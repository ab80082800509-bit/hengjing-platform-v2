'use client'

import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { BellRing, Camera, Check, CircleAlert, Heart, HeartOff, Pencil, Store, Trash2, UserRound } from 'lucide-react'
import { AvatarCropModal } from './avatar-upload'

export const RENAME_COOLDOWN_DAYS = 90

export const AVATAR_TONES = [
  'bg-primary text-primary-foreground',
  'bg-foreground text-card',
  'bg-emerald-700 text-card',
  'bg-blue-700 text-card',
  'bg-amber-600 text-card',
  'bg-rose-600 text-card',
]

const inputCls =
  'w-full rounded-xl border border-input bg-card px-3 py-2.5 text-base outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/30 sm:text-sm'
const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'

const LEVELS = [
  { name: '一般會員', min: 0, cls: 'bg-muted text-foreground' },
  { name: '銅牌會員', min: 2, cls: 'bg-amber-500/15 text-amber-300' },
  { name: '銀牌會員', min: 5, cls: 'bg-slate-200 text-slate-900' },
  { name: '金牌會員', min: 10, cls: 'bg-yellow-200 text-yellow-900' },
]

export function memberLevel(completedOrders: number) {
  let idx = 0
  LEVELS.forEach((l, i) => {
    if (completedOrders >= l.min) idx = i
  })
  const current = LEVELS[idx]
  const next = LEVELS[idx + 1]
  return {
    ...current,
    next: next ? { name: next.name, need: next.min - completedOrders } : null,
    progress: next ? Math.min(100, ((completedOrders - current.min) / (next.min - current.min)) * 100) : 100,
  }
}

export function daysUntilRename(changedAt: string | undefined, now = Date.now()): number {
  if (!changedAt) return 0
  const passed = Math.floor((now - new Date(changedAt).getTime()) / 86400000)
  return Math.max(0, RENAME_COOLDOWN_DAYS - passed)
}

export function UserAvatar({
  name,
  tone,
  src,
  size = 'size-14',
  textSize = 'text-lg',
}: {
  name: string
  tone: number
  src?: string
  size?: string
  textSize?: string
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" aria-hidden="true" className={`${size} shrink-0 rounded-full border border-border/60 object-cover shadow-sm`} />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`flex ${size} shrink-0 items-center justify-center rounded-full ${textSize} font-black shadow-sm ${AVATAR_TONES[tone % AVATAR_TONES.length]}`}
    >
      {name.trim().slice(0, 1) || <UserRound className="size-5" />}
    </span>
  )
}

export function BuyerProfileHeader({
  name,
  tone,
  avatar,
  completed,
  onEdit,
  avatarNode,
  tags,
  skinStyle,
}: {
  name: string
  tone: number
  avatar?: string
  completed: number
  onEdit: () => void
  avatarNode?: ReactNode
  tags?: ReactNode
  skinStyle?: CSSProperties
}) {
  const level = memberLevel(completed)
  const skinned = Boolean(skinStyle)
  return (
    <div
      className={`flex items-center gap-3 border-b border-border/60 px-4 py-4 ${skinned ? 'text-zinc-50' : 'bg-muted/40'}`}
      style={skinStyle}
    >
      {avatarNode ?? <UserAvatar name={name} tone={tone} src={avatar} />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate text-base font-black">{name}</p>
          {tags}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-black ${level.cls}`}>{level.name}</span>
          <span className={`text-xs ${skinned ? 'text-zinc-300' : 'text-muted-foreground'}`}>
            {level.next ? `再完成 ${level.next.need} 筆訂單升級${level.next.name}` : '已達最高等級'}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="會員升級進度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level.progress)}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${level.progress}%` }} />
        </div>
      </div>
      <button type="button" onClick={onEdit} className={`${btnGhost} px-3 py-1.5 text-xs`}>
        <Pencil className="size-3.5" />編輯
      </button>
    </div>
  )
}

export function BuyerProfilePanel({
  name,
  tone,
  avatar,
  nameChangedAt,
  completed,
  onRename,
  onAvatar,
  onAvatarUpload,
  onAvatarRemove,
  onSwitchSeller,
  avatarNode,
  tags,
}: {
  avatarNode?: ReactNode
  tags?: ReactNode
  name: string
  tone: number
  avatar?: string
  nameChangedAt?: string
  completed: number
  onRename: (next: string) => void
  onAvatar: (i: number) => void
  onAvatarUpload: (dataUrl: string) => void
  onAvatarRemove: () => void
  onSwitchSeller: () => void
}) {
  const [cropOpen, setCropOpen] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState('')
  const wait = daysUntilRename(nameChangedAt)
  const level = memberLevel(completed)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = draft.trim()
    if (wait > 0) return setError(`名字每 ${RENAME_COOLDOWN_DAYS} 天僅能更改一次，還需等待 ${wait} 天`)
    if (v.length < 2 || v.length > 20) return setError('名稱需為 2 到 20 個字')
    if (v === name) return setError('新名稱與目前相同')
    setError('')
    onRename(v)
  }

  return (
    <section aria-label="個人資料" className="space-y-5">
      <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <h3 className="text-sm font-black">大頭貼</h3>
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative">
            {avatarNode ?? <UserAvatar name={name} tone={tone} src={avatar} size="size-20" textSize="text-3xl" />}
            <button
              type="button"
              onClick={() => setCropOpen(true)}
              aria-label="上傳或更換大頭貼"
              className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow transition hover:brightness-95 active:scale-95"
            >
              <Camera className="size-4" />
            </button>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-black">{name}</span>
              {tags}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setCropOpen(true)} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                <Camera className="size-3.5" />{avatar ? '更換照片' : '上傳照片'}
              </button>
              {avatar && (
                <button type="button" onClick={onAvatarRemove} className={`${btnGhost} px-3 py-1.5 text-xs hover:text-destructive`}>
                  <Trash2 className="size-3.5" />移除照片
                </button>
              )}
            </div>
            <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
              支援 JPG / PNG / WEBP，檔案不超過 5MB。未上傳時，會以名稱首字與下方顏色作為預設頭像；賣家模式也可沿用作為店家 Logo。
            </p>
          </div>
        </div>
        {!avatar && (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="選擇預設頭像顏色">
            {AVATAR_TONES.map((cls, i) => (
              <button
                key={cls}
                type="button"
                role="radio"
                aria-checked={tone === i}
                aria-label={`顏色 ${i + 1}`}
                onClick={() => onAvatar(i)}
                className={`relative flex size-9 items-center justify-center rounded-full ${cls} ring-offset-2 ring-offset-card transition ${tone === i ? 'ring-2 ring-primary' : 'hover:scale-105'}`}
              >
                {tone === i && <Check className="size-4" />}
              </button>
            ))}
          </div>
        )}
        {cropOpen && (
          <AvatarCropModal
            onClose={() => setCropOpen(false)}
            onSave={(url) => {
              setCropOpen(false)
              onAvatarUpload(url)
            }}
          />
        )}
      </div>

      <form onSubmit={submit} noValidate className="space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <h3 className="text-sm font-black">顯示名稱</h3>
        <div className="space-y-1.5">
          <label htmlFor="profile-name" className="sr-only">顯示名稱</label>
          <input
            id="profile-name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={wait > 0}
            maxLength={20}
            className={`${inputCls} disabled:cursor-not-allowed disabled:bg-muted`}
          />
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            名字每 {RENAME_COOLDOWN_DAYS} 天內僅能更改一次，修改後訂單與評價仍會保留。
          </p>
          {wait > 0 && <p className="text-xs font-bold text-amber-400">目前無法修改，還需等待 {wait} 天。</p>}
          {error && <p role="alert" className="text-xs font-bold text-destructive">{error}</p>}
        </div>
        <button type="submit" disabled={wait > 0} className={btnPrimary}>儲存名稱</button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <div>
          <h3 className="text-sm font-black">會員等級</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {level.name}・已完成 {completed} 筆訂單
          </p>
        </div>
        <button type="button" onClick={onSwitchSeller} className={btnGhost}>
          <Store className="size-4" />切換為賣家
        </button>
      </div>
    </section>
  )
}

export interface FavItem {
  id: string
  name: string
  price: number
  soldOut: boolean
  sellerName: string
}

export function FavoritesPanel({
  items,
  renderThumb,
  onOpen,
  onToggle,
}: {
  items: FavItem[]
  renderThumb: (id: string) => ReactNode
  onOpen: (id: string) => void
  onToggle: (id: string) => void
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-center">
        <Heart className="size-12 text-border" />
        <p className="text-sm text-muted-foreground">還沒有收藏商品，逛逛市集點愛心加入收藏吧</p>
      </div>
    )
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="我的收藏">
      {items.map((it) => (
        <li key={it.id} className="flex gap-3 rounded-2xl border border-border/70 bg-card p-3 shadow-sm">
          <button type="button" onClick={() => onOpen(it.id)} className="size-20 shrink-0 overflow-hidden rounded-xl border border-border/70">
            {renderThumb(it.id)}
          </button>
          <div className="flex min-w-0 flex-1 flex-col">
            <button type="button" onClick={() => onOpen(it.id)} className="line-clamp-2 text-left text-sm font-bold hover:text-brand-ink">
              {it.name}
            </button>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{it.sellerName}</p>
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              <p className="text-sm font-black text-brand-ink">
                NT$ {it.price.toLocaleString('en-US')}
                {it.soldOut && <span className="ml-1.5 text-xs font-bold text-destructive">已售完</span>}
              </p>
              <button
                type="button"
                onClick={() => onToggle(it.id)}
                aria-label={`取消收藏 ${it.name}`}
                className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-destructive"
              >
                <HeartOff className="size-4" />
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export interface FollowPrefs {
  newItem: boolean
  coupon: boolean
}

export interface FollowItem {
  id: string
  name: string
  city: string
}

export function FollowingPanel({
  sellers,
  prefs,
  renderAvatar,
  onToggle,
  onUnfollow,
  onGoStore,
}: {
  sellers: FollowItem[]
  prefs: Record<string, FollowPrefs>
  renderAvatar: (id: string) => ReactNode
  onToggle: (id: string, key: keyof FollowPrefs) => void
  onUnfollow: (id: string) => void
  onGoStore: (id: string) => void
}) {
  if (sellers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-center">
        <BellRing className="size-12 text-border" />
        <p className="text-sm text-muted-foreground">還沒有關注任何賣家，進入店鋪點「關注」即可收到新品與優惠通知</p>
      </div>
    )
  }
  const get = (id: string): FollowPrefs => prefs[id] ?? { newItem: true, coupon: true }
  return (
    <ul className="space-y-3" aria-label="關注的賣家">
      {sellers.map((s) => (
        <li key={s.id} className="space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            {renderAvatar(s.id)}
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => onGoStore(s.id)} className="block truncate text-left text-sm font-black hover:text-brand-ink hover:underline">
                {s.name}
              </button>
              <p className="text-xs text-muted-foreground">{s.city}</p>
            </div>
            <button type="button" onClick={() => onUnfollow(s.id)} className={`${btnGhost} px-3 py-1.5 text-xs`}>
              取消關注
            </button>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={`${s.name} 的通知設定`}>
            {(
              [
                ['newItem', '新品上架通知'],
                ['coupon', '優惠券通知'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={get(s.id)[key]}
                onClick={() => onToggle(s.id, key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition ${
                  get(s.id)[key] ? 'border-primary bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground'
                }`}
              >
                {get(s.id)[key] && <Check className="size-3.5" />}
                {label}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  )
}
