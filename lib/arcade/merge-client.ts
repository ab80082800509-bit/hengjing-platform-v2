/**
 * 瀏覽器只送動作種類、位置與訂單編號。
 * 不送金幣、經驗、棋盤或 Pay 點，也不把進度寫進 localStorage。
 */
import { supabase } from '@/lib/supabase'
import { memberAccessToken } from '@/lib/rewards/member-session'
import { mergeFailureMessage, parseMergeRead, type MergeRead } from './merge-snapshot'

export const MERGE_RPC = {
  read: 'get_my_merge_shop',
  act: 'apply_my_merge_shop_action',
  plan: 'get_my_game_reward_plan',
} as const

export type MergeActionName = 'start' | 'move' | 'merge' | 'spawn' | 'serve' | 'upgrade' | 'claim_quest'

export type MergeActionPayload = {
  from?: number
  to?: number
  orderId?: string
  cells?: number[]
  expectedRevision?: number
}

async function memberRpc(name: string, args: Record<string, unknown>, uiUserId?: string | null) {
  const session = await memberAccessToken(uiUserId)
  if (!session.token) return { data: null, error: mergeFailureMessage(session.error ?? '請先登入') }
  try {
    const { data, error } = await supabase.rpc(name, args).setHeader('Authorization', `Bearer ${session.token}`)
    if (error) return { data: null, error: mergeFailureMessage(error.message) }
    return { data: typeof data === 'string' ? JSON.parse(data) as unknown : data, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch'
    return { data: null, error: mergeFailureMessage(message) }
  }
}

function parsed(result: { data: unknown; error: string | null }): { data: MergeRead | null; error: string | null } {
  if (result.error) return { data: null, error: result.error }
  const snapshot = parseMergeRead(result.data)
  if (!snapshot) return { data: null, error: '遊戲進度無法讀取。請重新整理；這次沒有把數字記在這台裝置上' }
  return { data: snapshot, error: null }
}

export async function fetchMyMergeShop(uiUserId?: string | null) {
  return parsed(await memberRpc(MERGE_RPC.read, {}, uiUserId))
}

export async function applyMyMergeAction(
  actionKey: string,
  actionType: MergeActionName,
  payload: MergeActionPayload,
  uiUserId?: string | null,
) {
  return parsed(await memberRpc(MERGE_RPC.act, {
    p_action_key: actionKey,
    p_action_type: actionType,
    p_payload: payload,
  }, uiUserId))
}
