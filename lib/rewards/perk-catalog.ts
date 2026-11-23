/**
 * Pay 點數商城虛擬商品的唯一目錄：原有 15 件特權＋第七階段第 9 批新增 25 件，共 40 件。
 * 名稱、分類、稀有度、持有方式、解鎖條件與販售期間都集中在這裡，畫面與 SQL 產生器共用。
 *
 * 價格：原 15 件沿用既有規劃價；新 25 件是建議價。兩者都還沒有站長簽核（PERK_PRICES_CONFIRMED = false）。
 * 正式扣點只讀資料庫 member_perk_catalog.cost，瀏覽器不能傳金額；畫面優先顯示資料庫回傳的價格。
 * 解鎖條件、販售期間與數量上限也由資料庫在兌換交易內重新檢查，這裡只負責顯示。
 */
export const PERK_PRICE_SOURCE = 'existing-catalog+batch9-proposal' as const
export const PERK_PRICES_CONFIRMED = false
export const PERK_CATALOG_VERSION = 2

/** 每個分類一個裝備欄位；sticker 不用裝備，擁有就能在聊天使用。 */
export const PERK_CATEGORIES = ['frame', 'badge', 'title', 'skin', 'bubble', 'pet', 'decor', 'board', 'scene', 'effect', 'collection', 'sticker'] as const
export type PerkCategory = (typeof PERK_CATEGORIES)[number]

export const PERK_SLOTS = ['frame', 'badge', 'title', 'skin', 'bubble', 'pet', 'decor', 'board', 'scene', 'effect', 'collection'] as const
export type PerkSlot = (typeof PERK_SLOTS)[number]
export const isPerkSlot = (category: PerkCategory): category is PerkSlot => (PERK_SLOTS as readonly string[]).includes(category)

/** 第 9 批以前資料庫只有這四欄；新欄位要等商城 v2 SQL 套用後才會回傳。 */
export const LEGACY_SLOTS = ['frame', 'badge', 'title', 'skin'] as const

export const PERK_RARITIES = ['common', 'rare', 'epic', 'legendary'] as const
export type PerkRarity = (typeof PERK_RARITIES)[number]

/** 解鎖條件。名稱與資料庫 perk_unlock_progress 一一對應。 */
export type PerkUnlock =
  | { metric: 'merge.shop_level'; target: number }
  | { metric: 'street.rank'; target: number }
  | { metric: 'street.shop_level'; target: number }

/** always：常態販售；festival：只在指定節慶期間販售，期間由資料庫 member_perk_sale_windows 決定。 */
export type PerkSale = { kind: 'always' } | { kind: 'festival'; festivalId: string }

export type PerkDefinition = {
  id: string
  name: string
  label: string
  category: PerkCategory
  rarity: PerkRarity
  cost: number
  effect: string
  /** 這一版全部是永久持有；期限持有要另外設計續期，不在這一批開放。 */
  hold: 'permanent'
  unlock?: PerkUnlock
  sale?: PerkSale
  /** 全站數量上限；沒有就是不限量。 */
  stock?: number
  /** 第幾批加入目錄，用來做版本相容。 */
  since: 1 | 2
}

const P = { hold: 'permanent' } as const

export const PERK_CATALOG = [
  // ---- 原有 15 件（第五批）：不改編號、分類與價格 ----
  { ...P, since: 1, id: 'frame-founder', name: '創始會員光環頭像框', label: '創始會員光環', category: 'frame', rarity: 'rare', cost: 100, effect: '專屬橘色微光流動邊框' },
  { ...P, since: 1, id: 'frame-blackdiamond', name: '尊爵黑鑽極致框', label: '尊爵黑鑽', category: 'frame', rarity: 'epic', cost: 150, effect: '幾何切割黑鑽質感微光閃爍' },
  { ...P, since: 1, id: 'frame-koi', name: '幸運錦鯉雙色框', label: '幸運錦鯉', category: 'frame', rarity: 'common', cost: 80, effect: '綠金雙色動態邊框' },
  { ...P, since: 1, id: 'frame-cyber', name: '賽博霓虹閃電框', label: '賽博霓虹', category: 'frame', rarity: 'epic', cost: 120, effect: '炫彩霓虹紫光閃電效果' },
  { ...P, since: 1, id: 'frame-flame', name: '熱血爆發烈焰框', label: '熱血烈焰', category: 'frame', rarity: 'legendary', cost: 200, effect: '強烈視覺衝擊之動態火焰邊框' },
  { ...P, since: 1, id: 'badge-honest', name: '誠實開箱官 勳章', label: '誠實開箱官', category: 'badge', rarity: 'common', cost: 80, effect: '商品評價區專屬金色勳章' },
  { ...P, since: 1, id: 'badge-detail', name: '細節控評測家 勳章', label: '細節控評測家', category: 'badge', rarity: 'common', cost: 60, effect: '商品評價區科技藍細節標籤' },
  { ...P, since: 1, id: 'badge-fivestar', name: '五星好評神人 勳章', label: '五星好評神人', category: 'badge', rarity: 'epic', cost: 120, effect: '評價區尊榮金光好評標籤' },
  { ...P, since: 1, id: 'badge-referee', name: '公道裁判官 勳章', label: '公道裁判官', category: 'badge', rarity: 'epic', cost: 150, effect: '評價區客觀公正高權威勳章' },
  { ...P, since: 1, id: 'title-saver', name: '省錢王者 頭銜', label: '省錢王者', category: 'title', rarity: 'epic', cost: 150, effect: '私訊與個人中心顯示獨家亮眼標籤' },
  { ...P, since: 1, id: 'title-flash', name: '閃電下單達人 頭銜', label: '閃電下單達人', category: 'title', rarity: 'rare', cost: 120, effect: '個人主頁顯示誠信高質感標籤' },
  { ...P, since: 1, id: 'title-cart', name: '清空購物車狂人 頭銜', label: '清空購物車狂人', category: 'title', rarity: 'common', cost: 100, effect: '社群強大購買力標籤' },
  { ...P, since: 1, id: 'title-hunter', name: '終極寶藏獵人 頭銜', label: '終極寶藏獵人', category: 'title', rarity: 'legendary', cost: 250, effect: '頂級活躍買家榮譽標籤' },
  { ...P, since: 1, id: 'skin-cyber', name: '極夜賽博朋克 Skin', label: '極夜賽博朋克', category: 'skin', rarity: 'epic', cost: 200, effect: '個人中心炫彩深色微粒背景' },
  { ...P, since: 1, id: 'skin-ink', name: '極簡墨炭黑金 Skin', label: '極簡墨炭黑金', category: 'skin', rarity: 'legendary', cost: 300, effect: '個人中心頂級奢華黑金暗黑主題' },

  // ---- 第 9 批新增 25 件：建議價，待站長核准 ----
  // 聊天氣泡：自己送出的聊天訊息外框，對方也看得到
  { ...P, since: 2, id: 'bubble-milktea', name: '珍奶泡泡聊天氣泡', label: '珍奶泡泡', category: 'bubble', rarity: 'common', cost: 80, effect: '奶茶色圓角氣泡，底部有珍珠緩緩浮起' },
  { ...P, since: 2, id: 'bubble-memo', name: '手寫便利貼聊天氣泡', label: '手寫便利貼', category: 'bubble', rarity: 'rare', cost: 100, effect: '微微傾斜的黃色便利貼，上方貼著紙膠帶' },
  { ...P, since: 2, id: 'bubble-neon', name: '霓虹電光聊天氣泡', label: '霓虹電光', category: 'bubble', rarity: 'epic', cost: 150, effect: '深色氣泡外圈有流動的霓虹光' },
  // 公開頭像框與頭銜
  { ...P, since: 2, id: 'frame-sakura', name: '櫻花飄落頭像框', label: '櫻花飄落', category: 'frame', rarity: 'epic', cost: 160, effect: '粉色花環外框，花瓣沿著頭像飄落' },
  { ...P, since: 2, id: 'title-merge-boss', name: '合成小舖大掌櫃 頭銜', label: '小舖大掌櫃', category: 'title', rarity: 'epic', cost: 180, effect: '合成小舖升到 Lv.5 才能兌換的店長頭銜', unlock: { metric: 'merge.shop_level', target: 5 } },
  { ...P, since: 2, id: 'title-street-star', name: '商店街名譽店長 頭銜', label: '名譽店長', category: 'title', rarity: 'legendary', cost: 220, effect: '夢想商店街店長等級 10 才能兌換的金色頭銜', unlock: { metric: 'street.rank', target: 10 } },
  // 寵物夥伴：顯示在名字旁、成就牆與夢想商店街
  { ...P, since: 2, id: 'pet-cat', name: '橘貓店小二 寵物', label: '橘貓店小二', category: 'pet', rarity: 'rare', cost: 120, effect: '戴小領巾的橘貓，會眨眼搖尾巴' },
  { ...P, since: 2, id: 'pet-shiba', name: '柴柴外送員 寵物', label: '柴柴外送員', category: 'pet', rarity: 'rare', cost: 120, effect: '戴安全帽的柴犬，會點頭吐舌頭' },
  { ...P, since: 2, id: 'pet-penguin', name: '企鵝收銀員 寵物', label: '企鵝收銀員', category: 'pet', rarity: 'epic', cost: 200, effect: '打著領結的企鵝，會左右搖擺揮手' },
  // 商店街裝潢：畫在自己的夢想商店街上，訪客也看得到
  { ...P, since: 2, id: 'decor-balloon', name: '彩虹氣球拱門 街景', label: '彩虹氣球拱門', category: 'decor', rarity: 'rare', cost: 120, effect: '麵包坊門口的彩虹氣球拱門，會輕輕飄動', unlock: { metric: 'street.shop_level', target: 2 } },
  { ...P, since: 2, id: 'decor-neon', name: '夜市霓虹招牌 街景', label: '夜市霓虹招牌', category: 'decor', rarity: 'epic', cost: 180, effect: '街口上方閃爍的「買 Pay 夜市」霓虹招牌', unlock: { metric: 'street.shop_level', target: 3 } },
  { ...P, since: 2, id: 'decor-fountain', name: '星光噴水池 街景', label: '星光噴水池', category: 'decor', rarity: 'legendary', cost: 260, effect: '街角廣場的噴水池，水花與星光循環噴出', unlock: { metric: 'street.shop_level', target: 4 } },
  // 方塊棋盤：方塊大挑戰的棋盤外觀
  { ...P, since: 2, id: 'board-wood', name: '木紋茶屋 方塊棋盤', label: '木紋茶屋', category: 'board', rarity: 'common', cost: 90, effect: '原木紋棋盤，四角掛著小燈籠' },
  { ...P, since: 2, id: 'board-arcade', name: '霓虹電玩 方塊棋盤', label: '霓虹電玩', category: 'board', rarity: 'rare', cost: 140, effect: '發光格線棋盤，有掃描線緩緩經過' },
  { ...P, since: 2, id: 'board-jade', name: '玉石金庫 方塊棋盤', label: '玉石金庫', category: 'board', rarity: 'epic', cost: 220, effect: '翠玉紋理棋盤，金色鉚釘邊框會反光' },
  // 遊戲背景與場景：遊樂園大廳、合成小舖與方塊大挑戰的背景
  { ...P, since: 2, id: 'scene-sakura', name: '櫻花步道 遊戲場景', label: '櫻花步道', category: 'scene', rarity: 'rare', cost: 100, effect: '遊戲背景換成櫻花步道，花瓣持續飄落' },
  { ...P, since: 2, id: 'scene-harbor', name: '海港夕陽 遊戲場景', label: '海港夕陽', category: 'scene', rarity: 'rare', cost: 120, effect: '夕陽下的港口與燈塔，海浪來回起伏' },
  { ...P, since: 2, id: 'scene-night', name: '星空夜市 遊戲場景', label: '星空夜市', category: 'scene', rarity: 'epic', cost: 180, effect: '夜市攤位剪影與滿天閃爍的星星' },
  // 個人頁面特效：個人中心與成就牆的動態特效，點一下有互動
  { ...P, since: 2, id: 'effect-snow', name: '綿綿細雪 個人頁特效', label: '綿綿細雪', category: 'effect', rarity: 'rare', cost: 100, effect: '個人頁面飄下細雪，點一下雪花散開' },
  { ...P, since: 2, id: 'effect-hearts', name: '愛心泡泡 個人頁特效', label: '愛心泡泡', category: 'effect', rarity: 'rare', cost: 120, effect: '愛心泡泡由下往上浮，點一下冒出一串愛心' },
  { ...P, since: 2, id: 'effect-coins', name: '金幣雨 個人頁特效', label: '金幣雨', category: 'effect', rarity: 'epic', cost: 200, effect: 'Pay 金幣從上方灑落，點一下金幣四散彈開' },
  // 節慶限定收藏：只在該節慶期間開放兌換，數量有限，取得後永久保留
  { ...P, since: 2, id: 'collect-newyear', name: '金馬迎春 節慶收藏', label: '金馬迎春', category: 'collection', rarity: 'legendary', cost: 168, effect: '春節限定的動態收藏徽章，展示在名字旁', sale: { kind: 'festival', festivalId: 'lunar-new-year' }, stock: 500 },
  { ...P, since: 2, id: 'collect-moon', name: '玉兔賞月 節慶收藏', label: '玉兔賞月', category: 'collection', rarity: 'legendary', cost: 168, effect: '中秋限定的動態收藏徽章，玉兔在月亮前搖耳朵', sale: { kind: 'festival', festivalId: 'mid-autumn' }, stock: 500 },
  { ...P, since: 2, id: 'collect-snowman', name: '雪人派對 節慶收藏', label: '雪人派對', category: 'collection', rarity: 'legendary', cost: 168, effect: '聖誕限定的動態收藏徽章，雪人會揮手', sale: { kind: 'festival', festivalId: 'christmas' }, stock: 500 },
  // 歷史加購包：編號與定價保留，販售由資料庫 active 關閉。聊天貼圖不再依持有判斷。
  { ...P, since: 2, id: 'sticker-party', name: '買 Pay 派對動態貼圖包', label: '派對動態貼圖', category: 'sticker', rarity: 'rare', cost: 150, effect: '已停止點數販售。既有持有紀錄保留；聊天動態貼圖改為登入即可使用。' },
] as const satisfies readonly PerkDefinition[]

export type PerkId = (typeof PERK_CATALOG)[number]['id']

export const perkDefinitionById = new Map<string, PerkDefinition>(PERK_CATALOG.map((perk) => [perk.id, perk]))

export type EquippedPerks = Partial<Record<PerkSlot, string>>

export function isPerkEquipped(equipped: EquippedPerks | undefined, perk: { id: string; category: PerkCategory }): boolean {
  return isPerkSlot(perk.category) && equipped?.[perk.category] === perk.id
}

export function perkClaimKey(perkId: string): string {
  return `perk_unlock:${perkId}`
}

export const UNLOCK_TEXT: Record<PerkUnlock['metric'], (target: number) => string> = {
  'merge.shop_level': (n) => `合成小舖升到 Lv.${n}`,
  'street.rank': (n) => `商店街店長等級 ${n}`,
  'street.shop_level': (n) => `商店街麵包坊升到 Lv.${n}`,
}
