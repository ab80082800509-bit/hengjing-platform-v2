import {
  BadgeCheck,
  Bird,
  Cat,
  Clover,
  Compass,
  Crown,
  CupSoda,
  Dog,
  Droplets,
  Flame,
  Flower2,
  Gamepad2,
  Gem,
  Grid3x3,
  Heart,
  Lightbulb,
  MessageCircle,
  Moon,
  Palette,
  PartyPopper,
  Rocket,
  Search,
  ShieldCheck,
  ShoppingCart,
  Smile,
  Snowflake,
  Sparkles,
  Star,
  StickyNote,
  Store,
  Sunset,
  Coins,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { PERK_CATALOG, type PerkCategory, type PerkId, type PerkRarity } from '@/lib/rewards/perk-catalog'

export type { EquippedPerks, PerkCategory, PerkRarity } from '@/lib/rewards/perk-catalog'

export interface Perk {
  id: string
  name: string
  label: string
  category: PerkCategory
  rarity: PerkRarity
  cost: number
  effect: string
  icon: LucideIcon
}

export const CATEGORY_META: Record<PerkCategory, { label: string; place: string }> = {
  frame: { label: '動態頭像框', place: '買家頭像' },
  badge: { label: '評價區勳章', place: '商品評價區的名字旁' },
  title: { label: '個人頭銜', place: '私訊與個人中心' },
  skin: { label: '主頁主題 Skin', place: '個人中心背景' },
  bubble: { label: '聊天氣泡', place: '賣場聊聊裡你送出的訊息' },
  pet: { label: '寵物夥伴', place: '名字旁、成就牆與夢想商店街' },
  decor: { label: '商店街裝潢', place: '你的夢想商店街，訪客也看得到' },
  board: { label: '方塊棋盤', place: '方塊大挑戰的棋盤' },
  scene: { label: '遊戲場景', place: '遊樂園、合成小舖與方塊大挑戰背景' },
  effect: { label: '個人頁特效', place: '個人中心與成就牆，點擊有互動' },
  collection: { label: '節慶限定收藏', place: '名字旁的動態徽章' },
  sticker: { label: '動態貼圖', place: '賣場聊聊的貼圖選單' },
}

export const CATEGORY_ORDER: PerkCategory[] = ['frame', 'badge', 'title', 'skin', 'bubble', 'pet', 'decor', 'board', 'scene', 'effect', 'collection', 'sticker']

export const RARITY_ORDER: PerkRarity[] = ['common', 'rare', 'epic', 'legendary']

export const RARITY_META: Record<
  PerkRarity,
  { label: string; en: string; card: string; pill: string; stage: string }
> = {
  common: {
    label: '普通',
    en: 'Common',
    card: 'border-border/70',
    pill: 'bg-slate-500/15 text-slate-300 ring-slate-400/40',
    stage: 'radial-gradient(circle at 50% 0%, rgba(148,163,184,.18), transparent 70%)',
  },
  rare: {
    label: '稀有',
    en: 'Rare',
    card: 'border-sky-400/45',
    pill: 'bg-sky-500/15 text-sky-300 ring-sky-400/50',
    stage: 'radial-gradient(circle at 50% 0%, rgba(56,189,248,.28), transparent 70%)',
  },
  epic: {
    label: '史詩',
    en: 'Epic',
    card: 'border-violet-400/70 shadow-[0_0_18px_-4px_rgba(167,139,250,.55)]',
    pill: 'bg-violet-500/20 text-violet-300 ring-violet-400/60',
    stage: 'radial-gradient(circle at 50% 0%, rgba(167,139,250,.35), transparent 70%)',
  },
  legendary: {
    label: '傳說',
    en: 'Legendary',
    card: 'border-amber-300/90 shadow-[0_0_22px_-3px_rgba(251,191,36,.6)]',
    pill: 'bg-amber-400/20 text-amber-300 ring-amber-300/70',
    stage: 'radial-gradient(circle at 50% 0%, rgba(251,191,36,.42), transparent 70%)',
  },
}

const PERK_ICONS = {
  'frame-founder': Crown,
  'frame-blackdiamond': Gem,
  'frame-koi': Clover,
  'frame-cyber': Zap,
  'frame-flame': Flame,
  'badge-honest': BadgeCheck,
  'badge-detail': Search,
  'badge-fivestar': Trophy,
  'badge-referee': ShieldCheck,
  'title-saver': Coins,
  'title-flash': Rocket,
  'title-cart': ShoppingCart,
  'title-hunter': Compass,
  'skin-cyber': Moon,
  'skin-ink': Palette,
  'bubble-milktea': CupSoda,
  'bubble-memo': StickyNote,
  'bubble-neon': MessageCircle,
  'frame-sakura': Flower2,
  'title-merge-boss': Store,
  'title-street-star': Star,
  'pet-cat': Cat,
  'pet-shiba': Dog,
  'pet-penguin': Bird,
  'decor-balloon': PartyPopper,
  'decor-neon': Lightbulb,
  'decor-fountain': Droplets,
  'board-wood': Grid3x3,
  'board-arcade': Gamepad2,
  'board-jade': Gem,
  'scene-sakura': Flower2,
  'scene-harbor': Sunset,
  'scene-night': Moon,
  'effect-snow': Snowflake,
  'effect-hearts': Heart,
  'effect-coins': Coins,
  'collect-newyear': Sparkles,
  'collect-moon': Moon,
  'collect-snowman': Snowflake,
  'sticker-party': Smile,
} satisfies Record<PerkId, LucideIcon>

export const PERKS: Perk[] = PERK_CATALOG.map((perk) => ({
  ...perk,
  icon: PERK_ICONS[perk.id],
}))

export const perkById = new Map(PERKS.map((p) => [p.id, p]))
