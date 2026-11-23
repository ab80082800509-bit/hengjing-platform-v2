import { readFileSync } from 'node:fs'
import { applyHelpReward, beginStealClaim, newSim, newStreet, parseStreet, settleHelpClaim, settleStealClaim } from '../lib/arcade/street-rules'
import { parseExplorePage, parseMyStreetSteal, parseStealClaim, parseStealResult, parseStealTarget, stealGate, stealReasonText } from '../lib/arcade/street-steal'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const NOW = Date.UTC(2026, 9, 29, 6)
const b = '22222222-2222-4222-8222-222222222222'

const steal = {
  enabled: true, day: '2026-10-29', usedToday: 0, dailyLimit: 8, pairLimit: 1, ownerLimit: 20, cooldownSeconds: 30, cooldownUntil: null,
  successPercent: 70, coinsMin: 8, coinsMax: 20, xp: 3, unclaimedCoins: 0, unclaimedXp: 0, unclaimedCount: 0,
}
const target = (extra: Record<string, unknown> = {}, s: Record<string, unknown> = {}) =>
  parseStealTarget({ ok: true, allowSteal: true, player: true, triedToday: 0, ownerToday: 0, steal: { ...steal, ...s }, ...extra })

const open = stealGate(target(), NOW)
assert(open.ok && open.left === 8, '開放、未偷過、未冷卻時可以偷')
assert(!stealGate(target({ allowSteal: false }), NOW).ok, '屋主關閉時要擋')
assert(!stealGate(target({ triedToday: 1 }), NOW).ok, '同一條街每日上限要擋')
assert(!stealGate(target({}, { usedToday: 8 }), NOW).ok, '每日次數用完要擋')
assert(!stealGate(target({ ownerToday: 20 }), NOW).ok, '屋主被偷上限要擋')
assert(!stealGate(target({}, { cooldownUntil: new Date(NOW + 10_000).toISOString() }), NOW).ok, '冷卻中要擋')
assert(!stealGate(target({}, { enabled: false }), NOW).ok, '總開關關閉要擋')
assert(!stealGate(null, NOW).ok, '還沒讀到狀態不能按')
assert(target({}, { dailyLimit: 999 }) === null, '參數超出資料庫範圍時丟掉')
assert(stealReasonText('owner_off').includes('屋主') && stealReasonText('self').includes('自己') && stealReasonText('???').length > 0, '原因文字')

assert(parseStealResult({ ok: true, replay: false, outcome: 'success', coins: 12, xp: 3, steal })?.coins === 12, '偷貨結果解析')
assert(parseStealResult({ ok: true, replay: false, outcome: 'miss', coins: 5, xp: 0, steal }) === null, '失敗卻有金幣的回覆要丟掉')
assert(parseStealResult({ ok: true, replay: false, outcome: 'win', coins: 1, xp: 0, steal }) === null, '未知結果要丟掉')

const mine = parseMyStreetSteal({ ok: true, allowSteal: false, stolenToday: 2, log: [{ nickname: '小明\u0007', outcome: 'success', coins: 9, at: '2026-10-29T06:00:00Z' }], steal })
assert(mine?.allowSteal === false && mine.log[0].nickname === '小明' && mine.stolenToday === 2, '屋主紀錄解析')
assert(parseMyStreetSteal({ ok: true, allowSteal: true, stolenToday: 0, log: [{ outcome: 'success', coins: -1, at: 'x' }], steal }) === null, '壞紀錄整份丟掉')

const page = parseExplorePage({
  ok: true, offset: 0, hasMore: false,
  streets: [{ ownerId: b.toUpperCase(), nickname: '阿花', avatarUrl: 'javascript:alert(1)', avatarTone: 0, shopLevel: 3, buildings: ['tea', 'evil'], likes: 4, todayVisitors: 1, friend: 'none', allowSteal: true, triedToday: 0, email: 'x@y.z' }],
})
assert(page?.streets.length === 1 && page.streets[0].ownerId === b, '探索列表解析並統一小寫編號')
assert(page?.streets[0].avatarUrl === null, '不安全的頭像網址要丟掉')
assert(page?.streets[0].buildings.join(',') === 'tea', '未知店面要丟掉')
assert(!('email' in (page?.streets[0] ?? {})), '探索列表不帶出 Email')
assert(parseExplorePage({ ok: true, offset: 0, hasMore: false, streets: [{ ownerId: 'nope' }] }) === null, '編號不正確時整份丟掉')

const k1 = 'ffffffff-0000-4000-8000-000000000001'
const k2 = 'ffffffff-0000-4000-8000-000000000002'
const claim = parseStealClaim({ ok: true, replay: false, claimKey: k1, coins: 21, xp: 6, entries: [{ nickname: '阿花' }, { nickname: '阿花' }], steal })
assert(claim?.coins === 21 && claim.count === 2 && claim.names.length === 1, '領取結果解析')
assert(parseStealClaim({ ok: true, replay: false, coins: 21, xp: 6, entries: [], steal }) === null, '沒有領取鍵不能入帳')

// 存檔：偷貨領取鍵與互助分開，回放只入帳一次。
const progress = newStreet(NOW)
const begun = beginStealClaim(progress, k1)
assert(begun.progress.stealClaimPending === k1 && begun.progress.helpClaimPending === null, '偷貨領取鍵不能佔用互助的欄位')
const reread = parseStreet(JSON.parse(JSON.stringify(begun.progress)))
assert(reread?.stealClaimPending === k1, '待領的偷貨鍵要能存回存檔')
assert(beginStealClaim(reread!, k2).key === k1, '有待領的鍵時要沿用')
const s1 = settleStealClaim({ progress: reread!, sim: newSim(reread!) }, k1, 21, 6, '趣味偷貨 2 筆・阿花', NOW)
assert(s1.applied && s1.state.progress.coins === 21 && s1.state.progress.xp === 6 && s1.state.progress.stealClaimPending === null, '第一次結清要入帳')
assert(s1.state.progress.log[0].kind === 'steal' && s1.state.progress.stats.earned === 0, '偷貨紀錄標成 steal 且不算營業收入')
const replay = settleStealClaim({ progress: { ...s1.state.progress, stealClaimPending: k1 }, sim: s1.state.sim }, k1, 21, 6, 'x', NOW)
assert(!replay.applied && replay.state.progress.coins === 21, '同一把鍵回放不能再加金幣')
const afterHelp = settleHelpClaim(s1.state, k1, 10, 0, '好友互助', NOW)
assert(afterHelp.applied && afterHelp.state.progress.coins === 31, '互助與偷貨的領取鍵各自記，互不影響')
assert(parseStreet(JSON.parse(JSON.stringify(s1.state.progress)))?.log[0].kind === 'steal', '偷貨紀錄要能存回存檔')
const legacy = parseStreet({ ...progress, stealClaimPending: undefined, stealClaimsApplied: undefined })
assert(legacy?.stealClaimPending === null && legacy.stealClaimsApplied.length === 0, '舊存檔沒有偷貨欄位時也要能讀')
assert(applyHelpReward({ progress, sim: newSim(progress) }, 5, 0, 'x', NOW).ok, '好友互助入帳照舊')

const sql = readFileSync('supabase/manual/20261029230100_street_steal_explore_apply.sql', 'utf8')
const body = sql.slice(sql.indexOf('BEGIN;'))
for (const bad of [
  'post_member_reward(', 'INSERT INTO public.member_point', 'UPDATE public.member_point', 'INSERT INTO public.reward_claims',
  'INSERT INTO public.member_street_help', 'UPDATE public.member_street_help', 'public.products', 'checkout_enabled',
]) {
  assert(!body.includes(bad), `第 7 批 SQL 不能碰：${bad}`)
}
for (const bad of ['UPDATE public.member_street_exhibits', 'DELETE FROM public.member_street_exhibits', 'INSERT INTO public.member_street_exhibits', 'DROP TABLE', 'TRUNCATE']) {
  assert(!body.includes(bad), `第 7 批不能改既有資料表：${bad}`)
}
for (const rel of ['exhibits', 'likes', 'visits', 'friends', 'friend_requests', 'helps', 'help_claims']) {
  assert(!new RegExp(`ALTER TABLE public\\.member_street_${rel}\\b`).test(body), `第 7 批不能改第 5、6 批資料表：${rel}`)
}
assert(!/GRANT[^;]*TO[^;]*\banon\b/.test(body), '第 7 批不能授權給訪客')
assert(body.includes('member_street_steals_request_key UNIQUE (thief_id, request_key)'), '請求鍵唯一')
assert(body.includes('PRIMARY KEY (user_id, claim_key)'), '領取紀錄每把鍵一列')
assert(body.includes("'street-steal-thief:'") && body.includes("'street-steal-owner:'"), '偷貨要鎖偷貨者與屋主')
assert(!body.includes('CREATE OR REPLACE FUNCTION public.request_street_friend') && !body.includes('CREATE OR REPLACE FUNCTION public.help_street_friend'), '不能覆蓋第 6 批好友函式')

const ui = readFileSync('components/arcade/dream-street.tsx', 'utf8')
for (const label of ['加好友', '等待對方同意', '接受邀請', '已是好友', '幫忙打理', '探索商店街', '允許其他玩家趣味偷貨']) {
  assert(ui.includes(label), `畫面缺少「${label}」`)
}
assert(ui.includes('複製拜訪連結'), '原本的分享連結要保留')

console.log('street steal checks passed')
