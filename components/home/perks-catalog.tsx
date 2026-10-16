import {
  BadgeCheck,
  Clover,
  Compass,
  Crown,
  Flame,
  Gem,
  Moon,
  Palette,
  Rocket,
  Search,
  ShieldCheck,
  ShoppingCart,
  Coins,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export type PerkCategory = 'frame' | 'badge' | 'title' | 'skin'
export type PerkRarity = 'common' | 'rare' | 'epic' | 'legendary'

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
}

export const CATEGORY_ORDER: PerkCategory[] = ['frame', 'badge', 'title', 'skin']

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

export const PERKS: Perk[] = [
  { id: 'frame-founder', name: '創始會員光環頭像框', label: '創始會員光環', category: 'frame', rarity: 'rare', cost: 100, effect: '專屬橘色微光流動邊框', icon: Crown },
  { id: 'frame-blackdiamond', name: '尊爵黑鑽極致框', label: '尊爵黑鑽', category: 'frame', rarity: 'epic', cost: 150, effect: '幾何切割黑鑽質感微光閃爍', icon: Gem },
  { id: 'frame-koi', name: '幸運錦鯉雙色框', label: '幸運錦鯉', category: 'frame', rarity: 'common', cost: 80, effect: '綠金雙色動態邊框', icon: Clover },
  { id: 'frame-cyber', name: '賽博霓虹閃電框', label: '賽博霓虹', category: 'frame', rarity: 'epic', cost: 120, effect: '炫彩霓虹紫光閃電效果', icon: Zap },
  { id: 'frame-flame', name: '熱血爆發烈焰框', label: '熱血烈焰', category: 'frame', rarity: 'legendary', cost: 200, effect: '強烈視覺衝擊之動態火焰邊框', icon: Flame },
  { id: 'badge-honest', name: '誠實開箱官 勳章', label: '誠實開箱官', category: 'badge', rarity: 'common', cost: 80, effect: '商品評價區專屬金色勳章', icon: BadgeCheck },
  { id: 'badge-detail', name: '細節控評測家 勳章', label: '細節控評測家', category: 'badge', rarity: 'common', cost: 60, effect: '商品評價區科技藍細節標籤', icon: Search },
  { id: 'badge-fivestar', name: '五星好評神人 勳章', label: '五星好評神人', category: 'badge', rarity: 'epic', cost: 120, effect: '評價區尊榮金光好評標籤', icon: Trophy },
  { id: 'badge-referee', name: '公道裁判官 勳章', label: '公道裁判官', category: 'badge', rarity: 'epic', cost: 150, effect: '評價區客觀公正高權威勳章', icon: ShieldCheck },
  { id: 'title-saver', name: '省錢王者 頭銜', label: '省錢王者', category: 'title', rarity: 'epic', cost: 150, effect: '私訊與個人中心顯示獨家亮眼標籤', icon: Coins },
  { id: 'title-flash', name: '閃電下單達人 頭銜', label: '閃電下單達人', category: 'title', rarity: 'rare', cost: 120, effect: '個人主頁顯示誠信高質感標籤', icon: Rocket },
  { id: 'title-cart', name: '清空購物車狂人 頭銜', label: '清空購物車狂人', category: 'title', rarity: 'common', cost: 100, effect: '社群強大購買力標籤', icon: ShoppingCart },
  { id: 'title-hunter', name: '終極寶藏獵人 頭銜', label: '終極寶藏獵人', category: 'title', rarity: 'legendary', cost: 250, effect: '頂級活躍買家榮譽標籤', icon: Compass },
  { id: 'skin-cyber', name: '極夜賽博朋克 Skin', label: '極夜賽博朋克', category: 'skin', rarity: 'epic', cost: 200, effect: '個人中心炫彩深色微粒背景', icon: Moon },
  { id: 'skin-ink', name: '極簡墨炭黑金 Skin', label: '極簡墨炭黑金', category: 'skin', rarity: 'legendary', cost: 300, effect: '個人中心頂級奢華黑金暗黑主題', icon: Palette },
]

export const perkById = new Map(PERKS.map((p) => [p.id, p]))

export type EquippedPerks = Partial<Record<PerkCategory, string>>
