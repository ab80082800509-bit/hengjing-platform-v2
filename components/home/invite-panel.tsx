'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Check, Copy, Link2, Share2, Store, Users } from 'lucide-react'
import { getVisitorId } from '@/lib/visitor'

type InviteStatus = { code: string; pending: number; claimedToday: boolean }

const CLAIM_ERRORS: Record<string, string> = {
  no_visit: '還沒有朋友透過你的連結進站',
  already_today: '今天已領取過邀請加碼，明天再來',
  no_code: '找不到你的邀請連結，請重新開啟',
}

const primaryBtn =
  'inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const channelBtn =
  'inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground transition hover:bg-muted active:scale-[0.98]'

export function InvitePanel({ name, onClaimed }: { name: string; onClaimed: () => void }) {
  const [visitorId] = useState(() => getVisitorId())
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [claiming, setClaiming] = useState(false)

  const { data, error: loadError, mutate } = useSWR<InviteStatus>(
    ['referral-me', visitorId, name],
    async () => {
      const res = await fetch('/api/referral/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, name }),
      })
      if (!res.ok) throw new Error('load_failed')
      return (await res.json()) as InviteStatus
    },
    { refreshInterval: 4000, revalidateOnFocus: true },
  )

  const link = data ? `${window.location.origin}/?ref=${data.code}` : ''
  const text = '我在買個Pay服逛到好多優惠，每天簽到、刮刮卡還能領券，點我的連結一起來逛逛'
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const pending = data?.pending ?? 0
  const canClaim = Boolean(data) && pending > 0 && !data?.claimedToday && !claiming

  const nativeShare = async () => {
    setError('')
    try {
      await navigator.share({ title: '買個Pay服', text, url: link })
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError('目前環境無法開啟系統分享，請改用複製連結')
    }
  }

  const copyLink = async () => {
    setError('')
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('瀏覽器不允許自動複製，請長按上方連結手動複製')
    }
  }

  const openChannel = (href: string) => {
    setError('')
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  const claim = async () => {
    setError('')
    setClaiming(true)
    try {
      const res = await fetch('/api/referral/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId }),
      })
      const result = (await res.json()) as { ok: boolean; reason?: string }
      if (result.ok) {
        onClaimed()
        return
      }
      setError(CLAIM_ERRORS[result.reason ?? ''] ?? '領取失敗，請稍後再試')
      void mutate()
    } catch {
      setError('網路異常，請稍後再試')
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/50 p-3">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Store className="size-7" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-black">買個Pay服</p>
          <p className="mt-0.5 text-pretty text-xs text-muted-foreground">把你的專屬連結傳給朋友，朋友點開進站後，你才能領取 +1 次</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-bold text-muted-foreground">你的專屬邀請連結</p>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 flex-1 select-all truncate text-xs font-medium" aria-live="polite">
            {link || (loadError ? '連結載入失敗' : '正在產生連結…')}
          </p>
          <button type="button" onClick={copyLink} disabled={!link} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-bold transition hover:bg-muted/70 disabled:opacity-50">
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? '已複製' : '複製'}
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {canNativeShare && (
          <button type="button" disabled={!link} onClick={nativeShare} className={`${channelBtn} sm:col-span-2`}>
            <Share2 className="size-4" aria-hidden />
            使用系統分享
          </button>
        )}
        <button
          type="button"
          disabled={!link}
          onClick={() => openChannel(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`)}
          className={channelBtn}
        >
          <Link2 className="size-4" aria-hidden />
          分享到 LINE
        </button>
        <button
          type="button"
          disabled={!link}
          onClick={() => openChannel(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`)}
          className={channelBtn}
        >
          <Share2 className="size-4" aria-hidden />
          分享到 Facebook
        </button>
      </div>

      <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/40 p-3">
        <p className={`flex items-center gap-2 text-xs font-bold ${pending > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
          <Users className="size-4" aria-hidden />
          {data?.claimedToday
            ? '今天已領取邀請加碼'
            : pending > 0
              ? `已有 ${pending} 位朋友透過你的連結進站，可以領取了`
              : '還沒有朋友透過你的連結進站，進站後這裡會自動更新'}
        </p>
        <button type="button" onClick={claim} disabled={!canClaim} className={primaryBtn}>
          領取 +1 次刮刮卡
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
