/**
 * 方塊大挑戰每週排行榜。瀏覽器只送排行賽編號與每一步，分數由資料庫重算。
 * 資料庫尚未套用排行榜函式時一律回報 unavailable，畫面不得改用本機分數冒充榜單。
 */
import { supabase } from '@/lib/supabase'
import { memberAccessToken } from '@/lib/rewards/member-session'
import {
  parseRankedStart,
  parseRankedSubmit,
  parseWeeklyBoard,
  type BlockMove,
  type RankedStart,
  type RankedSubmit,
  type WeeklyBoard,
} from './block-modes'

export type BoardCall<T> = { state: 'ok'; data: T } | { state: 'unavailable' } | { state: 'error'; message: string }

const KNOWN = ['請先登入', '排行賽開局太頻繁，請稍後再試', '找不到這場排行賽', '只能查詢本週或上週']

function failure(text: string): BoardCall<never> {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (/could not find the function|schema cache|does not exist|PGRST202|42883/i.test(clean)) return { state: 'unavailable' }
  const known = KNOWN.find((item) => clean.includes(item))
  if (known) return { state: 'error', message: known }
  if (/failed to fetch|network|timeout/i.test(clean)) return { state: 'error', message: '網路沒有完成，請稍後再試' }
  return { state: 'error', message: '排行榜暫時無法使用' }
}

async function rpc<T>(name: string, args: Record<string, unknown>, uiUserId: string | null, needLogin: boolean, parse: (raw: unknown) => T | null): Promise<BoardCall<T>> {
  try {
    const session = uiUserId ? await memberAccessToken(uiUserId) : { token: null, error: null }
    if (needLogin && !session.token) return { state: 'error', message: '請先登入' }
    let query = supabase.rpc(name, args)
    if (session.token) query = query.setHeader('Authorization', `Bearer ${session.token}`)
    const { data, error } = await query
    if (error) return failure(`${error.code ?? ''} ${error.message ?? ''}`)
    const parsed = parse(data)
    return parsed ? { state: 'ok', data: parsed } : { state: 'error', message: '排行榜回應無法讀取' }
  } catch (err) {
    return failure(err instanceof Error ? err.message : 'Failed to fetch')
  }
}

export function fetchWeeklyBoard(offset: 0 | -1, uiUserId: string | null): Promise<BoardCall<WeeklyBoard>> {
  return rpc('get_block_weekly_board', { p_week_offset: offset }, uiUserId, false, parseWeeklyBoard)
}

export function startRankedRun(uiUserId: string | null): Promise<BoardCall<RankedStart>> {
  return rpc('start_block_ranked_run', {}, uiUserId, true, parseRankedStart)
}

export function submitRankedRun(runId: string, moves: readonly BlockMove[], uiUserId: string | null): Promise<BoardCall<RankedSubmit>> {
  return rpc('submit_block_ranked_run', { p_run_id: runId, p_moves: moves }, uiUserId, true, parseRankedSubmit)
}
