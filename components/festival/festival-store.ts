'use client'

/**
 * 全站唯一的節慶主題狀態。首頁、市集、會員中心、賣家後台、遊樂園都讀這一份，
 * 不會出現不同畫面各算各的主題。只影響畫面，不寫任何資料。
 *
 * 正式主題一律依台灣時間自動判定，沒有任何人能手動切換。
 * 預覽與模擬時間只給平台管理員，且只影響管理員自己這個分頁：
 * - 後台「節慶預覽」或 ?festival=<主題編號> / ?festivalAt=<ISO 時間>，
 *   都要先通過 Supabase 驗證的登入身分與 profiles.role = 'admin' 才會生效。
 * - ?festival=auto、?festivalAt=now 或「恢復今日主題」隨時可結束預覽。
 * - 登出或換成其他帳號時，預覽立即結束。
 * 一般會員與訪客帶這些參數或改 sessionStorage 都不會生效，進站時會被清除。
 *
 * 本機開發可設 NEXT_PUBLIC_FESTIVAL_DEV_PREVIEW=1 並用 next dev 在 localhost 開啟免登入預覽；
 * 正式建置的 NODE_ENV 為 production，這條路徑不存在。
 */
import { useSyncExternalStore } from 'react'
import {
  BRAND_THEME,
  festivalScheduleIssues,
  festivalThemeById,
  newYearMoment,
  readFestivalOverride,
  resolveFestivalTheme,
  type FestivalTheme,
} from '@/lib/arcade/festival-theme'
import { taipeiCalendarDate } from '@/lib/rewards/taipei-day'

/** 跨年主題上顯示的年份：12/31 起顯示新的一年；預覽時顯示即將到來的一年（1 月內則為當年）。 */
export function festivalYear(now: number): number {
  const instant = new Date(now)
  const moment = newYearMoment(instant)
  if (moment) return moment.year
  const [year, month] = taipeiCalendarDate(instant).split('-').map(Number)
  return month === 1 ? year : year + 1
}

export type FestivalSnapshot = {
  theme: FestivalTheme
  /** 依日期自動判定的主題（預覽時與 theme 不同）。 */
  resolved: FestivalTheme
  preview: boolean
  /** 管理員選擇的預覽主題；null 代表跟隨今天。 */
  previewId: string | null
  /** 畫面時鐘（毫秒）。模擬時間時會從指定時間繼續往前走。 */
  now: number
  simulated: boolean
  issues: string[]
}

const PREVIEW_KEY = 'pay-festival-preview'
const CLOCK_KEY = 'pay-festival-clock'

const SERVER_SNAPSHOT: FestivalSnapshot = { theme: BRAND_THEME, resolved: BRAND_THEME, preview: false, previewId: null, now: 0, simulated: false, issues: [] }

let started = false
let previewId: string | null = null
let clockOffset = 0
let snapshot: FestivalSnapshot = SERVER_SNAPSHOT
let timer: number | null = null
let loggedIssues = ''
const listeners = new Set<() => void>()

/** 目前登入的帳號；undefined 代表還沒收到第一次登入狀態。 */
let sessionUserId: string | null | undefined
/** 每次換帳號就加一，讓換帳號前發出的管理員驗證結果作廢。 */
let authGeneration = 0

function devPreviewAllowed(): boolean {
  if (process.env.NODE_ENV !== 'development' || process.env.NEXT_PUBLIC_FESTIVAL_DEV_PREVIEW !== '1') return false
  return ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

function storageGet(key: string): string | null {
  try { return window.sessionStorage.getItem(key) } catch { return null }
}

function storageSet(key: string, value: string | null) {
  try {
    if (value == null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, value)
  } catch { /* 無痕模式等情況下不保存，只影響本頁 */ }
}

/** 由 Supabase 驗證登入身分，再讀受 RLS 與觸發器保護的 profiles.role；不是管理員就回傳 null。 */
async function verifyPlatformAdmin(): Promise<string | null> {
  try {
    const { supabase } = await import('@/lib/supabase')
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return null
    const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', data.user.id).maybeSingle()
    return !profileError && profile?.role === 'admin' ? data.user.id : null
  } catch {
    return null
  }
}

function compute() {
  const now = Date.now() + clockOffset
  const instant = new Date(now)
  const resolved = resolveFestivalTheme(instant)
  const forced = previewId ? festivalThemeById(previewId) : null
  const theme = forced ?? resolved
  const issues = festivalScheduleIssues(instant)
  const key = issues.join('|')
  if (key && key !== loggedIssues) console.info('[節慶主題] 以下排程今天無法可靠計算，已略過：', issues)
  loggedIssues = key
  const changed = theme.id !== snapshot.theme.id || resolved.id !== snapshot.resolved.id || (forced?.id ?? null) !== snapshot.previewId || key !== snapshot.issues.join('|') || (clockOffset !== 0) !== snapshot.simulated
  const minuteChanged = Math.floor(now / 60000) !== Math.floor(snapshot.now / 60000)
  if (!changed && !minuteChanged && snapshot !== SERVER_SNAPSHOT) return
  snapshot = { theme, resolved, preview: !!forced && forced.id !== resolved.id, previewId: forced?.id ?? null, now, simulated: clockOffset !== 0, issues }
  listeners.forEach((listener) => listener())
}

/** 對齊畫面時鐘的下一個整分鐘重算，網頁跨日持續開著也會準時切換。 */
function schedule() {
  if (timer != null) window.clearTimeout(timer)
  const now = Date.now() + clockOffset
  const wait = 60000 - (now % 60000) + 50
  timer = window.setTimeout(() => {
    compute()
    schedule()
  }, wait)
}

function applyPreview(id: string | null) {
  previewId = id && festivalThemeById(id) ? id : null
  storageSet(PREVIEW_KEY, previewId)
}

function applyClock(at: Date | null) {
  if (!at || Number.isNaN(at.getTime())) {
    clockOffset = 0
    storageSet(CLOCK_KEY, null)
    return
  }
  const setAt = Date.now()
  clockOffset = at.getTime() - setAt
  storageSet(CLOCK_KEY, JSON.stringify({ at: at.getTime(), setAt }))
}

function readStoredClock(): Date | null {
  try {
    const clock = JSON.parse(storageGet(CLOCK_KEY) ?? 'null') as { at: number; setAt: number } | null
    if (clock && Number.isFinite(clock.at) && Number.isFinite(clock.setAt)) return new Date(Date.now() + clock.at - clock.setAt)
  } catch { /* 格式錯誤就當作沒有 */ }
  return null
}

function endPreview() {
  previewId = null
  clockOffset = 0
  storageSet(PREVIEW_KEY, null)
  storageSet(CLOCK_KEY, null)
}

function refresh() {
  compute()
  schedule()
}

/** 換帳號（登出、登入另一個帳號）時立即結束預覽，不讓前一位管理員的預覽留給下一位使用者。 */
function watchAuth() {
  void import('@/lib/supabase').then(({ supabase }) => {
    supabase.auth.onAuthStateChange((_event: string, session: { user?: { id?: string } } | null) => {
      const uid = session?.user?.id ?? null
      if (sessionUserId === undefined) {
        sessionUserId = uid
        return
      }
      if (uid === sessionUserId) return
      sessionUserId = uid
      authGeneration += 1
      if (devPreviewAllowed()) return
      if (previewId || clockOffset) {
        endPreview()
        refresh()
      }
    })
  }).catch(() => { /* 沒有 Supabase 設定時沒有管理員，自然不會有預覽 */ })
}

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  const override = readFestivalOverride(window.location.search)
  if (override.clearPreview) storageSet(PREVIEW_KEY, null)
  if (override.clearAt) storageSet(CLOCK_KEY, null)

  const storedPreview = storageGet(PREVIEW_KEY)
  const wantPreview = override.previewId ?? (storedPreview && festivalThemeById(storedPreview) ? storedPreview : null)
  const wantClock = override.at ?? readStoredClock()

  if (devPreviewAllowed()) {
    applyPreview(wantPreview)
    applyClock(wantClock)
    refresh()
    watchAuth()
    return
  }

  // 先清掉，確認是管理員後才套用；非管理員不會看到任何一瞬間的預覽。
  previewId = null
  clockOffset = 0
  storageSet(PREVIEW_KEY, null)
  storageSet(CLOCK_KEY, null)
  refresh()
  watchAuth()

  if (!wantPreview && !wantClock) return
  const generation = authGeneration
  void verifyPlatformAdmin().then((adminId) => {
    if (!adminId || generation !== authGeneration) return
    applyPreview(wantPreview)
    applyClock(wantClock)
    refresh()
  })
}

let bootQueued = false

function subscribe(listener: () => void) {
  listeners.add(listener)
  // 第一次訂閱先回傳和伺服器相同的預設主題，等這次繪製結束再依台北時間重算。
  // 若在 getSnapshot 裡直接重算，節慶當天伺服器與瀏覽器的第一屏會不一致。
  if (!bootQueued && typeof window !== 'undefined') {
    bootQueued = true
    queueMicrotask(() => {
      start()
      listeners.forEach((item) => item())
    })
  }
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return started ? snapshot : SERVER_SNAPSHOT
}

export function useFestivalSnapshot(): FestivalSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT)
}

export function useFestivalPreviewId(): string | null {
  return useFestivalSnapshot().previewId
}

export type AdminFestivalPreviewResult = 'ok' | 'not_admin'

/**
 * 平台管理員私下預覽：選一個主題（null 代表依模擬時間自動判定）並可撥動畫面時鐘（null 代表現在）。
 * 每次都重新驗證管理員身分；只寫在這個分頁的 sessionStorage，不寫資料庫、不影響其他會員或正式排程。
 */
export async function startAdminFestivalPreview(options: { themeId: string | null; at: Date | null }): Promise<AdminFestivalPreviewResult> {
  start()
  const generation = authGeneration
  const adminId = await verifyPlatformAdmin()
  if (!adminId || generation !== authGeneration) return 'not_admin'
  applyPreview(options.themeId)
  applyClock(options.at)
  refresh()
  return 'ok'
}

/** 結束預覽並回到依台灣時間自動判定的今日主題。任何人都可以呼叫，只會讓畫面回到正式狀態。 */
export function restoreTodayFestival() {
  start()
  endPreview()
  refresh()
}
