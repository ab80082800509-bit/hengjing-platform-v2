'use client'

import { useEffect } from 'react'
import { rememberSignupInvite } from '@/lib/rewards/pending-invite'
import { getVisitorId } from '@/lib/visitor'

export function ReferralTracker() {
  useEffect(() => {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('ref')?.toUpperCase()
    if (!code || !/^[A-Z0-9]{8}$/.test(code)) return

    url.searchParams.delete('ref')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)

    rememberSignupInvite(code)
    // 進站紀錄只留在既有邀請資料庫，不會增加刮卡次數。
    void fetch('/api/referral/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, visitorId: getVisitorId() }),
      keepalive: true,
    }).catch(() => undefined)
  }, [])

  return null
}
