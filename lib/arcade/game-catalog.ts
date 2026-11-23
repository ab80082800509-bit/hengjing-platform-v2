/**
 * 遊樂園的遊戲登錄表與顯示文案。
 * 新增遊戲時在 ARCADE_GAMES 加一筆即可出現在遊樂園入口，導覽列只有一個「遊樂園」入口，不需改動。
 * 任務點數、上限與成就門檻只認資料庫，這裡只放名稱與說明。
 */
import type { GameRewardId } from './game-reward-policy'
import type { AchievementTier } from './achievement-snapshot'

export type ArcadeGameStatus = 'open' | 'coming_soon' | 'existing'

export type ArcadeGameEntry = {
  id: 'merge' | 'blocks' | 'street' | 'scratch'
  rewardId: GameRewardId | null
  name: string
  tagline: string
  status: ArcadeGameStatus
  cover: 'merge' | 'blocks' | 'street' | 'scratch'
  sharesGameCap: boolean
}

export const ARCADE_GAMES: readonly ArcadeGameEntry[] = [
  {
    id: 'merge',
    rewardId: 'merge_shop',
    name: 'Pay 服合成小舖',
    tagline: '合成茶點、招呼熟客、把小舖升級成巷口名店',
    status: 'open',
    cover: 'merge',
    sharesGameCap: true,
  },
  {
    id: 'blocks',
    rewardId: 'block_challenge',
    name: 'Pay 服方塊大挑戰',
    tagline: '拖曳方塊填滿整行整列，連續消除拚高分。正式獎勵後續開放',
    status: 'open',
    cover: 'blocks',
    sharesGameCap: true,
  },
  {
    id: 'street',
    rewardId: 'dream_street',
    name: 'Pay 服夢想商店街',
    tagline: '經營街角小店、接待顧客、升級店面。正式獎勵後續開放',
    status: 'open',
    cover: 'street',
    sharesGameCap: true,
  },
  {
    id: 'scratch',
    rewardId: null,
    name: '每日幸運刮刮卡',
    tagline: '沿用原本的刮卡次數與獎項，和簽到兌換是同一張卡',
    status: 'existing',
    cover: 'scratch',
    sharesGameCap: false,
  },
]

export const GAME_LABEL: Record<GameRewardId, string> = {
  merge_shop: '合成小舖',
  block_challenge: '方塊大挑戰',
  dream_street: '夢想商店街',
}

export const REWARD_TASK_COPY: Record<string, { title: string; detail: string; art: string }> = {
  merge_daily_orders: { title: '完成顧客訂單', detail: '今天在合成小舖交付顧客訂單', art: 'cu-chen' },
  merge_daily_merges: { title: '合成商品', detail: '今天在合成小舖合成商品', art: 'it-tea-3' },
  merge_daily_chest: { title: '打開每日寶箱', detail: '完成今日顧客任務並領取寶箱', art: 'ic-chest' },
  merge_weekly_orders: { title: '本週熟客滿堂', detail: '本週累計交付顧客訂單', art: 'ic-shop' },
  block_daily_clear: { title: '方塊挑戰過關', detail: '方塊大挑戰正式獎勵開放後才會計算', art: 'blocks' },
  street_daily_visit: { title: '逛商店街', detail: '夢想商店街正式獎勵開放後才會計算', art: 'street' },
}

export type AchievementCopy = { name: string; detail: string; art: string; group: 'orders' | 'shop' | 'collection' | 'street' | 'block' }

export const ACHIEVEMENT_COPY: Record<string, AchievementCopy> = {
  merge_first_order: { name: '開張大吉', detail: '完成第一張顧客訂單', art: 'cu-atao', group: 'orders' },
  merge_regulars: { name: '熟客滿堂', detail: '累計完成 30 張顧客訂單', art: 'cu-xiaoan', group: 'orders' },
  merge_famous: { name: '巷口名店', detail: '累計完成 120 張顧客訂單', art: 'cu-chen', group: 'orders' },
  merge_level_three: { name: '三代老店', detail: '小舖升到 Lv.3', art: 'ic-shop', group: 'shop' },
  merge_level_five: { name: '金字招牌', detail: '小舖升到 Lv.5', art: 'ic-up', group: 'shop' },
  merge_chest_week: { name: '勤勞店長', detail: '累計打開 7 次每日寶箱', art: 'ic-chest-open', group: 'shop' },
  merge_codex_eight: { name: '圖鑑新手', detail: '商品圖鑑收集 8 件', art: 'ic-book', group: 'collection' },
  merge_tea_master: { name: '茶王', detail: '收藏茶飲線最高階商品', art: 'it-tea-5', group: 'collection' },
  merge_snack_master: { name: '點心師傅', detail: '收藏點心線最高階商品', art: 'it-snack-5', group: 'collection' },
  merge_gift_master: { name: '伴手禮達人', detail: '收藏伴手禮線最高階商品', art: 'it-gift-5', group: 'collection' },
  merge_codex_full: { name: '雜貨舖收藏家', detail: '商品圖鑑 15 件全部收齊', art: 'ic-star', group: 'collection' },
  merge_level_six: { name: '百年水果舖', detail: '小舖升到 Lv.6，開放水果線', art: 'it-fruit-3', group: 'shop' },
  merge_fruit_master: { name: '水果禮籃達人', detail: '收藏水果線最高階商品', art: 'it-fruit-5', group: 'collection' },
  merge_codex_twenty: { name: '圖鑑大全', detail: '商品圖鑑 20 件全部收齊', art: 'ic-book', group: 'collection' },
  street_first_guest: { name: '第一位客人', detail: '商店街招待第 1 位客人', art: 'cu-atao', group: 'street' },
  street_regulars: { name: '街坊熟客', detail: '商店街累計招待 100 位客人', art: 'cu-xiaoan', group: 'street' },
  street_famous: { name: '人氣商店街', detail: '商店街累計招待 500 位客人', art: 'cu-chen', group: 'street' },
  street_level_three: { name: '街區新星', detail: '商店街升到 Lv.3', art: 'ic-shop', group: 'street' },
  street_flagship: { name: '旗艦街長', detail: '商店街升到 Lv.5', art: 'ic-up', group: 'street' },
  street_full_street: { name: '整條街開張', detail: '蓋好 2 間店面', art: 'ic-street', group: 'street' },
  street_decorator: { name: '佈置高手', detail: '買齊 4 件街景裝潢', art: 'ic-quest', group: 'street' },
  street_decor_all: { name: '最美商店街', detail: '8 件街景裝潢全部買齊', art: 'ic-star', group: 'street' },
  street_earned_10k: { name: '萬元營業額', detail: '商店街累計營業額 10,000 金幣', art: 'ic-coin', group: 'street' },
  block_ranked_first: { name: '初登排行榜', detail: '完成 1 局通過伺服器驗證的排行賽', art: 'ic-blocks', group: 'block' },
  block_ranked_ten: { name: '排行常客', detail: '完成 10 局通過驗證的排行賽', art: 'ic-blocks', group: 'block' },
  block_score_3k: { name: '三千分達人', detail: '排行賽單局 3,000 分（伺服器驗證）', art: 'ic-trophy', group: 'block' },
  block_score_8k: { name: '方塊傳說', detail: '排行賽單局 8,000 分（伺服器驗證）', art: 'ic-trophy', group: 'block' },
}

export const TIER_META: Record<AchievementTier, { label: string; ring: string; face: string; ribbon: string }> = {
  bronze: { label: '銅', ring: '#b8692e', face: '#f3c08e', ribbon: '#c2410c' },
  silver: { label: '銀', ring: '#8b97a6', face: '#eef2f7', ribbon: '#475569' },
  gold: { label: '金', ring: '#c88a12', face: '#ffe08a', ribbon: '#b45309' },
  legend: { label: '傳說', ring: '#f97316', face: '#fff1d6', ribbon: '#7c2d12' },
}

export function achievementName(id: string | null | undefined): string | null {
  if (!id) return null
  return ACHIEVEMENT_COPY[id]?.name ?? null
}

/** 刮刮卡不計入三款遊戲的共用上限。 */
export function gamesSharingCap(): ArcadeGameEntry[] {
  return ARCADE_GAMES.filter((game) => game.sharesGameCap)
}
