import { Suspense } from 'react'
import OpenMarketplace from '@/components/open-marketplace'
import { ReferralTracker } from '@/components/referral-tracker'

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReferralTracker />
      <OpenMarketplace />
    </Suspense>
  )
}
