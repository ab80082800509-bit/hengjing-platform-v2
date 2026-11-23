/** 通知入帳只接受隔離庫。正式 Supabase 與其他主機直接拒絕。 */
export function isolatedSellerPaymentDatabaseUrl(value: string | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    const localHost = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    const localDb = (url.protocol === 'postgres:' || url.protocol === 'postgresql:') && localHost && url.port === '54322' && url.pathname === '/postgres'
    return localDb ? value : null
  } catch {
    return null
  }
}

export function newebpayTestCredentials(env: Record<string, string | undefined>) {
  const merchantId = env.NEWEBPAY_MERCHANT_ID?.trim() ?? ''
  const hashKey = env.NEWEBPAY_HASH_KEY?.trim() ?? ''
  const hashIv = env.NEWEBPAY_HASH_IV?.trim() ?? ''
  return merchantId !== '' && hashKey !== '' && hashIv !== ''
}
