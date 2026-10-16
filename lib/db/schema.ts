import { bigserial, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

export const referralCodes = pgTable('referral_codes', {
  code: text('code').primaryKey(),
  ownerKey: text('owner_key').notNull(),
  ownerVisitor: text('owner_visitor').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const referralVisits = pgTable(
  'referral_visits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    code: text('code').notNull(),
    visitorId: text('visitor_id').notNull(),
    ipHash: text('ip_hash').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.code, t.visitorId)],
)
