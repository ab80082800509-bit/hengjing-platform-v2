/**
 * 會員獎勵請求只使用這位會員自己的 access token。
 * 沒有 session 時不送出，避免用 publishable key 冒充已登入。
 */
import { supabase } from '@/lib/supabase'

function sameMember(sessionUserId: string | null, verifiedUserId: string | null, uiUserId?: string | null): boolean | null {
  if (!sessionUserId) return uiUserId ? false : null
  if (uiUserId && uiUserId !== sessionUserId) return false
  if (!verifiedUserId) return false
  return verifiedUserId === sessionUserId
}

export async function memberAccessToken(uiUserId?: string | null): Promise<{ token: string | null; error: string | null; userMatch: boolean | null }> {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) return { token: null, error: error.message, userMatch: sameMember(null, null, uiUserId) }
    const token = data.session?.access_token
    const sessionUserId = data.session?.user?.id ?? null
    if (!token || !sessionUserId) {
      return { token: null, error: '請先登入', userMatch: sameMember(null, null, uiUserId) }
    }
    const verified = await supabase.auth.getUser(token)
    const verifiedUserId = verified.data.user?.id ?? null
    const userMatch = sameMember(sessionUserId, verifiedUserId, uiUserId)
    if (!verified.data.user || verifiedUserId !== sessionUserId) {
      const message = verified.error?.message ?? ''
      if (/failed to fetch|network|timeout/i.test(message)) return { token: null, error: message, userMatch }
      return { token: null, error: '請先登入', userMatch }
    }
    return { token, error: null, userMatch }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch'
    return { token: null, error: message, userMatch: sameMember(null, null, uiUserId) }
  }
}
