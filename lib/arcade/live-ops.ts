/**
 * 三款遊戲共用的活動輪替表。每日、每週、每月、遊戲季與節慶活動都在這裡登記，到期依台北時間自動換下一期。
 *
 * - 週期一律用 Asia/Taipei（固定 UTC+8，沒有日光節約）。每週從週一 00:00 起算，與 game_reward_period('weekly') 相同。
 * - 活動以「規則」登記，不寫某一屆的日期；每一期的代號（periodKey）由時間算出，同一期只能完成一次。
 * - 活動獎勵只有活動紀錄與遊戲內收藏，不發 Pay 點數；payPoints 固定為 0，新增活動也不能改。
 * - 這支檔案只決定「現在輪到哪一期、顯示什麼」。能不能完成、有沒有完成，只認資料庫 claim_my_live_event 重算的結果。
 */
import { themeActiveOn, festivalThemeById, BRAND_THEME, FESTIVAL_THEMES } from './festival-theme'
import type { GameRewardId } from './game-reward-policy'

export const LIVE_OPS_VERSION = 1

const TPE_MS = 8 * 3600_000
const DAY_MS = 24 * 3600_000

export type LiveCadence = 'daily' | 'weekly' | 'monthly' | 'season' | 'festival'

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter'

export const SEASON_META: Record<SeasonId, { name: string; months: string; motif: string }> = {
  spring: { name: '春日花市季', months: '3～5 月', motif: '花' },
  summer: { name: '夏日海港季', months: '6～8 月', motif: '海' },
  autumn: { name: '秋收市集季', months: '9～11 月', motif: '楓' },
  winter: { name: '冬暖燈會季', months: '12～2 月', motif: '燈' },
}

export type LivePeriod = { key: string; startMs: number; endMs: number; index: number; label: string }

function local(ms: number) {
  const d = new Date(ms + TPE_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() }
}

const pad = (n: number) => String(n).padStart(2, '0')
const utcOfTaipei = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) - TPE_MS

export function taipeiDayOf(ms: number): string {
  const t = local(ms)
  return `${t.y}-${pad(t.m)}-${pad(t.d)}`
}

export function seasonOf(month: number): SeasonId {
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}

/** 某個時間點所在的那一期。index 是從 2026 年起算的期數，只用來輪替內容。 */
export function livePeriod(cadence: Exclude<LiveCadence, 'festival'>, ms: number): LivePeriod {
  const t = local(ms)
  if (cadence === 'daily') {
    const startMs = utcOfTaipei(t.y, t.m, t.d)
    return { key: `d:${taipeiDayOf(ms)}`, startMs, endMs: startMs + DAY_MS, index: Math.floor((startMs - utcOfTaipei(2026, 1, 1)) / DAY_MS), label: `${pad(t.m)}/${pad(t.d)}` }
  }
  if (cadence === 'weekly') {
    const back = (t.wd + 6) % 7
    const startMs = utcOfTaipei(t.y, t.m, t.d) - back * DAY_MS
    const index = Math.floor((startMs - utcOfTaipei(2025, 12, 29)) / (7 * DAY_MS))
    const s = local(startMs)
    const e = local(startMs + 6 * DAY_MS)
    return { key: `w:${taipeiDayOf(startMs)}`, startMs, endMs: startMs + 7 * DAY_MS, index, label: `${pad(s.m)}/${pad(s.d)}～${pad(e.m)}/${pad(e.d)}` }
  }
  if (cadence === 'monthly') {
    const startMs = utcOfTaipei(t.y, t.m, 1)
    const endMs = t.m === 12 ? utcOfTaipei(t.y + 1, 1, 1) : utcOfTaipei(t.y, t.m + 1, 1)
    return { key: `m:${t.y}-${pad(t.m)}`, startMs, endMs, index: (t.y - 2026) * 12 + t.m - 1, label: `${t.y} 年 ${t.m} 月` }
  }
  const season = seasonOf(t.m)
  const year = season === 'winter' && t.m <= 2 ? t.y - 1 : t.y
  const startMonth = { spring: 3, summer: 6, autumn: 9, winter: 12 }[season]
  const startMs = utcOfTaipei(year, startMonth, 1)
  const endMs = season === 'winter' ? utcOfTaipei(year + 1, 3, 1) : utcOfTaipei(year, startMonth + 3, 1)
  const order = ['spring', 'summer', 'autumn', 'winter'].indexOf(season)
  return { key: `s:${year}-${season}`, startMs, endMs, index: (year - 2026) * 4 + order, label: `${year} ${SEASON_META[season].name}` }
}

/**
 * 節慶期：連續幾個台北日曆日都算同一個主題，就合成同一期，代號用開始那天。
 * 某一天算不算在期間內，跟已安裝的活動窗口一樣，看主題在當天正午是否生效；
 * 不把跨年 18:00 才開始的畫面主題，提前算成資料庫沒有的另一期。
 */
export function festivalPeriod(festivalId: string, ms: number): LivePeriod | null {
  const theme = festivalThemeById(festivalId, FESTIVAL_THEMES)
  if (!theme) return null
  const today = taipeiDayOf(ms)
  if (!themeActiveOn(theme, today)) return null
  let startMs = utcOfTaipei(...(today.split('-').map(Number) as [number, number, number]))
  for (let i = 0; i < 40 && themeActiveOn(theme, taipeiDayOf(startMs - DAY_MS)); i += 1) startMs -= DAY_MS
  let endMs = startMs + DAY_MS
  for (let i = 0; i < 40 && themeActiveOn(theme, taipeiDayOf(endMs)); i += 1) endMs += DAY_MS
  const s = local(startMs)
  return { key: `f:${festivalId}:${taipeiDayOf(startMs)}`, startMs, endMs, index: s.y - 2026, label: `${s.y} ${theme.name}` }
}

/** 同一期固定挑同一個；換期才換。 */
export function rotate<T>(pool: readonly T[], period: Pick<LivePeriod, 'index'>, salt = 0): T {
  const n = pool.length
  return pool[(((period.index + salt) % n) + n) % n]
}

/* ---------- 活動登記表 ---------- */

/** 資料庫能重算的進度來源。名稱與 game_live_event_metric 一一對應，新增時兩邊一起加。 */
export type LiveMetric =
  | 'merge.orders' // 合成小舖：這一期交付的顧客訂單數
  | 'merge.merges' // 合成小舖：這一期的合成次數
  | 'street.served' // 夢想商店街：這一期服務的顧客數（以報名時的雲端存檔為起點）
  | 'street.earned' // 夢想商店街：這一期的營業收入
  | 'block.ranked' // 方塊大挑戰：這一期通過伺服器重算的排行賽場數
  | 'block.score' // 方塊大挑戰：這一期排行賽最高分

/** 這一版活動只留下永久的活動紀錄與勳章；遊戲金幣、Pay 點數都不從活動發放。 */
export type LiveReward = { kind: 'record'; medal: string }

export type LiveEventDef = {
  id: string
  game: GameRewardId
  cadence: LiveCadence
  /** cadence 為 festival 時對應的節慶主題代號（沿用 27 種節慶主題）。 */
  festivalId?: string
  /** 同一個活動輪流出現的幾種內容；每一期依期數挑一個。 */
  variants: readonly { title: string; detail: string; metric: LiveMetric; target: number }[]
  reward: LiveReward
  /** 永遠是 0。活動不發 Pay 點數，正式點數額度另行簽核。 */
  payPoints: 0
}

const FESTIVAL_GAME: Record<string, GameRewardId> = {
  'lunar-new-year': 'merge_shop',
  'mid-autumn': 'dream_street',
  christmas: 'block_challenge',
}
const FESTIVAL_GOAL: Record<GameRewardId, { metric: LiveMetric; target: number; detail: string; medal: string }> = {
  merge_shop: { metric: 'merge.orders', target: 15, detail: '節慶期間交付 15 張顧客訂單', medal: 'it-gift-5' },
  dream_street: { metric: 'street.served', target: 40, detail: '節慶期間服務 40 位顧客', medal: 'ic-street' },
  block_challenge: { metric: 'block.ranked', target: 1, detail: '節慶期間完成 1 場排行賽', medal: 'ic-trophy' },
}
const FESTIVAL_ORDER: readonly GameRewardId[] = ['merge_shop', 'dream_street', 'block_challenge']
const FESTIVAL_ID_FIX: Record<string, string> = {
  'lunar-new-year': 'fest_new_year_merge',
  'mid-autumn': 'fest_mid_autumn_street',
  christmas: 'fest_christmas_block',
}

/** 27 種節慶主題各有一個限定活動，輪流落在三款遊戲；期間跟著主題自動開始與結束。 */
const FESTIVAL_EVENTS: LiveEventDef[] = FESTIVAL_THEMES.filter((theme) => theme.id !== BRAND_THEME.id).map((theme, index) => {
  const game = FESTIVAL_GAME[theme.id] ?? FESTIVAL_ORDER[index % 3]
  const goal = FESTIVAL_GOAL[game]
  return {
    id: FESTIVAL_ID_FIX[theme.id] ?? `fest_${theme.id.replace(/-/g, '_')}`,
    game,
    cadence: 'festival',
    festivalId: theme.id,
    variants: [{ title: `${theme.name}限定活動`, detail: goal.detail, metric: goal.metric, target: goal.target }],
    reward: { kind: 'record', medal: goal.medal },
    payPoints: 0,
  }
})

export const LIVE_EVENTS: readonly LiveEventDef[] = [
  {
    id: 'merge_daily_errand',
    game: 'merge_shop',
    cadence: 'daily',
    variants: [
      { title: '今日跑腿', detail: '今天交付 5 張顧客訂單', metric: 'merge.orders', target: 5 },
      { title: '今日手作', detail: '今天合成 15 次商品', metric: 'merge.merges', target: 15 },
    ],
    reward: { kind: 'record', medal: 'ic-chest-open' },
    payPoints: 0,
  },
  {
    id: 'street_daily_rounds',
    game: 'dream_street',
    cadence: 'daily',
    variants: [
      { title: '今日巡街', detail: '今天服務 20 位顧客', metric: 'street.served', target: 20 },
      { title: '今日營收', detail: '今天營業收入 800 金幣', metric: 'street.earned', target: 800 },
    ],
    reward: { kind: 'record', medal: 'ic-coin' },
    payPoints: 0,
  },
  {
    id: 'merge_weekly_rush',
    game: 'merge_shop',
    cadence: 'weekly',
    variants: [
      { title: '熟客感謝週', detail: '本週交付 25 張顧客訂單', metric: 'merge.orders', target: 25 },
      { title: '合成手作週', detail: '本週合成 60 次商品', metric: 'merge.merges', target: 60 },
      { title: '巷口人氣週', detail: '本週交付 35 張顧客訂單', metric: 'merge.orders', target: 35 },
    ],
    reward: { kind: 'record', medal: 'ic-quest' },
    payPoints: 0,
  },
  {
    id: 'street_monthly_fair',
    game: 'dream_street',
    cadence: 'monthly',
    variants: [
      { title: '月光市集', detail: '本月服務 120 位顧客', metric: 'street.served', target: 120 },
      { title: '招牌營收月', detail: '本月營業收入 6,000 金幣', metric: 'street.earned', target: 6000 },
      { title: '街坊同樂月', detail: '本月服務 160 位顧客', metric: 'street.served', target: 160 },
    ],
    reward: { kind: 'record', medal: 'ic-shop' },
    payPoints: 0,
  },
  {
    id: 'block_weekly_cup',
    game: 'block_challenge',
    cadence: 'weekly',
    variants: [
      { title: '週末盃排行賽', detail: '本週完成 3 場排行賽', metric: 'block.ranked', target: 3 },
      { title: '高分衝刺週', detail: '本週排行賽單場 4,000 分', metric: 'block.score', target: 4000 },
    ],
    reward: { kind: 'record', medal: 'ic-star' },
    payPoints: 0,
  },
  {
    id: 'season_street_parade',
    game: 'dream_street',
    cadence: 'season',
    variants: [
      { title: '季節遊行', detail: '這一季服務 400 位顧客', metric: 'street.served', target: 400 },
    ],
    reward: { kind: 'record', medal: 'ic-up' },
    payPoints: 0,
  },
  ...FESTIVAL_EVENTS,
]

export type LiveEventInstance = {
  id: string
  game: GameRewardId
  cadence: LiveCadence
  period: LivePeriod
  /** 資料庫的領取鍵：活動代號＋期別。重新整理、換裝置都不會變。 */
  claimKey: string
  title: string
  detail: string
  metric: LiveMetric
  target: number
  reward: LiveReward
  payPoints: 0
}

export function eventPeriod(def: LiveEventDef, ms: number): LivePeriod | null {
  if (def.cadence === 'festival') return def.festivalId ? festivalPeriod(def.festivalId, ms) : null
  return livePeriod(def.cadence, ms)
}

/** 現在進行中的活動；節慶活動只在節慶期間出現。 */
export function activeLiveEvents(ms: number, game?: GameRewardId): LiveEventInstance[] {
  const out: LiveEventInstance[] = []
  for (const def of LIVE_EVENTS) {
    if (game && def.game !== game) continue
    const period = eventPeriod(def, ms)
    if (!period) continue
    const variant = rotate(def.variants, period)
    out.push({ id: def.id, game: def.game, cadence: def.cadence, period, claimKey: `${def.id}@${period.key}`, ...variant, reward: def.reward, payPoints: 0 })
  }
  return out
}

export const CADENCE_LABEL: Record<LiveCadence, string> = {
  daily: '每日',
  weekly: '每週',
  monthly: '每月',
  season: '遊戲季',
  festival: '節慶限定',
}

/**
 * 倒數以伺服器時間為準，只加上這台裝置自讀取後經過的時間。
 * 裝置時區與往回調的系統時鐘不會改期別；往回調時維持讀取當下的伺服器時間。
 */
export function anchoredNow(serverNowMs: number, fetchedAtMs: number, localNowMs: number): number {
  const elapsed = localNowMs - fetchedAtMs
  if (!Number.isFinite(serverNowMs) || !Number.isFinite(elapsed)) return localNowMs
  return serverNowMs + Math.max(0, elapsed)
}

export function untilText(endMs: number, nowMs: number): string {
  const left = Math.max(0, endMs - nowMs)
  const days = Math.floor(left / DAY_MS)
  const hours = Math.floor((left % DAY_MS) / 3600_000)
  const mins = Math.floor((left % 3600_000) / 60_000)
  if (days > 0) return `${days} 天 ${hours} 小時`
  if (hours > 0) return `${hours} 小時 ${mins} 分`
  return `${mins} 分`
}

/** 給 SQL 產生器用：一個節慶在某段年份內每一期的開始與結束日（含頭不含尾）。 */
export function festivalWindows(festivalId: string, fromYear: number, toYear: number): { startsOn: string; endsOn: string }[] {
  const theme = festivalThemeById(festivalId, FESTIVAL_THEMES)
  if (!theme) return []
  const out: { startsOn: string; endsOn: string }[] = []
  let open: string | null = null
  for (let ms = utcOfTaipei(fromYear, 1, 1); ms < utcOfTaipei(toYear + 1, 1, 1); ms += DAY_MS) {
    const day = taipeiDayOf(ms)
    const on = themeActiveOn(theme, day)
    if (on && !open) open = day
    if (!on && open) {
      out.push({ startsOn: open, endsOn: day })
      open = null
    }
  }
  if (open) out.push({ startsOn: open, endsOn: taipeiDayOf(utcOfTaipei(toYear + 1, 1, 1)) })
  return out
}
