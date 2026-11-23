import pg from 'pg'
import { isolatedSellerPaymentDatabaseUrl, newebpayTestCredentials } from '@/lib/seller-subscription-newebpay'
import { readNewebpayNotice, type NewebpayFields } from '@/lib/newebpay-mpg'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const merchantId = process.env.NEWEBPAY_MERCHANT_ID?.trim() ?? ''
  const hashKey = process.env.NEWEBPAY_HASH_KEY?.trim() ?? ''
  const hashIv = process.env.NEWEBPAY_HASH_IV?.trim() ?? ''
  const databaseUrl = isolatedSellerPaymentDatabaseUrl(process.env.DATABASE_URL)
  if (!newebpayTestCredentials(process.env) || !databaseUrl) {
    return Response.json({ ok: false, code: 'newebpay_test_not_configured' }, { status: 503 })
  }

  const form = await request.formData()
  const fields: NewebpayFields = {
    Status: String(form.get('Status') ?? ''),
    MerchantID: String(form.get('MerchantID') ?? ''),
    TradeInfo: String(form.get('TradeInfo') ?? ''),
    TradeSha: String(form.get('TradeSha') ?? ''),
    Version: String(form.get('Version') ?? ''),
  }
  const notice = readNewebpayNotice(fields, hashKey, hashIv, merchantId)
  if (!notice.ok) {
    return Response.json({ ok: false, code: notice.code }, { status: notice.code === 'bad_signature' ? 400 : 422 })
  }

  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const recorded = await client.query(
      `select public.record_seller_subscription_payment_notice($1::jsonb) as result`,
      [JSON.stringify(notice.payload)],
    )
    const result = recorded.rows[0]?.result as { outcome?: string }
    return Response.json({ ok: true, outcome: result?.outcome ?? 'ignored' })
  } finally {
    await client.end()
  }
}
