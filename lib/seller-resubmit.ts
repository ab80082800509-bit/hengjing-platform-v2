/**
 * 重新送審只允許本人把自己被退回的申請改回 pending。
 * 不產生 approved，也不接受別人的申請編號。
 */

export type ResubmitRow = {
  id: string
  userId?: string
  verify: string
}

export function ownRejectedResubmit(
  actorId: string | null | undefined,
  row: ResubmitRow | undefined,
): { id: string; userId: string; status: 'pending' } | null {
  if (!actorId || !row?.id || !row.userId || row.userId !== actorId) return null
  if (row.verify !== 'rejected') return null
  return { id: row.id, userId: row.userId, status: 'pending' }
}
