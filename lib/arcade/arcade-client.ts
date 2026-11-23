/**
 * 遊樂園共用的獎勵、成就與點數商城入口。
 * 瀏覽器只送任務或成就編號，不送分數、點數、會員編號或完成宣告。
 */
import { supabase } from '@/lib/supabase'
import { memberAccessToken } from '@/lib/rewards/member-session'
import { gameRewardFailureMessage, parseGameRewardState, type GameRewardState } from './game-reward-snapshot'
import { achievementFailureMessage, parseAchievementState, type AchievementState } from './achievement-snapshot'
import { parsePointsMall, type PointsMallState } from './points-mall-snapshot'
import { liveEventFailureMessage, parseLiveEvents, type LiveEventsState } from './live-events-snapshot'

type Result<T> = { data: T | null; error: string | null }

async function call(name: string, args: Record<string, unknown>, uiUserId: string | null | undefined, fail: (message: string) => string): Promise<Result<unknown>> {
  const session = await memberAccessToken(uiUserId)
  if (!session.token) return { data: null, error: fail(session.error ?? '請先登入') }
  try {
    const { data, error } = await supabase.rpc(name, args).setHeader('Authorization', `Bearer ${session.token}`)
    if (error) return { data: null, error: fail(error.message) }
    return { data, error: null }
  } catch (err) {
    return { data: null, error: fail(err instanceof Error ? err.message : 'Failed to fetch') }
  }
}

function parsed<T>(result: Result<unknown>, parse: (value: unknown) => T | null, unreadable: string): Result<T> {
  if (result.error) return { data: null, error: result.error }
  try {
    const value = parse(result.data)
    return value ? { data: value, error: null } : { data: null, error: unreadable }
  } catch {
    return { data: null, error: unreadable }
  }
}

export async function fetchGameRewardRules(): Promise<Result<GameRewardState>> {
  try {
    const { data, error } = await supabase.rpc('get_game_reward_rules')
    if (error) return { data: null, error: gameRewardFailureMessage(error.message) }
    return parsed({ data, error: null }, parseGameRewardState, '獎勵規則無法讀取')
  } catch (err) {
    return { data: null, error: gameRewardFailureMessage(err instanceof Error ? err.message : 'Failed to fetch') }
  }
}

export async function fetchMyGameRewards(uiUserId?: string | null): Promise<Result<GameRewardState>> {
  return parsed(await call('get_my_game_rewards', {}, uiUserId, gameRewardFailureMessage), parseGameRewardState, '獎勵進度無法讀取')
}

export async function claimMyGameReward(taskId: string, uiUserId?: string | null): Promise<Result<GameRewardState>> {
  return parsed(await call('claim_my_game_reward', { p_task_id: taskId }, uiUserId, gameRewardFailureMessage), parseGameRewardState, '領取結果無法讀取，請重新整理；已領取的不會重複計算')
}

export async function syncMyAchievements(uiUserId?: string | null): Promise<Result<AchievementState>> {
  return parsed(await call('sync_my_game_achievements', {}, uiUserId, achievementFailureMessage), parseAchievementState, '成就無法讀取')
}

export async function setMyGameBadge(achievementId: string | null, uiUserId?: string | null): Promise<Result<AchievementState>> {
  return parsed(await call('set_my_game_badge', { p_achievement_id: achievementId }, uiUserId, achievementFailureMessage), parseAchievementState, '展示設定無法讀取')
}

export async function fetchMyLiveEvents(uiUserId?: string | null): Promise<Result<LiveEventsState>> {
  return parsed(await call('get_my_live_events', {}, uiUserId, liveEventFailureMessage), parseLiveEvents, '活動進度無法讀取')
}

export async function claimMyLiveEvent(eventId: string, uiUserId?: string | null): Promise<Result<LiveEventsState>> {
  return parsed(await call('claim_my_live_event', { p_event_id: eventId }, uiUserId, liveEventFailureMessage), parseLiveEvents, '領取結果無法讀取，請重新整理；已領過的不會重複計算')
}

export async function fetchMyPointsMall(uiUserId?: string | null): Promise<Result<PointsMallState>> {
  return parsed(await call('get_my_points_mall', {}, uiUserId, (message) => {
    if (/could not find the function|schema cache|PGRST202|42883/i.test(message)) return '點數商城還沒套用到目前資料庫'
    if (message.includes('請先登入')) return '請先登入'
    return '點數商城無法讀取'
  }), parsePointsMall, '點數商城無法讀取')
}

export async function fetchPublicGameBadges(userIds: string[]): Promise<Record<string, string> | null> {
  const ids = [...new Set(userIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 40)
  if (!ids.length) return {}
  try {
    const { data, error } = await supabase.rpc('public_game_badges', { p_user_ids: ids })
    if (error || !Array.isArray(data)) return null
    const out: Record<string, string> = {}
    for (const row of data as Array<{ userId?: unknown; badge?: unknown }>) {
      if (typeof row.userId === 'string' && typeof row.badge === 'string') out[row.userId] = row.badge
    }
    return out
  } catch {
    return null
  }
}
