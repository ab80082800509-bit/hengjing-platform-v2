'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Flame, Zap } from 'lucide-react'

export interface FlashItem {
  id: string
  name: string
  price: number
  image: string
  sold: number
  stock: number
  sellerName: string
}

const ROUND_MS = 6 * 60 * 60 * 1000

function useCountdown() {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setLeft(ROUND_MS - (Date.now() % ROUND_MS))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return left
}

function Digit({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="flex flex-col items-center">
      <span className="min-w-9 rounded-lg bg-background px-1.5 py-1 text-center font-mono text-lg font-black tabular-nums text-primary shadow-inner md:min-w-10 md:text-xl">
        {value}
      </span>
      <span className="mt-0.5 text-[10px] font-bold text-primary-foreground/80">{unit}</span>
    </span>
  )
}

export function FlashSale({
  items,
  money,
  onOpen,
  onSeeAll,
}: {
  items: FlashItem[]
  money: (n: number) => string
  onOpen: (id: string) => void
  onSeeAll: () => void
}) {
  const left = useCountdown()
  const rail = useRef<HTMLUListElement>(null)
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = left === null ? '--' : pad(Math.floor(left / 3_600_000))
  const m = left === null ? '--' : pad(Math.floor((left % 3_600_000) / 60_000))
  const s = left === null ? '--' : pad(Math.floor((left % 60_000) / 1000))

  const scrollBy = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * 360, behavior: 'smooth' })

  if (items.length === 0) return null

  return (
    <section aria-label="限時熱銷推薦" className="mt-6 overflow-hidden rounded-3xl border border-border bg-card shadow-lg shadow-black/20 md:mt-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3 text-primary-foreground md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-background/90 text-primary">
            <Zap className="size-5 fill-primary" aria-hidden />
          </span>
          <div>
            <h2 className="flex items-center gap-1.5 text-lg font-black leading-tight md:text-xl">
              限時熱銷推薦
              <Flame className="size-4 md:size-5" aria-hidden />
            </h2>
            <p className="text-xs font-medium text-primary-foreground/80">本檔榜單依銷量彙整，倒數結束後更新</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div role="timer" aria-label={left === null ? '倒數計時載入中' : `距離榜單更新還有 ${h} 小時 ${m} 分 ${s} 秒`} className="flex items-start gap-1.5">
            <Digit value={h} unit="時" />
            <span className="mt-1 font-black">:</span>
            <Digit value={m} unit="分" />
            <span className="mt-1 font-black">:</span>
            <Digit value={s} unit="秒" />
          </div>
          <button
            type="button"
            onClick={onSeeAll}
            className="hidden rounded-full bg-background/90 px-3.5 py-1.5 text-xs font-black text-primary transition hover:bg-background sm:inline-flex"
          >
            查看全部
          </button>
        </div>
      </div>

      <div className="relative">
        <button
          type="button"
          aria-label="向左捲動"
          onClick={() => scrollBy(-1)}
          className="absolute left-2 top-1/3 z-10 hidden size-9 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-lg transition hover:bg-muted md:flex"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          aria-label="向右捲動"
          onClick={() => scrollBy(1)}
          className="absolute right-2 top-1/3 z-10 hidden size-9 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-lg transition hover:bg-muted md:flex"
        >
          <ChevronRight className="size-5" />
        </button>

        <ul
          ref={rail}
          className="flex snap-x gap-3 overflow-x-auto p-3 [scrollbar-width:none] md:gap-4 md:p-4 [&::-webkit-scrollbar]:hidden"
        >
          {items.map((p, i) => {
            const total = p.sold + p.stock
            const pct = total > 0 ? Math.min(100, Math.round((p.sold / total) * 100)) : 0
            return (
              <li key={p.id} className="w-36 shrink-0 snap-start sm:w-40 md:w-44">
                <button
                  type="button"
                  onClick={() => onOpen(p.id)}
                  className="group flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-background/40 text-left transition hover:-translate-y-0.5 hover:border-primary/50"
                >
                  <span className="relative block aspect-square overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image} alt={p.name} loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-105" />
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-black text-primary-foreground">TOP {i + 1}</span>
                    {p.stock > 0 && p.stock <= 10 && (
                      <span className="absolute bottom-1.5 right-1.5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-white">僅剩 {p.stock} 件</span>
                    )}
                  </span>
                  <span className="flex flex-1 flex-col gap-1.5 p-2.5">
                    <span className="line-clamp-2 min-h-[2.5rem] text-[13px] font-bold leading-snug text-foreground">{p.name}</span>
                    <span className="text-base font-black text-primary">{money(p.price)}</span>
                    <span className="relative block h-4 overflow-hidden rounded-full bg-muted" role="img" aria-label={`已售 ${p.sold} 件`}>
                      <span className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-orange-500 to-red-500" style={{ width: `${Math.max(pct, 18)}%` }} />
                      <span className="relative flex h-full items-center px-2 text-[10px] font-black text-white">已售 {p.sold}</span>
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
