/**
 * 買 Pay 原創動態貼圖，只在站內聊天使用，不是 LINE 貼圖。
 * 前 12 張沿用夢想商店街已核可的 Q 版居民立繪。
 * 後 18 張是 Pay 袋仔，使用 pay-bag-mascot 的水平雙格素材。
 *
 * 聊天訊息本文存成 [[sticker:代號]]；舊版畫面會看到這段文字，不會壞。
 * 已收錄的貼圖登入聊天即可選取與播放，不看貼圖包持有、點數或 Inventory。
 * 偽造代號只會顯示成一般文字。
 */
export type StickerPack = 'base' | 'sticker-party' | 'pay-bag'

export type StickerMotion = 'bounce' | 'wave' | 'nod' | 'jump' | 'sway' | 'spin'
export type StickerProp = 'heart' | 'check' | 'star' | 'clock' | 'coin' | 'moon' | 'cake' | 'cheers' | 'confetti' | 'flag' | 'gift' | 'coins'

type CastSticker = {
  kind: 'cast'
  id: string
  pack: 'base' | 'sticker-party'
  /** 夢想商店街居民編號 0～11 */
  cast: number
  caption: string
  motion: StickerMotion
  prop: StickerProp
}

type PayBagSticker = {
  kind: 'pay-bag'
  id: string
  pack: 'pay-bag'
  caption: string
  /** 水平雙格原圖。左格第 1 幀，右格第 2 幀。 */
  sheet: string
}

export type StickerDef = CastSticker | PayBagSticker

const PAY_BAG: readonly PayBagSticker[] = [
  ['pay-hello', '你好呀'],
  ['pay-morning', '早安！'],
  ['pay-goodbye', '再見～'],
  ['pay-check', '幫你查詢'],
  ['pay-wait', '請稍等'],
  ['pay-no-problem', '沒問題'],
  ['pay-sorry', '真的抱歉'],
  ['pay-spec', '確認規格'],
  ['pay-quote', '這是報價'],
  ['pay-shipped', '已出貨'],
  ['pay-package-sent', '包裹送出'],
  ['pay-call', '電話聯絡'],
  ['pay-thanks', '非常感謝'],
  ['pay-hardwork', '辛苦了'],
  ['pay-cheer', '加油！'],
  ['pay-countdown', '倒數開始'],
  ['pay-awesome', '太棒了！'],
  ['pay-congrats', '恭喜完成'],
].map(([id, caption]) => ({
  kind: 'pay-bag' as const,
  id,
  pack: 'pay-bag' as const,
  caption,
  sheet: `/stickers/pay-bag/${id}.png`,
}))

export const STICKERS: readonly StickerDef[] = [
  { kind: 'cast', id: 'base-thanks', pack: 'base', cast: 0, caption: '謝謝！', motion: 'bounce', prop: 'heart' },
  { kind: 'cast', id: 'base-ok', pack: 'base', cast: 3, caption: '收到', motion: 'nod', prop: 'check' },
  { kind: 'cast', id: 'base-great', pack: 'base', cast: 4, caption: '讚啦', motion: 'jump', prop: 'star' },
  { kind: 'cast', id: 'base-wait', pack: 'base', cast: 1, caption: '等我一下', motion: 'sway', prop: 'clock' },
  { kind: 'cast', id: 'base-deal', pack: 'base', cast: 2, caption: '成交！', motion: 'bounce', prop: 'coin' },
  { kind: 'cast', id: 'base-night', pack: 'base', cast: 5, caption: '晚安', motion: 'sway', prop: 'moon' },
  { kind: 'cast', id: 'party-birthday', pack: 'sticker-party', cast: 6, caption: '生日快樂', motion: 'jump', prop: 'cake' },
  { kind: 'cast', id: 'party-cheers', pack: 'sticker-party', cast: 7, caption: '乾杯！', motion: 'wave', prop: 'cheers' },
  { kind: 'cast', id: 'party-confetti', pack: 'sticker-party', cast: 8, caption: '灑花～', motion: 'spin', prop: 'confetti' },
  { kind: 'cast', id: 'party-go', pack: 'sticker-party', cast: 9, caption: '衝啊！', motion: 'jump', prop: 'flag' },
  { kind: 'cast', id: 'party-gift', pack: 'sticker-party', cast: 10, caption: '送你禮物', motion: 'bounce', prop: 'gift' },
  { kind: 'cast', id: 'party-rich', pack: 'sticker-party', cast: 11, caption: '發大財', motion: 'wave', prop: 'coins' },
  ...PAY_BAG,
]

export const stickerById = new Map(STICKERS.map((sticker) => [sticker.id, sticker]))

const TOKEN = /^\[\[sticker:([a-z0-9-]{2,32})\]\]$/

export function stickerToken(id: string): string {
  return `[[sticker:${id}]]`
}

export function parseStickerMessage(body: string): StickerDef | null {
  const match = TOKEN.exec(body.trim())
  return match ? stickerById.get(match[1]) ?? null : null
}

/** 已收錄的貼圖都可播放。未知代號不會進到這裡，呼叫端會把它留成一般文字。 */
export function stickerUsable(sticker: StickerDef, _ownedPacks?: readonly string[]): boolean {
  return stickerById.has(sticker.id)
}

/** 聊天列表的最後一則訊息預覽。 */
export function stickerPreviewText(body: string): string {
  const sticker = parseStickerMessage(body)
  return sticker ? `［貼圖］${sticker.caption}` : body
}
