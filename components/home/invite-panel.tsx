'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Check, Copy, Link2, Share2 } from 'lucide-react'
import { fetchMyInviteStatus } from '@/lib/rewards/invite-client'

const channelBtn =
  'inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground transition hover:bg-muted active:scale-[0.98]'

export function InvitePanel({ userId, onBonus }: { userId: string | null; onBonus?: (bonusToday: boolean) => void }) {
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const { data, error: loadError } = useSWR(
    userId ? ['member-invite', userId] : null,
    async () => {
      const result = await fetchMyInviteStatus(userId)
      if (result.error || !result.data) throw new Error(result.error ?? '邀請狀態暫時無法讀取')
      onBonus?.(result.data.inviteBonusToday)
      return result.data
    },
    { refreshInterval: 4000, revalidateOnFocus: true },
  )

  const link = data && typeof window !== 'undefined' ? `${window.location.origin}/?ref=${data.code}` : ''
  const text = '我在買個Pay服逛到好多優惠，完成註冊後我們都能參加每日刮刮卡，點我的連結一起來'
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const message = loadError instanceof Error ? loadError.message : ''

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

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="rounded-2xl border border-border/70 bg-muted/50 p-3">
        <p className="text-sm font-black">邀請朋友完成註冊</p>
        <p className="mt-1 text-pretty text-xs text-muted-foreground">
          朋友要使用這個連結註冊新會員，並完成信箱驗證，你今天才能多刮 1 次。只點開連結不會加次數。同一位朋友只能成立一次，不能邀請自己。加到的次數在台灣時間 00:00 作廢。
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-bold text-muted-foreground">你的專屬邀請連結</p>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 flex-1 select-all truncate text-xs font-medium" aria-live="polite">
            {link || (message ? '連結暫時無法讀取' : '正在產生連結…')}
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

      <p className={`rounded-2xl border border-border/70 bg-muted/40 px-3 py-3 text-xs font-bold ${data?.inviteBonusToday ? 'text-emerald-400' : 'text-muted-foreground'}`}>
        {data?.inviteBonusToday
          ? '今天已有朋友完成註冊，額外 1 次已加上'
          : '今天還沒有朋友完成註冊。對方驗證信箱並登入後，這裡會更新。'}
      </p>

      {(error || message) && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive">
          {error || message}
        </p>
      )}
    </div>
  )
}
