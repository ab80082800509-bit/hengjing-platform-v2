import { createCipheriv, createDecipheriv, createHash, timingSafeEqual } from 'node:crypto'

/** 藍新 MPG 測試環境。正式環境網址不在這支使用。 */
export const NEWEBPAY_TEST_GATEWAY = 'https://ccore.newebpay.com/MPG/mpg_gateway'

export const NEWEBPAY_SAMPLE_KEY = '12345678901234567890123456789012'
export const NEWEBPAY_SAMPLE_IV = '1234567890123456'
export const NEWEBPAY_SAMPLE_QUERY =
  'MerchantID=3430112&RespondType=JSON&TimeStamp=1485232229&Version=1.4&MerchantOrderNo=S_1485232229&Amt=40&ItemDesc=UnitTest'

/** 定案後的賣家月費，藍新 MPG 只使用這個整數 Amt。 */
export const SELLER_SUBSCRIPTION_MPG_AMT = 420

export function mpgTradeQuery(fields: {
  merchantId: string
  timeStamp: string
  merchantOrderNo: string
  amt: number
  itemDesc: string
}) {
  if (fields.amt !== SELLER_SUBSCRIPTION_MPG_AMT) {
    throw new Error('藍新 Amt 只使用定案的 420')
  }
  return [
    ['MerchantID', fields.merchantId],
    ['RespondType', 'JSON'],
    ['TimeStamp', fields.timeStamp],
    ['Version', '1.6'],
    ['MerchantOrderNo', fields.merchantOrderNo],
    ['Amt', String(SELLER_SUBSCRIPTION_MPG_AMT)],
    ['ItemDesc', fields.itemDesc],
  ].map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%20/g, '+')}`).join('&')
}

const BLOCK = 32

function pkcs7Pad(data: Buffer) {
  const pad = BLOCK - (data.length % BLOCK)
  return Buffer.concat([data, Buffer.alloc(pad, pad)])
}

function pkcs7Unpad(data: Buffer) {
  const pad = data[data.length - 1] ?? 0
  if (pad < 1 || pad > BLOCK || data.length < pad) return null
  for (let i = data.length - pad; i < data.length; i += 1) {
    if (data[i] !== pad) return null
  }
  return data.subarray(0, data.length - pad)
}

export function encryptTradeInfo(plain: string, key: string, iv: string) {
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(pkcs7Pad(Buffer.from(plain, 'utf8'))), cipher.final()]).toString('hex')
}

export function decryptTradeInfo(hex: string, key: string, iv: string) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null
  const decipher = createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
  decipher.setAutoPadding(false)
  const padded = Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()])
  const plain = pkcs7Unpad(padded)
  return plain ? plain.toString('utf8') : null
}

export function tradeSha(tradeInfo: string, key: string, iv: string) {
  return createHash('sha256').update(`HashKey=${key}&${tradeInfo}&HashIV=${iv}`, 'utf8').digest('hex').toUpperCase()
}

function sameText(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type NewebpayFields = {
  Status: string
  MerchantID: string
  TradeInfo: string
  TradeSha: string
  Version: string
}

export type VerifiedNewebpayNotice = {
  verified: true
  outerStatus: string
  outerMerchantId: string
  resultStatus: string
  resultMerchantId: string
  merchantOrderNo: string
  amt: string
  tradeNo: string
  paymentType: string
  payTime: string
  tradeSha: string
  message: string
}

export type NewebpayNoticeResult =
  | { ok: true; payload: VerifiedNewebpayNotice }
  | { ok: false; code: 'bad_signature' | 'bad_payload' | 'merchant_mismatch' | 'unsupported_format' }

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function amtToken(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'string') return value.trim()
  return ''
}

/** 先核對 TradeSha，再解密。簽章不符時不把內容交給入帳。 */
export function readNewebpayNotice(
  fields: NewebpayFields,
  key: string,
  iv: string,
  expectedMerchantId: string,
): NewebpayNoticeResult {
  const tradeInfo = fields.TradeInfo.trim()
  const tradeShaValue = fields.TradeSha.trim().toUpperCase()
  if (!tradeInfo || !/^[0-9A-F]{64}$/.test(tradeShaValue) || tradeInfo.length > 12000) {
    return { ok: false, code: 'bad_payload' }
  }
  if (!sameText(tradeShaValue, tradeSha(tradeInfo, key, iv))) {
    return { ok: false, code: 'bad_signature' }
  }
  if (fields.MerchantID.trim() !== expectedMerchantId) {
    return { ok: false, code: 'merchant_mismatch' }
  }
  const plain = decryptTradeInfo(tradeInfo, key, iv)
  if (!plain) return { ok: false, code: 'bad_payload' }
  let parsed: unknown
  try {
    parsed = JSON.parse(plain)
  } catch {
    return { ok: false, code: 'unsupported_format' }
  }
  if (!parsed || typeof parsed !== 'object' || !('Result' in parsed)) {
    return { ok: false, code: 'unsupported_format' }
  }
  const body = parsed as { Status?: unknown; Message?: unknown; Result?: unknown }
  const result = body.Result
  if (!result || typeof result !== 'object') return { ok: false, code: 'unsupported_format' }
  const row = result as Record<string, unknown>
  const resultMerchantId = text(row.MerchantID)
  const merchantOrderNo = text(row.MerchantOrderNo)
  if (!resultMerchantId || !merchantOrderNo) return { ok: false, code: 'bad_payload' }
  if (resultMerchantId !== expectedMerchantId) return { ok: false, code: 'merchant_mismatch' }
  return {
    ok: true,
    payload: {
      verified: true,
      outerStatus: fields.Status.trim(),
      outerMerchantId: fields.MerchantID.trim(),
      resultStatus: text(body.Status),
      resultMerchantId,
      merchantOrderNo,
      amt: amtToken(row.Amt),
      tradeNo: text(row.TradeNo),
      paymentType: text(row.PaymentType),
      payTime: text(row.PayTime),
      tradeSha: tradeShaValue,
      message: text(body.Message).slice(0, 50),
    },
  }
}
