import { PERK_SLOTS, perkDefinitionById, type EquippedPerks, type PerkSlot } from './perk-catalog'

export type PerkSnapshot = {
  replayed: boolean
  balance: number
  owned: string[]
  equipped: EquippedPerks
}

const SLOT_KEYS: readonly PerkSlot[] = PERK_SLOTS

export function parseEquippedPerks(value: unknown): EquippedPerks | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const equipped: EquippedPerks = {}
  for (const key of SLOT_KEYS) {
    const id = row[key]
    if (id == null || id === '') continue
    if (typeof id !== 'string') return undefined
    const perk = perkDefinitionById.get(id)
    if (!perk || perk.category !== key) return undefined
    equipped[key] = id
  }
  return Object.keys(equipped).length ? equipped : undefined
}

export function parsePerkSnapshot(value: unknown): PerkSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.balance !== 'number' || !Number.isInteger(row.balance) || row.balance < 0) return null
  if (!Array.isArray(row.owned)) return null
  const owned: string[] = []
  for (const id of row.owned) {
    if (typeof id !== 'string' || !perkDefinitionById.has(id) || owned.includes(id)) return null
    owned.push(id)
  }
  const equipped = parseEquippedPerks(row.equipped ?? {}) ?? {}
  for (const key of SLOT_KEYS) {
    const id = equipped[key]
    if (id && !owned.includes(id)) return null
  }
  return {
    replayed: row.replayed === true,
    balance: row.balance,
    owned,
    equipped,
  }
}

/** 公開裝備。stickers 只反映既有貼圖包持有紀錄，不再決定貼圖能不能播放。 */
export type PublicLoadout = EquippedPerks & { stickers?: string[] }

export function parsePublicLoadouts(value: unknown): Record<string, PublicLoadout> | null {
  if (!Array.isArray(value)) return null
  const loadouts: Record<string, PublicLoadout> = {}
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const row = item as Record<string, unknown>
    if (typeof row.userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(row.userId)) return null
    const equipped: PublicLoadout = { ...(parseEquippedPerks(row) ?? {}) }
    if (Array.isArray(row.stickers)) {
      const packs = row.stickers.filter((id): id is string => typeof id === 'string' && perkDefinitionById.get(id)?.category === 'sticker')
      if (packs.length) equipped.stickers = packs
    }
    if (Object.keys(equipped).length) loadouts[row.userId] = equipped
  }
  return loadouts
}

export function perkFailureMessage(message: string, action: 'read' | 'purchase' | 'equip'): string {
  if (/failed to fetch|network|fetch|timeout/i.test(message)) {
    if (action === 'purchase') return '網路異常，虛擬特權沒有購買，點數沒有變動'
    if (action === 'equip') return '網路異常，裝備沒有變更'
    return '網路異常，收藏庫暫時無法讀取'
  }
  if (/jwt|not authenticated|permission denied|請先登入/i.test(message)) return '請先登入'
  if (/PGRST202|schema cache|Could not find the function/i.test(message)) {
    return action === 'equip'
      ? '虛擬特權尚未完成資料庫更新，裝備沒有變更'
      : '虛擬特權尚未完成資料庫更新，點數沒有變動'
  }
  if (message.includes('虛擬特權購買尚未開放')) return '虛擬特權購買尚未開放'
  if (message.includes('點數不足')) return '點數不足'
  if (message.includes('尚未達成解鎖條件')) return '尚未達成解鎖條件，點數沒有變動'
  if (message.includes('不在販售期間')) return '這件收藏不在販售期間，點數沒有變動'
  if (message.includes('已經兌換完畢')) return '這件收藏已經兌換完畢，點數沒有變動'
  if (message.includes('不需要裝備')) return '這件收藏擁有就能使用，不需要裝備'
  if (message.includes('尚未擁有這個虛擬特權')) return '尚未擁有這個虛擬特權'
  if (message.includes('這個虛擬特權無法購買') || message.includes('這個虛擬特權無法裝備')) return '這個虛擬特權無法購買'
  if (message.includes('虛擬特權購買沒有完成')) return '虛擬特權購買沒有完成，點數與收藏都沒有變更'
  if (message.includes('同一領獎鍵不可改寫')) return '虛擬特權購買沒有完成，點數與收藏都沒有變更'
  return action === 'purchase'
    ? '虛擬特權購買沒有完成，點數與收藏都沒有變更'
    : action === 'equip'
      ? '裝備沒有變更'
      : '收藏庫暫時無法讀取。請重新整理；已經買到的特權不會消失'
}
