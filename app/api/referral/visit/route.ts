import { and, count, eq, gte } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { referralCodes, referralVisits } from '@/lib/db/schema'
import { CODE_PATTERN, VISITOR_PATTERN, hashIp, readJson } from '@/lib/referral'

export const dynamic = 'force-dynamic'

const DAILY_VISITS_PER_IP = 5

export async function POST(request: Request) {
  const body = await readJson(request)
  const code = typeof body.code === 'string' ? body.code.toUpperCase() : ''
  const visitorId = typeof body.visitorId === 'string' ? body.visitorId : ''
  if (!CODE_PATTERN.test(code) || !VISITOR_PATTERN.test(visitorId)) {
    return NextResponse.json({ recorded: false, reason: 'invalid' }, { status: 400 })
  }

  const owner = (await db.select().from(referralCodes).where(eq(referralCodes.code, code)).limit(1))[0]
  if (!owner) return NextResponse.json({ recorded: false, reason: 'unknown_code' })
  if (owner.ownerVisitor === visitorId) return NextResponse.json({ recorded: false, reason: 'self' })

  const ipHash = hashIp(request)

  const [sameIpOnCode] = await db
    .select({ n: count() })
    .from(referralVisits)
    .where(and(eq(referralVisits.code, code), eq(referralVisits.ipHash, ipHash)))
  if ((sameIpOnCode?.n ?? 0) > 0) return NextResponse.json({ recorded: false, reason: 'duplicate' })

  const [recentFromIp] = await db
    .select({ n: count() })
    .from(referralVisits)
    .where(and(eq(referralVisits.ipHash, ipHash), gte(referralVisits.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))))
  if ((recentFromIp?.n ?? 0) >= DAILY_VISITS_PER_IP) return NextResponse.json({ recorded: false, reason: 'rate_limited' })

  const inserted = await db
    .insert(referralVisits)
    .values({ code, visitorId, ipHash })
    .onConflictDoNothing()
    .returning({ id: referralVisits.id })

  return NextResponse.json({ recorded: inserted.length > 0, reason: inserted.length > 0 ? 'ok' : 'duplicate' })
}
