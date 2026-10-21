type AuthLike = { message?: string; status?: number; code?: string } | null | undefined

export function signupErrorZh(error: AuthLike) {
  const message = error?.message?.trim() ?? ''
  const code = (error?.code ?? '').toLowerCase()
  const text = message.toLowerCase()
  if (
    error?.status === 429
    || code.includes('rate')
    || code.includes('over_email')
    || text.includes('rate limit')
    || text.includes('too many')
    || text.includes('email rate')
  ) {
    return '註冊暫時受到頻率限制。這通常是驗證信寄送額度或短時間註冊次數已滿，請稍後再試。正式營運需要設定自訂 SMTP，不能關閉驗證。'
  }
  if (text.includes('already registered') || text.includes('already been registered') || code.includes('user_already')) {
    return '這個 Email 已經註冊，請直接登入，或使用忘記密碼。'
  }
  if (text.includes('invalid email') || code.includes('email_address_invalid')) {
    return 'Email 格式不正確，請再確認一次。'
  }
  if (text.includes('password') && (text.includes('weak') || text.includes('short') || text.includes('at least'))) {
    return '密碼強度不足，請使用更長且不容易猜測的密碼。'
  }
  if (text.includes('signup') && text.includes('disabled')) {
    return '目前暫停開放註冊，請稍後再試。'
  }
  return message ? `註冊失敗：${message}` : '註冊失敗，請稍後再試'
}
