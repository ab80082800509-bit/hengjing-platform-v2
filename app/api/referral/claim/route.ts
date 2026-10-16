import { eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { referralCodes } from '@/lib/db/schema'
import { VISITOR_PATTERN, readJson, taipeiDayStart } from '@/lib/referral'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = await readJson(request)
  const visitorId = typeof body.visitorId === 'string' ? body.visitorId : ''
  if (!VISITOR_PATTERN.test(visitorId)) {
    return NextResponse.json({ ok: false, reason: 'invalid' }, { status: 400 })
  }

  const owner = (await db.select().from(referralCodes).where(eq(referralCodes.ownerVisitor, visitorId)).limit(1))[0]
  if (!owner) return NextResponse.json({ ok: false, reason: 'no_code' })

  const dayStart = taipeiDayStart().toISOString()
  const result = await db.execute(sql`
    UPDATE referral_visits
    SET claimed_at = now()
    WHERE id = (
      SELECT id FROM referral_visits
      WHERE code = ${owner.code} AND claimed_at IS NULL
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    AND NOT EXISTS (
      SELECT 1 FROM referral_visits
      WHERE code = ${owner.code} AND claimed_at >= ${dayStart}::timestamptz
    )
    RETURNING id
  `)

  if (result.rows.length > 0) return NextResponse.json({ ok: true })

  const claimedToday = await db.execute(sql`
    SELECT 1 FROM referral_visits
    WHERE code = ${owner.code} AND claimed_at >= ${dayStart}::timestamptz
    LIMIT 1
  `)
  return NextResponse.json({ ok: false, reason: claimedToday.rows.length > 0 ? 'already_today' : 'no_visit' })
}
