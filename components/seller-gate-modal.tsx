'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Lock, MessageSquareText, PackageOpen, ReceiptText, Rocket, ShoppingBag, Store, X } from 'lucide-react'

interface SellerGateModalProps {
  onClose: () => void
  onUpgrade: () => void
  onDemo?: () => void
}

const PERKS: { icon: ReactNode; title: string; desc: string }[] = [
  { icon: <PackageOpen className="size-4" />, title: '蝦皮一鍵搬家', desc: '商品資料快速匯入，免重新上架' },
  { icon: <MessageSquareText className="size-4" />, title: '自動簡訊提醒', desc: '到期前 7 天與 3 天主動通知' },
  { icon: <ReceiptText className="size-4" />, title: '雲端發票夾', desc: '歷史電子發票與收據隨時下載' },
]

export function SellerGateModal({ onClose, onUpgrade, onDemo }: SellerGateModalProps) {
  const primaryRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    primaryRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      trigger?.focus?.()
    }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="關閉視窗"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-foreground/50 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="seller-gate-title"
        aria-describedby="seller-gate-desc"
        className="relative flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-border/70 bg-card shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-6 motion-safe:duration-300 sm:rounded-3xl sm:zoom-in-95"
      >
        <div className="overflow-y-auto px-5 pb-5 pt-5">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-foreground">
              <Lock className="size-3.5 text-primary" />
              解鎖賣家專屬後台
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="關閉視窗"
              className="-mr-1.5 -mt-1 rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>

          <h2 id="seller-gate-title" className="mt-4 text-balance text-xl font-black leading-tight">
            您目前是以「買家」身分瀏覽
          </h2>
          <p id="seller-gate-desc" className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
            這是賣家專屬的管理中心。如果您也想在此平台開設自己的專屬商店、享有蝦皮一鍵搬家、自動簡訊提醒與雲端發票功能，歡迎立即升級為創始店長（月費 NT$ 599，另加 5% 營業稅，含稅 NT$ 629）！
          </p>

          <ul className="mt-4 space-y-2">
            {PERKS.map((perk) => (
              <li key={perk.title} className="flex items-center gap-3 rounded-2xl bg-muted/60 px-3 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">{perk.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-black leading-tight">{perk.title}</span>
                  <span className="block text-pretty text-xs leading-snug text-muted-foreground">{perk.desc}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-col gap-2.5">
            <button
              ref={primaryRef}
              type="button"
              onClick={onUpgrade}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.98]"
            >
              <Rocket className="size-4" />
              了解開店方案 / 立即升級
              <ArrowRight className="size-4" />
            </button>
            {onDemo && (
              <button
                type="button"
                onClick={onDemo}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-primary bg-primary/10 px-5 py-3 text-sm font-bold text-foreground transition hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.98]"
              >
                <Store className="size-4" />
                免註冊，直接體驗測試賣家
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.98]"
            >
              <ShoppingBag className="size-4" />
              返回買家首頁
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
