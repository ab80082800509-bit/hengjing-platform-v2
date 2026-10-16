'use client'

import { useState } from 'react'
import { CalendarClock, CircleAlert, RotateCcw, ShieldCheck } from 'lucide-react'
import { SheetModal } from './sheet-modal'

const fmt = (d: string) => d.replace(/-/g, '/')

export function SubscriptionManager({
  price,
  taxNote,
  nextDate,
  cancelAtPeriodEnd,
  disabled,
  onCancel,
  onResume,
}: {
  price: number
  taxNote?: string
  nextDate: string
  cancelAtPeriodEnd: boolean
  disabled?: boolean
  onCancel: () => void
  onResume: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <section
      aria-label="訂閱管理"
      className="space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black">
          <CalendarClock className="size-4 text-brand-ink" />訂閱管理
        </h3>
        {cancelAtPeriodEnd ? (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-300">已取消續約</span>
        ) : (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-bold text-emerald-300">訂閱中</span>
        )}
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-muted/60 px-3 py-2">
          <dt className="text-xs text-muted-foreground">{cancelAtPeriodEnd ? '權限保留至' : '下次扣款日'}</dt>
          <dd className="font-black">{fmt(nextDate)}</dd>
        </div>
        <div className="rounded-xl bg-muted/60 px-3 py-2">
          <dt className="text-xs text-muted-foreground">月費（含稅）</dt>
          <dd className="font-black">{cancelAtPeriodEnd ? '本期結束後不再扣款' : `NT$ ${price.toLocaleString('en-US')} / 月`}</dd>
          {taxNote && !cancelAtPeriodEnd && <dd className="mt-0.5 text-xs font-medium text-muted-foreground">{taxNote}</dd>}
        </div>
      </dl>

      {cancelAtPeriodEnd ? (
        <>
          <p className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-300">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-400" />
            您的權限與商品會保留至 {fmt(nextDate)}，之後才停止續約。改變心意時，期限內隨時可以恢復訂閱。
          </p>
          <button
            type="button"
            onClick={onResume}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] sm:w-auto"
          >
            <RotateCcw className="size-4" />恢復訂閱
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setConfirmOpen(true)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-destructive/40 bg-card px-5 py-2.5 text-sm font-bold text-destructive transition hover:bg-destructive/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          取消訂閱
        </button>
      )}

      {confirmOpen && (
        <SheetModal
          title="確定要取消訂閱嗎？"
          size="sm"
          onClose={() => setConfirmOpen(false)}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98]"
              >
                保留訂閱
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false)
                  onCancel()
                }}
                className="inline-flex items-center justify-center rounded-full border border-destructive/40 bg-card px-5 py-2.5 text-sm font-bold text-destructive transition hover:bg-destructive/10 active:scale-[0.98]"
              >
                確認取消續約
              </button>
            </div>
          }
        >
          <div className="space-y-3 p-5">
            <p className="flex items-start gap-2 rounded-2xl border border-blue-500/35 bg-blue-500/10 p-3.5 text-sm font-bold leading-relaxed text-blue-300">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-blue-400" />
              取消後您的權限與商品將保留至本期繳費週期結束，之後才停止續約。
            </p>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>權限與商品保留至 <b className="text-foreground">{fmt(nextDate)}</b></li>
              <li>期限前不會再自動扣款</li>
              <li>期限內可隨時按「恢復訂閱」，不需要重新註冊</li>
            </ul>
          </div>
        </SheetModal>
      )}
    </section>
  )
}
