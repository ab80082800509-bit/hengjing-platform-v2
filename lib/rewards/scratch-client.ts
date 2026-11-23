/**
 * 瀏覽器只呼叫沒有參數的刮卡入口。
 * 不傳會員、點數、獎項或日期，也不在本機把餘額加上去。
 */
import { supabase } from '@/lib/supabase'
import { memberAccessToken } from './member-session'
import { parseScratchSnapshot, scratchFailureMessage, type ScratchSnapshot } from './scratch-snapshot'

export const SCRATCH_RPC = {
  read: 'get_my_scratch_state',
  draw: 'draw_my_scratch_card',
  reveal: 'reveal_my_scratch_card',
} as const

type ScratchAction = 'read' | 'draw' | 'reveal'

export async function callMyScratch(action: ScratchAction, uiUserId?: string | null): Promise<{ data: ScratchSnapshot | null; error: string | null }> {
  const rpc = SCRATCH_RPC[action]
  const session = await memberAccessToken(uiUserId)
  if (!session.token) return { data: null, error: scratchFailureMessage(session.error ?? '請先登入', action) }
  try {
    const { data, error } = await supabase.rpc(rpc).setHeader('Authorization', `Bearer ${session.token}`)
    if (error) return { data: null, error: scratchFailureMessage(error.message, action) }
    const payload = typeof data === 'string' ? JSON.parse(data) as unknown : data
    const parsed = parseScratchSnapshot(payload)
    if (!parsed) {
      return {
        data: null,
        error: action === 'read' ? '刮卡狀態無法讀取。請重新整理；若次數已減少，點數已入帳' : '刮卡結果無法讀取。請重新整理；若次數已減少，點數已入帳，不會再刮一張新的',
      }
    }
    return { data: parsed, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch'
    return { data: null, error: scratchFailureMessage(message, action) }
  }
}

export function fetchMyScratchState(uiUserId?: string | null) {
  return callMyScratch('read', uiUserId)
}

export function drawMyScratchCard(uiUserId?: string | null) {
  return callMyScratch('draw', uiUserId)
}

export function revealMyScratchCard(uiUserId?: string | null) {
  return callMyScratch('reveal', uiUserId)
}
