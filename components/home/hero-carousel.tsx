'use client'

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, Crown, Gift, Pause, Play, ShieldCheck, Store } from 'lucide-react'
import type { QuickKey } from './quick-grid'

interface HeroCarouselProps {
  approvedCount: number
  productCount: number
  freeShipText: string
  planPriceText: string
  onStartSelling: () => void
  onQuick: (key: QuickKey) => void
  photos?: string[]
}

const INTERVAL_MS = 5500

const textureDots = '[background-image:radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:18px_18px]'
const textureLines =
  '[background-image:repeating-linear-gradient(135deg,rgba(255,255,255,0.025)_0,rgba(255,255,255,0.025)_1px,transparent_1px,transparent_10px)]'

const ctaPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-lg shadow-orange-950/40 transition hover:brightness-110 active:scale-[0.98]'
const ctaGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-zinc-600/70 bg-zinc-900/50 px-4 py-2.5 text-sm font-bold text-foreground backdrop-blur transition hover:bg-zinc-900/80 active:scale-[0.98]'

const FALLBACK_SRC = '/placeholder.svg'

class ImageGuard extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function CollagePhoto({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return (
    <Image
      src={!failed && src ? src : FALLBACK_SRC}
      alt=""
      width={288}
      height={288}
      sizes="144px"
      className="aspect-square w-full object-cover"
      onError={() => setFailed(true)}
    />
  )
}

function Collage({ images }: { images: string[] }) {
  if (!images.length) return null
  const pos = ['left-0 top-8 -rotate-6', 'left-1/3 top-0 rotate-3', 'right-0 top-12 rotate-6']
  return (
    <div className="relative mx-auto hidden h-60 w-full max-w-sm md:block" aria-hidden>
      {images.slice(0, 3).map((src, i) => (
        <div key={`${src}-${i}`} className={`absolute w-36 overflow-hidden rounded-2xl border border-zinc-600/60 bg-zinc-800 shadow-2xl shadow-black/50 ${pos[i]}`}>
          <ImageGuard key={src} fallback={<img src={FALLBACK_SRC} alt="" className="aspect-square w-full object-cover" />}>
            <CollagePhoto src={src} />
          </ImageGuard>
        </div>
      ))}
    </div>
  )
}

export function HeroCarousel({ approvedCount, productCount, freeShipText, planPriceText, onStartSelling, onQuick, photos = [] }: HeroCarouselProps) {
  const [index, setIndex] = useState(0)
  const [hover, setHover] = useState(false)
  const [focusIn, setFocusIn] = useState(false)
  const [userPaused, setUserPaused] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [reduced, setReduced] = useState(false)
  const touchX = useRef<number | null>(null)

  const slides = [
    {
      key: 'market',
      glow: 'rgba(249,115,22,0.22)',
      body: (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/40 bg-orange-500/10 px-3 py-1 text-xs font-bold text-orange-300">
            <ShieldCheck className="size-3.5" aria-hidden />賣家皆經實名審核
          </span>
          <h1 className="mt-3 text-balance text-[28px] font-black leading-tight text-foreground md:text-5xl">
            每位賣家，<br />都是一間小市集
          </h1>
          <p className="mt-3 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
            這裡只展示已通過審核並公開上架的商品。金流與物流尚未開放，結帳不會成立訂單。
          </p>
            <div className="mt-4 hidden flex-wrap gap-2 text-sm md:flex">
            <span className="rounded-full border border-zinc-700/50 bg-zinc-900/60 px-3.5 py-1.5 font-bold"><span className="text-primary">{approvedCount}</span> 間有商品的賣場</span>
            <span className="rounded-full border border-zinc-700/50 bg-zinc-900/60 px-3.5 py-1.5 font-bold"><span className="text-primary">{productCount}</span> 件在架商品</span>
            <span className="rounded-full border border-zinc-700/50 bg-zinc-900/60 px-3.5 py-1.5 font-bold">參考門檻 {freeShipText}</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => onQuick('new')} className={ctaPrimary}>看最新上架</button>
            <button type="button" onClick={onStartSelling} className={ctaGhost}>
              <Store className="size-4 text-primary" aria-hidden />我要開店
              <span className="text-xs font-medium text-muted-foreground">月費 {planPriceText}</span>
            </button>
          </div>
        </>
      ),
    },
    {
      key: 'checkin',
      glow: 'rgba(245,158,11,0.2)',
      body: (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-300">
            <Gift className="size-3.5" aria-hidden />每日簽到
          </span>
          <h2 className="mt-3 text-balance text-[28px] font-black leading-tight text-foreground md:text-5xl">
            簽到領點數，<br />兌換賣家優惠券
          </h2>
          <p className="mt-3 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
            點數只能兌換各賣家自行發行的折價券或優惠碼，平台不提供現金或購物金折抵。
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => onQuick('checkin')} className={ctaPrimary}>前往簽到兌換</button>
          </div>
        </>
      ),
    },
    {
      key: 'trust',
      glow: 'rgba(56,169,245,0.2)',
      body: (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-bold text-sky-300">
            <ShieldCheck className="size-3.5" aria-hidden />交易說明
          </span>
          <h2 className="mt-3 text-balance text-[28px] font-black leading-tight text-foreground md:text-5xl">
            先看得到商品，<br />付款尚未開放
          </h2>
          <p className="mt-3 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
            平台目前不代收商品貨款。賣家申請、證件上傳與管理員審核仍照常運作。
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => onQuick('trust')} className={ctaPrimary}>查看交易說明</button>
          </div>
        </>
      ),
    },
    {
      key: 'founder',
      glow: 'rgba(234,179,8,0.2)',
      body: (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-3 py-1 text-xs font-bold text-yellow-300">
            <Crown className="size-3.5" aria-hidden />創始特約店
          </span>
          <h2 className="mt-3 text-balance text-[28px] font-black leading-tight text-foreground md:text-5xl">
            最早進駐的<br />優質賣家與品牌
          </h2>
          <p className="mt-3 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
            創始店長都通過實名審核，陪平台從零開始，逛逛他們的賣場。
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => onQuick('founder')} className={ctaPrimary}>逛創始特約店</button>
          </div>
        </>
      ),
    },
  ]

  const count = slides.length
  const go = useCallback((n: number) => setIndex(((n % count) + count) % count), [count])
  const paused = hover || focusIn || userPaused || hidden || reduced

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    const onVis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      mq.removeEventListener('change', onChange)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  useEffect(() => {
    if (paused) return
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), INTERVAL_MS)
    return () => clearTimeout(id)
  }, [paused, index, count])

  return (
    <section
      aria-roledescription="carousel"
      aria-label="市集精選 Banner"
      className="relative mt-4 overflow-hidden rounded-3xl border border-zinc-700/50 bg-zinc-800 shadow-xl shadow-black/30 md:mt-6"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocusIn(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocusIn(false)
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX
      }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        touchX.current = null
        if (Math.abs(dx) > 48) go(index + (dx < 0 ? 1 : -1))
      }}
    >
      <div
        className="flex transition-transform duration-700 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(-${index * 100}%)` }}
        aria-live={paused ? 'polite' : 'off'}
      >
        {slides.map((slide, i) => (
          <div
            key={slide.key}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} / ${count}`}
            inert={i !== index}
            className="relative w-full shrink-0 overflow-hidden bg-gradient-to-br from-zinc-800 via-zinc-800 to-zinc-900"
          >
            <div aria-hidden className={`pointer-events-none absolute inset-0 ${textureDots}`} />
            <div aria-hidden className={`pointer-events-none absolute inset-0 ${textureLines}`} />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: `radial-gradient(ellipse 60% 90% at 100% 0%, ${slide.glow}, transparent 70%)` }}
            />
            <div className={`relative grid items-center gap-5 px-5 pb-12 pt-5 md:gap-6 md:px-12 md:pb-14 md:pt-10 ${photos.length ? 'md:grid-cols-[1.2fr_1fr]' : ''}`}>
              <div>{slide.body}</div>
              <Collage images={photos} />
            </div>
          </div>
        ))}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-4 pb-3 md:px-8">
        <div className="flex items-center">
          {slides.map((slide, i) => (
            <button
              key={slide.key}
              type="button"
              aria-label={`前往第 ${i + 1} 張`}
              aria-current={i === index}
              onClick={() => go(i)}
              className="group flex h-8 items-center px-1"
            >
              <span className={`block h-1.5 rounded-full transition-all duration-300 ${i === index ? 'w-7 bg-primary' : 'w-2.5 bg-zinc-600 group-hover:bg-zinc-500'}`} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setUserPaused((v) => !v)}
            aria-label={userPaused ? '開始自動播放' : '暫停自動播放'}
            className="flex size-8 items-center justify-center rounded-full border border-zinc-600/60 bg-zinc-900/70 text-foreground transition hover:bg-zinc-900"
          >
            {userPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="上一張"
            className="flex size-8 items-center justify-center rounded-full border border-zinc-600/60 bg-zinc-900/70 text-foreground transition hover:bg-zinc-900"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="下一張"
            className="flex size-8 items-center justify-center rounded-full border border-zinc-600/60 bg-zinc-900/70 text-foreground transition hover:bg-zinc-900"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </section>
  )
}
