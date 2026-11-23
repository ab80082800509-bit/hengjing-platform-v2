import { readFileSync } from 'node:fs'
import { applyHelpReward, beginHelpClaim, newSim, newStreet, parseStreet, settleHelpClaim } from '../lib/arcade/street-rules'
import { friendStateOf, helpGate, helpReasonText, parseHelpClaim, parseMyStreetFriends } from '../lib/arcade/street-help'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const NOW = Date.UTC(2026, 9, 28, 4)
const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const c = '33333333-3333-4333-8333-333333333333'

const help = {
  enabled: true, day: '2026-10-28', usedToday: 0, dailyLimit: 5, receivedToday: 0, receiveLimit: 10,
  cooldownSeconds: 60, cooldownUntil: null, requestLimit: 10, maxFriends: 50,
  helperCoins: 30, helperXp: 8, ownerCoins: 20, unclaimedCoins: 0, unclaimedXp: 0, unclaimedCount: 0,
}
const card = (userId: string, extra: Record<string, unknown> = {}) => ({ userId, nickname: '小明', avatarUrl: null, avatarTone: 0, published: true, helpedToday: false, helpedMeToday: false, ...extra })

const list = parseMyStreetFriends({ ok: true, friends: [card(b)], incoming: [card(c)], outgoing: [], help })
assert(list !== null, '好友名單應該可以解析')
assert(friendStateOf(list, b) === 'accepted' && friendStateOf(list, c) === 'incoming' && friendStateOf(list, a) === 'none', '好友狀態判斷錯誤')
assert(helpGate(list, b, NOW).ok, '好友、未幫過、未冷卻時可以幫忙')
assert(!helpGate(list, c, NOW).ok, '邀請中還不能幫忙')
assert(!helpGate(list, a, NOW).ok, '陌生人不能幫忙')
assert(!helpGate(parseMyStreetFriends({ ok: true, friends: [card(b, { helpedToday: true })], incoming: [], outgoing: [], help }), b, NOW).ok, '同日同好友只能一次')
assert(!helpGate(parseMyStreetFriends({ ok: true, friends: [card(b)], incoming: [], outgoing: [], help: { ...help, usedToday: 5 } }), b, NOW).ok, '每日次數用完要擋')
assert(!helpGate(parseMyStreetFriends({ ok: true, friends: [card(b)], incoming: [], outgoing: [], help: { ...help, cooldownUntil: new Date(NOW + 30_000).toISOString() } }), b, NOW).ok, '冷卻中要擋')
assert(!helpGate(parseMyStreetFriends({ ok: true, friends: [card(b)], incoming: [], outgoing: [], help: { ...help, enabled: false } }), b, NOW).ok, '關閉時要擋')
assert(parseMyStreetFriends({ ok: true, friends: [card('not-a-uuid')], incoming: [], outgoing: [], help }) === null, '會員編號不正確時整份丟掉')
assert(parseMyStreetFriends({ ok: true, friends: [], incoming: [], outgoing: [], help: { ...help, dailyLimit: 999 } }) === null, '參數超出資料庫範圍時丟掉')
assert(helpReasonText('cooldown').includes('稍等') && helpReasonText('???').length > 0, '原因文字')

const k1 = 'eeeeeeee-0000-4000-8000-000000000001'
const k2 = 'eeeeeeee-0000-4000-8000-000000000002'
const claim = parseHelpClaim({ ok: true, replay: false, claimKey: k1, coins: 50, xp: 8, entries: [{ nickname: '小明' }, { nickname: '小明' }], help })
assert(claim?.coins === 50 && claim.xp === 8 && claim.count === 2 && claim.names.length === 1 && claim.claimKey === k1, '領取結果解析錯誤')
assert(parseHelpClaim({ ok: true, replay: false, claimKey: k1, coins: -1, xp: 0, entries: [], help }) === null, '負數不能入帳')
assert(parseHelpClaim({ ok: true, coins: 50, xp: 8, entries: [], help }) === null, '沒有領取鍵的回覆不能入帳')

const progress = newStreet(NOW)
const state = { progress, sim: newSim(progress) }
const res = applyHelpReward(state, 50, 8, '好友互助 2 筆・小明', NOW)
assert(res.ok && res.state.progress.coins === 50 && res.state.progress.xp === 8, '互助獎勵要加到金幣與經驗')
assert(res.ok && res.state.progress.stats.earned === 0 && res.state.progress.today.served === 0, '互助不算進營業統計')
assert(res.ok && res.state.progress.log[0].kind === 'help', '紀錄要標成互助')
assert(!applyHelpReward(state, 0, 0, 'x', NOW).ok, '沒有獎勵不能入帳')
const reread = res.ok ? parseStreet(JSON.parse(JSON.stringify(res.state.progress))) : null
assert(reread?.log[0].kind === 'help' && reread.coins === 50, '互助紀錄要能存回 v3 存檔')

// 領取鍵：先存進存檔，回覆遺失後重載仍沿用同一把；回放只入帳一次。
const begun = beginHelpClaim(progress, k1)
assert(begun.key === k1 && begun.progress.helpClaimPending === k1, '領取前要先記下領取鍵')
const afterReload = parseStreet(JSON.parse(JSON.stringify(begun.progress)))
assert(afterReload?.helpClaimPending === k1, '待領的領取鍵要能存回存檔')
assert(beginHelpClaim(afterReload!, k2).key === k1, '有待領的鍵時要沿用，不能換新鍵')
const s1 = settleHelpClaim({ progress: afterReload!, sim: newSim(afterReload!) }, k1, 50, 8, '好友互助', NOW)
assert(s1.applied && s1.state.progress.coins === 50 && s1.state.progress.helpClaimPending === null, '第一次結清要入帳並清掉待領')
assert(s1.state.progress.helpClaimsApplied.includes(k1), '入帳後要記下已入帳的鍵')
const replayed = settleHelpClaim({ progress: { ...s1.state.progress, helpClaimPending: k1 }, sim: s1.state.sim }, k1, 50, 8, '好友互助', NOW)
assert(!replayed.applied && replayed.state.progress.coins === 50 && replayed.state.progress.helpClaimPending === null, '同一把鍵回放不能再加金幣')
const empty = settleHelpClaim({ progress: begun.progress, sim: newSim(begun.progress) }, k1, 0, 0, '好友互助', NOW)
assert(!empty.applied && empty.state.progress.coins === 0 && empty.state.progress.helpClaimPending === null, '領到 0 時只清掉待領')
assert(parseStreet({ ...progress, helpClaimPending: 'nope', helpClaimsApplied: ['x', k1, k1] })?.helpClaimPending === null, '壞掉的領取鍵要丟掉')
assert(parseStreet({ ...progress, helpClaimsApplied: ['x', k1, k1] })?.helpClaimsApplied.length === 1, '已入帳的鍵要去重並丟掉壞值')
const legacy = parseStreet({ ...progress, helpClaimPending: undefined, helpClaimsApplied: undefined })
assert(legacy?.helpClaimPending === null && legacy.helpClaimsApplied.length === 0, '舊存檔沒有領取欄位時也要能讀')

const sql = readFileSync('supabase/manual/20261029220200_street_friend_help_apply.sql', 'utf8')
const body = sql.slice(sql.indexOf('BEGIN;'))
for (const bad of ['post_member_reward(', 'INSERT INTO public.member_point', 'UPDATE public.member_point', 'INSERT INTO public.reward_claims']) {
  assert(!body.includes(bad), `第 6 批 SQL 不能寫入 Pay 點數：${bad}`)
}
assert(!/GRANT[^;]*TO[^;]*\banon\b/.test(body), '第 6 批不能授權給訪客')
assert(body.includes('member_street_helps_pair_day UNIQUE (helper_id, owner_id, help_day)'), '同日同好友唯一鍵')
assert(body.includes('member_street_helps_request_key UNIQUE (helper_id, request_key)'), '請求鍵唯一')
assert(body.includes('PRIMARY KEY (user_id, claim_key)'), '領取紀錄每把鍵一列')
assert(body.includes('claim_my_street_help_rewards(p_claim_key uuid)') && !/claim_my_street_help_rewards\(\)\s+(RETURNS|TO|FROM)/.test(body), '領取必須帶領取鍵')

const batch5 = readFileSync('supabase/manual/20261029220100_street_social_apply.sql', 'utf8')
const batch5Body = batch5.slice(batch5.indexOf('BEGIN;'))
for (const bad of ['INSERT INTO auth.', 'DELETE FROM auth.', 'auth.identities', 'example.invalid', 'INSERT INTO public.profiles', 'UPDATE public.profiles', 'SET LOCAL ROLE']) {
  assert(!batch5Body.includes(bad), `第 5 批正式版不能含測試會員或改寫會員資料：${bad}`)
}

console.log('street help checks passed')
