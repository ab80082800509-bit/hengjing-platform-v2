'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarCheck, Check, Clock, Coins, Gift } from 'lucide-react'
import { ResetCountdown } from './day-clock'

export function CheckinCard({
  loggedIn,
  points,
  rewards,
  checkedDays,
  checkedToday,
  skew,
  onCheckIn,
  footer,
}: {
  loggedIn: boolean
  points: number
  rewards: number[]
  checkedDays: number
  checkedToday: boolean
  skew: number
  onCheckIn: () => void
  footer?: ReactNode
}) {
  const [burst, setBurst] = useState<number | null>(null)
  const prevToday = useRef(checkedToday)
  useEffect(() => {
    if (checkedToday && !prevToday.current) {
      setBurst(rewards[Math.max(0, checkedDays - 1)])
      const t = setTimeout(() => setBurst(null), 1800)
      prevToday.current = checkedToday
      return () => clearTimeout(t)
    }
    prevToday.current = checkedToday
  }, [checkedToday, checkedDays, rewards])

  const total = rewards.length
  const done = loggedIn ? checkedDays : 0
  const signed = loggedIn && checkedToday
  const nextReward = rewards[Math.min(done, total - 1)]

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-lg shadow-black/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-lg font-black">
            <CalendarCheck className="size-5 shrink-0 text-brand-ink" aria-hidden />
            每日簽到
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {signed ? `已連續簽到 ${done} 天` : done > 0 ? `已連續簽到 ${done} 天，今天簽到繼續累計` : '每天簽到領點數，連續 7 天有加碼'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="flex items-center justify-end gap-1 text-2xl font-black text-brand-ink">
            <Coins className="size-5" aria-hidden />
            {loggedIn ? points : 0}
          </p>
          <p className="text-xs text-muted-foreground">我的點數</p>
        </div>
      </div>

      <div
        role="progressbar"
        aria-label="連續簽到進度"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`已簽到 ${done} / ${total} 天`}
        className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-[width] duration-500"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>

      <ol className="mt-3 grid grid-cols-7 gap-1.5" aria-label="7 天簽到進度">
        {rewards.map((r, i) => {
          const isDone = i < done
          const isToday = loggedIn && !checkedToday && i === checkedDays
          const isBonus = i === total - 1
          return (
            <li
              key={i}
              className={`flex flex-col items-center gap-0.5 rounded-xl border py-2 text-[11px] font-bold ${
                isDone
                  ? 'border-primary bg-primary text-primary-foreground'
                  : isToday
                    ? 'border-primary bg-accent text-brand-ink ring-2 ring-primary/40'
                    : isBonus
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                      : 'border-border bg-muted/50 text-muted-foreground'
              }`}
            >
              <span>Day {i + 1}</span>
              {isDone ? (
                <Check className="size-4" aria-hidden />
              ) : isBonus ? (
                <Gift className="size-4" aria-hidden />
              ) : (
                <Coins className="size-4" aria-hidden />
              )}
              <span>+{r}</span>
            </li>
          )
        })}
      </ol>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Gift className="size-3 shrink-0 text-amber-400" aria-hidden />
        連續 7 天，Day 7 額外獎勵 +{rewards[total - 1]} 點；中斷一天會從 Day 1 重新累計
      </p>

      <div className="relative mt-4">
        {signed ? (
          <button
            type="button"
            disabled
            className="inline-flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-full bg-emerald-500/15 px-5 py-2.5 text-sm font-bold text-emerald-400 ring-1 ring-inset ring-emerald-500/40"
          >
            <Check className="size-4" aria-hidden />
            已簽到
          </button>
        ) : (
          <button
            type="button"
            onClick={onCheckIn}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98]"
          >
            <CalendarCheck className="size-4" aria-hidden />
            立即簽到（領取 +{nextReward} 點）
          </button>
        )}
        {burst !== null && (
          <span
            role="status"
            className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 animate-bounce whitespace-nowrap rounded-full bg-amber-400 px-4 py-1 text-sm font-black text-amber-950 shadow-lg"
          >
            簽到成功 +{burst} 點
          </span>
        )}
      </div>

      <p className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center text-xs text-muted-foreground">
        <Clock className="size-3.5 shrink-0" aria-hidden />
        {signed ? '距離每日 00:00 重製還剩' : '今日簽到於 00:00 重製，還剩'}
        <ResetCountdown skew={skew} className="font-black text-foreground" />
        {signed && <span>，明天可再簽到</span>}
      </p>

      {footer && <div className="mt-auto pt-3">{footer}</div>}
    </div>
  )
}
