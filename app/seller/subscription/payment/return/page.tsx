import { Suspense } from 'react'
import { SellerSubscriptionPaymentQuery } from '@/components/seller-subscription-payment-query'

export const metadata = { title: '月費付款查詢｜買個 Pay 服' }

export default function SellerSubscriptionPaymentReturnPage() {
  return (
    <main className="mx-auto min-h-screen max-w-xl bg-background px-4 py-10 text-foreground">
      <Suspense fallback={<p className="text-sm text-muted-foreground">正在查詢伺服器上的付款單</p>}>
        <SellerSubscriptionPaymentQuery />
      </Suspense>
    </main>
  )
}
