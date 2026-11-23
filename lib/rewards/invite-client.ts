/**
 * 邀請狀態與結算都不接受前端傳入的會員、次數或邀請碼。
 * 邀請碼只在註冊當下寫進新會員資料，由資料庫觸發器留下。
 */
import { supabase } from '@/lib/supabase'
import { inviteFailureMessage, parseInviteSettlement, parseInviteStatus } from './invite-snapshot'
import { memberAccessToken } from './member-session'

export const INVITE_RPC = {
  read: 'get_my_invite_status',
  settle: 'settle_my_signup_invite',
} as const

export type { InviteSettlement, InviteStatus } from './invite-snapshot'
export { inviteFailureMessage, parseInviteSettlement, parseInviteStatus } from './invite-snapshot'

function payloadOf(data: unknown): unknown {
  return typeof data === 'string' ? JSON.parse(data) as unknown : data
}

async function callInvite<T>(rpc: string, parse: (value: unknown) => T | null, uiUserId?: string | null): Promise<{ data: T | null; error: string | null }> {
  const session = await memberAccessToken(uiUserId)
  if (!session.token) return { data: null, error: inviteFailureMessage(session.error ?? '請先登入') }
  try {
    const { data, error } = await supabase.rpc(rpc).setHeader('Authorization', `Bearer ${session.token}`)
    if (error) return { data: null, error: inviteFailureMessage(error.message) }
    const parsed = parse(payloadOf(data))
    if (!parsed) return { data: null, error: '邀請狀態無法讀取，不會增加刮卡次數' }
    return { data: parsed, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch'
    return { data: null, error: inviteFailureMessage(message) }
  }
}

export function fetchMyInviteStatus(uiUserId?: string | null) {
  return callInvite(INVITE_RPC.read, parseInviteStatus, uiUserId)
}

export function settleMySignupInvite(uiUserId?: string | null) {
  return callInvite(INVITE_RPC.settle, parseInviteSettlement, uiUserId)
}
