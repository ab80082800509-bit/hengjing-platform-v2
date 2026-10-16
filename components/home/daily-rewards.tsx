'use client'

import { ChevronRight, Ticket } from 'lucide-react'
import { CheckinCard } from './checkin-card'
import { ResetCountdown } from './day-clock'
import { PRIZE_TABLE } from './scratch-config'

export function DailyRewards({
  loggedIn,
  points,
  rewards,
  checkedDays,
  checkedToday,
  skew,
  scratchLeft,
  scratchTotal,
  onCheckIn,
  onOpenScratch,
  onSeeRewards,
}: {
  loggedIn: boolean
  points: number
  rewards: number[]
  checkedDays: number
  checkedToday: boolean
  skew: number
  scratchLeft: number
  scratchTotal: number
  onCheckIn: () => void
  onOpenScratch: () => void
  onSeeRewards: () => void
}) {
  const exhausted = loggedIn && scratchLeft <= 0
  return (
    <section aria-label="每日任務" className="mt-6 grid gap-4 md:mt-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <CheckinCard
        loggedIn={loggedIn}
        points={points}
        rewards={rewards}
        checkedDays={checkedDays}
        checkedToday={checkedToday}
        skew={skew}
        onCheckIn={onCheckIn}
        footer={
          <button type="button" onClick={onSeeRewards} className="flex w-full items-center justify-center gap-1 text-xs font-bold text-brand-ink hover:underline">
            前往兌換賣家折價券
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        }
      />

      <div className="relative flex flex-col overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-accent via-card to-card p-5 shadow-lg shadow-black/20">
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-lime-400 to-green-600 text-white shadow-lg shadow-black/30">
            <Ticket className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-black">每日幸運刮刮卡</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">每日免費刮 1 次，邀請朋友進站再 +1 次</p>
          </div>
        </div>

        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="獎項與機率">
          {PRIZE_TABLE.map((p) => (
            <li key={p.kind} className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
              {p.label.split(' / ')[0]} <span className="text-brand-ink">約 {p.odds}%</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/50 px-4 py-3 text-xs">
          <div>
            <p className="text-muted-foreground">今日剩餘次數</p>
            <p className="text-lg font-black text-foreground">{loggedIn ? `${scratchLeft} / ${scratchTotal}` : '1 / 1'}</p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground">00:00 重製倒數</p>
            <ResetCountdown skew={skew} className="text-lg font-black text-brand-ink" />
          </div>
        </div>

        <div className="mt-auto pt-4">
          {exhausted ? (
            <button
              type="button"
              onClick={onOpenScratch}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-muted px-5 py-2.5 text-sm font-bold text-muted-foreground"
            >
              <Ticket className="size-4" aria-hidden />
              今日次數已用完，明天再來
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenScratch}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98]"
            >
              <Ticket className="size-4" aria-hidden />
              立即刮卡
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
