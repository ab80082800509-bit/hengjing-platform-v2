/**
 * 第三批刮卡開獎的對照規格。正式開獎只認 Supabase 的 scratch_award_from_units。
 * 這裡不連線，也不讀瀏覽器時間。
 *
 * 機率沿用既有展示：一般券 25%、點數 65%、創始券 5%、保底 5%。
 * 點數權重 40／30／18／9／3，對應 10、15、20、30、50。
 * 這裡只決定獎項類別。一般券是否改發商家授權券，由資料庫在開獎時判斷。
 * 沒有可發券時仍是 coupon_fallback 20 點。創始券仍是 founder_fallback 30 點。
 * 真正發券時不另贈 2 或 5 點，也不和替代點數同時發。
 * 萬分比是同一組比例的整數寫法，用來讓資料庫與測試對齊邊界。
 */

export const SCRATCH_ERRORS = {
  key: '刮卡領獎鍵必須使用資料庫台北日與次數槽',
  amount: '刮卡點數不在已確認的獎項',
  noBonus: '邀請加碼次數尚未成立',
  mismatch: '刮卡領獎必須與已鎖定的開獎結果一致',
  exhausted: '今日刮卡次數已用完',
  failed: '刮卡沒有成功，點數沒有增加',
  random: '刮卡隨機數不在可接受範圍',
  reveal: '目前沒有可揭曉的刮卡',
} as const

export const SCRATCH_POINT_VALUES = [3, 10, 15, 20, 30, 50] as const

export type ScratchPointValue = (typeof SCRATCH_POINT_VALUES)[number]

export type ScratchOutcomeKind = 'points' | 'none' | 'coupon_fallback' | 'founder_fallback'

export type ScratchAward = {
  outcomeKind: ScratchOutcomeKind
  points: ScratchPointValue
}

const CLAIM_KEY = /^scratch:(\d{4}-\d{2}-\d{2}):slot:([12])$/

export function parseScratchSlot(claimKey: string, taipeiDay: string): 1 | 2 {
  const matched = CLAIM_KEY.exec(claimKey)
  if (!matched || matched[1] !== taipeiDay) throw new Error(SCRATCH_ERRORS.key)
  return matched[2] === '1' ? 1 : 2
}

export function scratchClaimKey(taipeiDay: string, slot: 1 | 2): string {
  return `scratch:${taipeiDay}:slot:${slot}`
}

function weightedPoints(pointBp: number): 10 | 15 | 20 | 30 | 50 {
  if (pointBp < 4000) return 10
  if (pointBp < 7000) return 15
  if (pointBp < 8800) return 20
  if (pointBp < 9700) return 30
  return 50
}

export function rollScratchAwardFromBasis(kindBp: number, pointBp: number): ScratchAward {
  if (!Number.isInteger(kindBp) || !Number.isInteger(pointBp) || kindBp < 0 || kindBp > 9999 || pointBp < 0 || pointBp > 9999) {
    throw new Error(SCRATCH_ERRORS.random)
  }
  if (kindBp < 2500) return { outcomeKind: 'coupon_fallback', points: 20 }
  if (kindBp < 9000) return { outcomeKind: 'points', points: weightedPoints(pointBp) }
  if (kindBp < 9500) return { outcomeKind: 'founder_fallback', points: 30 }
  return { outcomeKind: 'none', points: 3 }
}
