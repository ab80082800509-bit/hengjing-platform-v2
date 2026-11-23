/**
 * 第六階段三款遊戲的 Pay 點數規劃。
 * 額度尚未正式簽核，這支檔案不能入帳，也不讀寫第四階段點數帳本。
 * 刮刮卡維持原本規則，不計入這裡的每日 10 點。
 */
export const GAME_REWARD_GAMES = ['merge_shop', 'block_challenge', 'dream_street'] as const

export type GameRewardId = (typeof GAME_REWARD_GAMES)[number]

export const GAME_REWARD_APPROVAL = 'pending_approval' as const

export const GAME_REWARD_PAYOUT_ENABLED = false as const

/** 尚未簽核的規劃額度，不是已核准的營運數字。 */
export const GAME_REWARD_PLAN = {
  dailyCap: 10,
  weeklyQuest: 10,
  weeklyCap: 80,
  scratchExcluded: true,
} as const

export const GAME_REWARD_ERRORS = {
  unapproved: '遊戲 Pay 點數尚未正式簽核，不能入帳',
  secondLedger: '不能為遊戲另建 Pay 點數帳本',
} as const

export type GameRewardProgress = {
  payoutEnabled: false
  approval: typeof GAME_REWARD_APPROVAL
  issuedPayPoints: null
  dailyCap: number
  weeklyQuest: number
  weeklyCap: number
  scratchExcluded: true
  games: readonly GameRewardId[]
  label: string
}

export function gameRewardProgress(): GameRewardProgress {
  return {
    payoutEnabled: false,
    approval: GAME_REWARD_APPROVAL,
    issuedPayPoints: null,
    dailyCap: GAME_REWARD_PLAN.dailyCap,
    weeklyQuest: GAME_REWARD_PLAN.weeklyQuest,
    weeklyCap: GAME_REWARD_PLAN.weeklyCap,
    scratchExcluded: true,
    games: GAME_REWARD_GAMES,
    label: 'Pay 點數獎勵尚未正式簽核，目前不會發放',
  }
}

export function rejectGamePayPayout(_points: number, _claimKey: string): never {
  throw new Error(GAME_REWARD_ERRORS.unapproved)
}
