'use client'

/**
 * 平台管理員專用的節慶預覽。只出現在已驗證的管理員後台；
 * 每次套用都會在 festival-store 重新驗證管理員身分，只影響管理員自己這個分頁。
 * 正式主題不能在這裡切換，永遠依台灣時間自動運作。
 */
import { useState } from 'react'
import { FESTIVAL_THEMES } from '@/lib/arcade/festival-theme'
import { festivalStyle } from '@/components/arcade/festival-banner'
import {
  restoreTodayFestival,
  startAdminFestivalPreview,
  useFestivalSnapshot,
} from './festival-store'

const panelCls = 'rounded-2xl border border-border/70 bg-card shadow-sm'
const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'

const TAIPEI_TIME = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatTaipei(now: number): string {
  return now ? TAIPEI_TIME.format(new Date(now)) : '讀取中'
}

/** datetime-local 的值一律當作台灣時間解讀。 */
function parseTaipeiLocal(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const at = new Date(`${value}:00+08:00`)
  return Number.isNaN(at.getTime()) ? null : at
}

export function FestivalAdminPreview() {
  const snap = useFestivalSnapshot()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [simulateAt, setSimulateAt] = useState('')
  const themes = FESTIVAL_THEMES.filter((item) => item.id !== 'brand')
  const active = snap.preview || snap.simulated || snap.previewId !== null

  const run = async (themeId: string | null, at: Date | null, done: string) => {
    if (busy) return
    setBusy(true)
    setMessage('')
    const result = await startAdminFestivalPreview({ themeId, at })
    setBusy(false)
    setMessage(result === 'ok' ? done : '無法確認平台管理員身分，未套用預覽。請重新登入管理員後台。')
  }

  const simulate = () => {
    const at = parseTaipeiLocal(simulateAt)
    if (!at) {
      setMessage('請輸入完整的台灣日期與時間。')
      return
    }
    void run(null, at, `已模擬台灣時間 ${formatTaipei(at.getTime())}，主題依正式排程自動判定，時鐘會繼續往前走。`)
  }

  return (
    <section className="space-y-4" aria-label="節慶預覽">
      <div className={`${panelCls} space-y-3 p-5`}>
        <h2 className="text-sm font-black">節慶預覽（僅管理員自己的畫面）</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          正式主題一律依台灣時間自動切換，這裡無法變更。預覽只存在你目前這個分頁，不會寫入資料庫，也不會影響其他會員的畫面或正式日期排程；登出、換帳號或關閉分頁後自動結束。
        </p>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-xl bg-muted/50 p-3">
            <dt className="text-xs font-bold text-muted-foreground">目前畫面</dt>
            <dd className="font-black">{snap.theme.name}</dd>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <dt className="text-xs font-bold text-muted-foreground">依時間自動判定</dt>
            <dd className="font-black">{snap.resolved.name}</dd>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <dt className="text-xs font-bold text-muted-foreground">{snap.simulated ? '模擬台灣時間' : '台灣時間'}</dt>
            <dd className="font-black tabular-nums">{formatTaipei(snap.now)}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-bold text-muted-foreground" htmlFor="festival-simulate-at">
            模擬台灣日期與時間
            <input
              id="festival-simulate-at"
              type="datetime-local"
              value={simulateAt}
              onChange={(event) => setSimulateAt(event.target.value)}
              className="rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </label>
          <button type="button" className={btnPrimary} disabled={busy || !simulateAt} onClick={simulate}>模擬自動節慶</button>
          <button
            type="button"
            className={btnGhost}
            disabled={busy || !active}
            onClick={() => {
              restoreTodayFestival()
              setMessage('已恢復今日主題。')
            }}
          >
            恢復今日主題
          </button>
        </div>
        {message ? <p role="status" className="text-xs font-bold text-muted-foreground">{message}</p> : null}
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label={`全部 ${themes.length} 個節慶主題`}>
        {themes.map((item) => (
          <li key={item.id} className={`${panelCls} flex items-center gap-3 p-3`} style={festivalStyle(item)}>
            <span className="fx-motif shrink-0">{item.motif}</span>
            <span className="min-w-0 flex-1">
              <b className="text-sm font-black">{item.name}</b>
              <small className="block text-xs text-muted-foreground">{item.eyebrow}｜優先順序 {item.priority}</small>
            </span>
            <button
              type="button"
              className={`${btnGhost} shrink-0 px-3 py-1.5 text-xs`}
              aria-pressed={snap.previewId === item.id}
              disabled={busy}
              onClick={() => void run(item.id, null, `正在預覽${item.name}，只有你的畫面看得到。`)}
            >
              {snap.previewId === item.id ? '預覽中' : '預覽'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 管理員預覽期間在任何頁面都提醒並提供「恢復今日主題」。非管理員不會進入預覽狀態，所以看不到。 */
export function FestivalPreviewNotice() {
  const snap = useFestivalSnapshot()
  if (!snap.previewId && !snap.simulated) return null
  const label = snap.previewId ? `預覽：${snap.theme.name}` : `模擬 ${formatTaipei(snap.now)}`
  return (
    <div role="status" className="fixed top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2 text-xs font-bold shadow-xl backdrop-blur md:top-auto md:bottom-6">
      <span>管理員{label}</span>
      <button type="button" onClick={restoreTodayFestival} className="rounded-full bg-primary px-3 py-1 text-primary-foreground">
        恢復今日主題
      </button>
    </div>
  )
}
