/** 解析 get_my_live_events / claim_my_live_event 的回應。進度與是否領過只認伺服器。 */
import type { GameRewardId } from './game-reward-policy'
import { LIVE_EVENTS, activeLiveEvents, type LiveCadence } from './live-ops'

export type LiveEventProgress = {
  eventId: string
  gameId: GameRewardId
  cadence: LiveCadence
  periodKey: string
  variant: number
  target: number
  progress: number
  available: boolean
  claimed: boolean
  endsAt: number
}

export type LiveEventRecord = { eventId: string; periodKey: string; variant: number; medal: string; claimedAt: string }

export type LiveEventsState = { events: LiveEventProgress[]; records: LiveEventRecord[]; serverNow: number | null }

export type LiveBoardCard = {
  id: string
  gameId: GameRewardId
  cadence: LiveCadence
  claimKey: string
  periodKey: string
  title: string
  detail: string
  medal: string
  festival: boolean
  target: number
  progress: number
  claimed: boolean
  available: boolean
  endsAt: number
  source: 'server' | 'preview'
}

const CADENCE_ORDER: Record<LiveCadence, number> = { daily: 0, weekly: 1, monthly: 2, season: 3, festival: 4 }

function readInstant(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

function catalogCopy(eventId: string, variant: number) {
  const def = LIVE_EVENTS.find((item) => item.id === eventId)
  const row = def?.variants[variant] ?? def?.variants[0]
  return {
    title: row?.title ?? eventId,
    detail: row?.detail ?? '',
    medal: def?.reward.medal ?? 'ic-star',
    festival: def?.cadence === 'festival',
  }
}

/**
 * 已登入且伺服器有回應時，期別、題目與截止時間只認伺服器。
 * 未登入或活動表尚未套用時，用同一套台北時間規則預覽，不拿它領獎。
 */
export function resolveLiveBoard(nowMs: number, server: LiveEventsState | null, game?: GameRewardId): LiveBoardCard[] {
  const cards: LiveBoardCard[] = server
    ? server.events.filter((event) => !game || event.gameId === game).map((event) => ({
      id: event.eventId,
      gameId: event.gameId,
      cadence: event.cadence,
      claimKey: `${event.eventId}@${event.periodKey}`,
      periodKey: event.periodKey,
      ...catalogCopy(event.eventId, event.variant),
      target: event.target,
      progress: event.progress,
      claimed: event.claimed,
      available: event.available,
      endsAt: event.endsAt,
      source: 'server' as const,
    }))
    : activeLiveEvents(nowMs, game).map((item) => ({
      id: item.id,
      gameId: item.game,
      cadence: item.cadence,
      claimKey: item.claimKey,
      periodKey: item.period.key,
      title: item.title,
      detail: item.detail,
      medal: item.reward.medal,
      festival: item.cadence === 'festival',
      target: item.target,
      progress: 0,
      claimed: false,
      available: false,
      endsAt: item.period.endMs,
      source: 'preview' as const,
    }))
  return cards.sort((a, b) => CADENCE_ORDER[a.cadence] - CADENCE_ORDER[b.cadence] || a.id.localeCompare(b.id))
}

const GAMES = new Set<GameRewardId>(['merge_shop', 'block_challenge', 'dream_street'])
const CADENCES = new Set<LiveCadence>(['daily', 'weekly', 'monthly', 'season', 'festival'])
const ID = /^[a-z0-9_]{3,40}$/
const KEY = /^(d|w|m|s|f):[a-z0-9:-]{4,60}$/

export function parseLiveEvents(value: unknown): LiveEventsState | null {
  const body = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!body || typeof body !== 'object') return null
  const row = body as Record<string, unknown>
  if (!Array.isArray(row.events) || !Array.isArray(row.records) || row.events.length > 100) return null
  const events: LiveEventProgress[] = []
  for (const item of row.events) {
    const e = item as Record<string, unknown>
    if (!e || typeof e.eventId !== 'string' || !ID.test(e.eventId) || !GAMES.has(e.gameId as GameRewardId) || !CADENCES.has(e.cadence as LiveCadence)) return null
    if (typeof e.periodKey !== 'string' || !KEY.test(e.periodKey) || !Number.isInteger(e.variant) || !Number.isInteger(e.target) || !Number.isInteger(e.progress)) return null
    const endsAt = Date.parse(String(e.endsAt))
    if (!Number.isFinite(endsAt)) return null
    events.push({
      eventId: e.eventId,
      gameId: e.gameId as GameRewardId,
      cadence: e.cadence as LiveCadence,
      periodKey: e.periodKey,
      variant: e.variant as number,
      target: e.target as number,
      progress: e.progress as number,
      available: e.available !== false,
      claimed: e.claimed === true,
      endsAt,
    })
  }
  const records: LiveEventRecord[] = []
  for (const item of row.records.slice(0, 60)) {
    const r = item as Record<string, unknown>
    if (!r || typeof r.eventId !== 'string' || !ID.test(r.eventId) || typeof r.periodKey !== 'string' || !KEY.test(r.periodKey)) continue
    records.push({ eventId: r.eventId, periodKey: r.periodKey, variant: Number.isInteger(r.variant) ? (r.variant as number) : 0, medal: typeof r.medal === 'string' ? r.medal : 'ic-star', claimedAt: String(r.claimedAt ?? '') })
  }
  if (row.serverNow != null && readInstant(row.serverNow) == null) return null
  return { events, records, serverNow: row.serverNow == null ? null : readInstant(row.serverNow) }
}

export function liveEventFailureMessage(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim()
  const known = ['請先登入', '活動不在進行期間', '這一期已經領過活動紀錄', '活動目標還沒完成', '活動資料來源還沒開放', '找不到這個活動']
  const hit = known.find((item) => clean.includes(item))
  if (hit) return hit
  if (/could not find the function|schema cache|does not exist|PGRST202|42883/i.test(clean)) return '活動紀錄還沒套用到目前資料庫'
  if (/failed to fetch|network|timeout/i.test(clean)) return '網路沒有完成，活動紀錄沒有變更'
  return '活動紀錄沒有變更'
}
