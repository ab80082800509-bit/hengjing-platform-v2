'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { BarChart3, CalendarDays, Gift, Pause, Pencil, Percent, Play, Plus, Sparkles, Store, Ticket, Trash2, Truck } from 'lucide-react'
import { SheetModal } from '@/components/sheet-modal'
import { btnDangerSolid, btnGhost, btnPrimary, panelCls } from './styles'
import {
  KIND_LABEL,
  STATUS_LABEL,
  conversionOf,
  couponStatus,
  couponTitle,
  kindOf,
  remainOf,
  slashDate,
  type CouponLike,
  type CouponStatus,
} from './coupon-utils'

const STATUS_TONE: Record<CouponStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/40',
  paused: 'bg-muted text-muted-foreground ring-border',
  soldout: 'bg-primary/10 text-brand-ink ring-primary/40',
  expired: 'bg-destructive/10 text-destructive ring-destructive/35',
  upcoming: 'bg-sky-500/10 text-sky-400 ring-sky-500/40',
}

const COLS =
  'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_192px]'

type Filter = 'all' | CouponStatus

const pctOf = (n: number, total: number) => Math.min(100, Math.round((n / Math.max(1, total)) * 100))

function daysUntil(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000)
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={`${panelCls} p-4`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-black text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function CellLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-[11px] font-bold text-muted-foreground lg:hidden">{children}</p>
}

function ActionButton({
  text,
  label,
  onClick,
  disabled,
  pressed,
  tone = 'default',
  children,
}: {
  text: string
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  tone?: 'default' | 'danger' | 'accent'
  children: ReactNode
}) {
  const hover =
    tone === 'danger'
      ? 'hover:border-destructive hover:text-destructive'
      : tone === 'accent'
        ? 'hover:border-primary hover:text-brand-ink'
        : 'hover:bg-muted hover:text-foreground'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={`inline-flex h-8 items-center justify-center gap-1 rounded-full border px-3 text-xs font-bold text-muted-foreground transition disabled:cursor-not-allowed disabled:opacity-40 lg:w-8 lg:px-0 ${hover} ${
        pressed ? 'border-primary bg-primary/10 text-brand-ink' : 'border-border'
      }`}
    >
      {children}
      <span className="lg:sr-only">{text}</span>
    </button>
  )
}

function FunnelBar({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const pct = pctOf(value, total)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold text-foreground">{value.toLocaleString('en-US')} 張</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function CouponStats({ c }: { c: CouponLike }) {
  const claimRate = pctOf(c.redeemed, c.qty)
  const conversion = conversionOf(c)
  const metrics = [
    { label: '領取率', value: `${claimRate}%`, hint: `${c.redeemed.toLocaleString('en-US')} / ${c.qty.toLocaleString('en-US')} 張` },
    { label: '帶來訂單', value: `${c.usedOrders.toLocaleString('en-US')} 筆`, hint: '已使用此券下單' },
    { label: '轉化率', value: conversion === null ? '—' : `${conversion}%`, hint: conversion === null ? '店內折扣碼無領取紀錄' : '領取後實際下單' },
    { label: '剩餘張數', value: remainOf(c).toLocaleString('en-US'), hint: '尚可發放' },
  ]
  return (
    <section aria-label={`${c.name ?? c.code} 數據追蹤`} className="mt-3 rounded-xl border border-border bg-muted/30 p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-black text-foreground">
        <BarChart3 className="size-4 text-brand-ink" aria-hidden />
        數據追蹤
        <span className="font-mono text-[11px] font-bold tracking-wider text-muted-foreground">{c.code}</span>
      </h3>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-xl border border-border/70 bg-card px-3 py-2.5">
            <dt className="text-[11px] font-bold text-muted-foreground">{m.label}</dt>
            <dd className="mt-0.5 text-xl font-black text-foreground">{m.value}</dd>
            <p className="text-[11px] text-muted-foreground">{m.hint}</p>
          </div>
        ))}
      </dl>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <FunnelBar label="發行" value={c.qty} total={c.qty} tone="bg-muted-foreground/50" />
        <FunnelBar label="已領取" value={c.redeemed} total={c.qty} tone="bg-primary" />
        <FunnelBar label="已使用下單" value={Math.min(c.usedOrders, c.qty)} total={c.qty} tone="bg-emerald-500" />
      </div>
      <p className="mt-3 text-pretty text-[11px] leading-relaxed text-muted-foreground">
        轉化率 = 已使用訂單數 ÷ 已領取張數（上限 100%）。折價券金額由賣家自行吸收，此處不顯示平台金流。
      </p>
    </section>
  )
}

export function CouponList({
  coupons,
  today,
  listedCount,
  maxListed,
  onCreate,
  onEdit,
  onToggleActive,
  onToggleListed,
  onToggleShelf,
  onDelete,
}: {
  coupons: CouponLike[]
  today: string
  listedCount: number
  maxListed: number
  onCreate: () => void
  onEdit: (id: string) => void
  onToggleActive: (id: string) => void
  onToggleListed: (id: string) => void
  onToggleShelf: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [statsId, setStatsId] = useState<string | null>(null)

  const rows = useMemo(() => coupons.map((c) => ({ c, status: couponStatus(c, today) })), [coupons, today])
  const counts = useMemo(() => {
    const base: Record<Filter, number> = { all: rows.length, active: 0, paused: 0, soldout: 0, expired: 0, upcoming: 0 }
    rows.forEach((r) => (base[r.status] += 1))
    return base
  }, [rows])
  const visible = filter === 'all' ? rows : rows.filter((r) => r.status === filter)
  const totalClaimed = coupons.reduce((s, c) => s + c.redeemed, 0)
  const totalUsed = coupons.reduce((s, c) => s + c.usedOrders, 0)
  const deleting = deleteId ? coupons.find((c) => c.id === deleteId) : undefined

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'active', label: STATUS_LABEL.active },
    { key: 'paused', label: STATUS_LABEL.paused },
    { key: 'soldout', label: STATUS_LABEL.soldout },
    { key: 'expired', label: STATUS_LABEL.expired },
    ...(counts.upcoming > 0 ? [{ key: 'upcoming' as const, label: STATUS_LABEL.upcoming }] : []),
  ]

  return (
    <section className="space-y-4" aria-label="優惠券管理">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-black">
            <Ticket className="size-5 text-brand-ink" aria-hidden />
            優惠券管理
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">建立、編輯、下架與刪除店內折價券，並可選擇開放給簽到專區與幸運刮刮卡取得更多曝光</p>
        </div>
        <button type="button" onClick={onCreate} className={btnPrimary}>
          <Plus className="size-4" aria-hidden />
          新增折價券
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="進行中" value={`${counts.active}`} hint={`共 ${coupons.length} 張折價券`} />
        <StatCard label="累計已領取" value={totalClaimed.toLocaleString('en-US')} hint="張" />
        <StatCard label="已使用訂單" value={totalUsed.toLocaleString('en-US')} hint="筆訂單已折抵" />
        <StatCard label="曝光名額" value={`${listedCount} / ${maxListed}`} hint="簽到專區與刮刮卡獎池" />
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="依狀態篩選">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
              filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.label}
            <span className="ml-1 opacity-80">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border p-10 text-center">
          <Ticket className="size-10 text-border" aria-hidden />
          <p className="text-sm text-muted-foreground">{coupons.length === 0 ? '還沒有任何折價券，建立第一張來吸引買家吧' : '這個狀態下沒有折價券'}</p>
          {coupons.length === 0 && (
            <button type="button" onClick={onCreate} className={btnPrimary}>
              <Plus className="size-4" aria-hidden />
              新增折價券
            </button>
          )}
        </div>
      ) : (
        <div className={`${panelCls} overflow-hidden`}>
          <div
            aria-hidden
            className={`hidden gap-3 border-b border-border/70 bg-muted/40 px-4 py-2.5 text-xs font-bold text-muted-foreground lg:grid ${COLS}`}
          >
            <span>折價券名稱 / 折扣碼</span>
            <span>類型</span>
            <span>門檻與折扣</span>
            <span>發行 / 已領取 / 已使用</span>
            <span>有效期限</span>
            <span>狀態</span>
            <span className="text-right">操作</span>
          </div>
          <ul className="divide-y divide-border/60">
            {visible.map(({ c, status }) => {
              const kind = kindOf(c)
              const Icon = kind === 'freeship' ? Truck : kind === 'percent' ? Percent : kind === 'gift' ? Gift : Ticket
              const label = c.name ?? c.code
              const left = c.endAt ? daysUntil(today, c.endAt) : null
              const exposed = c.listed && status === 'active'
              const canExpose = status === 'active' || status === 'upcoming'
              const paused = !c.active
              const statsOpen = statsId === c.id
              return (
                <li key={c.id} className="px-4 py-4">
                  <div className={`grid grid-cols-2 gap-3 lg:items-center ${COLS}`}>
                    <div className="order-1 col-span-2 flex min-w-0 items-start gap-3 lg:order-none lg:col-span-1">
                      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${status === 'active' ? 'bg-accent text-brand-ink' : 'bg-muted text-muted-foreground'}`}>
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-foreground">{label}</p>
                        <p className="mt-0.5 inline-block rounded-md border border-dashed border-border px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wider text-muted-foreground">
                          {c.code}
                        </p>
                      </div>
                    </div>

                    <div className="order-2 lg:order-none">
                      <CellLabel>類型</CellLabel>
                      <span className="inline-flex items-center rounded-md bg-accent px-2 py-0.5 text-xs font-bold text-brand-ink">{KIND_LABEL[kind]}</span>
                    </div>

                    <div className="order-3 lg:order-none">
                      <CellLabel>狀態</CellLabel>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
                        {exposed && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-brand-ink ring-1 ring-primary/35">
                            <Sparkles className="size-3" aria-hidden />
                            曝光中
                          </span>
                        )}
                        {c.shelf && status === 'active' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-brand-ink ring-1 ring-border">
                            <Store className="size-3" aria-hidden />
                            賣場可領
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="order-4 col-span-2 lg:order-none lg:col-span-1">
                      <CellLabel>門檻與折扣</CellLabel>
                      <p className="text-sm font-bold text-brand-ink">{couponTitle(c)}</p>
                    </div>

                    <div className="order-5 text-xs lg:order-none">
                      <CellLabel>發行 / 已領取 / 已使用</CellLabel>
                      <p className="font-bold text-foreground">
                        {c.redeemed.toLocaleString('en-US')} / {c.qty.toLocaleString('en-US')}
                        <span className="ml-1 font-normal text-muted-foreground">剩 {remainOf(c).toLocaleString('en-US')}</span>
                      </p>
                      <div
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={c.qty}
                        aria-valuenow={c.redeemed}
                        aria-label="已領取比例"
                        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                      >
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pctOf(c.redeemed, c.qty)}%` }} />
                      </div>
                      <p className="mt-1 text-muted-foreground">已使用 {c.usedOrders} 筆訂單</p>
                    </div>

                    <div className="order-6 text-xs lg:order-none">
                      <CellLabel>有效期限</CellLabel>
                      <p className="flex items-center gap-1 font-medium text-foreground">
                        <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        {c.startAt && c.endAt ? `${slashDate(c.startAt)} ~ ${slashDate(c.endAt)}` : '不限期間'}
                      </p>
                      {status === 'active' && left !== null && left <= 3 && (
                        <p className="mt-1 font-bold text-brand-ink">{left <= 0 ? '今天到期' : `${left} 天後到期`}</p>
                      )}
                    </div>

                    <div className="order-7 col-span-2 flex flex-wrap items-center gap-1.5 lg:order-none lg:col-span-1 lg:justify-end">
                      <ActionButton text="數據" label={`查看 ${label} 數據追蹤`} pressed={statsOpen} onClick={() => setStatsId(statsOpen ? null : c.id)}>
                        <BarChart3 className="size-3.5" aria-hidden />
                      </ActionButton>
                      <ActionButton text="編輯" label={`編輯 ${label}`} onClick={() => onEdit(c.id)}>
                        <Pencil className="size-3.5" aria-hidden />
                      </ActionButton>
                      <ActionButton
                        text={paused ? '重新上架' : '下架'}
                        label={`${paused ? '重新上架' : '暫停下架'} ${label}`}
                        tone="accent"
                        disabled={status === 'expired'}
                        onClick={() => onToggleActive(c.id)}
                      >
                        {paused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
                      </ActionButton>
                      <ActionButton
                        text={c.listed ? '停止曝光' : '開放曝光'}
                        label={`${c.listed ? '停止曝光' : '開放曝光'} ${label}`}
                        tone="accent"
                        pressed={c.listed}
                        disabled={!c.listed && !canExpose}
                        onClick={() => onToggleListed(c.id)}
                      >
                        <Sparkles className="size-3.5" aria-hidden />
                      </ActionButton>
                      <ActionButton
                        text={c.shelf ? '收回賣場' : '放上賣場'}
                        label={`${c.shelf ? '從賣場收回' : '放上賣場供買家領取'} ${label}`}
                        tone="accent"
                        pressed={!!c.shelf}
                        disabled={!c.shelf && !canExpose}
                        onClick={() => onToggleShelf(c.id)}
                      >
                        <Store className="size-3.5" aria-hidden />
                      </ActionButton>
                      <ActionButton text="刪除" label={`刪除 ${label}`} tone="danger" onClick={() => setDeleteId(c.id)}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </ActionButton>
                    </div>
                  </div>
                  {statsOpen && <CouponStats c={c} />}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
        折價券金額由賣家自行吸收，平台為純 SaaS 服務，不經手交易金流，也不提供現金或購物金折抵。下架後賣場頁面與刮刮卡獎池會立即隱藏該券，已領取買家仍可依期限使用；刪除只會移出此列表。
      </p>

      {deleting && (
        <SheetModal
          title="刪除折價券"
          size="sm"
          onClose={() => setDeleteId(null)}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDeleteId(null)} className={btnGhost}>
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete(deleting.id)
                  if (statsId === deleting.id) setStatsId(null)
                  setDeleteId(null)
                }}
                className={btnDangerSolid}
              >
                <Trash2 className="size-4" aria-hidden />
                確認刪除
              </button>
            </div>
          }
        >
          <div className="space-y-3 p-5">
            <p className="text-base font-black text-foreground">確定要刪除此優惠券紀錄嗎？</p>
            <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
              <p className="text-sm font-black text-foreground">{deleting.name ?? deleting.code}</p>
              <p className="text-sm font-bold text-brand-ink">{couponTitle(deleting)}</p>
              <p className="mt-0.5 font-mono text-[11px] font-bold tracking-wider text-muted-foreground">{deleting.code}</p>
            </div>
            <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
              {deleting.redeemed > 0
                ? `已有 ${deleting.redeemed} 張被買家領取，這些買家仍可在效期內使用；但此券會從列表移除，且無法復原。`
                : '刪除後無法復原。'}
            </p>
          </div>
        </SheetModal>
      )}
    </section>
  )
}
