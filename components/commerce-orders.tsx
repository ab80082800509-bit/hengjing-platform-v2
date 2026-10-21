'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  cancelMyOrder,
  customTaipeiRange,
  formatTaipei,
  formatTwd,
  getOrderDetail,
  listMyBuyerOrders,
  listMyOrderNotifications,
  listMySellerOrders,
  markOrderNotificationRead,
  sellerOperationsReport,
  sellerOrdersForMetric,
  taipeiRange,
  type BuyerOrderBucket,
  type CommerceOrder,
  type MetricOrder,
  type SellerMetric,
  type SellerOrderBucket,
  type SellerReport,
} from '@/lib/commerce-orders'

const panel = 'rounded-2xl border border-border/70 bg-card shadow-sm'
const ghost = 'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50'

const EVENT_LABEL: Record<string, string> = {
  order_placed: '訂單成立',
  order_cancelled: '訂單取消',
  inventory_hold_expired: '庫存保留到期',
}

function stageTone(stage: string) {
  if (stage === 'done') return 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/35'
  if (stage === 'cancelled' || stage === 'refunded') return 'bg-muted text-muted-foreground ring-border'
  if (stage === 'to_ship' || stage === 'to_receive') return 'bg-accent text-accent-foreground ring-orange-200'
  return 'bg-amber-500/10 text-amber-400 ring-amber-500/35'
}

function Status({ stage, label }: { stage: string; label: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${stageTone(stage)}`}>{label}</span>
}

function Message({ children, error = false }: { children: string; error?: boolean }) {
  return (
    <p role={error ? 'alert' : 'status'} className={`${panel} p-8 text-center text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
      {children}
    </p>
  )
}

function canCancel(order: CommerceOrder) {
  return order.canCancel && order.actions.includes('cancel')
}

function groupBuyerOrders(orders: CommerceOrder[]) {
  const groups: { batchId: string; orders: CommerceOrder[] }[] = []
  const index = new Map<string, number>()
  orders.forEach((order) => {
    const key = order.batchId || order.orderId
    const found = index.get(key)
    if (found == null) {
      index.set(key, groups.length)
      groups.push({ batchId: key, orders: [order] })
    } else {
      groups[found].orders.push(order)
    }
  })
  return groups
}

function OrderDetail({
  orderId,
  role,
  onBack,
  onChanged,
  stacked = false,
}: {
  orderId: string
  role: 'buyer' | 'seller'
  onBack: () => void
  onChanged: () => void
  stacked?: boolean
}) {
  const [order, setOrder] = useState<CommerceOrder | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await getOrderDetail(orderId)
    setLoading(false)
    if (result.error || !result.data) {
      setOrder(null)
      setError(result.error || '找不到這張訂單')
      return
    }
    setOrder(result.data)
  }, [orderId])

  useEffect(() => { void load() }, [load])

  const cancel = async () => {
    if (!order || !canCancel(order) || busy) return
    setBusy(true)
    setNote('')
    const result = await cancelMyOrder(order.orderId, role)
    setBusy(false)
    if (result.error) {
      setNote(result.error)
      return
    }
    setNote(result.data?.message || '訂單已取消')
    onChanged()
    await load()
  }

  if (loading) return <Message>訂單載入中</Message>
  if (error || !order) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={onBack} className={stacked ? `${ghost} min-h-11 w-full sm:w-auto` : ghost}>返回列表</button>
        <Message error>{error || '找不到這張訂單'}</Message>
        <button type="button" onClick={() => void load()} className={stacked ? `${ghost} min-h-11 w-full sm:w-auto` : ghost}>重新整理</button>
      </div>
    )
  }

  const meta = stacked
    ? 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl bg-muted/40 px-3 py-2.5 sm:block sm:rounded-none sm:bg-transparent sm:p-0'
    : ''
  return (
    <article className={`${panel} min-w-0 space-y-4 p-4`} aria-label={`訂單 ${order.displayNo}`}>
      <div className={stacked ? 'flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2' : 'flex flex-wrap items-center gap-2'}>
        <button type="button" onClick={onBack} className={stacked ? `${ghost} min-h-11 w-full sm:w-auto` : ghost}>返回列表</button>
        <h3 className={`font-mono text-sm font-black ${stacked ? 'break-all' : ''}`}>{order.displayNo}</h3>
        <Status stage={order.buyerStage} label={order.buyerStageLabel} />
      </div>
      <p className={`text-sm text-muted-foreground ${stacked ? 'break-words' : ''}`}>{order.storeName}・{formatTaipei(order.createdAt)}</p>
      <ul className="divide-y divide-border/60 rounded-xl border border-border/70">
        {order.items.map((item) => (
          <li key={item.orderItemId} className={stacked ? 'space-y-2 p-3 sm:flex sm:items-center sm:gap-3 sm:space-y-0' : 'flex gap-3 p-3'}>
            <div className={stacked ? 'flex min-w-0 gap-3 sm:contents' : 'contents'}>
              <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt="" className="size-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold ${stacked ? 'break-words' : ''}`}>{item.name}</p>
                {stacked ? (
                  <>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.variantLabel}</p>
                    <p className="text-xs text-muted-foreground">數量 {item.qty}</p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{item.variantLabel}・數量 {item.qty}</p>
                )}
              </div>
            </div>
            <p className={`text-sm font-bold ${stacked ? 'sm:shrink-0' : ''}`}>
              {stacked ? <span className="mr-1.5 text-xs font-medium text-muted-foreground sm:hidden">金額</span> : null}
              {formatTwd(item.lineTotal)}
            </p>
          </li>
        ))}
      </ul>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className={meta}><dt className="text-xs text-muted-foreground">商品小計</dt><dd className="font-bold">{formatTwd(order.itemsSubtotal)}</dd></div>
        <div className={meta}><dt className="text-xs text-muted-foreground">訂單金額</dt><dd className="font-black text-brand-ink">{formatTwd(order.orderTotal)}</dd></div>
        <div className={meta}><dt className="text-xs text-muted-foreground">付款方式</dt><dd className={stacked ? 'text-right sm:text-left' : ''}>{order.paymentMethodLabel || '尚未選擇'}</dd></div>
        <div className={meta}><dt className="text-xs text-muted-foreground">配送方式</dt><dd className={stacked ? 'text-right sm:text-left' : ''}>{order.fulfillmentMethodLabel || '尚未選擇'}</dd></div>
        <div className={`sm:col-span-2 ${meta}`}>
          <dt className="text-xs text-muted-foreground">運費</dt>
          <dd className={stacked ? 'min-w-0 max-w-full text-right text-pretty sm:text-left' : ''}>{order.shippingFeeStatus === 'confirmed' && order.shippingFee != null ? formatTwd(order.shippingFee) : '運費尚未定價，未計入訂單金額'}</dd>
        </div>
      </dl>
      {order.recipient && (
        <div className="rounded-xl bg-muted/50 p-3 text-sm">
          <p className="text-xs font-bold text-muted-foreground">收件資料</p>
          <p className="mt-1 break-words font-bold">{order.recipient.name}・{order.recipient.phone}</p>
          <p className="break-words">{order.recipient.address}</p>
        </div>
      )}
      {order.stockHoldStatus === 'held' && order.stockHoldExpiresAt && (
        <p className="text-xs text-muted-foreground">庫存保留至 {formatTaipei(order.stockHoldExpiresAt)}。保留到期不會自動標成已付款。</p>
      )}
      <section aria-label="訂單紀錄">
        <h4 className="text-sm font-black">訂單紀錄</h4>
        {order.events.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">目前沒有訂單紀錄</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {order.events.map((event, index) => (
              <li key={`${event.eventType}-${event.createdAt}-${index}`} className="text-sm">
                <p className="font-bold">{EVENT_LABEL[event.eventType] || event.eventType}</p>
                <p className="text-xs text-muted-foreground">{formatTaipei(event.createdAt)}{event.actorRole ? `・${event.actorRole}` : ''}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="text-xs leading-relaxed text-muted-foreground">{order.notice || '付款與物流尚未串接。訂單成立不等於已付款、已出貨或已成交。'}</p>
      <p className="text-xs text-muted-foreground">收款確認、出貨、完成與退款都尚未串接，這裡不能把它們標成已完成。</p>
      {canCancel(order) && (
        <button type="button" onClick={() => void cancel()} disabled={busy} className={stacked ? `${ghost} min-h-11 w-full sm:w-auto` : ghost}>
          {busy ? '取消中' : '取消這張未付款訂單'}
        </button>
      )}
      {note && <p role="status" className="text-sm font-bold">{note}</p>}
    </article>
  )
}

function OrderCards({
  orders,
  onOpen,
  onContact,
  stacked = false,
}: {
  orders: CommerceOrder[]
  onOpen: (id: string) => void
  onContact?: (sellerId: string) => void
  stacked?: boolean
}) {
  const groups = groupBuyerOrders(orders)
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.batchId} className="space-y-3">
          {group.orders.length > 1 && (
            <p className="text-xs font-bold text-muted-foreground">同一次結帳，依賣場拆成 {group.orders.length} 筆訂單</p>
          )}
          {group.orders.map((order) => (
            <article key={order.orderId} className={`${panel} min-w-0 overflow-hidden`}>
              <header className={stacked
                ? 'flex flex-col items-start gap-2 border-b border-border/60 bg-muted/40 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:py-2.5'
                : 'flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-2.5'}>
                <span className={`text-sm font-black ${stacked ? 'break-words' : ''}`}>{order.storeName}</span>
                <span className={`font-mono text-xs text-muted-foreground ${stacked ? 'max-w-full break-all' : ''}`}>{order.displayNo}</span>
                <span className={stacked ? 'sm:ml-auto' : 'ml-auto'}><Status stage={order.buyerStage} label={order.buyerStageLabel} /></span>
              </header>
              <ul>
                {order.items.map((item) => (
                  <li key={item.orderItemId} className={stacked
                    ? 'flex flex-col gap-1 border-b border-border/50 px-4 py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3'
                    : 'flex gap-3 border-b border-border/50 px-4 py-3 last:border-0'}>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-bold ${stacked ? 'break-words' : ''}`}>{item.name}</p>
                      {stacked ? (
                        <>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.variantLabel}</p>
                          <p className="text-xs text-muted-foreground">數量 {item.qty}</p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">{item.variantLabel}・數量 {item.qty}</p>
                      )}
                    </div>
                    <p className={`text-sm font-bold ${stacked ? 'sm:shrink-0 sm:text-right' : ''}`}>
                      {stacked ? <span className="mr-1.5 text-xs font-medium text-muted-foreground sm:hidden">金額</span> : null}
                      {formatTwd(item.lineTotal)}
                    </p>
                  </li>
                ))}
              </ul>
              <footer className={stacked
                ? 'flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between'
                : 'flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm'}>
                <span className="text-xs text-muted-foreground">{formatTaipei(order.createdAt)}</span>
                <span>訂單金額 <b className={`text-base font-black ${stacked ? 'text-brand-ink' : ''}`}>{formatTwd(order.orderTotal)}</b></span>
                <span className={stacked ? 'grid grid-cols-1 gap-2 sm:flex' : 'flex gap-2'}>
                  {onContact && <button type="button" onClick={() => onContact(order.sellerId)} className={stacked ? `${ghost} min-h-11 w-full sm:w-auto` : ghost}>聯絡賣場</button>}
                  <button type="button" onClick={() => onOpen(order.orderId)} className={stacked ? `${ghost} min-h-11 w-full sm:w-auto` : ghost}>查看詳情</button>
                </span>
              </footer>
            </article>
          ))}
        </section>
      ))}
    </div>
  )
}

export function BuyerOrdersPanel({
  bucket,
  focusOrderId,
  onContact,
}: {
  bucket: BuyerOrderBucket
  focusOrderId?: string | null
  onContact?: (sellerId: string) => void
}) {
  const [orders, setOrders] = useState<CommerceOrder[] | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(focusOrderId ?? null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => { if (focusOrderId) setOpenId(focusOrderId) }, [focusOrderId])

  const load = useCallback(async () => {
    setError('')
    setOrders(null)
    const result = await listMyBuyerOrders(bucket)
    if (result.error) {
      setError(result.error)
      setOrders([])
      return
    }
    setOrders(result.data ?? [])
  }, [bucket])

  useEffect(() => { void load() }, [load, reloadKey])

  if (openId) {
    return (
      <OrderDetail
        orderId={openId}
        role="buyer"
        stacked
        onBack={() => setOpenId(null)}
        onChanged={() => setReloadKey((n) => n + 1)}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex sm:justify-end">
        <button type="button" onClick={() => setReloadKey((n) => n + 1)} className={`${ghost} min-h-11 w-full sm:w-auto`}>重新整理</button>
      </div>
      {orders == null ? <Message>訂單載入中</Message> : error ? (
        <div className="space-y-3">
          <Message error>{error}</Message>
          <button type="button" onClick={() => void load()} className={`${primary} min-h-11 w-full sm:w-auto`}>再試一次</button>
        </div>
      ) : orders.length === 0 ? (
        <Message>這個分類目前沒有訂單。正式結帳尚未開放，所以不會出現新的商品訂單。</Message>
      ) : (
        <>
          <OrderCards orders={orders} stacked onOpen={setOpenId} onContact={onContact} />
        </>
      )}
    </div>
  )
}

export function SellerOrdersPanel({
  focusOrderId,
  onPending,
}: {
  focusOrderId?: string | null
  onPending?: (count: number) => void
}) {
  const [bucket, setBucket] = useState<SellerOrderBucket>('all')
  const [orders, setOrders] = useState<CommerceOrder[] | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(focusOrderId ?? null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => { if (focusOrderId) setOpenId(focusOrderId) }, [focusOrderId])

  const load = useCallback(async () => {
    setError('')
    setOrders(null)
    const result = await listMySellerOrders(bucket)
    if (result.error) {
      setError(result.error)
      setOrders([])
      return
    }
    const rows = result.data ?? []
    setOrders(rows)
    if (bucket === 'pending') onPending?.(rows.length)
  }, [bucket, onPending])

  useEffect(() => { void load() }, [load, reloadKey])

  if (openId) {
    return <OrderDetail orderId={openId} role="seller" onBack={() => setOpenId(null)} onChanged={() => setReloadKey((n) => n + 1)} />
  }

  return (
    <section className="space-y-3" aria-label="訂單出貨">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {(['all', 'pending'] as const).map((id) => (
            <button key={id} type="button" onClick={() => setBucket(id)} className={bucket === id ? primary : ghost}>
              {id === 'all' ? '全部訂單' : '待處理'}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setReloadKey((n) => n + 1)} className={ghost}>重新整理</button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">只顯示目前登入賣場的訂單。收款確認、出貨、完成與退款尚未串接，不能在這裡標成已完成。</p>
      {orders == null ? <Message>訂單載入中</Message> : error ? (
        <div className="space-y-3">
          <Message error>{error}</Message>
          <button type="button" onClick={() => void load()} className={primary}>再試一次</button>
        </div>
      ) : orders.length === 0 ? (
        <Message>這個分類目前沒有訂單</Message>
      ) : (
        <OrderCards orders={orders} onOpen={setOpenId} />
      )}
    </section>
  )
}

const METRICS: { id: SellerMetric; label: string; amountKey: keyof SellerReport; countKey: keyof SellerReport; noteKey: keyof SellerReport }[] = [
  { id: 'placed', label: '成立訂單金額', amountKey: 'placedAmount', countKey: 'placedCount', noteKey: 'placedAmountNote' },
  { id: 'confirmed_collected', label: '已驗證收款', amountKey: 'confirmedCollectedAmount', countKey: 'confirmedCollectedCount', noteKey: 'confirmedCollectedNote' },
  { id: 'completed', label: '已完成訂單金額', amountKey: 'completedAmount', countKey: 'completedCount', noteKey: 'completedNote' },
  { id: 'cancelled', label: '取消訂單', amountKey: 'cancelledAmount', countKey: 'cancelledCount', noteKey: 'placedAmountNote' },
  { id: 'refunded', label: '可信退款', amountKey: 'refundAmount', countKey: 'refundCount', noteKey: 'refundNote' },
]

export function SellerReportPanel({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const [preset, setPreset] = useState<'today' | '7' | '30' | 'custom'>('30')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [range, setRange] = useState(() => taipeiRange('30'))
  const [report, setReport] = useState<SellerReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState<SellerMetric | null>(null)
  const [rows, setRows] = useState<MetricOrder[] | null>(null)
  const [rowError, setRowError] = useState('')

  const load = useCallback(async (next: { from: string; to: string }) => {
    setLoading(true)
    setError('')
    setMetric(null)
    setRows(null)
    const result = await sellerOperationsReport(next.from, next.to)
    setLoading(false)
    if (result.error || !result.data) {
      setReport(null)
      setError(result.error || '報表載入失敗')
      return
    }
    setReport(result.data)
  }, [])

  useEffect(() => { void load(range) }, [load, range])

  const applyPreset = (next: 'today' | '7' | '30') => {
    setPreset(next)
    setRange(taipeiRange(next))
  }

  const applyCustom = () => {
    const next = customTaipeiRange(fromDate, toDate)
    if (!next) {
      setError('請選擇開始日期，結束日期不能早於開始日期')
      return
    }
    setPreset('custom')
    setRange(next)
  }

  const openMetric = async (id: SellerMetric) => {
    setMetric(id)
    setRows(null)
    setRowError('')
    const result = await sellerOrdersForMetric(id, range.from, range.to)
    if (result.error) {
      setRowError(result.error)
      setRows([])
      return
    }
    setRows(result.data ?? [])
  }

  return (
    <section className="space-y-4" aria-label="營運報表">
      <div>
        <h2 className="text-base font-black">營運報表</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">平台不代收、不代撥商品款。成立訂單金額不是實際收款，也不是平台收入。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {([['today', '今天'], ['7', '近 7 天'], ['30', '近 30 天']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => applyPreset(id)} className={preset === id ? primary : ghost}>{label}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold text-muted-foreground">自訂開始
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 block rounded-xl border border-input bg-card px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-muted-foreground">自訂結束
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 block rounded-xl border border-input bg-card px-3 py-2 text-sm" />
        </label>
        <button type="button" onClick={applyCustom} className={ghost}>套用區間</button>
      </div>
      {loading ? <Message>報表載入中</Message> : error ? (
        <div className="space-y-3">
          <Message error>{error}</Message>
          <button type="button" onClick={() => void load(range)} className={primary}>再試一次</button>
        </div>
      ) : report && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {METRICS.map((item) => (
              <button key={item.id} type="button" onClick={() => void openMetric(item.id)} className={`${panel} p-4 text-left transition hover:bg-muted/40`}>
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="mt-1 text-xl font-black">{formatTwd(Number(report[item.amountKey]))}</p>
                <p className="text-sm font-bold">{Number(report[item.countKey])} 筆</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {item.id === 'cancelled' ? '此區間已取消訂單的訂單金額' : String(report[item.noteKey] || '')}
                </p>
              </button>
            ))}
            <button type="button" onClick={() => void openMetric('pending')} className={`${panel} p-4 text-left transition hover:bg-muted/40`}>
              <p className="text-xs text-muted-foreground">待處理訂單</p>
              <p className="mt-1 text-xl font-black">{report.pendingCount}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{report.pendingNote}</p>
            </button>
          </div>
          {metric && (
            <div className="space-y-2">
              <h3 className="text-sm font-black">對應訂單</h3>
              {rows == null ? <Message>明細載入中</Message> : rowError ? <Message error>{rowError}</Message> : rows.length === 0 ? (
                <Message>這個指標目前是 0，沒有對應訂單</Message>
              ) : (
                <ul className="space-y-2">
                  {rows.map((row) => (
                    <li key={row.orderId}>
                      <button type="button" onClick={() => onOpenOrder(row.orderId)} className={`${panel} flex w-full flex-wrap items-center gap-2 p-3 text-left`}>
                        <span className="font-mono text-sm font-bold">{row.displayNo}</span>
                        <Status stage={row.buyerStage} label={row.buyerStageLabel} />
                        <span className="text-xs text-muted-foreground">{formatTaipei(row.createdAt)}</span>
                        <span className="ml-auto font-bold">{formatTwd(row.orderTotal)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function OrderNotifications({
  onOpenOrder,
  onChanged,
}: {
  onOpenOrder: (orderId: string) => void
  onChanged?: () => void
}) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listMyOrderNotifications>>['data']>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await listMyOrderNotifications(50)
    setLoading(false)
    if (result.error) {
      setRows([])
      setError(result.error)
      return
    }
    setRows(result.data ?? [])
  }, [])

  useEffect(() => { void load() }, [load])

  const open = async (id: string, orderId: string, unread: boolean) => {
    if (unread) {
      const markError = await markOrderNotificationRead(id)
      if (markError) {
        setError(markError)
        return
      }
      setRows((current) => current?.map((row) => row.id === id ? { ...row, readAt: new Date().toISOString() } : row) ?? current)
      onChanged?.()
    }
    onOpenOrder(orderId)
  }

  const unread = rows?.filter((row) => !row.readAt).length ?? 0

  return (
    <section className="space-y-3" aria-label="訂單通知">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-black">訂單通知{rows ? `（未讀 ${unread}）` : ''}</h2>
        <button type="button" onClick={() => void load()} className={ghost}>重新整理</button>
      </div>
      {loading ? <Message>通知載入中</Message> : error ? (
        <div className="space-y-3">
          <Message error>{error}</Message>
          <button type="button" onClick={() => void load()} className={primary}>再試一次</button>
        </div>
      ) : !rows || rows.length === 0 ? (
        <Message>目前沒有訂單通知</Message>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => void open(row.id, row.orderId, !row.readAt)}
                className={`${panel} w-full p-4 text-left ${row.readAt ? '' : 'ring-1 ring-primary/50'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-black">{row.title}</p>
                  {!row.readAt && <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-black text-white">未讀</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{formatTaipei(row.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{row.body}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{row.displayNo}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function SellerSnapshotCards() {
  const [pending, setPending] = useState<number | null>(null)
  const [placed, setPlaced] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stop = false
    const range = taipeiRange('30')
    void sellerOperationsReport(range.from, range.to).then((result) => {
      if (stop) return
      if (result.error || !result.data) {
        setError(result.error || '報表載入失敗')
        return
      }
      setPending(result.data.pendingCount)
      setPlaced(result.data.placedAmount)
    })
    return () => { stop = true }
  }, [])

  return (
    <>
      <div className={`${panel} p-4`}>
        <p className="text-xs text-muted-foreground">待處理訂單</p>
        <p className="text-base font-black">{error ? '無法讀取' : pending == null ? '讀取中' : pending}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">不受日期影響，只算目前仍待處理的真實訂單</p>
      </div>
      <div className={`${panel} p-4`}>
        <p className="text-xs text-muted-foreground">近 30 天成立金額</p>
        <p className="text-base font-black">{error ? '無法讀取' : placed == null ? '讀取中' : formatTwd(placed)}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">成立訂單金額，不是已收款，也不是平台收入</p>
      </div>
    </>
  )
}

export function useOrderUnread(active: boolean) {
  const [count, setCount] = useState(0)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((n) => n + 1), [])
  useEffect(() => {
    if (!active) {
      setCount(0)
      return
    }
    let stop = false
    void listMyOrderNotifications(50).then((result) => {
      if (stop || result.error || !result.data) return
      setCount(result.data.filter((row) => !row.readAt).length)
    })
    return () => { stop = true }
  }, [active, version])
  return { count, reload }
}
