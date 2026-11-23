/**
 * 瀏覽器只呼叫會員自己的簽到入口。
 * 不傳 user_id、點數、日期或連續天數，也不在本機把餘額加上去。
 * 呼叫前先向 Supabase Auth 取得這位會員的 access token，並原樣放進 Authorization。
 * 沒有 session 時不送出請求，避免用 publishable key 冒充已登入。
 */
import { supabase } from '@/lib/supabase'
import { checkinFailureMessage, parseCheckinSnapshot, type CheckinSnapshot } from './checkin-snapshot'

export const CHECKIN_RPC = {
  claim: 'claim_my_daily_checkin',
  read: 'get_my_checkin_state',
} as const

export type { CheckinLedgerEntry, CheckinSnapshot } from './checkin-snapshot'

type CheckinAction = 'read' | 'claim'

function traceCheckin(detail: {
  action: CheckinAction
  stage: 'session' | 'user' | 'rpc'
  hasSession: boolean
  userMatch: boolean | null
  rpc: string | null
  httpStatus: number | null
  errorCode: string | null
}) {
  if (process.env.NODE_ENV !== 'development') return
  console.info('[checkin]', detail)
}

function errorParts(error: unknown): { httpStatus: number | null; errorCode: string | null } {
  if (!error || typeof error !== 'object') return { httpStatus: null, errorCode: null }
  const row = error as { status?: unknown; code?: unknown }
  return {
    httpStatus: typeof row.status === 'number' ? row.status : null,
    errorCode: typeof row.code === 'string' && row.code.length > 0 && row.code.length <= 64 ? row.code : null,
  }
}

function sameMember(sessionUserId: string | null, verifiedUserId: string | null, uiUserId?: string | null): boolean | null {
  if (!sessionUserId) return uiUserId ? false : null
  if (uiUserId && uiUserId !== sessionUserId) return false
  if (!verifiedUserId) return false
  return verifiedUserId === sessionUserId
}

async function memberAccessToken(action: CheckinAction, uiUserId?: string | null): Promise<{ token: string | null; error: string | null; userMatch: boolean | null }> {
  const rpc = action === 'claim' ? CHECKIN_RPC.claim : CHECKIN_RPC.read
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      const userMatch = sameMember(null, null, uiUserId)
      traceCheckin({ action, stage: 'session', hasSession: false, userMatch, rpc, ...errorParts(error) })
      return { token: null, error: checkinFailureMessage(error.message, action), userMatch }
    }
    const token = data.session?.access_token
    const sessionUserId = data.session?.user?.id ?? null
    if (!token || !sessionUserId) {
      const userMatch = sameMember(null, null, uiUserId)
      traceCheckin({ action, stage: 'session', hasSession: false, userMatch, rpc, httpStatus: null, errorCode: null })
      return { token: null, error: '請先登入', userMatch }
    }

    const verified = await supabase.auth.getUser(token)
    const verifiedUserId = verified.data.user?.id ?? null
    const userMatch = sameMember(sessionUserId, verifiedUserId, uiUserId)
    if (!verified.data.user || verifiedUserId !== sessionUserId) {
      const message = verified.error?.message ?? ''
      traceCheckin({
        action,
        stage: 'user',
        hasSession: true,
        userMatch,
        rpc,
        ...errorParts(verified.error),
      })
      if (/failed to fetch|network|timeout/i.test(message)) {
        return { token: null, error: checkinFailureMessage(message, action), userMatch }
      }
      return { token: null, error: '請先登入', userMatch }
    }
    return { token, error: null, userMatch }
  } catch (err) {
    const userMatch = sameMember(null, null, uiUserId)
    traceCheckin({ action, stage: 'session', hasSession: false, userMatch, rpc, httpStatus: null, errorCode: null })
    const message = err instanceof Error ? err.message : 'Failed to fetch'
    return { token: null, error: checkinFailureMessage(message, action), userMatch }
  }
}

async function callCheckin(action: CheckinAction, uiUserId?: string | null): Promise<{ data: CheckinSnapshot | null; error: string | null }> {
  const rpc = action === 'claim' ? CHECKIN_RPC.claim : CHECKIN_RPC.read
  const session = await memberAccessToken(action, uiUserId)
  if (!session.token) return { data: null, error: session.error }
  try {
    const { data, error, status } = await supabase
      .rpc(action === 'claim' ? CHECKIN_RPC.claim : CHECKIN_RPC.read)
      .setHeader('Authorization', `Bearer ${session.token}`)
    const parts = errorParts(error)
    if (error) {
      traceCheckin({
        action,
        stage: 'rpc',
        hasSession: true,
        userMatch: session.userMatch,
        rpc,
        httpStatus: typeof status === 'number' ? status : parts.httpStatus,
        errorCode: parts.errorCode,
      })
      return { data: null, error: checkinFailureMessage(error.message, action) }
    }
    traceCheckin({ action, stage: 'rpc', hasSession: true, userMatch: session.userMatch, rpc, httpStatus: typeof status === 'number' ? status : null, errorCode: null })
    const payload = typeof data === 'string' ? JSON.parse(data) as unknown : data
    const parsed = parseCheckinSnapshot(payload)
    if (!parsed) return { data: null, error: action === 'claim' ? '簽到結果不完整，點數沒有變動' : '點數資料不完整，不會顯示示範點數' }
    return { data: parsed, error: null }
  } catch {
    traceCheckin({ action, stage: 'rpc', hasSession: true, userMatch: session.userMatch, rpc, httpStatus: null, errorCode: null })
    return { data: null, error: checkinFailureMessage('Failed to fetch', action) }
  }
}

export function fetchMyCheckinState(uiUserId?: string | null): Promise<{ data: CheckinSnapshot | null; error: string | null }> {
  return callCheckin('read', uiUserId)
}

export function claimMyDailyCheckin(uiUserId?: string | null): Promise<{ data: CheckinSnapshot | null; error: string | null }> {
  return callCheckin('claim', uiUserId)
}
