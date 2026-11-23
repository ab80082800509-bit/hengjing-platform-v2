'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type SubscriptionReminder = {
  id: string
  title: string
  body: string
  endsTaipei: string
  readAt: string | null
  createdTaipei: string
}

function readSubscriptionReminders(data: unknown): SubscriptionReminder[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.body !== 'string') return []
    return [{
      id: row.id,
      title: row.title,
      body: row.body,
      endsTaipei: typeof row.endsTaipei === 'string' ? row.endsTaipei : '',
      readAt: typeof row.readAt === 'string' ? row.readAt : null,
      createdTaipei: typeof row.createdTaipei === 'string' ? row.createdTaipei : '',
    }]
  })
}

export async function loadMySubscriptionReminders(): Promise<{ rows: SubscriptionReminder[]; error: string }> {
  const { data, error } = await supabase.rpc('list_my_seller_subscription_reminders')
  if (error) return { rows: [], error: error.message }
  return { rows: readSubscriptionReminders(data), error: '' }
}

export async function markMySubscriptionRemindersRead(): Promise<string> {
  const { error } = await supabase.rpc('mark_my_seller_subscription_reminders_read')
  return error ? error.message : ''
}

type Quote = {
  net: number
  tax: number
  gross: number
  chargeAmt?: number
  approxDisplay: number
  approxIsCharge: boolean
}

type ExtensionRequest = {
  id: string
  status: string
  statusLabel: string
  requestedTaipei: string | null
  reviewedTaipei: string | null
  note: string | null
  sellerUserId?: string
  storeName?: string
  reviewedBy?: string | null
  state?: { label?: string }
}

type SubscriptionPolicy = {
  enabled: boolean
  enabledTaipei: string | null
}

export type SubscriptionView = {
  state: string
  label: string
  canStartNewTrade: boolean | null
  startsTaipei: string | null
  endsTaipei: string | null
  serverTaipei: string | null
  remainingText: string | null
  canApplyExtension: boolean
  applyBlockReason: string | null
  extensionUsed: boolean
  extensionQualificationUsed?: boolean
  scheduleNote: string | null
  paymentStatus: string
  quote: Quote
  policy?: SubscriptionPolicy
  checkoutOpen?: boolean
  requests: ExtensionRequest[]
}

export function eligibilityText(view: { canStartNewTrade: boolean | null; checkoutOpen?: boolean }) {
  const qualification =
    view.canStartNewTrade === true
      ? '訂閱資格有效'
      : view.canStartNewTrade === false
        ? '訂閱資格已到期，不能開始新交易。既有訂單、物流、售後與聊天不受這項限制'
        : '訂閱制度還沒有啟用時間，目前不因月費擋住新交易'
  const checkout = view.checkoutOpen === true ? '平台結帳已開放' : '平台結帳尚未開放'
  return { qualification, checkout }
}

const panel = 'rounded-2xl border border-border/70 bg-card shadow-sm'
const primaryBtn =
  'inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50'
const ghostBtn =
  'inline-flex items-center justify-center rounded-full border border-border bg-card px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'

const twd = (value: number) =>
  `NT$${Number(value).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export type SubscriptionPayment = {
  id: string
  merchantOrderNo: string
  quoteNet: string
  quoteTax: string
  quoteGross: string
  approxDisplay: number
  approxIsCharge: boolean
  gatewayAmt: number | null
  status: string
  tradeNo: string | null
  paidTaipei: string | null
  failureCode: string | null
  createdTaipei: string | null
  periodWritten: boolean
}

const paymentStatusText: Record<string, string> = {
  amount_pending: '實收整數尚未定案，尚未送出藍新',
  pending: '已送出，尚未入帳',
  paid: '已入帳，尚未寫入付費期限',
  failed: '付款失敗，沒有入帳',
}

function readPayment(data: unknown): SubscriptionPayment | null {
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.merchantOrderNo !== 'string' || typeof row.quoteGross !== 'string') return null
  return {
    id: row.id,
    merchantOrderNo: row.merchantOrderNo,
    quoteNet: typeof row.quoteNet === 'string' ? row.quoteNet : '',
    quoteTax: typeof row.quoteTax === 'string' ? row.quoteTax : '',
    quoteGross: row.quoteGross,
    approxDisplay: typeof row.approxDisplay === 'number' ? row.approxDisplay : 524,
    approxIsCharge: row.approxIsCharge === true,
    gatewayAmt: typeof row.gatewayAmt === 'number' ? row.gatewayAmt : null,
    status: typeof row.status === 'string' ? row.status : '',
    tradeNo: typeof row.tradeNo === 'string' ? row.tradeNo : null,
    paidTaipei: typeof row.paidTaipei === 'string' ? row.paidTaipei : null,
    failureCode: typeof row.failureCode === 'string' ? row.failureCode : null,
    createdTaipei: typeof row.createdTaipei === 'string' ? row.createdTaipei : null,
    periodWritten: row.periodWritten === true,
  }
}

export async function loadMySellerSubscriptionPayment(orderNo: string) {
  const { data, error } = await supabase.rpc('get_my_seller_subscription_payment', { p_order: orderNo })
  if (error) return { payment: null as SubscriptionPayment | null, message: '', error: error.message }
  const body = (data ?? {}) as { message?: string; payment?: unknown }
  return { payment: readPayment(body.payment), message: body.message ?? '', error: '' }
}

export function SellerSubscriptionPaymentCard({ payment }: { payment: SubscriptionPayment }) {
  const legacy = payment.gatewayAmt == null
  const label = legacy
    ? '舊報價草稿，尚未送出'
    : payment.status === 'amount_pending'
      ? `實收 ${payment.gatewayAmt} 元，尚未送出`
      : paymentStatusText[payment.status] ?? '付款單狀態未定義'
  return (
    <article className="space-y-1 rounded-xl bg-muted/50 p-3 text-sm">
      <p className="font-black">{label}</p>
      <p className="font-mono text-xs">付款單 {payment.merchantOrderNo}</p>
      {legacy ? (
        <p>這張未送出草稿保留原報價，含稅 NT${payment.quoteGross}。請用新付款單。</p>
      ) : (
        <p>含稅實付 NT${payment.quoteGross}。藍新 MPG 的 Amt 是 {payment.gatewayAmt}。正式收款維持關閉。</p>
      )}
      <p>{payment.periodWritten ? '付費期限已寫入' : '不會寫成有效訂閱，試營業、延長與付費期限都沒有被改寫。'}</p>
      {payment.paidTaipei && <p>入帳時間（台北）{payment.paidTaipei}</p>}
      {payment.tradeNo && <p className="font-mono text-xs">藍新交易序號 {payment.tradeNo}</p>}
      {payment.failureCode && <p>失敗代碼 {payment.failureCode}</p>}
    </article>
  )
}

export function SellerSubscriptionPanel({ onNotify }: { onNotify: (message: string) => void }) {
  const [view, setView] = useState<SubscriptionView | null>(null)
  const [payments, setPayments] = useState<SubscriptionPayment[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [{ data, error: rpcError }, paymentResult] = await Promise.all([
      supabase.rpc('get_my_seller_subscription'),
      supabase.rpc('list_my_seller_subscription_payments'),
    ])
    if (rpcError) {
      setError(rpcError.message)
      setView(null)
      return
    }
    setError(paymentResult.error?.message ?? '')
    setView(data as SubscriptionView)
    setPayments(Array.isArray(paymentResult.data) ? paymentResult.data.flatMap((item) => {
      const row = readPayment(item)
      return row ? [row] : []
    }) : [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const apply = async () => {
    if (!view?.canApplyExtension) {
      onNotify(view?.applyBlockReason || '現在不能再提出延長申請')
      return
    }
    setBusy(true)
    const { data, error: rpcError } = await supabase.rpc('apply_my_seller_extension')
    setBusy(false)
    if (rpcError) {
      onNotify(rpcError.message)
      await load()
      return
    }
    setView(data as SubscriptionView)
    onNotify('已送出 15 天延長申請，等候站長審核。待審不會自動延長期限。')
  }

  const subscribe = async () => {
    setBusy(true)
    const { data, error: rpcError } = await supabase.rpc('create_my_seller_subscription_payment')
    setBusy(false)
    if (rpcError) {
      onNotify(rpcError.message)
      return
    }
    const body = data as { message?: string }
    onNotify(body.message ?? '付款單沒有建立')
    await load()
  }

  return (
    <section className="space-y-4" aria-label="方案與月費管理">
      <div className={`${panel} space-y-3 p-5`}>
        <p className="text-xs font-bold text-muted-foreground">目前方案</p>
        <h2 className="text-xl font-black">標準賣家方案</h2>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {view && (
          <>
            <p className="text-sm font-bold">
              未稅 {twd(view.quote.net)}，稅額 {twd(view.quote.tax)}，含稅實付 {twd(view.quote.gross)}。
            </p>
            <p className="text-sm text-muted-foreground">
              藍新 MPG 使用 Amt={view.quote.chargeAmt ?? view.quote.gross}。正式收款維持關閉，付費起算與續期尚未接上。
            </p>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">目前狀態</dt>
                <dd className="font-black">{view.label}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">伺服器時間（台北）</dt>
                <dd className="font-bold">{view.serverTaipei ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">開始（台北）</dt>
                <dd className="font-bold">{view.startsTaipei ?? '尚未寫入'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">結束（台北）</dt>
                <dd className="font-bold">{view.endsTaipei ?? '尚未寫入'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">剩餘時間</dt>
                <dd className="font-bold">{view.remainingText ?? '沒有進行中的期限'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">付款狀態</dt>
                <dd className="font-bold">{view.paymentStatus === 'paid' ? '已付款' : '未付款'}</dd>
              </div>
            </dl>
            <p className="text-sm">{eligibilityText(view).qualification}</p>
            <p className="text-sm">{eligibilityText(view).checkout}</p>
            {view.scheduleNote && <p className="text-sm font-bold">{view.scheduleNote}</p>}
            <p className="text-xs leading-relaxed text-muted-foreground">
              新賣家從審核通過起算 30 天試營業。制度啟用前就已通過的賣家，從站長設定的啟用時間起算完整 30 天。到期只能提出一次 15 天延長；申請寫入後就用掉資格，拒絕後不能再申請。待審不會延長。站長核准後從核准時間起算 15 天，並立即進入延長中。
              {view.policy?.enabled
                ? ` 制度已於 ${view.policy.enabledTaipei}（台北）啟用。`
                : ' 站長還沒設定啟用時間，所以啟用程序不會在這裡替賣家起算。'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryBtn} disabled={busy || !view.canApplyExtension} onClick={() => void apply()}>
                申請 15 天延長
              </button>
              <button type="button" className={ghostBtn} disabled={busy} onClick={() => void subscribe()}>
                立即訂閱
              </button>
            </div>
            {view.applyBlockReason && <p className="text-xs text-muted-foreground">{view.applyBlockReason}</p>}
            <div className="space-y-2 border-t border-border/60 pt-3" aria-label="月費付款單">
              <h3 className="text-sm font-black">月費付款單</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                新付款單由伺服器寫入實收 420 元，藍新 MPG 使用 Amt=420。舊的未送出草稿保留原報價。正式收款維持關閉，不會寫成有效訂閱。
              </p>
              {payments.length === 0 && <p className="text-sm text-muted-foreground">還沒有付款單</p>}
              <ul className="space-y-2">
                {payments.map((payment) => (
                  <li key={payment.id}>
                    <SellerSubscriptionPaymentCard payment={payment} />
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
      <div className={`${panel} space-y-3 p-5`}>
        <h3 className="text-sm font-black">延長申請紀錄</h3>
        {view && view.requests.length === 0 && <p className="text-sm text-muted-foreground">還沒有申請</p>}
        <ul className="space-y-2">
          {view?.requests.map((row) => (
            <li key={row.id} className="rounded-xl bg-muted/50 p-3 text-sm">
              <p className="font-bold">{row.statusLabel}</p>
              <p className="text-muted-foreground">申請 {row.requestedTaipei ?? '—'}</p>
              {row.reviewedTaipei && <p className="text-muted-foreground">審核 {row.reviewedTaipei}</p>}
              {row.note && <p>{row.note}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function AdminSellerExtensionPanel({ onNotify }: { onNotify: (message: string) => void }) {
  const [rows, setRows] = useState<ExtensionRequest[]>([])
  const [policy, setPolicy] = useState<SubscriptionPolicy | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [enabling, setEnabling] = useState(false)

  const load = useCallback(async () => {
    const [{ data, error: rpcError }, policyResult] = await Promise.all([
      supabase.rpc('admin_list_seller_extensions'),
      supabase.rpc('seller_subscription_policy'),
    ])
    if (rpcError) {
      setError(rpcError.message)
      setRows([])
    } else {
      setError('')
      setRows((data ?? []) as ExtensionRequest[])
    }
    if (!policyResult.error) setPolicy(policyResult.data as SubscriptionPolicy)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const review = async (id: string, approve: boolean) => {
    setBusyId(id)
    const { error: rpcError } = await supabase.rpc('admin_review_seller_extension', {
      p_id: id,
      p_approve: approve,
      p_note: approve ? '核准一次延長' : '拒絕延長',
    })
    setBusyId(null)
    const message = rpcError
      ? rpcError.message
      : approve
        ? '已核准。15 天從伺服器的核准時間起算，賣家已進入延長中。'
        : '已拒絕。這次申請已用掉唯一資格，不能再提出。'
    setNote(message)
    onNotify(message)
    await load()
  }

  const pending = rows.filter((row) => row.status === 'pending')

  const enable = async () => {
    if (policy?.enabled) {
      onNotify('啟用時間已寫入，再次操作不會重設期限')
      return
    }
    setEnabling(true)
    const { data, error: rpcError } = await supabase.rpc('admin_enable_seller_subscriptions')
    setEnabling(false)
    const body = data as { alreadyEnabled?: boolean; enabledTaipei?: string; sellersStarted?: number } | null
    const message = rpcError
      ? rpcError.message
      : body?.alreadyEnabled
        ? `啟用時間維持 ${body.enabledTaipei}（台北），沒有重設期限。`
        : `已於 ${body?.enabledTaipei ?? '伺服器時間'}（台北）啟用，既有通過賣家 ${body?.sellersStarted ?? 0} 位從這個時間起算 30 天。`
    setNote(message)
    onNotify(message)
    await load()
  }

  return (
    <div className={`${panel} space-y-3 p-5`}>
      <h2 className="text-base font-black">賣家訂閱制度</h2>
      <p className="text-sm">
        啟用時間（台北）：<span className="font-black">{policy?.enabled ? policy.enabledTaipei : '尚未設定'}</span>
      </p>
      <p className="text-sm text-muted-foreground">
        只有按下啟用才會寫入伺服器現在時間。部署、登入或重整不會起算。再次按下不會重設已有期限。
      </p>
      <button type="button" className={primaryBtn} disabled={enabling || policy?.enabled === true} onClick={() => void enable()}>
        啟用賣家訂閱制度
      </button>
      <h2 className="text-base font-black">15 天延長審核</h2>
      <p className="text-sm text-muted-foreground">
        待審不會自動延長，到期仍限制新交易。核准會在同一筆操作寫入 15 天，並從核准時間起算，賣家立即進入延長中。拒絕後不能再申請。重複批准不會延長兩次。
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {note && <p className="text-sm font-bold">{note}</p>}
      {pending.length === 0 && <p className="text-sm text-muted-foreground">目前沒有待審申請</p>}
      <ul className="space-y-3">
        {pending.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 p-3">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-black">{row.storeName ?? '賣場'}</p>
              <p className="text-muted-foreground">申請 {row.requestedTaipei}</p>
            </div>
            <button type="button" className={ghostBtn} disabled={busyId !== null} onClick={() => void review(row.id, false)}>
              拒絕
            </button>
            <button type="button" className={primaryBtn} disabled={busyId !== null} onClick={() => void review(row.id, true)}>
              批准
            </button>
          </li>
        ))}
      </ul>
      {rows.some((row) => row.status !== 'pending') && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <h3 className="text-sm font-black">已審核紀錄</h3>
          <ul className="space-y-2">
            {rows.filter((row) => row.status !== 'pending').map((row) => (
              <li key={row.id} className="text-sm text-muted-foreground">
                {row.storeName ?? '賣場'}・{row.statusLabel}・{row.state?.label ?? '狀態未回傳'}・{row.reviewedTaipei ?? row.requestedTaipei}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function SellerSubscriptionReminderList({
  rows,
  error,
  onMarkRead,
}: {
  rows: SubscriptionReminder[] | null
  error: string
  onMarkRead: () => void
}) {
  const unread = (rows ?? []).filter((row) => !row.readAt).length
  return (
    <section className="space-y-3" aria-label="方案到期提醒">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-black">方案到期提醒{rows ? `（${rows.length}）` : ''}</h2>
        {unread > 0 && (
          <button type="button" onClick={onMarkRead} className={`${ghostBtn} px-3 py-1.5 text-xs`}>全部標示已讀</button>
        )}
      </div>
      {rows == null ? (
        <p className={`${panel} p-6 text-center text-sm text-muted-foreground`}>通知載入中</p>
      ) : error ? (
        <p className={`${panel} p-6 text-sm text-destructive`}>{error}</p>
      ) : rows.length === 0 ? (
        <p className={`${panel} p-6 text-center text-sm text-muted-foreground`}>目前沒有方案到期提醒</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className={`${panel} space-y-2 p-4 ${row.readAt ? '' : 'ring-1 ring-destructive/40'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-black">{row.title}</p>
                {!row.readAt && <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-black text-white">未讀</span>}
                <span className="ml-auto font-mono text-xs text-muted-foreground">{row.createdTaipei}</span>
              </div>
              <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{row.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
