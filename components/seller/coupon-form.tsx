'use client'

import { useId, useState, type ReactNode } from 'react'
import { CreditCard, Gift, Percent, Plus, RefreshCw, Save, Sparkles, Store } from 'lucide-react'
import { btnGhost, btnPrimary, inputCls } from './styles'
import { couponTitle, foldLabel, kindOf, slashDate, type CouponDraft, type CouponKind, type CouponLike } from './coupon-utils'

type Errors = Partial<Record<'name' | 'code' | 'minSpend' | 'amount' | 'percent' | 'maxDiscount' | 'gift' | 'qty' | 'startAt' | 'endAt', string>>

const CODE_RE = /^[A-Z0-9]{4,12}$/
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const genCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')

const addDaysISO = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 7)

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-bold text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-msg`} className="text-xs font-bold text-destructive" role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${htmlFor}-msg`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

const KINDS: { key: CouponKind; label: string; desc: string; Icon: typeof Gift }[] = [
  { key: 'cash', label: '滿額折現', desc: '例：滿 $1,000 折 $50，適合拉高客單價', Icon: CreditCard },
  { key: 'percent', label: '滿額打折', desc: '例：滿 $1,500 享 9 折，可設折抵上限', Icon: Percent },
  { key: 'gift', label: '滿額贈禮券', desc: '達門檻隨包裹附贈小禮物，不折抵金額', Icon: Gift },
]

export function CouponForm({
  today,
  listedCount,
  maxListed,
  redeemCost,
  initial,
  onSubmit,
  onCancel,
}: {
  today: string
  listedCount: number
  maxListed: number
  redeemCost: number
  initial?: CouponLike
  onSubmit: (draft: CouponDraft) => string | null
  onCancel: () => void
}) {
  const uid = useId()
  const id = (k: string) => `${uid}-${k}`
  const [name, setName] = useState(initial?.name ?? '')
  const [code, setCode] = useState(() => initial?.code ?? genCode())
  const [kind, setKind] = useState<CouponKind>(initial ? kindOf(initial) : 'cash')
  const [minSpend, setMinSpend] = useState(initial ? String(initial.minSpend) : '')
  const [amount, setAmount] = useState(initial && kindOf(initial) === 'cash' ? String(initial.amount) : '')
  const [percent, setPercent] = useState(initial?.percent ? String(initial.percent) : '')
  const [maxDiscount, setMaxDiscount] = useState(initial?.maxDiscount ? String(initial.maxDiscount) : '')
  const [gift, setGift] = useState(initial?.gift ?? '')
  const [qty, setQty] = useState(initial ? String(initial.qty) : '')
  const [startAt, setStartAt] = useState(initial?.startAt ?? today)
  const [endAt, setEndAt] = useState(() => initial?.endAt ?? addDaysISO(today, 30))
  const [listed, setListed] = useState(initial?.listed ?? false)
  const [shelf, setShelf] = useState(initial?.shelf ?? true)
  const locked = !!initial && (initial.redeemed > 0 || initial.usedOrders > 0)
  const started = !!initial?.startAt && initial.startAt <= today
  const [errors, setErrors] = useState<Errors>({})
  const [submitError, setSubmitError] = useState('')

  const slotsLeft = Math.max(0, maxListed - listedCount)
  const minN = Number(minSpend) || 0
  const amountN = Number(amount) || 0
  const percentN = Number(percent) || 0
  const maxDiscountN = Number(maxDiscount) || 0
  const giftText = gift.trim()
  const percentValid = percentN >= 10 && percentN <= 99
  const qtyN = Number(qty) || 0

  const validate = (): Errors => {
    const e: Errors = {}
    if (!name.trim()) e.name = '請輸入折價券名稱'
    else if (name.trim().length > 20) e.name = '名稱最多 20 個字'
    if (!CODE_RE.test(code.trim().toUpperCase())) e.code = '折扣碼需為 4–12 碼英文或數字'
    if (!minN || minN < 1 || minN > 100000) e.minSpend = '請輸入 1–100,000 的最低消費金額'
    if (kind === 'cash') {
      if (!amountN || amountN < 1) e.amount = '請輸入折抵金額'
      else if (amountN > 5000) e.amount = '單張折抵金額上限為 NT$ 5,000'
      else if (minN && amountN >= minN) e.amount = '折抵金額須低於最低消費金額'
    }
    if (kind === 'percent') {
      if (!percentValid) e.percent = '請輸入 10–99 的數字（9 折輸入 90）'
      if (maxDiscount && (maxDiscountN < 1 || maxDiscountN > 100000)) e.maxDiscount = '上限需介於 NT$ 1–100,000，或留空表示不設上限'
    }
    if (kind === 'gift') {
      if (!giftText) e.gift = '請輸入贈品名稱或說明'
      else if (giftText.length > 30) e.gift = '贈品說明最多 30 個字'
    }
    if (!qtyN || qtyN < 1 || qtyN > 10000) e.qty = '請輸入 1–10,000 的發行數量'
    else if (initial && qtyN < initial.redeemed) e.qty = `發行數量不可低於已領取數量（${initial.redeemed} 張）`
    if (!startAt) e.startAt = '請選擇開始日期'
    else if (startAt < today && startAt !== initial?.startAt) e.startAt = '開始日期不可早於今天'
    if (!endAt) e.endAt = '請選擇結束日期'
    else if (endAt < today) e.endAt = '結束日期不可早於今天'
    else if (startAt && endAt < startAt) e.endAt = '結束日期不可早於開始日期'
    return e
  }

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    const e = validate()
    setErrors(e)
    setSubmitError('')
    if (Object.keys(e).length) return
    const err = onSubmit({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      kind,
      amount: kind === 'cash' ? amountN : 0,
      percent: kind === 'percent' ? percentN : 0,
      maxDiscount: kind === 'percent' ? maxDiscountN : 0,
      gift: kind === 'gift' ? giftText : '',
      minSpend: minN,
      qty: qtyN,
      startAt,
      endAt,
      listed,
      shelf,
    })
    if (err) setSubmitError(err)
  }

  const aria = (k: keyof Errors, hint = false) => ({
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] || hint ? `${id(k)}-msg` : undefined,
  })

  const showPreview = minN > 0 && (kind === 'cash' ? amountN > 0 : kind === 'percent' ? percentValid : giftText.length > 0)

  return (
    <form onSubmit={submit} noValidate className="space-y-5 p-5">
      {locked && (
        <p className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs leading-relaxed text-foreground" role="note">
          此券已有買家領取或使用，為保障買家權益，折扣類型、門檻與折扣內容已鎖定；仍可調整名稱、發行數量、有效期限與曝光設定。
        </p>
      )}
      <fieldset className="space-y-2" disabled={locked}>
        <legend className="text-xs font-bold text-foreground">折扣類型</legend>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {KINDS.map(({ key, label, desc, Icon }) => (
            <label
              key={key}
              className="flex cursor-pointer flex-col items-start gap-2.5 rounded-2xl border border-border bg-card p-3.5 transition hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
            >
              <input type="radio" name={id('kind')} value={key} checked={kind === key} onChange={() => setKind(key)} className="sr-only" />
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-brand-ink">
                <Icon className="size-4.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-black text-foreground">{label}</span>
                <span className="block text-xs text-muted-foreground">{desc}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="折價券名稱" htmlFor={id('name')} error={errors.name} hint="買家會在券包中看到，例如：開幕感謝券">
          <input id={id('name')} className={inputCls} maxLength={20} value={name} onChange={(e) => setName(e.target.value)} placeholder="開幕感謝券" {...aria('name', true)} />
        </Field>
        <Field label="折扣碼" htmlFor={id('code')} error={errors.code} hint={initial ? '折扣碼建立後不可修改' : '系統已自動產生，也可自行修改'}>
          <div className="flex gap-1.5">
            <input
              id={id('code')}
              className={`${inputCls} min-w-0 font-mono uppercase tracking-widest`}
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              readOnly={!!initial}
              {...aria('code', true)}
            />
            {!initial && (
              <button type="button" onClick={() => setCode(genCode())} aria-label="重新產生折扣碼" className={`${btnGhost} shrink-0 px-3`}>
                <RefreshCw className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </Field>
        <Field label="最低消費金額（NT$）" htmlFor={id('minSpend')} error={errors.minSpend} hint="單一訂單中該店商品小計須達此金額">
          <input id={id('minSpend')} disabled={locked} className={inputCls} inputMode="numeric" value={minSpend} onChange={(e) => setMinSpend(digits(e.target.value))} placeholder="1000" {...aria('minSpend', true)} />
        </Field>
        {kind === 'cash' && (
          <Field label="折抵金額（NT$）" htmlFor={id('amount')} error={errors.amount} hint="須低於最低消費金額，單張上限 NT$ 5,000">
            <input id={id('amount')} disabled={locked} className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} placeholder="50" {...aria('amount', true)} />
          </Field>
        )}
        {kind === 'percent' && (
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="折扣百分比"
              htmlFor={id('percent')}
              error={errors.percent}
              hint={percentValid ? `輸入 ${percentN} = ${foldLabel(percentN)} 折` : '例：9 折輸入 90'}
            >
              <input id={id('percent')} disabled={locked} className={inputCls} inputMode="numeric" maxLength={2} value={percent} onChange={(e) => setPercent(digits(e.target.value).slice(0, 2))} placeholder="90" {...aria('percent', true)} />
            </Field>
            <Field label="最高折抵上限（NT$）" htmlFor={id('maxDiscount')} error={errors.maxDiscount} hint="留空＝不設上限">
              <input id={id('maxDiscount')} disabled={locked} className={inputCls} inputMode="numeric" value={maxDiscount} onChange={(e) => setMaxDiscount(digits(e.target.value))} placeholder="150" {...aria('maxDiscount', true)} />
            </Field>
          </div>
        )}
        {kind === 'gift' && (
          <Field label="贈品名稱／說明" htmlFor={id('gift')} error={errors.gift} hint="憑券隨包裹附贈，不折抵商品金額，請備妥足量贈品">
            <input id={id('gift')} disabled={locked} className={inputCls} maxLength={30} value={gift} onChange={(e) => setGift(e.target.value)} placeholder="贈專用清潔布乙份" {...aria('gift', true)} />
          </Field>
        )}
        <Field label="發行總數量（張）" htmlFor={id('qty')} error={errors.qty} hint="領完即結束發放">
          <input id={id('qty')} className={inputCls} inputMode="numeric" value={qty} onChange={(e) => setQty(digits(e.target.value))} placeholder="100" {...aria('qty', true)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="開始日期" htmlFor={id('startAt')} error={errors.startAt}>
            <input id={id('startAt')} type="date" disabled={started} className={inputCls} min={initial ? undefined : today} value={startAt} onChange={(e) => setStartAt(e.target.value)} {...aria('startAt')} />
          </Field>
          <Field label="結束日期" htmlFor={id('endAt')} error={errors.endAt}>
            <input id={id('endAt')} type="date" className={inputCls} min={startAt || today} value={endAt} onChange={(e) => setEndAt(e.target.value)} {...aria('endAt')} />
          </Field>
        </div>
      </div>

      <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
        <label className={`flex items-start gap-3 ${slotsLeft === 0 && !listed ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={listed}
            disabled={slotsLeft === 0 && !listed}
            onChange={(e) => setListed(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span className="min-w-0 space-y-1">
            <span className="flex flex-wrap items-center gap-1.5 text-sm font-black text-foreground">
              <Sparkles className="size-4 text-brand-ink" aria-hidden />
              開放買家使用【平台簽到點數／刮刮樂】兌換此優惠券
            </span>
            <span className="block text-xs leading-relaxed text-muted-foreground">
              勾選後將獲得首頁簽到專區與幸運刮刮卡獎池之免費曝光流量。買家以 {redeemCost} 點兌換，或在刮刮卡中獎時取得；折抵金額由您自行吸收，平台不提供現金或購物金折抵。
            </span>
            <span className={`block text-xs font-bold ${slotsLeft === 0 ? 'text-amber-400' : 'text-muted-foreground'}`}>
              {slotsLeft === 0 ? `曝光名額已滿（${listedCount} / ${maxListed}），請先在列表中停止其他券的曝光` : `目前已使用 ${listedCount} / ${maxListed} 個曝光名額`}
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={shelf} onChange={(e) => setShelf(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
          <span className="min-w-0 space-y-1">
            <span className="flex flex-wrap items-center gap-1.5 text-sm font-black text-foreground">
              <Store className="size-4 text-brand-ink" aria-hidden />
              同步放在自己的賣場，讓買家直接領取
            </span>
            <span className="block text-xs leading-relaxed text-muted-foreground">
              勾選後，買家逛您的賣場時可在「此賣場可兌換／領取優惠券」中免費領取，不需要點數，也不佔用簽到專區的曝光名額。可與上方的點數兌換同時開啟。
            </span>
          </span>
        </label>
      </div>

      {showPreview && (
        <div className="rounded-2xl border-2 border-dashed border-primary/60 bg-accent px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">買家看到的折價券</p>
          <p className="text-lg font-black text-brand-ink">{couponTitle({ kind, minSpend: minN, amount: amountN, percent: percentN, maxDiscount: maxDiscountN, gift: giftText })}</p>
          <p className="text-xs text-muted-foreground">
            {qtyN > 0 ? `限量 ${qtyN.toLocaleString('en-US')} 張・` : ''}
            {startAt && endAt ? `${slashDate(startAt)} ~ ${slashDate(endAt)}` : ''}
          </p>
        </div>
      )}

      {submitError && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive" role="alert">
          {submitError}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={btnGhost}>
          取消
        </button>
        <button type="submit" className={btnPrimary}>
          {initial ? <Save className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {initial ? '儲存變更' : '建立折價券'}
        </button>
      </div>
    </form>
  )
}
