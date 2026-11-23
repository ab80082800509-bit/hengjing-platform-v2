/**
 * 瀏覽器只呼叫虛擬特權入口。
 * 不傳會員編號、點數金額或庫存增量，也不在本機改餘額。
 */
import { supabase } from '@/lib/supabase'
import { memberAccessToken } from './member-session'
import {
  parsePerkSnapshot,
  parsePublicLoadouts,
  perkFailureMessage,
  type PerkSnapshot,
  type PublicLoadout,
} from './perk-snapshot'

async function memberRpc(
  name: string,
  args: Record<string, unknown>,
  action: 'read' | 'purchase' | 'equip',
  uiUserId?: string | null,
): Promise<{ data: unknown; error: string | null }> {
  const session = await memberAccessToken(uiUserId)
  if (!session.token) return { data: null, error: perkFailureMessage(session.error ?? '請先登入', action) }
  try {
    const { data, error } = await supabase.rpc(name, args).setHeader('Authorization', `Bearer ${session.token}`)
    if (error) return { data: null, error: perkFailureMessage(error.message, action) }
    return { data: typeof data === 'string' ? JSON.parse(data) as unknown : data, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch'
    return { data: null, error: perkFailureMessage(message, action) }
  }
}

function parsed(result: { data: unknown; error: string | null }, action: 'read' | 'purchase' | 'equip'): { data: PerkSnapshot | null; error: string | null } {
  if (result.error) return { data: null, error: result.error }
  const snapshot = parsePerkSnapshot(result.data)
  if (!snapshot) {
    return {
      data: null,
      error: action === 'purchase'
        ? '購買結果無法讀取。請重新整理；若點數已扣，特權會在收藏庫，不會再扣一次'
        : '收藏庫無法讀取。請重新整理；已經買到的特權不會消失',
    }
  }
  return { data: snapshot, error: null }
}

export async function fetchMyPerks(uiUserId?: string | null): Promise<{ data: PerkSnapshot | null; error: string | null }> {
  return parsed(await memberRpc('list_my_perks', {}, 'read', uiUserId), 'read')
}

export async function purchaseMyPerk(perkId: string, uiUserId?: string | null): Promise<{ data: PerkSnapshot | null; error: string | null }> {
  return parsed(await memberRpc('purchase_my_perk', { p_perk_id: perkId }, 'purchase', uiUserId), 'purchase')
}

export async function setMyPerkEquipped(
  perkId: string,
  equipped: boolean,
  uiUserId?: string | null,
): Promise<{ data: PerkSnapshot | null; error: string | null }> {
  return parsed(await memberRpc('set_my_perk_equipped', { p_perk_id: perkId, p_equipped: equipped }, 'equip', uiUserId), 'equip')
}

export async function fetchPublicEquippedPerks(userIds: string[]): Promise<Record<string, PublicLoadout> | null> {
  const ids = [...new Set(userIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 40)
  if (!ids.length) return {}
  try {
    const { data, error } = await supabase.rpc('public_equipped_perks', { p_user_ids: ids })
    if (error) return null
    const payload = typeof data === 'string' ? JSON.parse(data) as unknown : data
    return parsePublicLoadouts(payload)
  } catch {
    return null
  }
}
