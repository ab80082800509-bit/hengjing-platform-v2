const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/
const REASONS = new Set(['no_signup_invite', 'registration_incomplete', 'invalid_code', 'self_invite'])

export type InviteStatus = {
  code: string
  inviteBonusToday: boolean
}

export type InviteSettlement = {
  settled: boolean
  replayed: boolean
  reason: string | null
  bonusGranted: boolean
}

export function inviteFailureMessage(message: string): string {
  if (/permission denied|42501/i.test(message)) return '邀請狀態權限不足。這不是登入狀態問題'
  if (/failed to fetch|network|timeout/i.test(message)) return '網路異常，邀請狀態暫時無法讀取'
  if (/PGRST202|schema cache|Could not find the function/i.test(message)) return '邀請功能尚未完成資料庫更新'
  if (/jwt|not authenticated|請先登入/i.test(message)) return '請先登入'
  return '邀請狀態暫時無法讀取'
}

export function parseInviteStatus(value: unknown): InviteStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.code !== 'string' || !CODE_PATTERN.test(row.code)) return null
  if (typeof row.inviteBonusToday !== 'boolean') return null
  return { code: row.code, inviteBonusToday: row.inviteBonusToday }
}

export function parseInviteSettlement(value: unknown): InviteSettlement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.settled !== 'boolean' || typeof row.replayed !== 'boolean' || typeof row.bonusGranted !== 'boolean') return null
  if (!(row.reason === null || (typeof row.reason === 'string' && REASONS.has(row.reason)))) return null
  if (row.settled && row.reason !== null) return null
  if (!row.settled && row.bonusGranted) return null
  if (row.replayed && !row.settled) return null
  return {
    settled: row.settled,
    replayed: row.replayed,
    reason: row.reason,
    bonusGranted: row.bonusGranted,
  }
}
