/**
 * 註冊前暫時記住網址上的邀請碼。
 * 這不是獎勵。點開連結不會加刮卡次數。
 * 只有註冊請求把同一個碼寫進新會員資料，資料庫才會在註冊當下留下邀請關係。
 */
const STORAGE_KEY = 'hj-signup-invite'
const CODE_PATTERN = /^[A-Z0-9]{8}$/

export function rememberSignupInvite(code: string): void {
  if (typeof window === 'undefined') return
  const normalized = code.trim().toUpperCase()
  if (!CODE_PATTERN.test(normalized)) return
  window.localStorage.setItem(STORAGE_KEY, normalized)
}

export function readSignupInvite(): string | null {
  if (typeof window === 'undefined') return null
  const value = window.localStorage.getItem(STORAGE_KEY)
  if (!value || !CODE_PATTERN.test(value)) return null
  return value
}

export function clearSignupInvite(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
}
