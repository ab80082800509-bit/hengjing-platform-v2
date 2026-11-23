/**
 * 解析 get_my_game_rewards / claim_my_game_reward / get_game_reward_rules 的回應。
 * 只要資料庫回報 payoutEnabled 不是 false 或 issuedPayPoints 不是 0，就整份拒用，畫面不顯示已發點。
 */
import type { GameRewardId } from './game-reward-policy'

export type GameRewardTaskStatus = 'locked' | 'in_progress' | 'claimable' | 'claimed' | 'capped'

export type GameRewardTask = {
  id: string
  gameId: GameRewardId
  period: 'daily' | 'weekly'
  metric: string
  target: number
  progress: number
  points: number
  claimablePoints: number
  awardedPoints: number
  status: GameRewardTaskStatus
  periodKey: string
  resetAt: string
}

export type GameRewardState = {
  signedIn: boolean
  payoutEnabled: false
  approval: string
  issuedPayPoints: 0
  dailyCap: number
  weeklyQuest: number
  weeklyCap: number
  scratchExcluded: true
  taipeiDay: string
  weekStart: string
  weekEnd: string
  dailyResetAt: string
  weeklyResetAt: string
  dailyUsed: number
  weeklyUsed: number
  weeklyQuestUsed: number
  withheldTotal: number
  serverNow: string
  games: { id: GameRewardId; open: boolean }[]
  tasks: GameRewardTask[]
  claim: { taskId: string; awardedPoints: number; replayed: boolean } | null
}

const GAMES = new Set<GameRewardId>(['merge_shop', 'block_challenge', 'dream_street'])
const STATUSES = new Set<GameRewardTaskStatus>(['locked', 'in_progress', 'claimable', 'claimed', 'capped'])
const DAY = /^\d{4}-\d{2}-\d{2}$/

const int = (value: unknown, min = 0, max = 100000): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null
const text = (value: unknown): string | null => (typeof value === 'string' && value.length <= 200 ? value : null)
const day = (value: unknown): string | null => (typeof value === 'string' && DAY.test(value.slice(0, 10)) ? value.slice(0, 10) : null)
const instant = (value: unknown): string | null => {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

function parseTask(value: unknown): GameRewardTask | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = text(row.id)
  const gameId = row.gameId as GameRewardId
  const period = row.period
  const status = row.status as GameRewardTaskStatus
  const target = int(row.target, 1)
  const progress = int(row.progress)
  const points = int(row.points, 1, 100)
  const claimablePoints = int(row.claimablePoints, 0, 100)
  const awardedPoints = int(row.awardedPoints, 0, 100)
  const periodKey = day(row.periodKey)
  const resetAt = instant(row.resetAt)
  if (!id || !GAMES.has(gameId) || (period !== 'daily' && period !== 'weekly') || !STATUSES.has(status)) return null
  if (target == null || progress == null || points == null || claimablePoints == null || awardedPoints == null || !periodKey || !resetAt) return null
  return { id, gameId, period, metric: text(row.metric) ?? '', target, progress, points, claimablePoints, awardedPoints, status, periodKey, resetAt }
}

export function parseGameRewardState(value: unknown): GameRewardState | null {
  const body = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!body || typeof body !== 'object') return null
  const row = body as Record<string, unknown>
  if (row.payoutEnabled !== false || row.issuedPayPoints !== 0 || row.scratchExcluded !== true) return null
  const nums = {
    dailyCap: int(row.dailyCap, 0, 1000),
    weeklyQuest: int(row.weeklyQuest, 0, 1000),
    weeklyCap: int(row.weeklyCap, 0, 7000),
    dailyUsed: int(row.dailyUsed, 0, 7000),
    weeklyUsed: int(row.weeklyUsed, 0, 7000),
    weeklyQuestUsed: int(row.weeklyQuestUsed, 0, 7000),
    withheldTotal: int(row.withheldTotal, 0, 10000000),
  }
  if (Object.values(nums).some((item) => item == null)) return null
  const taipeiDay = day(row.taipeiDay)
  const weekStart = day(row.weekStart)
  const weekEnd = day(row.weekEnd)
  const dailyResetAt = instant(row.dailyResetAt)
  const weeklyResetAt = instant(row.weeklyResetAt)
  const serverNow = instant(row.serverNow)
  if (!taipeiDay || !weekStart || !weekEnd || !dailyResetAt || !weeklyResetAt || !serverNow) return null
  if (!Array.isArray(row.tasks) || row.tasks.length > 40 || !Array.isArray(row.games)) return null
  const tasks: GameRewardTask[] = []
  for (const item of row.tasks) {
    const parsed = parseTask(item)
    if (!parsed) return null
    tasks.push(parsed)
  }
  const games: GameRewardState['games'] = []
  for (const item of row.games) {
    const game = item as Record<string, unknown>
    if (!game || !GAMES.has(game.id as GameRewardId) || typeof game.open !== 'boolean') return null
    games.push({ id: game.id as GameRewardId, open: game.open })
  }
  let claim: GameRewardState['claim'] = null
  if (row.claim && typeof row.claim === 'object') {
    const c = row.claim as Record<string, unknown>
    const awardedPoints = int(c.awardedPoints, 0, 100)
    if (!text(c.taskId) || awardedPoints == null || typeof c.replayed !== 'boolean') return null
    claim = { taskId: c.taskId as string, awardedPoints, replayed: c.replayed }
  }
  return {
    signedIn: row.signedIn === true,
    payoutEnabled: false,
    approval: text(row.approval) ?? 'pending_approval',
    issuedPayPoints: 0,
    dailyCap: nums.dailyCap!,
    weeklyQuest: nums.weeklyQuest!,
    weeklyCap: nums.weeklyCap!,
    scratchExcluded: true,
    taipeiDay,
    weekStart,
    weekEnd,
    dailyResetAt,
    weeklyResetAt,
    dailyUsed: nums.dailyUsed!,
    weeklyUsed: nums.weeklyUsed!,
    weeklyQuestUsed: nums.weeklyQuestUsed!,
    withheldTotal: nums.withheldTotal!,
    serverNow,
    games,
    tasks,
    claim,
  }
}

export function gameRewardFailureMessage(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim()
  const known = ['請先登入', '任務還沒完成', '遊戲獎勵已達上限', '這款遊戲尚未開放', '找不到這個遊戲任務', '遊戲 Pay 點數尚未正式簽核，不能入帳']
  const hit = known.find((item) => clean.includes(item))
  if (hit) return hit
  if (/could not find the function|schema cache|does not exist|PGRST202|42883/i.test(clean)) return '遊戲獎勵還沒套用到目前資料庫'
  if (/failed to fetch|network|timeout/i.test(clean)) return '網路沒有完成，獎勵狀態沒有變更'
  return '獎勵狀態沒有變更'
}
