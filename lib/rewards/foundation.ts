/**
 * 第四、第五階段第一批的發獎規格。第三批只追加刮卡來源。
 *
 * 真正入帳的是 Supabase 交易裡的 public.post_member_reward。
 * 這個檔案不連線、不寫入瀏覽器狀態，也不能代替資料庫鎖。
 * 進站點擊不是成功註冊，也不在這裡發獎。
 */
import { PERK_CATALOG } from './perk-catalog'
import { SCRATCH_ERRORS, SCRATCH_POINT_VALUES, parseScratchSlot } from './scratch-rules'
import { TAIPEI_TIME_ZONE } from './taipei-day'

export { TAIPEI_TIME_ZONE }

export const REWARD_DATABASE = 'supabase' as const

export const REWARD_RPC = {
  post: 'post_member_reward',
  read: 'get_my_reward_account',
  linkVisitor: 'link_my_visitor',
  taipeiToday: 'taipei_today',
} as const

export const CHECKIN_REWARDS = [10, 10, 15, 15, 20, 20, 50] as const

export const CHECKIN_POINT_VALUES = [10, 15, 20, 50] as const

export const REWARD_KINDS = ['checkin', 'scratch', 'coupon_exchange', 'perk_unlock'] as const

export const OPEN_REWARD_KINDS = ['checkin', 'scratch'] as const

export type RewardKind = (typeof REWARD_KINDS)[number]

export const VISITOR_ID_PATTERN = /^[a-f0-9]{32}$/

export const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const KNOWN_PERKS = PERK_CATALOG.map((perk) => ({
  id: perk.id,
  category: perk.category,
  cost: perk.cost,
}))

export const REWARD_ERRORS = {
  browser: '點數與獎勵不能在瀏覽器入帳',
  internalOnly: '發獎只能由資料庫內部交易呼叫',
  missingUser: '找不到會員',
  badMetadata: '獎勵附註必須是物件',
  metadataSize: '獎勵附註過長',
  integer: '點數必須是整數',
  checkinKey: '簽到領獎鍵必須使用資料庫台北日',
  checkinAmount: '簽到點數必須是已確認的 10、15、20 或 50',
  closedKind: '這個獎勵來源尚未開放入帳',
  unknownKind: '尚未開放這個獎勵來源',
  rewrite: '同一領獎鍵不可改寫來源或點數',
  sameDay: '同一天不能重複簽到',
  insufficient: '點數不足',
  immutable: '點數流水與領獎紀錄不可修改或刪除',
  balanceDrift: '點數餘額與流水不一致',
  balanceFlag: '點數餘額只能由發獎交易更新',
  accountDelete: '點數帳戶不可刪除',
  accountUser: '不能變更點數帳戶的會員',
  claimMismatch: '領獎紀錄與點數流水不一致',
  entryWithoutClaim: '點數流水缺少領獎紀錄',
  missingEntry: '領獎紀錄缺少點數流水',
  accountLock: '無法鎖定點數帳戶',
  visitorFormat: '訪客身分格式不正確',
  visitorTaken: '這個訪客身分已經綁定其他會員',
  visitorBind: '無法完成訪客綁定',
  login: '請先登入',
} as const

const METADATA_MAX_BYTES = 1024

export type LedgerEntry = {
  userId: string
  kind: RewardKind
  claimKey: string
  delta: number
  balanceAfter: number
  taipeiDay: string
}

export type VisitorLink = {
  userId: string
  visitorId: string
}

export type InviteBonus = {
  userId: string
  taipeiDay: string
}

export type LedgerState = {
  accounts: Record<string, number>
  entries: LedgerEntry[]
  claims: LedgerEntry[]
  links: VisitorLink[]
  inviteBonuses: InviteBonus[]
}

export type RewardPostInput = {
  userId: string
  kind: string
  claimKey: string
  delta: number
  metadata?: unknown
  internal: boolean
}

export type RewardPostResult = {
  replayed: boolean
  delta: number
  balanceAfter: number
  currentBalance: number
  taipeiDay: string
  kind: RewardKind
  claimKey: string
}

export function emptyLedger(): LedgerState {
  return { accounts: {}, entries: [], claims: [], links: [], inviteBonuses: [] }
}

export function assertRewardWriteStaysOffBrowser(): void {
  if (typeof window !== 'undefined') throw new Error(REWARD_ERRORS.browser)
}

export function assertPointBalanceCovers(balance: number, delta: number): number {
  if (!Number.isInteger(balance) || !Number.isInteger(delta)) throw new Error(REWARD_ERRORS.integer)
  const next = balance + delta
  if (next < 0) throw new Error(REWARD_ERRORS.insufficient)
  return next
}

export function checkinClaimKey(taipeiDay: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(taipeiDay)) throw new Error(REWARD_ERRORS.checkinKey)
  return `checkin:${taipeiDay}`
}

function assertMetadata(metadata: unknown): void {
  if (metadata === undefined) return
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(REWARD_ERRORS.badMetadata)
  }
  if (new TextEncoder().encode(JSON.stringify(metadata)).length > METADATA_MAX_BYTES) {
    throw new Error(REWARD_ERRORS.metadataSize)
  }
}

function cloneState(state: LedgerState): LedgerState {
  return {
    accounts: { ...state.accounts },
    entries: state.entries.map((entry) => ({ ...entry })),
    claims: state.claims.map((entry) => ({ ...entry })),
    links: state.links.map((link) => ({ ...link })),
    inviteBonuses: state.inviteBonuses.map((bonus) => ({ ...bonus })),
  }
}

function assertInvariant(state: LedgerState): void {
  const users = new Set([
    ...Object.keys(state.accounts),
    ...state.entries.map((entry) => entry.userId),
    ...state.claims.map((entry) => entry.userId),
  ])
  for (const userId of users) {
    const balance = state.accounts[userId] ?? 0
    const summed = state.entries.filter((entry) => entry.userId === userId).reduce((sum, entry) => sum + entry.delta, 0)
    if (summed !== balance) throw new Error(REWARD_ERRORS.balanceDrift)
  }
  for (const claim of state.claims) {
    const entry = state.entries.find(
      (item) => item.userId === claim.userId && item.claimKey === claim.claimKey && item.kind === claim.kind,
    )
    if (!entry || entry.delta !== claim.delta || entry.balanceAfter !== claim.balanceAfter || entry.taipeiDay !== claim.taipeiDay) {
      throw new Error(REWARD_ERRORS.claimMismatch)
    }
  }
  for (const entry of state.entries) {
    if (!state.claims.some((claim) => claim.userId === entry.userId && claim.claimKey === entry.claimKey)) {
      throw new Error(REWARD_ERRORS.entryWithoutClaim)
    }
  }
}

/**
 * post_member_reward 的單執行緒規格。
 * taipeiDay 代表資料庫 public.taipei_today() 的結果，呼叫端不能用它向正式函式指定日期。
 * 正式 SQL 沒有時間參數。
 */
export function applyRewardClaimSpec(
  state: LedgerState,
  input: RewardPostInput,
  taipeiDay: string,
): { state: LedgerState; result: RewardPostResult } {
  if (!input.internal) throw new Error(REWARD_ERRORS.internalOnly)
  if (!USER_ID_PATTERN.test(input.userId)) throw new Error(REWARD_ERRORS.missingUser)
  assertMetadata(input.metadata)
  if (!REWARD_KINDS.includes(input.kind as RewardKind)) throw new Error(REWARD_ERRORS.unknownKind)
  if (!OPEN_REWARD_KINDS.includes(input.kind as (typeof OPEN_REWARD_KINDS)[number])) {
    throw new Error(REWARD_ERRORS.closedKind)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(taipeiDay)) throw new Error(REWARD_ERRORS.checkinKey)
  if (input.kind === 'checkin') {
    if (input.claimKey !== checkinClaimKey(taipeiDay)) throw new Error(REWARD_ERRORS.checkinKey)
    if (!CHECKIN_POINT_VALUES.includes(input.delta as (typeof CHECKIN_POINT_VALUES)[number])) {
      throw new Error(REWARD_ERRORS.checkinAmount)
    }
  }
  if (input.kind === 'scratch') {
    const slot = parseScratchSlot(input.claimKey, taipeiDay)
    if (!(SCRATCH_POINT_VALUES as readonly number[]).includes(input.delta)) throw new Error(SCRATCH_ERRORS.amount)
    if (slot === 2 && !state.inviteBonuses.some((bonus) => bonus.userId === input.userId && bonus.taipeiDay === taipeiDay)) {
      throw new Error(SCRATCH_ERRORS.noBonus)
    }
  }

  const next = cloneState(state)
  const sameKey = next.claims.find((claim) => claim.userId === input.userId && claim.claimKey === input.claimKey)
  if (sameKey) {
    if (sameKey.kind !== input.kind || sameKey.delta !== input.delta) throw new Error(REWARD_ERRORS.rewrite)
    const currentBalance = next.accounts[input.userId] ?? 0
    return {
      state,
      result: {
        replayed: true,
        delta: sameKey.delta,
        balanceAfter: sameKey.balanceAfter,
        currentBalance,
        taipeiDay: sameKey.taipeiDay,
        kind: sameKey.kind,
        claimKey: sameKey.claimKey,
      },
    }
  }
  if (input.kind === 'checkin' && next.claims.some((claim) => claim.userId === input.userId && claim.kind === 'checkin' && claim.taipeiDay === taipeiDay)) {
    throw new Error(REWARD_ERRORS.sameDay)
  }

  const current = next.accounts[input.userId] ?? 0
  const balanceAfter = assertPointBalanceCovers(current, input.delta)
  const entry: LedgerEntry = {
    userId: input.userId,
    kind: input.kind as RewardKind,
    claimKey: input.claimKey,
    delta: input.delta,
    balanceAfter,
    taipeiDay,
  }
  next.accounts[input.userId] = balanceAfter
  next.entries.push(entry)
  next.claims.push({ ...entry })
  assertInvariant(next)
  return {
    state: next,
    result: {
      replayed: false,
      delta: input.delta,
      balanceAfter,
      currentBalance: balanceAfter,
      taipeiDay,
      kind: input.kind as RewardKind,
      claimKey: input.claimKey,
    },
  }
}

export function linkVisitorSpec(
  state: LedgerState,
  userId: string,
  visitorId: string,
): { state: LedgerState; result: { linked: true; replayed: boolean } } {
  if (!USER_ID_PATTERN.test(userId)) throw new Error(REWARD_ERRORS.missingUser)
  if (!VISITOR_ID_PATTERN.test(visitorId)) throw new Error(REWARD_ERRORS.visitorFormat)
  const existing = state.links.find((link) => link.visitorId === visitorId)
  if (existing) {
    if (existing.userId !== userId) throw new Error(REWARD_ERRORS.visitorTaken)
    return { state, result: { linked: true, replayed: true } }
  }
  const next = cloneState(state)
  next.links.push({ userId, visitorId })
  return { state: next, result: { linked: true, replayed: false } }
}

/** 規格裡的當日邀請加碼。不發點數。正式資料只由 settle_my_signup_invite 寫入。 */
export function noteInviteBonus(state: LedgerState, userId: string, taipeiDay: string): LedgerState {
  if (!USER_ID_PATTERN.test(userId)) throw new Error(REWARD_ERRORS.missingUser)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(taipeiDay)) throw new Error(SCRATCH_ERRORS.key)
  if (state.inviteBonuses.some((bonus) => bonus.userId === userId && bonus.taipeiDay === taipeiDay)) return state
  const next = cloneState(state)
  next.inviteBonuses.push({ userId, taipeiDay })
  return next
}
