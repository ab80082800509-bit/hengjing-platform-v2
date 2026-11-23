/**
 * 公開街景、按讚與拜訪只走會員自己的 access token 與資料庫函式。
 * 不寫 localStorage，也不把金幣、庫存或私人存檔送出去。
 */
import { supabase } from '@/lib/supabase'
import { memberAccessToken } from '@/lib/rewards/member-session'
import {
  parseMyStreetSocial,
  parsePublicStreet,
  type MyStreetSocial,
  type PublicStreet,
  type StreetExhibit,
} from './street-public'
import {
  helpReasonText,
  parseHelpClaim,
  parseHelpStatus,
  parseMyStreetFriends,
  type FriendState,
  type HelpClaim,
  type MyStreetFriends,
  type StreetHelpStatus,
} from './street-help'
import {
  parseExplorePage,
  parseMyStreetSteal,
  parseStealClaim,
  parseStealResult,
  parseStealTarget,
  stealReasonText,
  type ExplorePage,
  type MyStreetSteal,
  type StealClaim,
  type StealResult,
  type StealTarget,
} from './street-steal'
import {
  boardReasonText,
  parseStreetBoard,
  type BoardPeriod,
  type BoardScope,
  type ServerBoardKind,
  type StreetBoard,
} from './street-board'

export const STREET_SOCIAL_RPC = {
  mine: 'get_my_street_social',
  publish: 'set_my_street_exhibit',
  visit: 'get_public_street',
  like: 'toggle_street_like',
  friends: 'get_my_street_friends',
  request: 'request_street_friend',
  respond: 'respond_street_friend',
  remove: 'remove_street_friend',
  help: 'help_street_friend',
  claim: 'claim_my_street_help_rewards',
  stealMine: 'get_my_street_steal',
  stealSet: 'set_my_street_steal',
  stealTarget: 'get_street_steal_target',
  steal: 'steal_street_goods',
  stealClaim: 'claim_my_street_steal_rewards',
  explore: 'explore_public_streets',
  board: 'get_street_leaderboard',
} as const

const UNAVAILABLE = '公開街景尚未在資料庫啟用。跨會員拜訪要等站長核准 SQL 草案後才能使用。'

export type SocialResult<T> = {
  data: T | null
  error: string | null
  unavailable: boolean
}

function unavailableMessage(message: string) {
  return /schema cache|could not find the function|does not exist|PGRST202/i.test(message)
}

function socialFailure(message: string) {
  if (unavailableMessage(message)) return UNAVAILABLE
  if (/請先登入|jwt|not authenticated/i.test(message)) return '請先登入'
  if (/Failed to fetch|network|timeout/i.test(message)) return '網路連線不穩，這次沒有記下互動'
  return '街景互動沒有完成，請稍後再試'
}

async function memberRpc(name: string, args: Record<string, unknown>, uiUserId?: string | null): Promise<SocialResult<unknown>> {
  const session = await memberAccessToken(uiUserId)
  if (!session.token) {
    const error = socialFailure(session.error ?? '請先登入')
    return { data: null, error, unavailable: unavailableMessage(session.error ?? '') }
  }
  try {
    const { data, error } = await supabase.rpc(name, args).setHeader('Authorization', `Bearer ${session.token}`)
    if (error) {
      const message = socialFailure(error.message)
      return { data: null, error: message, unavailable: unavailableMessage(error.message) }
    }
    return { data: typeof data === 'string' ? JSON.parse(data) as unknown : data, error: null, unavailable: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch'
    return { data: null, error: socialFailure(message), unavailable: unavailableMessage(message) }
  }
}

export async function fetchMyStreetSocial(uiUserId?: string | null): Promise<SocialResult<MyStreetSocial>> {
  const result = await memberRpc(STREET_SOCIAL_RPC.mine, {}, uiUserId)
  if (result.error || result.data == null) return { data: null, error: result.error, unavailable: result.unavailable }
  const mine = parseMyStreetSocial(result.data)
  if (!mine) return { data: null, error: '人氣資料無法讀取', unavailable: false }
  return { data: mine, error: null, unavailable: false }
}

export async function publishMyStreet(published: boolean, exhibit: StreetExhibit, uiUserId?: string | null): Promise<SocialResult<MyStreetSocial>> {
  const result = await memberRpc(STREET_SOCIAL_RPC.publish, {
    p_published: published,
    p_view: {
      shopLevel: exhibit.shopLevel,
      buildings: exhibit.buildings,
      equipped: exhibit.equipped,
    },
  }, uiUserId)
  if (result.error || result.data == null) return { data: null, error: result.error, unavailable: result.unavailable }
  const mine = parseMyStreetSocial(result.data)
  if (!mine || mine.published !== published) return { data: null, error: '公開設定沒有被接受', unavailable: false }
  return { data: mine, error: null, unavailable: false }
}

export async function fetchPublicStreet(ownerId: string, uiUserId?: string | null): Promise<SocialResult<PublicStreet> & { closed: boolean }> {
  const result = await memberRpc(STREET_SOCIAL_RPC.visit, { p_owner: ownerId }, uiUserId)
  if (result.error || result.data == null) return { data: null, error: result.error, unavailable: result.unavailable, closed: false }
  const src = result.data
  if (src && typeof src === 'object' && (src as { ok?: unknown }).ok === false) {
    return { data: null, error: '這條商店街沒有公開。', unavailable: false, closed: true }
  }
  const street = parsePublicStreet(src, ownerId)
  if (!street) return { data: null, error: '公開街景無法讀取', unavailable: false, closed: false }
  return { data: street, error: null, unavailable: false, closed: false }
}

export async function toggleStreetLike(ownerId: string, uiUserId?: string | null): Promise<SocialResult<{ likes: number; likedByMe: boolean }>> {
  const result = await memberRpc(STREET_SOCIAL_RPC.like, { p_owner: ownerId }, uiUserId)
  if (result.error || result.data == null) return { data: null, error: result.error, unavailable: result.unavailable }
  const src = result.data
  if (!src || typeof src !== 'object') return { data: null, error: '按讚沒有被接受', unavailable: false }
  const row = src as Record<string, unknown>
  if (row.ok === false && row.reason === 'self') return { data: null, error: '不能對自己的商店街按讚', unavailable: false }
  if (row.ok === false) return { data: null, error: '這條商店街沒有公開。', unavailable: false }
  if (row.ok !== true || typeof row.likes !== 'number' || typeof row.likedByMe !== 'boolean') {
    return { data: null, error: '按讚沒有被接受', unavailable: false }
  }
  return { data: { likes: row.likes, likedByMe: row.likedByMe }, error: null, unavailable: false }
}

const HELP_UNAVAILABLE = '好友互助尚未在資料庫啟用，要等站長核准第 6 批 SQL 後才能使用。'

function helpResult<T>(result: SocialResult<unknown>, read: (src: Record<string, unknown>) => T | null, fallback: string): SocialResult<T> {
  if (result.unavailable) return { data: null, error: HELP_UNAVAILABLE, unavailable: true }
  if (result.error || result.data == null) return { data: null, error: result.error, unavailable: false }
  const src = result.data as Record<string, unknown>
  if (!src || typeof src !== 'object') return { data: null, error: fallback, unavailable: false }
  if (src.ok === false) return { data: null, error: helpReasonText(src.reason), unavailable: false }
  const data = read(src)
  return data == null ? { data: null, error: fallback, unavailable: false } : { data, error: null, unavailable: false }
}

export async function fetchMyStreetFriends(uiUserId?: string | null): Promise<SocialResult<MyStreetFriends>> {
  return helpResult(await memberRpc(STREET_SOCIAL_RPC.friends, {}, uiUserId), parseMyStreetFriends, '好友名單無法讀取')
}

const readState = (src: Record<string, unknown>): FriendState | null =>
  src.status === 'none' || src.status === 'outgoing' || src.status === 'incoming' || src.status === 'accepted' ? src.status : null

export async function requestStreetFriend(otherId: string, uiUserId?: string | null): Promise<SocialResult<FriendState>> {
  return helpResult(await memberRpc(STREET_SOCIAL_RPC.request, { p_other: otherId }, uiUserId), readState, '好友邀請沒有完成')
}

export async function respondStreetFriend(otherId: string, accept: boolean, uiUserId?: string | null): Promise<SocialResult<FriendState>> {
  return helpResult(await memberRpc(STREET_SOCIAL_RPC.respond, { p_other: otherId, p_accept: accept }, uiUserId), readState, '好友回覆沒有完成')
}

export async function removeStreetFriend(otherId: string, uiUserId?: string | null): Promise<SocialResult<FriendState>> {
  return helpResult(await memberRpc(STREET_SOCIAL_RPC.remove, { p_other: otherId }, uiUserId), readState, '好友設定沒有完成')
}

/** requestKey 由呼叫端為這一次按鈕產生；網路重送同一把鑰匙不會多記一筆。 */
export async function helpStreetFriend(ownerId: string, requestKey: string, uiUserId?: string | null): Promise<SocialResult<{ duplicate: boolean; help: StreetHelpStatus }>> {
  return helpResult(await memberRpc(STREET_SOCIAL_RPC.help, { p_owner: ownerId, p_request_key: requestKey }, uiUserId), (src) => {
    const help = parseHelpStatus(src.help)
    return help && typeof src.duplicate === 'boolean' ? { duplicate: src.duplicate, help } : null
  }, '幫忙沒有完成')
}

/** claimKey 要先寫進存檔再呼叫；回覆遺失時用同一把鍵重送，資料庫回放同一筆結果。 */
export async function claimStreetHelpRewards(claimKey: string, uiUserId?: string | null): Promise<SocialResult<HelpClaim>> {
  return helpResult(await memberRpc(STREET_SOCIAL_RPC.claim, { p_claim_key: claimKey }, uiUserId), (src) => {
    const claim = parseHelpClaim(src)
    return claim && claim.claimKey === claimKey.toLowerCase() ? claim : null
  }, '互助獎勵無法領取')
}

const STEAL_UNAVAILABLE = '趣味偷貨與探索尚未在資料庫啟用，要等站長核准第 7 批 SQL 後才能使用。'

export type StealCallResult<T> = SocialResult<T> & { reason: string | null }

function stealResult<T>(result: SocialResult<unknown>, read: (src: Record<string, unknown>) => T | null, fallback: string): StealCallResult<T> {
  if (result.unavailable) return { data: null, error: STEAL_UNAVAILABLE, unavailable: true, reason: null }
  if (result.error || result.data == null) return { data: null, error: result.error, unavailable: false, reason: null }
  const src = result.data as Record<string, unknown>
  if (!src || typeof src !== 'object') return { data: null, error: fallback, unavailable: false, reason: null }
  if (src.ok === false) {
    const reason = typeof src.reason === 'string' ? src.reason : null
    return { data: null, error: stealReasonText(reason), unavailable: false, reason }
  }
  const data = read(src)
  return data == null ? { data: null, error: fallback, unavailable: false, reason: null } : { data, error: null, unavailable: false, reason: null }
}

export async function fetchMyStreetSteal(uiUserId?: string | null): Promise<StealCallResult<MyStreetSteal>> {
  return stealResult(await memberRpc(STREET_SOCIAL_RPC.stealMine, {}, uiUserId), parseMyStreetSteal, '偷貨紀錄無法讀取')
}

export async function setMyStreetSteal(allow: boolean, uiUserId?: string | null): Promise<StealCallResult<boolean>> {
  return stealResult(await memberRpc(STREET_SOCIAL_RPC.stealSet, { p_allow: allow }, uiUserId), (src) => (src.allowSteal === allow ? allow : null), '偷貨設定沒有完成')
}

export async function fetchStealTarget(ownerId: string, uiUserId?: string | null): Promise<StealCallResult<StealTarget>> {
  return stealResult(await memberRpc(STREET_SOCIAL_RPC.stealTarget, { p_owner: ownerId }, uiUserId), parseStealTarget, '偷貨狀態無法讀取')
}

/** requestKey 由呼叫端為這一次按鈕產生；斷線重送同一把鑰匙，資料庫回放同一筆結果。 */
export async function stealStreetGoods(ownerId: string, requestKey: string, uiUserId?: string | null): Promise<StealCallResult<StealResult>> {
  return stealResult(await memberRpc(STREET_SOCIAL_RPC.steal, { p_owner: ownerId, p_request_key: requestKey }, uiUserId), parseStealResult, '偷貨沒有完成')
}

/** claimKey 要先寫進存檔再呼叫；回覆遺失時用同一把鍵重送，資料庫回放同一筆結果。 */
export async function claimStreetStealRewards(claimKey: string, uiUserId?: string | null): Promise<StealCallResult<StealClaim>> {
  return stealResult(await memberRpc(STREET_SOCIAL_RPC.stealClaim, { p_claim_key: claimKey }, uiUserId), (src) => {
    const claim = parseStealClaim(src)
    return claim && claim.claimKey === claimKey.toLowerCase() ? claim : null
  }, '偷貨獎勵無法領取')
}

export async function exploreStreets(offset: number, uiUserId?: string | null): Promise<StealCallResult<ExplorePage>> {
  return stealResult(await memberRpc(STREET_SOCIAL_RPC.explore, { p_offset: Math.max(0, Math.floor(offset)) }, uiUserId), parseExplorePage, '探索列表無法讀取')
}

const BOARD_UNAVAILABLE = '社交排行榜尚未在資料庫啟用，要等站長核准第 8 批 SQL 後才會顯示。'

/** 只送要看哪一種榜；名次與成績全部由資料庫從互助、偷貨紀錄統計。 */
export async function fetchStreetBoard(board: ServerBoardKind, scope: BoardScope, period: BoardPeriod, uiUserId?: string | null): Promise<SocialResult<StreetBoard>> {
  const result = await memberRpc(STREET_SOCIAL_RPC.board, { p_board: board, p_scope: scope, p_period: period }, uiUserId)
  if (result.unavailable) return { data: null, error: BOARD_UNAVAILABLE, unavailable: true }
  if (result.error || result.data == null) return { data: null, error: result.error, unavailable: false }
  const src = result.data as Record<string, unknown>
  if (src && typeof src === 'object' && src.ok === false) return { data: null, error: boardReasonText(src.reason), unavailable: false }
  const data = parseStreetBoard(src, { board, scope, period })
  return data ? { data, error: null, unavailable: false } : { data: null, error: '排行榜回應無法讀取', unavailable: false }
}
