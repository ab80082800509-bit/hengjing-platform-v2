/**
 * 點數紀錄的畫面列。
 * 簽到列沿用 get_my_checkin_state 已回傳的帳本列。
 * 換券、特權與今日刮卡點數，只採用既有查詢 RPC 已回傳、且金額被帳本規則固定的事實。
 * 不建立新帳本，也不改餘額。
 */
import { COUPON_EXCHANGE_COST } from './coupon-rules'
import { perkDefinitionById } from './perk-catalog'
import { SCRATCH_POINT_VALUES } from './scratch-rules'

export type PointHistoryRow = {
  id: string
  delta: number
  label: string
  at: string
}

const SCRATCH_POINT_OUTCOMES = new Set(['points', 'coupon_fallback', 'founder_fallback'])
const SCRATCH_POINTS = new Set<number>(SCRATCH_POINT_VALUES)

export function mergePointHistory(input: {
  checkin: PointHistoryRow[]
  pointCoupons: { id: string; code: string; claimedAt: string }[]
  perkIds: string[]
  scratch: { id: string; points: number; at: string; outcomeKind: string } | null
}): PointHistoryRow[] {
  const rows: PointHistoryRow[] = input.checkin.map((entry) => ({ ...entry }))
  for (const hold of input.pointCoupons) {
    if (!hold.id || !hold.code || !hold.claimedAt) continue
    rows.push({
      id: `coupon:${hold.id}`,
      delta: -COUPON_EXCHANGE_COST,
      label: `點數換券・${hold.code}`,
      at: hold.claimedAt,
    })
  }
  for (const perkId of input.perkIds) {
    const perk = perkDefinitionById.get(perkId)
    if (!perk) continue
    rows.push({
      id: `perk:${perk.id}`,
      delta: -perk.cost,
      label: `特權購買・${perk.name}`,
      at: '',
    })
  }
  if (
    input.scratch
    && SCRATCH_POINT_OUTCOMES.has(input.scratch.outcomeKind)
    && SCRATCH_POINTS.has(input.scratch.points)
  ) {
    rows.push({
      id: `scratch:${input.scratch.id}`,
      delta: input.scratch.points,
      label: '刮刮卡點數',
      at: input.scratch.at,
    })
  }
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  }).sort((a, b) => {
    if (a.at && b.at && a.at !== b.at) return b.at.localeCompare(a.at)
    if (a.at && !b.at) return -1
    if (!a.at && b.at) return 1
    return a.label.localeCompare(b.label, 'zh-Hant')
  })
}
