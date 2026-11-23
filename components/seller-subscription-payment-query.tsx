'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  loadMySellerSubscriptionPayment,
  SellerSubscriptionPaymentCard,
  type SubscriptionPayment,
} from '@/components/seller-subscription-panel'

export function SellerSubscriptionPaymentQuery() {
  const params = useSearchParams()
  const orderNo = params.get('order') ?? ''
  const ignored = params.has('status') || params.has('Status') || params.has('amt') || params.has('Amt') || params.has('TradeInfo')
  const [payment, setPayment] = useState<SubscriptionPayment | null>(null)
  const [message, setMessage] = useState('正在查詢伺服器上的付款單')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadMySellerSubscriptionPayment(orderNo).then((result) => {
      if (cancelled) return
      setPayment(result.payment)
      setMessage(result.message || (orderNo ? '找不到這張付款單。這一頁只顯示伺服器查到的結果。' : '請帶付款單編號。'))
      setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [orderNo])

  return (
    <section className="space-y-4" aria-label="月費付款查詢">
      <h1 className="text-2xl font-black">月費付款查詢</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
      {ignored && <p className="text-sm font-bold">已忽略網址上的付款狀態與金額，沒有用它們入帳。</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {payment && <SellerSubscriptionPaymentCard payment={payment} />}
      <Link href="/?view=seller&tab=plan" className="inline-flex text-sm font-bold underline">
        回到方案與月費
      </Link>
    </section>
  )
}
