'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { findSimilarProducts, type SimilarHit } from '@/lib/marketplace-features'

type SortKey = 'score' | 'low' | 'high'

export function SimilarProductsDialog({
  productId,
  productName,
  money,
  onClose,
  onOpen,
}: {
  productId: string
  productName: string
  money: (n: number) => string
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const [items, setItems] = useState<SimilarHit[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [sort, setSort] = useState<SortKey>('score')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const result = await findSimilarProducts(productId, 0)
      if (cancelled) return
      setItems(result.items)
      setError(result.error)
      setOffset(result.items.length)
      setDone(result.items.length < 12)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [productId])

  const shown = useMemo(() => {
    const list = [...items]
    if (sort === 'low') list.sort((a, b) => a.price - b.price)
    if (sort === 'high') list.sort((a, b) => b.price - a.price)
    if (sort === 'score') list.sort((a, b) => b.matchScore - a.matchScore || a.price - b.price)
    return list
  }, [items, sort])

  const more = async () => {
    setLoading(true)
    const result = await findSimilarProducts(productId, offset)
    setError(result.error)
    setItems((current) => {
      const seen = new Set(current.map((item) => item.id))
      return [...current, ...result.items.filter((item) => !seen.has(item.id))]
    })
    setOffset((value) => value + result.items.length)
    setDone(result.items.length < 12)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-foreground/45 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label="找相似商品" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-border/70 bg-card shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-black"><Search className="size-4" />找相似商品</h2>
            <p className="truncate text-xs text-muted-foreground">以「{productName}」為基準，只比對其他賣家的公開商品。售價未含運費。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex gap-1.5 px-5 pt-3" role="group" aria-label="排序">
          {([
            ['score', '相似程度優先'],
            ['low', '價格由低到高'],
            ['high', '價格由高到低'],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={sort === id} onClick={() => setSort(id)} className={`rounded-full px-3 py-1 text-xs font-bold ${sort === id ? 'bg-foreground text-card' : 'bg-muted text-muted-foreground'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="overflow-y-auto p-5">
          {error && <p role="alert" className="mb-3 text-sm font-bold text-destructive">{error}</p>}
          {loading && items.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在比對公開商品</p>
          ) : shown.length === 0 && !error ? (
            <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">沒有符合條件的相似商品</p>
          ) : shown.length === 0 ? null : (
            <ul className="space-y-3">
              {shown.map((item) => (
                <li key={item.id} className="flex gap-3 rounded-2xl border border-border/70 p-3">
                  <button type="button" onClick={() => onOpen(item.id)} className="size-20 shrink-0 overflow-hidden rounded-xl border border-border/70 bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.image || '/placeholder.svg'} alt="" className="h-full w-full object-cover" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${item.matchKind === 'same' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                        {item.matchKind === 'same' ? '同款' : '相似款'}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{item.purchasable ? '可購買' : '目前不可購買'}</span>
                    </div>
                    <button type="button" onClick={() => onOpen(item.id)} className="mt-1 line-clamp-2 text-left text-sm font-bold hover:underline">{item.name}</button>
                    <p className="text-xs text-muted-foreground">{item.storeName}</p>
                    {item.specNote && <p className="mt-1 text-xs text-muted-foreground">{item.specNote}</p>}
                    <p className="mt-1 text-sm font-black text-brand-ink">
                      {money(item.price)}
                      {item.priceLabel === '起價' ? ' 起' : ''}
                    </p>
                    {item.priceLabel === '起價' && <p className="text-[11px] text-muted-foreground">不同規格價格不同，這是最低售價，不是全部規格的價格。</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!done && items.length > 0 && (
            <button type="button" onClick={() => void more()} disabled={loading} className="mt-4 w-full rounded-full border border-border py-2 text-sm font-bold disabled:opacity-50">
              {loading ? '載入中' : '載入更多'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
