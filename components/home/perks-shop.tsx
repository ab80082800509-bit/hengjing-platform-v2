'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { Check, Coins, Eye, Lock, Star } from 'lucide-react'
import { UserAvatar } from '@/components/buyer-profile'
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  PERKS,
  RARITY_META,
  RARITY_ORDER,
  perkById,
  type EquippedPerks,
  type Perk,
  type PerkCategory,
  type PerkRarity,
} from './perks-catalog'

export interface PerkViewer {
  name: string
  tone: number
  avatar?: string
}

const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-foreground transition hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'

const FRAME_STYLE: Record<string, { ring: string; glow: string; anim: string; dur: string }> = {
  'frame-founder': {
    ring: 'conic-gradient(from 0deg, #f97316, #fde68a, #fb923c, #7c2d12, #f97316)',
    glow: 'rgba(249,115,22,.55)',
    anim: 'perk-anim-slow',
    dur: '2.8s',
  },
  'frame-blackdiamond': {
    ring: 'conic-gradient(from 0deg, #09090b 0deg 18deg, #71717a 18deg 30deg, #fafafa 30deg 36deg, #18181b 36deg 90deg, #52525b 90deg 104deg, #e4e4e7 104deg 110deg, #09090b 110deg 180deg, #71717a 180deg 192deg, #fafafa 192deg 198deg, #18181b 198deg 270deg, #52525b 270deg 284deg, #e4e4e7 284deg 290deg, #09090b 290deg 360deg)',
    glow: 'rgba(228,228,231,.35)',
    anim: 'perk-anim-mid',
    dur: '3.2s',
  },
  'frame-koi': {
    ring: 'conic-gradient(from 0deg, #22c55e, #facc15, #16a34a, #fbbf24, #22c55e)',
    glow: 'rgba(34,197,94,.4)',
    anim: 'perk-anim-slow',
    dur: '3s',
  },
  'frame-cyber': {
    ring: 'conic-gradient(from 0deg, #a855f7, #22d3ee, #ec4899, #8b5cf6, #22d3ee, #a855f7)',
    glow: 'rgba(168,85,247,.6)',
    anim: 'perk-anim-neon',
    dur: '1.8s',
  },
  'frame-flame': {
    ring: 'conic-gradient(from 0deg, #ef4444, #f97316, #fde047, #dc2626, #f97316, #ef4444)',
    glow: 'rgba(239,68,68,.65)',
    anim: 'perk-anim-flame',
    dur: '1s',
  },
}

const CHIP_STYLE: Record<string, string> = {
  'badge-honest': 'bg-gradient-to-r from-amber-400 to-yellow-300 text-amber-950 ring-amber-200/60',
  'badge-detail': 'bg-sky-500/15 text-sky-300 ring-sky-400/50',
  'badge-fivestar': 'bg-gradient-to-r from-yellow-300 via-amber-300 to-yellow-500 text-amber-950 ring-yellow-100/70 shadow-[0_0_14px_rgba(251,191,36,.65)]',
  'badge-referee': 'bg-violet-500/20 text-violet-200 ring-violet-400/60 shadow-[0_0_12px_rgba(167,139,250,.45)]',
  'title-saver': 'bg-gradient-to-r from-fuchsia-500/25 to-violet-500/25 text-fuchsia-200 ring-fuchsia-400/60',
  'title-flash': 'bg-sky-500/15 text-sky-200 ring-sky-400/50',
  'title-cart': 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40',
  'title-hunter': 'bg-gradient-to-r from-amber-500/30 via-yellow-300/30 to-amber-500/30 text-amber-200 ring-amber-300/70 shadow-[0_0_14px_rgba(251,191,36,.45)]',
}

const SHIMMER_IDS = new Set(['badge-fivestar', 'title-hunter', 'title-saver'])

const SKIN_STYLE: Record<string, CSSProperties> = {
  'skin-cyber': {
    backgroundColor: '#0b1020',
    backgroundImage:
      'radial-gradient(circle at 18% 22%, rgba(168,85,247,.5), transparent 45%), radial-gradient(circle at 82% 75%, rgba(34,211,238,.4), transparent 45%), radial-gradient(rgba(255,255,255,.35) 1px, transparent 1.5px)',
    backgroundSize: 'auto, auto, 16px 16px',
  },
  'skin-ink': {
    backgroundColor: '#0a0a0a',
    backgroundImage:
      'repeating-linear-gradient(135deg, transparent 0 18px, rgba(212,175,55,.2) 18px 19px), linear-gradient(135deg, #0a0a0a, #1c1917 60%, #292524)',
    boxShadow: 'inset 0 0 0 1px rgba(212,175,55,.55)',
  },
}

const STAGE_BASE: CSSProperties = { backgroundColor: '#09090b' }

export function FrameAvatar({
  perkId,
  viewer,
  size = 'size-14',
  textSize = 'text-lg',
  thickness = 3,
}: {
  perkId: string
  viewer: PerkViewer
  size?: string
  textSize?: string
  thickness?: number
}) {
  const f = FRAME_STYLE[perkId]
  const avatar = <UserAvatar name={viewer.name} tone={viewer.tone} src={viewer.avatar} size={size} textSize={textSize} />
  if (!f) return avatar
  return (
    <span
      className="perk-glow relative inline-flex rounded-full"
      style={{ '--perk-glow': f.glow, '--perk-glow-dur': f.dur } as CSSProperties}
    >
      <span className="absolute inset-0 overflow-hidden rounded-full" aria-hidden="true">
        <span className={`absolute -inset-1/2 ${f.anim}`} style={{ background: f.ring }} />
      </span>
      <span className="relative inline-flex rounded-full bg-zinc-950" style={{ margin: thickness }}>
        {avatar}
      </span>
    </span>
  )
}

export function PerkChip({ perk, large = false }: { perk: Perk; large?: boolean }) {
  const Icon = perk.icon
  return (
    <span
      className={`relative inline-flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-full font-black ring-1 ring-inset ${
        large ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[11px]'
      } ${CHIP_STYLE[perk.id] ?? ''}`}
    >
      <Icon className={large ? 'size-4' : 'size-3'} aria-hidden="true" />
      {perk.label}
      {SHIMMER_IDS.has(perk.id) && <span className="perk-shimmer pointer-events-none absolute inset-0" aria-hidden="true" />}
    </span>
  )
}

export function PerkAvatar({
  viewer,
  equipped,
  size = 'size-14',
  textSize = 'text-lg',
  thickness = 3,
}: {
  viewer: PerkViewer
  equipped?: EquippedPerks
  size?: string
  textSize?: string
  thickness?: number
}) {
  if (equipped?.frame) {
    return <FrameAvatar perkId={equipped.frame} viewer={viewer} size={size} textSize={textSize} thickness={thickness} />
  }
  return <UserAvatar name={viewer.name} tone={viewer.tone} src={viewer.avatar} size={size} textSize={textSize} />
}

export function PerkTags({ equipped, large = false }: { equipped?: EquippedPerks; large?: boolean }) {
  const title = equipped?.title ? perkById.get(equipped.title) : undefined
  const badge = equipped?.badge ? perkById.get(equipped.badge) : undefined
  if (!title && !badge) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {title && <PerkChip perk={title} large={large} />}
      {badge && <PerkChip perk={badge} large={large} />}
    </span>
  )
}

export function skinStyleFor(equipped?: EquippedPerks): CSSProperties | undefined {
  return equipped?.skin ? SKIN_STYLE[equipped.skin] : undefined
}

function stageStyle(perk: Perk): CSSProperties {
  if (perk.category === 'skin') return SKIN_STYLE[perk.id] ?? STAGE_BASE
  return { ...STAGE_BASE, backgroundImage: RARITY_META[perk.rarity].stage }
}

function PerkThumb({ perk, viewer }: { perk: Perk; viewer: PerkViewer }) {
  if (perk.category === 'frame') return <FrameAvatar perkId={perk.id} viewer={viewer} size="size-14" />
  if (perk.category === 'skin') {
    return (
      <div className="flex items-center gap-2">
        <UserAvatar name={viewer.name} tone={viewer.tone} src={viewer.avatar} size="size-9" textSize="text-sm" />
        <div className="space-y-1.5" aria-hidden="true">
          <span className="block h-2 w-16 rounded-full bg-white/70" />
          <span className="block h-2 w-10 rounded-full bg-white/30" />
        </div>
      </div>
    )
  }
  return <PerkChip perk={perk} large />
}

function RarityPill({ rarity }: { rarity: PerkRarity }) {
  const m = RARITY_META[rarity]
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-black ring-1 ring-inset ${m.pill}`}>
      {m.label}
      <span className="font-medium opacity-80">{m.en}</span>
    </span>
  )
}

function ReviewStars() {
  return (
    <span className="inline-flex gap-0.5 text-amber-400" role="img" aria-label="5 星評價">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} className="size-3.5 fill-current" aria-hidden="true" />
      ))}
    </span>
  )
}

export function PerkPreviewContent({
  perk,
  viewer,
  owned,
  equipped,
  loggedIn,
  points,
  onUnlock,
  onEquip,
}: {
  perk: Perk
  viewer: PerkViewer
  owned: boolean
  equipped: boolean
  loggedIn: boolean
  points: number
  onUnlock: () => void
  onEquip: () => void
}) {
  const name = viewer.name || '買家'
  const short = perk.cost - points
  return (
    <div className="space-y-4 p-5">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <RarityPill rarity={perk.rarity} />
          <span className="text-xs text-muted-foreground">{CATEGORY_META[perk.category].label}</span>
        </div>
        <h3 className="text-lg font-black text-balance">{perk.name}</h3>
        <p className="text-sm text-muted-foreground">
          {perk.effect}，套用位置：{CATEGORY_META[perk.category].place}
        </p>
      </div>

      <div
        className="relative flex min-h-48 flex-col items-center justify-center gap-4 overflow-hidden rounded-2xl p-5 text-white"
        style={stageStyle(perk)}
        role="img"
        aria-label={`${perk.name}的套用預覽`}
      >
        {perk.category === 'frame' && (
          <>
            <FrameAvatar perkId={perk.id} viewer={viewer} size="size-24" textSize="text-3xl" thickness={4} />
            <p className="text-sm font-black">{name}</p>
            <div className="flex items-center gap-4 rounded-full bg-white/10 px-4 py-2">
              <FrameAvatar perkId={perk.id} viewer={viewer} size="size-8" textSize="text-xs" thickness={2} />
              <span className="text-xs text-zinc-300">頁首大小</span>
              <FrameAvatar perkId={perk.id} viewer={viewer} size="size-10" textSize="text-sm" thickness={2} />
              <span className="text-xs text-zinc-300">評價區大小</span>
            </div>
          </>
        )}

        {perk.category === 'badge' && (
          <div className="w-full max-w-sm space-y-2 rounded-xl bg-white/10 p-4">
            <div className="flex items-center gap-2.5">
              <UserAvatar name={viewer.name} tone={viewer.tone} src={viewer.avatar} size="size-9" textSize="text-sm" />
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-black">
                  <span className="truncate">{name}</span>
                  <PerkChip perk={perk} />
                </p>
                <ReviewStars />
              </div>
            </div>
            <p className="text-xs leading-relaxed text-zinc-200">出貨很快，包裝完整，實品與描述一致，推薦給大家。</p>
          </div>
        )}

        {perk.category === 'title' && (
          <div className="w-full max-w-sm space-y-3">
            <div className="flex items-center gap-3 rounded-xl bg-white/10 p-4">
              <UserAvatar name={viewer.name} tone={viewer.tone} src={viewer.avatar} size="size-12" textSize="text-lg" />
              <div className="space-y-1">
                <p className="text-sm font-black">{name}</p>
                <PerkChip perk={perk} />
              </div>
              <span className="ml-auto text-[11px] text-zinc-300">個人中心</span>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl bg-white/10 p-3">
              <UserAvatar name={viewer.name} tone={viewer.tone} src={viewer.avatar} size="size-8" textSize="text-xs" />
              <div className="space-y-1">
                <p className="flex items-center gap-1.5 text-xs font-black">
                  {name}
                  <PerkChip perk={perk} />
                </p>
                <p className="text-xs text-zinc-200">請問這款還有現貨嗎？</p>
              </div>
            </div>
          </div>
        )}

        {perk.category === 'skin' && (
          <div className="w-full max-w-sm space-y-3">
            <div className="flex items-center gap-3">
              <UserAvatar name={viewer.name} tone={viewer.tone} src={viewer.avatar} size="size-14" textSize="text-xl" />
              <div>
                <p className="text-base font-black">{name}</p>
                <p className="text-xs text-zinc-300">買家中心</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {['點數', '優惠券', '訂單'].map((label) => (
                <div key={label} className="rounded-xl bg-white/10 px-2 py-2.5 backdrop-blur-sm">
                  <p className="text-sm font-black">—</p>
                  <p className="text-[11px] text-zinc-300">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-sm font-black text-brand-ink">
          <Coins className="size-4" aria-hidden="true" />
          {perk.cost} 點
        </p>
        {owned ? (
          <button type="button" onClick={onEquip} aria-pressed={equipped} className={equipped ? btnGhost : btnPrimary}>
            <Check className="size-3.5" aria-hidden="true" />
            {equipped ? '已裝備（點此卸下）' : '立即裝備'}
          </button>
        ) : (
          <div className="flex items-center gap-3">
            {loggedIn && short > 0 && <span className="text-xs text-muted-foreground">還差 {short} 點</span>}
            <button type="button" onClick={onUnlock} className={btnPrimary}>
              <Coins className="size-3.5" aria-hidden="true" />
              用點數解鎖
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function EquipStrip({
  viewer,
  owned,
  equipped,
  points,
}: {
  viewer: PerkViewer
  owned: string[]
  equipped: EquippedPerks
  points: number
}) {
  const frame = equipped.frame ? perkById.get(equipped.frame) : undefined
  const badge = equipped.badge ? perkById.get(equipped.badge) : undefined
  const title = equipped.title ? perkById.get(equipped.title) : undefined
  const skin = equipped.skin ? SKIN_STYLE[equipped.skin] : undefined
  const name = viewer.name || '買家'
  return (
    <div
      className={`flex flex-wrap items-center gap-4 rounded-2xl p-4 ring-1 ring-border/70 ${skin ? 'text-white' : 'bg-muted/40'}`}
      style={skin}
      aria-label="我的裝備"
    >
      {frame ? (
        <FrameAvatar perkId={frame.id} viewer={viewer} size="size-14" />
      ) : (
        <UserAvatar name={viewer.name} tone={viewer.tone} src={viewer.avatar} size="size-14" textSize="text-lg" />
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-black">
          <span className="truncate">{name}</span>
          {badge && <PerkChip perk={badge} />}
          {title && <PerkChip perk={title} />}
        </p>
        <p className={`text-xs ${skin ? 'text-zinc-300' : 'text-muted-foreground'}`}>
          {owned.length === 0 ? '尚未解鎖任何特權，解鎖後可在這裡裝備，並顯示在評價區與個人中心' : `已解鎖 ${owned.length} / ${PERKS.length} 件收藏品`}
        </p>
      </div>
      <p className={`inline-flex items-center gap-1.5 text-sm font-black ${skin ? 'text-amber-300' : 'text-brand-ink'}`}>
        <Coins className="size-4" aria-hidden="true" />
        {points} 點
      </p>
    </div>
  )
}

function filterChip(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    active ? 'border-primary bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'
  }`
}

export function PerksPanel({
  loggedIn,
  points,
  owned,
  equipped,
  viewer,
  onPreview,
  onUnlock,
  onEquip,
}: {
  loggedIn: boolean
  points: number
  owned: string[]
  equipped: EquippedPerks
  viewer: PerkViewer
  onPreview: (id: string) => void
  onUnlock: (id: string) => void
  onEquip: (id: string) => void
}) {
  const [category, setCategory] = useState<PerkCategory | 'all'>('all')
  const [rarity, setRarity] = useState<PerkRarity | 'all'>('all')

  const byRarity = useMemo(() => PERKS.filter((p) => rarity === 'all' || p.rarity === rarity), [rarity])
  const visible = useMemo(() => byRarity.filter((p) => category === 'all' || p.category === category), [byRarity, category])
  const countOf = (c: PerkCategory) => byRarity.filter((p) => p.category === c).length

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-black">尊榮頭銜與特權</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">用簽到點數解鎖頭像框、評價勳章、頭銜與主題，收集你的專屬風格</p>
      </div>

      <EquipStrip viewer={viewer} owned={owned} equipped={equipped} points={points} />

      <div className="space-y-2.5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="分類篩選">
          <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')} className={filterChip(category === 'all')}>
            全部 ({byRarity.length})
          </button>
          {CATEGORY_ORDER.map((c) => (
            <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={filterChip(category === c)}>
              {CATEGORY_META[c].label} ({countOf(c)})
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="稀有度篩選">
          <span className="text-xs font-bold text-muted-foreground">稀有度</span>
          <button type="button" aria-pressed={rarity === 'all'} onClick={() => setRarity('all')} className={filterChip(rarity === 'all')}>
            全部
          </button>
          {RARITY_ORDER.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={rarity === r}
              onClick={() => setRarity(r)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition ${
                rarity === r ? RARITY_META[r].pill : 'bg-card text-muted-foreground ring-border hover:text-foreground'
              }`}
            >
              {RARITY_META[r].label}
              <span className="ml-1 font-medium opacity-70">{RARITY_META[r].en}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">這個篩選條件下沒有品項</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => {
            const isOwned = owned.includes(p.id)
            const isEquipped = equipped[p.category] === p.id
            const short = p.cost - points
            return (
              <li key={p.id} className={`flex flex-col gap-3 rounded-2xl border bg-card p-3 ${RARITY_META[p.rarity].card}`}>
                <div className="flex h-28 items-center justify-center overflow-hidden rounded-xl" style={stageStyle(p)}>
                  <PerkThumb perk={p} viewer={viewer} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <RarityPill rarity={p.rarity} />
                  <span className="text-[11px] text-muted-foreground">{CATEGORY_META[p.category].label}</span>
                </div>
                <div className="space-y-0.5">
                  <p className="text-sm font-black text-pretty">{p.name}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{p.effect}</p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="inline-flex items-center gap-1 text-sm font-black text-brand-ink">
                    <Coins className="size-4" aria-hidden="true" />
                    {p.cost} 點
                  </p>
                  {isOwned ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400">
                      <Check className="size-3.5" aria-hidden="true" />已擁有
                    </span>
                  ) : loggedIn && short > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3" aria-hidden="true" />還差 {short} 點
                    </span>
                  ) : null}
                </div>
                <div className="mt-auto grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => onPreview(p.id)} className={btnGhost}>
                    <Eye className="size-3.5" aria-hidden="true" />即時預覽
                  </button>
                  {isOwned ? (
                    <button
                      type="button"
                      onClick={() => onEquip(p.id)}
                      aria-pressed={isEquipped}
                      className={isEquipped ? `${btnGhost} border-primary text-brand-ink` : btnPrimary}
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                      {isEquipped ? '已裝備' : '裝備'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => onUnlock(p.id)} className={btnPrimary}>
                      <Coins className="size-3.5" aria-hidden="true" />用點數解鎖
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="rounded-2xl bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
        頭銜與特權皆為虛擬外觀收藏品，以平台簽到點數解鎖後永久擁有，不可轉讓、退換或兌換現金；同一類別一次只能裝備一件。
      </p>
    </div>
  )
}
