'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, ShieldCheck, Truck, X } from 'lucide-react'

interface WelcomePromoModalProps {
  threshold: number
  onClose: () => void
}

export function WelcomePromoModal({ threshold, onClose }: WelcomePromoModalProps) {
  const ctaRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ctaRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [mounted])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="關閉活動公告"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-foreground/55 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-promo-title"
        className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-border/70 bg-card shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉活動公告"
          className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full bg-card/90 text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-5" />
        </button>

        <div className="bg-primary px-6 pb-7 pt-8 text-primary-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/15 px-3 py-1 text-xs font-bold">
            <Truck className="size-3.5" />
            限時活動・全站適用
          </span>
          <p className="mt-4 text-sm font-medium opacity-90">單一店家消費滿</p>
          <p id="welcome-promo-title" className="flex items-baseline gap-1.5 font-black leading-none">
            <span className="text-3xl">$</span>
            <span className="text-7xl tracking-tight">{threshold}</span>
            <span className="text-2xl">享免運</span>
          </p>
        </div>

        <div className="space-y-4 px-6 pb-6 pt-5">
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            每間店家獨立計算，湊滿 {threshold} 元就自動折抵運費。7-11、全家、宅配都適用，購物車會即時顯示還差多少元。
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2.5 rounded-2xl bg-muted/60 px-3 py-2.5">
              <ShieldCheck className="size-4 shrink-0 text-brand-ink" />
              <span>款項由綠界安全信託專戶保管，確認收貨後才撥款</span>
            </li>
            <li className="flex items-center gap-2.5 rounded-2xl bg-muted/60 px-3 py-2.5">
              <Truck className="size-4 shrink-0 text-brand-ink" />
              <span>購物車可針對單一店家勾選結帳</span>
            </li>
          </ul>
          <button
            ref={ctaRef}
            type="button"
            onClick={onClose}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.98]"
          >
            開始逛逛
            <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
