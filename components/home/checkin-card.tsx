'use client'

import type { ReactNode } from 'react'
import { CalendarCheck, Check, Clock, Coins, Gift } from 'lucide-react'
import { ResetCountdown } from './day-clock'

export type CheckinPhase = 'boot' | 'loading' | 'guest' | 'ready' | 'error'

export function CheckinCard({
  phase,
  points,
  rewards,
  checkedDays,
  checkedToday,
  nextReward,
  skew,
  busy = false,
  burstPoints = null,
  errorText = null,
  onCheckIn,
  footer,
}: {
  phase: CheckinPhase
  points: number
  rewards: readonly number[]
  checkedDays: number
  checkedToday: boolean
  nextReward: number | null
  skew: number
  busy?: boolean
  burstPoints?: number | null
  errorText?: string | null
  onCheckIn: () => void
  footer?: ReactNode
}) {
  const total = rewards.length
  const ready = phase === 'ready'
  const done = ready ? checkedDays : 0
  const signed = ready && checkedToday
  const claimable = ready && !checkedToday && nextReward != null
  const balanceText = phase === 'guest' ? 0 : ready ? points : '…'
  const subtitle =
    phase === 'boot' || phase === 'loading'
      ? '正在讀取簽到狀態'
      : phase === 'error'
        ? errorText || '簽到狀態暫時無法讀取，點數沒有變動'
        : signed
          ? `已連續簽到 ${done} 天`
          : done > 0
            ? `已連續簽到 ${done} 天，今天簽到繼續累計`
            : '每天簽到領點數，連續 7 天有加碼'

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-lg shadow-black/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-lg font-black">
            <CalendarCheck className="size-5 shrink-0 text-brand-ink" aria-hidden />
            每日簽到
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="flex items-center justify-end gap-1 text-2xl font-black text-brand-ink">
            <Coins className="size-5" aria-hidden />
            {balanceText}
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
        aria-valuetext={ready ? `已簽到 ${done} / ${total} 天` : '簽到進度讀取中'}
        className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-[width] duration-500"
          style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
        />
      </div>

      <ol className="mt-3 grid grid-cols-7 gap-1.5" aria-label="7 天簽到進度">
        {rewards.map((reward, index) => {
          const isDone = index < done
          const isToday = claimable && index === checkedDays
          const isBonus = index === total - 1
          return (
            <li
              key={index}
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
              <span>Day {index + 1}</span>
              {isDone ? (
                <Check className="size-4" aria-hidden />
              ) : isBonus ? (
                <Gift className="size-4" aria-hidden />
              ) : (
                <Coins className="size-4" aria-hidden />
              )}
              <span>+{reward}</span>
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
        ) : phase === 'boot' || phase === 'loading' || busy ? (
          <button
            type="button"
            disabled
            aria-busy="true"
            className="inline-flex w-full cursor-wait items-center justify-center gap-1.5 rounded-full bg-muted px-5 py-2.5 text-sm font-bold text-muted-foreground"
          >
            <CalendarCheck className="size-4" aria-hidden />
            {busy ? '簽到中，正在確認入帳' : '正在讀取簽到狀態'}
          </button>
        ) : phase === 'error' ? (
          <button
            type="button"
            onClick={onCheckIn}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98]"
          >
            <CalendarCheck className="size-4" aria-hidden />
            重新讀取簽到狀態
          </button>
        ) : (
          <button
            type="button"
            onClick={onCheckIn}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98]"
          >
            <CalendarCheck className="size-4" aria-hidden />
            立即簽到（領取 +{phase === 'guest' ? rewards[0] : nextReward} 點）
          </button>
        )}
        {burstPoints != null && (
          <span
            role="status"
            className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 animate-bounce whitespace-nowrap rounded-full bg-amber-400 px-4 py-1 text-sm font-black text-amber-950 shadow-lg"
          >
            簽到成功 +{burstPoints} 點
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
