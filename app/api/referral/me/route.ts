import { and, count, eq, gte, isNotNull, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { referralCodes, referralVisits } from '@/lib/db/schema'
import { VISITOR_PATTERN, generateCode, readJson, taipeiDayStart } from '@/lib/referral'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = await readJson(request)
  const visitorId = typeof body.visitorId === 'string' ? body.visitorId : ''
  const name = typeof body.name === 'string' ? body.name.slice(0, 60) : ''
  if (!VISITOR_PATTERN.test(visitorId)) {
    return NextResponse.json({ error: 'invalid_visitor' }, { status: 400 })
  }

  let owner = (await db.select().from(referralCodes).where(eq(referralCodes.ownerVisitor, visitorId)).limit(1))[0]
  for (let attempt = 0; !owner && attempt < 5; attempt += 1) {
    await db
      .insert(referralCodes)
      .values({ code: generateCode(), ownerKey: name, ownerVisitor: visitorId })
      .onConflictDoNothing()
    owner = (await db.select().from(referralCodes).where(eq(referralCodes.ownerVisitor, visitorId)).limit(1))[0]
  }
  if (!owner) return NextResponse.json({ error: 'code_unavailable' }, { status: 503 })

  const [pending] = await db
    .select({ n: count() })
    .from(referralVisits)
    .where(and(eq(referralVisits.code, owner.code), isNull(referralVisits.claimedAt)))
  const [claimedToday] = await db
    .select({ n: count() })
    .from(referralVisits)
    .where(
      and(
        eq(referralVisits.code, owner.code),
        isNotNull(referralVisits.claimedAt),
        gte(referralVisits.claimedAt, taipeiDayStart()),
      ),
    )

  return NextResponse.json({
    code: owner.code,
    pending: pending?.n ?? 0,
    claimedToday: (claimedToday?.n ?? 0) > 0,
  })
}
