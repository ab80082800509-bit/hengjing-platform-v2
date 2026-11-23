'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { Coins, Save, X } from 'lucide-react'
import { fetchMyCouponPointOffers, saveMyCouponPointOffer } from '@/lib/rewards/coupon-client'
import type { CouponPointOffer } from '@/lib/rewards/coupon-snapshot'
import { btnGhost, btnPrimary, inputCls, panelCls } from './styles'
import { couponStatus, couponTitle, slashDate, type CouponLike } from './coupon-utils'

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6)

function OfferForm({
  coupon,
  offer,
  today,
  onSave,
  onCancel,
}: {
  coupon: CouponLike
  offer: CouponPointOffer | undefined
  today: string
  onSave: (next: { enabled: boolean; pointsCost: number; pointsQty: number; endsOn: string }) => Promise<string | null>
  onCancel: () => void
}) {
  const uid = useId()
  const [enabled, setEnabled] = useState(offer?.enabled ?? true)
  const [cost, setCost] = useState(offer ? String(offer.pointsCost) : '')
  const [qty, setQty] = useState(offer ? String(offer.pointsQty) : '')
  const [endsOn, setEndsOn] = useState(offer?.endsOn ?? coupon.endAt ?? today)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const issued = offer?.pointsIssued ?? 0

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (saving) return
    const costN = Number(cost)
    const qtyN = Number(qty)
    let msg = ''
    if (!Number.isInteger(costN) || costN < 1 || costN > 100000) msg = '請輸入 1–100,000 的兌換所需點數'
    else if (!Number.isInteger(qtyN) || qtyN < 1 || qtyN > 10000) msg = '請輸入 1–10,000 的可兌換數量'
    else if (qtyN > coupon.qty) msg = `可兌換數量不可超過發行總數量（${coupon.qty} 張）`
    else if (qtyN < issued) msg = `可兌換數量不可低於已兌換數量（${issued} 張）`
    else if (!endsOn) msg = '請選擇兌換截止日'
    else if (coupon.endAt && endsOn > coupon.endAt) msg = '兌換截止日不可晚於優惠券結束日'
    else if (enabled && endsOn < today) msg = '兌換截止日不可早於今天'
    setError(msg)
    if (msg) return
    setSaving(true)
    try {
      const err = await onSave({ enabled, pointsCost: costN, pointsQty: qtyN, endsOn })
      if (err) setError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3 rounded-xl border border-border bg-muted/30 p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
        <span className="text-sm font-black text-foreground">我授權此優惠券開放買家使用 Pay 點數兌換</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-cost`} className="block text-xs font-bold">兌換所需 Pay 點數</label>
          <input id={`${uid}-cost`} className={inputCls} inputMode="numeric" value={cost} onChange={(e) => setCost(digits(e.target.value))} placeholder="由您決定" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-qty`} className="block text-xs font-bold">可兌換數量（張）</label>
          <input id={`${uid}-qty`} className={inputCls} inputMode="numeric" value={qty} onChange={(e) => setQty(digits(e.target.value))} placeholder={`最多 ${coupon.qty}`} />
          {issued > 0 && <p className="text-[11px] text-muted-foreground">已兌換 {issued} 張</p>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-ends`} className="block text-xs font-bold">兌換截止日</label>
          <input id={`${uid}-ends`} type="date" className={inputCls} min={today} max={coupon.endAt} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        使用門檻與折扣沿用此券設定：{couponTitle(coupon)}。點數兌換與賣場領取、刮刮卡共用此券的發行總數量。折扣由您承擔，平台不補貼也不向您收費。
      </p>
      {error && <p role="alert" className="text-xs font-bold text-destructive">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={btnGhost}><X className="size-4" aria-hidden />取消</button>
        <button type="submit" className={btnPrimary} disabled={saving}><Save className="size-4" aria-hidden />{saving ? '儲存中…' : '儲存點數兌換設定'}</button>
      </div>
    </form>
  )
}

export function CouponPointOffers({
  coupons,
  today,
  uiUserId,
  onNotify,
}: {
  coupons: CouponLike[]
  today: string
  uiUserId: string | null
  onNotify: (message: string) => void
}) {
  const [offers, setOffers] = useState<Map<string, CouponPointOffer> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(() => {
    void fetchMyCouponPointOffers(uiUserId).then((result) => {
      if (result.data) {
        setOffers(new Map(result.data.map((offer) => [offer.couponId, offer])))
        setLoadError(null)
      } else {
        setOffers(null)
        setLoadError(result.error)
      }
    })
  }, [uiUserId])

  useEffect(() => {
    load()
  }, [load])

  const rows = coupons.filter((c) => !c.deleted && couponStatus(c, today) !== 'expired')

  return (
    <section aria-label="Pay 點數兌換授權" className={`${panelCls} space-y-3 p-4`}>
      <div>
        <h3 className="flex items-center gap-1.5 text-base font-black">
          <Coins className="size-4.5 text-brand-ink" aria-hidden />
          Pay 點數兌換授權（購物優惠區）
        </h3>
        <p className="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground">
          只有您在這裡明確開放的優惠券，才會出現在買家「Pay 點數商城 → 購物優惠區」。所需點數、可兌換數量與截止日由您決定；一般優惠券的賣場領取與刮刮卡曝光不受影響，也不會自動變成點數兌換券。
        </p>
      </div>
      {loadError ? (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive">
          {loadError}
          <button type="button" onClick={load} className="ml-2 underline">重新讀取</button>
        </p>
      ) : !offers ? (
        <p className="text-xs text-muted-foreground">正在讀取點數兌換設定…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">目前沒有可設定的優惠券。先建立一張進行中或尚未開始的折價券。</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((c) => {
            const offer = offers.get(c.id)
            const label = c.name ?? c.code
            return (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-black">{label} <span className="font-mono text-[11px] text-muted-foreground">{c.code}</span></p>
                    <p className="text-xs text-brand-ink">{couponTitle(c)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {offer?.enabled
                        ? `已開放：${offer.pointsCost} 點兌換・已兌換 ${offer.pointsIssued} / ${offer.pointsQty} 張・兌換至 ${slashDate(offer.endsOn)}`
                        : offer
                          ? `已關閉（原設定 ${offer.pointsCost} 點、${offer.pointsQty} 張）`
                          : '未開放 Pay 點數兌換'}
                    </p>
                  </div>
                  {editing !== c.id && (
                    <button type="button" onClick={() => setEditing(c.id)} className={`${btnGhost} py-1.5 text-xs`}>
                      {offer ? '調整點數兌換' : '開放點數兌換'}
                    </button>
                  )}
                </div>
                {editing === c.id && (
                  <OfferForm
                    coupon={c}
                    offer={offer}
                    today={today}
                    onCancel={() => setEditing(null)}
                    onSave={async (next) => {
                      const result = await saveMyCouponPointOffer(c.id, next, uiUserId)
                      if (!result.data) return result.error ?? '點數兌換設定沒有儲存'
                      const saved = result.data
                      setOffers((current) => new Map(current ?? []).set(saved.couponId, saved))
                      setEditing(null)
                      onNotify(saved.enabled ? `「${label}」已開放 ${saved.pointsCost} 點兌換` : `「${label}」已關閉點數兌換`)
                      return null
                    }}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
