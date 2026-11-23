/** 解析 sync_my_game_achievements / set_my_game_badge 的回應。 */
import type { GameRewardId } from './game-reward-policy'

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'legend'

export type AchievementProgress = {
  id: string
  gameId: GameRewardId
  tier: AchievementTier
  target: number
  progress: number
  unlocked: boolean
  unlockedAt: string | null
  /** 資料來源尚未在資料庫開放時為 false，顯示「待開放」。 */
  available: boolean
}

export type AchievementState = {
  achievements: AchievementProgress[]
  showcase: string | null
  newlyUnlocked: string[]
}

const TIERS = new Set<AchievementTier>(['bronze', 'silver', 'gold', 'legend'])
const GAMES = new Set<GameRewardId>(['merge_shop', 'block_challenge', 'dream_street'])
const ID = /^[a-z0-9_]{3,40}$/

export function parseAchievementState(value: unknown): AchievementState | null {
  const body = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!body || typeof body !== 'object') return null
  const row = body as Record<string, unknown>
  if (!Array.isArray(row.achievements) || row.achievements.length > 200) return null
  const achievements: AchievementProgress[] = []
  for (const item of row.achievements) {
    const a = item as Record<string, unknown>
    if (!a || typeof a.id !== 'string' || !ID.test(a.id) || !GAMES.has(a.gameId as GameRewardId) || !TIERS.has(a.tier as AchievementTier)) return null
    if (!Number.isInteger(a.target) || !Number.isInteger(a.progress) || typeof a.unlocked !== 'boolean') return null
    const unlockedAt = a.unlockedAt == null ? null : a.unlockedAt instanceof Date ? a.unlockedAt.toISOString() : String(a.unlockedAt)
    achievements.push({
      id: a.id,
      gameId: a.gameId as GameRewardId,
      tier: a.tier as AchievementTier,
      target: a.target as number,
      progress: a.progress as number,
      unlocked: a.unlocked,
      unlockedAt,
      available: a.available !== false,
    })
  }
  const showcase = typeof row.showcase === 'string' && ID.test(row.showcase) ? row.showcase : null
  const newlyUnlocked = Array.isArray(row.newlyUnlocked) ? row.newlyUnlocked.filter((id): id is string => typeof id === 'string' && ID.test(id)) : []
  return { achievements, showcase, newlyUnlocked }
}

export function achievementFailureMessage(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim()
  const known = ['請先登入', '尚未解鎖這個成就']
  const hit = known.find((item) => clean.includes(item))
  if (hit) return hit
  if (/could not find the function|schema cache|does not exist|PGRST202|42883/i.test(clean)) return '遊戲成就還沒套用到目前資料庫'
  if (/failed to fetch|network|timeout/i.test(clean)) return '網路沒有完成，成就沒有變更'
  return '成就沒有變更'
}
