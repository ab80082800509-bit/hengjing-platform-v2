/**
 * 雲端存檔只走會員自己的 access token 與第 9 批資料庫函式。
 * 回覆分成：成功、資料庫拒收（帶 reason 與雲端最新版）、離線、尚未啟用、未登入。
 */
import { supabase } from '@/lib/supabase'
import { memberAccessToken } from '@/lib/rewards/member-session'
import { parseCloudRow, type CloudRow } from './street-cloud'
import { setStreetContentVersion, type StreetProgress } from './street-rules'

export const STREET_CLOUD_RPC = {
  get: 'get_my_street_save',
  import: 'import_my_street_save',
  save: 'save_my_street',
} as const

export type CloudReply =
  | { kind: 'ok'; row: CloudRow | null; replay: boolean; credited: { coins: number; xp: number } }
  | { kind: 'rejected'; reason: string; row: CloudRow | null }
  | { kind: 'offline' }
  | { kind: 'unavailable' }
  | { kind: 'auth' }

const TIMEOUT_MS = 12_000
const offlineMessage = (message: string) => /Failed to fetch|network|timeout|load failed|fetch failed/i.test(message)
const unavailableMessage = (message: string) => /schema cache|could not find the function|does not exist|PGRST202/i.test(message)

function classify(message: string): CloudReply {
  if (unavailableMessage(message)) return { kind: 'unavailable' }
  if (/請先登入|jwt|not authenticated/i.test(message)) return { kind: 'auth' }
  return { kind: 'offline' }
}

const whole = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0)

async function cloudRpc(name: string, args: Record<string, unknown>, uiUserId: string): Promise<CloudReply> {
  const session = await memberAccessToken(uiUserId)
  if (!session.token) return offlineMessage(session.error ?? '') ? { kind: 'offline' } : { kind: 'auth' }
  try {
    const call = supabase.rpc(name, args).setHeader('Authorization', `Bearer ${session.token}`)
    const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))
    const { data, error } = await Promise.race([call, timeout])
    if (error) return classify(error.message)
    const src = (typeof data === 'string' ? JSON.parse(data) : data) as Record<string, unknown> | null
    if (!src || typeof src !== 'object') return { kind: 'offline' }
    if (src.contentVersion === 2) setStreetContentVersion(2)
    if (src.ok === false) {
      if (src.reason === 'disabled') return { kind: 'unavailable' }
      return { kind: 'rejected', reason: typeof src.reason === 'string' ? src.reason : 'unknown', row: parseCloudRow(src) }
    }
    if (src.ok !== true) return { kind: 'offline' }
    const credited = src.credited && typeof src.credited === 'object' ? (src.credited as Record<string, unknown>) : {}
    if (src.exists === false) return { kind: 'ok', row: null, replay: false, credited: { coins: 0, xp: 0 } }
    const row = parseCloudRow(src)
    if (!row) return { kind: 'offline' }
    return { kind: 'ok', row, replay: src.replay === true, credited: { coins: whole(credited.coins), xp: whole(credited.xp) } }
  } catch (err) {
    return classify(err instanceof Error ? err.message : 'Failed to fetch')
  }
}

export const fetchMyStreetSave = (uiUserId: string) => cloudRpc(STREET_CLOUD_RPC.get, {}, uiUserId)

/** requestKey 要先寫進本機同步紀錄再呼叫；回覆遺失時用同一把鍵重送，資料庫回放同一筆。 */
export const importMyStreetSave = (progress: StreetProgress, requestKey: string, uiUserId: string) =>
  cloudRpc(STREET_CLOUD_RPC.import, { p_progress: progress, p_request_key: requestKey }, uiUserId)

export const saveMyStreet = (baseRevision: number, progress: StreetProgress, requestKey: string, uiUserId: string) =>
  cloudRpc(STREET_CLOUD_RPC.save, { p_base_revision: baseRevision, p_progress: progress, p_request_key: requestKey }, uiUserId)
