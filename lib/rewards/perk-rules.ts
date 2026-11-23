/**
 * 第五批虛擬特權的對照規格。正式扣點與入庫只認 Supabase。
 * 這裡不連線，也不能代替資料庫鎖。
 * 價格只從既有目錄讀取，呼叫端不能傳入金額。
 */
import {
  REWARD_ERRORS,
  USER_ID_PATTERN,
  assertPointBalanceCovers,
  type LedgerState,
} from './foundation'
import { isPerkSlot, perkClaimKey, perkDefinitionById, type PerkCategory, type PerkSlot } from './perk-catalog'

export const PERK_ERRORS = {
  insufficient: REWARD_ERRORS.insufficient,
  unavailable: '這個虛擬特權無法購買',
  incomplete: '虛擬特權購買沒有完成，點數與收藏都沒有變更',
  internal: '扣點只能由資料庫內部交易呼叫',
  unowned: '尚未擁有這個虛擬特權',
  slot: '裝備欄位與道具分類不符',
  login: REWARD_ERRORS.login,
} as const

const DAY = /^\d{4}-\d{2}-\d{2}$/

export type PerkHold = {
  userId: string
  perkId: string
  category: PerkCategory
  cost: number
  claimKey: string
}

export type PerkLoadout = { userId: string } & Partial<Record<PerkSlot, string>>

export type PerkInventoryState = {
  ledger: LedgerState
  holds: PerkHold[]
  loadouts: PerkLoadout[]
}

function cloneLedger(state: LedgerState): LedgerState {
  return {
    accounts: { ...state.accounts },
    entries: state.entries.map((entry) => ({ ...entry })),
    claims: state.claims.map((entry) => ({ ...entry })),
    links: state.links.map((link) => ({ ...link })),
    inviteBonuses: state.inviteBonuses.map((bonus) => ({ ...bonus })),
  }
}

function cloneInventory(state: PerkInventoryState): PerkInventoryState {
  return {
    ledger: cloneLedger(state.ledger),
    holds: state.holds.map((hold) => ({ ...hold })),
    loadouts: state.loadouts.map((loadout) => ({ ...loadout })),
  }
}

function catalogPerk(perkId: string) {
  const perk = perkDefinitionById.get(perkId)
  if (!perk) throw new Error(PERK_ERRORS.unavailable)
  return perk
}

export function emptyPerkInventory(ledger: LedgerState): PerkInventoryState {
  return { ledger, holds: [], loadouts: [] }
}

export function purchasePerk(
  state: PerkInventoryState,
  input: { userId: string; perkId: string; taipeiDay: string; internal: boolean },
): { state: PerkInventoryState; replayed: boolean; balance: number; cost: number } {
  if (!input.internal) throw new Error(PERK_ERRORS.internal)
  if (!USER_ID_PATTERN.test(input.userId)) throw new Error(REWARD_ERRORS.missingUser)
  if (!DAY.test(input.taipeiDay)) throw new Error(PERK_ERRORS.unavailable)
  const perk = catalogPerk(input.perkId)
  const claimKey = perkClaimKey(perk.id)
  const hold = state.holds.find((item) => item.userId === input.userId && item.perkId === perk.id)
  const claim = state.ledger.claims.find((item) => item.userId === input.userId && item.claimKey === claimKey)
  const current = state.ledger.accounts[input.userId] ?? 0
  if (hold || claim) {
    if (!hold || !claim || hold.category !== perk.category || claim.kind !== 'perk_unlock' || claim.delta !== -hold.cost || claim.claimKey !== hold.claimKey) {
      throw new Error(PERK_ERRORS.incomplete)
    }
    return { state, replayed: true, balance: current, cost: hold.cost }
  }
  const balance = assertPointBalanceCovers(current, -perk.cost)
  const next = cloneInventory(state)
  const entry = {
    userId: input.userId,
    kind: 'perk_unlock' as const,
    claimKey,
    delta: -perk.cost,
    balanceAfter: balance,
    taipeiDay: input.taipeiDay,
  }
  next.ledger.accounts[input.userId] = balance
  next.ledger.entries.push(entry)
  next.ledger.claims.push({ ...entry })
  next.holds.push({
    userId: input.userId,
    perkId: perk.id,
    category: perk.category,
    cost: perk.cost,
    claimKey,
  })
  return { state: next, replayed: false, balance, cost: perk.cost }
}

function loadoutFor(state: PerkInventoryState, userId: string): PerkLoadout {
  return state.loadouts.find((item) => item.userId === userId) ?? { userId }
}

export function setPerkEquipped(
  state: PerkInventoryState,
  input: { userId: string; perkId: string; equipped: boolean },
): { state: PerkInventoryState; replayed: boolean } {
  if (!USER_ID_PATTERN.test(input.userId)) throw new Error(REWARD_ERRORS.missingUser)
  const perk = catalogPerk(input.perkId)
  const slot0 = perk.category
  if (!isPerkSlot(slot0)) throw new Error(PERK_ERRORS.slot)
  const hold = state.holds.find((item) => item.userId === input.userId && item.perkId === perk.id)
  if (!hold || hold.category !== perk.category) throw new Error(PERK_ERRORS.unowned)
  const current = loadoutFor(state, input.userId)
  const slot = current[slot0]
  if (input.equipped && slot === perk.id) return { state, replayed: true }
  if (!input.equipped && slot !== perk.id) return { state, replayed: true }
  const next = cloneInventory(state)
  const loadout = next.loadouts.find((item) => item.userId === input.userId)
  const updated: PerkLoadout = { ...(loadout ?? { userId: input.userId }) }
  if (input.equipped) updated[slot0] = perk.id
  else delete updated[slot0]
  if (loadout) {
    const index = next.loadouts.findIndex((item) => item.userId === input.userId)
    next.loadouts[index] = updated
  } else {
    next.loadouts.push(updated)
  }
  return { state: next, replayed: false }
}
