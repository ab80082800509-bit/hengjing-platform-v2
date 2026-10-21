'use client'

import { useEffect, useMemo, useState } from 'react'
import { Eye, ImagePlus, Loader2, Send, Store } from 'lucide-react'
import {
  fetchMyStorefront,
  publishStorefront,
  removeStoreMedia,
  saveStorefront,
  STORE_THEMES,
  uploadStoreMedia,
  type StorefrontSettings,
  type StoreTheme,
} from '@/lib/marketplace-features'

type ProductPick = {
  id: string
  name: string
  priceLabel: string
  image: string
  category: string
  public: boolean
}

const empty: StorefrontSettings = {
  bannerUrl: null,
  logoUrl: null,
  intro: '',
  theme: 'default',
  featuredIds: [],
  categories: [],
}

export function StorefrontEditor({
  sellerUserId,
  storeName,
  approved,
  products,
  onNotify,
  onPreview,
  onViewPublic,
}: {
  sellerUserId: string | null
  storeName: string
  approved: boolean
  products: ProductPick[]
  onNotify: (message: string) => void
  onPreview: (draft: StorefrontSettings) => void
  onViewPublic: () => void
}) {
  const [draft, setDraft] = useState<StorefrontSettings>(empty)
  const [savedBanner, setSavedBanner] = useState<string | null>(null)
  const [savedLogo, setSavedLogo] = useState<string | null>(null)
  const [publishedBanner, setPublishedBanner] = useState<string | null>(null)
  const [publishedLogo, setPublishedLogo] = useState<string | null>(null)
  const [separated, setSeparated] = useState(false)
  const [published, setPublished] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const publicProducts = products.filter((item) => item.public)
  const categories = useMemo(() => [...new Set(publicProducts.map((item) => item.category).filter(Boolean))], [publicProducts])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!sellerUserId) {
        setLoading(false)
        return
      }
      const result = await fetchMyStorefront()
      if (cancelled) return
      if (result.error) setError(result.error)
      if (result.storefront) {
        setDraft(result.storefront)
        setSavedBanner(result.storefront.bannerUrl)
        setSavedLogo(result.storefront.logoUrl)
        setPublishedBanner(result.storefront.publishedBannerUrl ?? null)
        setPublishedLogo(result.storefront.publishedLogoUrl ?? null)
        setSeparated(result.storefront.separated === true)
        setPublished(result.storefront.published === true)
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [sellerUserId])

  const payload = () => ({ ...draft, storeName, categories: draft.categories.filter((item) => categories.includes(item)) })

  const upload = async (file: File | undefined, kind: 'banner' | 'logo') => {
    if (!file) return
    setError('')
    const result = await uploadStoreMedia(file, kind)
    if (result.error || !result.url) {
      setError(result.error || '上傳失敗')
      onNotify(result.error || '上傳失敗')
      return
    }
    setDraft((current) => ({ ...current, [kind === 'banner' ? 'bannerUrl' : 'logoUrl']: result.url }))
  }

  const toggleFeatured = (id: string) => {
    setDraft((current) => {
      const has = current.featuredIds.includes(id)
      const featuredIds = has ? current.featuredIds.filter((item) => item !== id) : [...current.featuredIds, id].slice(0, 12)
      return { ...current, featuredIds }
    })
  }

  const moveFeatured = (id: string, dir: -1 | 1) => {
    setDraft((current) => {
      const index = current.featuredIds.indexOf(id)
      const next = index + dir
      if (index < 0 || next < 0 || next >= current.featuredIds.length) return current
      const featuredIds = [...current.featuredIds]
      const [item] = featuredIds.splice(index, 1)
      featuredIds.splice(next, 0, item)
      return { ...current, featuredIds }
    })
  }

  const forgetReplacedMedia = async () => {
    if (savedBanner && savedBanner !== draft.bannerUrl && savedBanner !== publishedBanner) await removeStoreMedia(savedBanner)
    if (savedLogo && savedLogo !== draft.logoUrl && savedLogo !== publishedLogo) await removeStoreMedia(savedLogo)
    setSavedBanner(draft.bannerUrl)
    setSavedLogo(draft.logoUrl)
  }

  const save = async () => {
    if (!separated) {
      const message = '草稿與正式賣場尚未分開。請先審查並執行賣場草稿 SQL，這次不會寫入，避免直接改到買家看到的賣場。'
      setError(message)
      onNotify(message)
      return
    }
    setSaving(true)
    setError('')
    const message = await saveStorefront(payload())
    setSaving(false)
    if (message) {
      setError(message)
      onNotify(message)
      return
    }
    await forgetReplacedMedia()
    onNotify('草稿已儲存。買家仍看到上一個已發布版本。')
  }

  const publish = async () => {
    if (!separated) {
      const message = '確認發布需要先執行賣場草稿 SQL。目前不會改動公開賣場。'
      setError(message)
      onNotify(message)
      setConfirming(false)
      return
    }
    setPublishing(true)
    setError('')
    const message = await publishStorefront(payload())
    setPublishing(false)
    setConfirming(false)
    if (message) {
      setError(message)
      onNotify(message)
      return
    }
    setPublished(true)
    setPublishedBanner(draft.bannerUrl)
    setPublishedLogo(draft.logoUrl)
    await forgetReplacedMedia()
    onNotify('賣場已發布，買家現在看得到這個版本。')
  }

  if (!approved || !sellerUserId) {
    return <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">通過賣家認證後才能設定賣場裝潢。這裡不會變更實名或月費狀態。</p>
  }
  if (loading) {
    return <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />讀取賣場裝潢</p>
  }

  return (
    <section aria-label="賣場裝潢" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black"><Store className="size-4" />賣場裝潢</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">賣場名稱沿用已核准的店名「{storeName}」。儲存草稿只寫入您自己的草稿；確認發布才會更新買家看到的賣場。查看我的賣場永遠打開目前公開版本。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onPreview({ ...payload(), separated, published: false })} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-bold">
            <Eye className="size-4" />預覽賣場
          </button>
          <button type="button" onClick={onViewPublic} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
            <Store className="size-4" />查看我的賣場
          </button>
        </div>
      </div>
      <p className="text-xs font-bold text-muted-foreground">{published ? '目前已有買家看得到的正式版本。再改草稿不會立刻覆蓋它。' : '尚未發布裝潢。買家現在看到預設賣場。'}</p>
      {!separated && (
        <p role="status" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-bold text-amber-200">
          資料庫還沒有草稿與正式版本的分離欄位。預覽與查看我的賣場可以使用；儲存草稿和確認發布會先停住，避免沿用舊程序把草稿直接寫成公開賣場。
        </p>
      )}
      {error && <p role="alert" className="text-sm font-bold text-destructive">{error}</p>}
      <div className="space-y-4 rounded-3xl border border-border/70 bg-card p-4">
        <p className="text-sm font-black">賣場名稱<span className="ml-2 font-bold text-muted-foreground">{storeName}</span></p>
        <label className="block text-sm font-black">
          賣場封面
          <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-sm" onChange={(e) => void upload(e.target.files?.[0], 'banner')} />
        </label>
        {draft.bannerUrl && <img src={draft.bannerUrl} alt="" className="h-24 w-full rounded-xl object-cover" />}
        <label className="block text-sm font-black">
          賣場 Logo
          <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-sm" onChange={(e) => void upload(e.target.files?.[0], 'logo')} />
        </label>
        {draft.logoUrl && <img src={draft.logoUrl} alt="" className="size-16 rounded-xl object-cover" />}
        <p className="flex items-center gap-1 text-xs text-muted-foreground"><ImagePlus className="size-3.5" />JPG、PNG、WEBP，單張 5MB 以內，存放於 store-media。商品分類圖片仍使用 product-images。</p>
        <label className="block text-sm font-black" htmlFor="store-intro">
          賣場介紹
          <textarea id="store-intro" value={draft.intro} maxLength={400} rows={4} onChange={(e) => setDraft((current) => ({ ...current, intro: e.target.value }))} className="mt-2 w-full rounded-xl border border-input px-3 py-2 text-sm" placeholder="品牌簡介，不能包含 HTML" />
        </label>
        <div>
          <p className="text-sm font-black">主題色</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {STORE_THEMES.map((theme) => (
              <button key={theme.id} type="button" aria-pressed={draft.theme === theme.id} onClick={() => setDraft((current) => ({ ...current, theme: theme.id as StoreTheme }))} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${draft.theme === theme.id ? 'border-primary bg-accent' : 'border-border'}`}>
                <span aria-hidden className={`size-3 rounded-full bg-gradient-to-br ${theme.banner}`} />
                {theme.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-black">分類展示</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {categories.length === 0 && <p className="text-xs text-muted-foreground">尚無公開上架商品分類</p>}
            {categories.map((category) => {
              const on = draft.categories.includes(category)
              return (
                <button key={category} type="button" aria-pressed={on} onClick={() => setDraft((current) => ({ ...current, categories: on ? current.categories.filter((item) => item !== category) : [...current.categories, category] }))} className={`rounded-full border px-3 py-1 text-xs font-bold ${on ? 'border-primary bg-accent' : 'border-border'}`}>
                  {category}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <p className="text-sm font-black">精選商品（最多 12 件公開上架商品）</p>
          <ul className="mt-2 space-y-2">
            {publicProducts.length === 0 && <li className="text-xs text-muted-foreground">目前沒有可精選的公開商品，仍可先設定封面與介紹。</li>}
            {publicProducts.map((item) => {
              const index = draft.featuredIds.indexOf(item.id)
              return (
                <li key={item.id} className="flex items-center gap-2 rounded-xl border border-border/70 px-3 py-2">
                  <button type="button" aria-pressed={index >= 0} onClick={() => toggleFeatured(item.id)} className="text-xs font-bold text-brand-ink">{index >= 0 ? '已選' : '選取'}</button>
                  <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                  <span className="text-xs text-muted-foreground">{item.priceLabel}</span>
                  {index >= 0 && (
                    <>
                      <button type="button" onClick={() => moveFeatured(item.id, -1)} className="text-xs">上移</button>
                      <button type="button" onClick={() => moveFeatured(item.id, 1)} className="text-xs">下移</button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void save()} disabled={saving || publishing} className="rounded-full border border-border px-5 py-2.5 text-sm font-bold disabled:opacity-50">
            {saving ? '儲存中' : '儲存草稿'}
          </button>
          <button type="button" onClick={() => setConfirming(true)} disabled={saving || publishing} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">
            <Send className="size-4" />確認發布
          </button>
        </div>
      </div>
      {confirming && (
        <div role="dialog" aria-modal="true" aria-labelledby="publish-store-title" className="rounded-3xl border border-primary/40 bg-card p-4">
          <h3 id="publish-store-title" className="text-sm font-black">確認發布賣場裝潢？</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">發布成功後，買家會看到現在這版封面、Logo、介紹、主題色、精選商品與分類。取消則維持上一個正式版本。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="rounded-full border border-border px-4 py-2 text-sm font-bold">取消</button>
            <button type="button" onClick={() => void publish()} disabled={publishing} className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
              {publishing ? '發布中' : '確認發布'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
