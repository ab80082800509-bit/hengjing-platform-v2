import { readFileSync } from 'node:fs'
import { boardReasonText, parseStreetBoard, shortDay } from '../lib/arcade/street-board'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const expect = { board: 'help', scope: 'global', period: 'week' } as const
const base = {
  ok: true, board: 'help', scope: 'global', period: 'week',
  weekStart: '2026-10-26', weekEnd: '2026-11-01', nextWeekAt: '2026-11-01T16:00:00+00:00', total: 2,
}
const row = (extra: Record<string, unknown> = {}) => ({
  rank: 1, score: 5, extra: 2, me: false, published: true, userId: a.toUpperCase(),
  nickname: '阿花', avatarUrl: null, avatarTone: 0, ...extra,
})

const board = parseStreetBoard({
  ...base,
  rows: [row({ email: 'x@y.z', phone: '0912' }), row({ rank: 2, score: 3, me: true, userId: b, nickname: '我\u0007', avatarUrl: 'javascript:alert(1)' })],
  me: { rank: 2, score: 3, extra: 0, listed: true, published: true },
}, expect)
assert(board?.rows.length === 2 && board.rows[0].userId === a, '榜單解析並統一小寫編號')
assert(!('email' in (board?.rows[0] ?? {})) && !('phone' in (board?.rows[0] ?? {})), '榜單不帶出 Email 或電話')
assert(board?.rows[1].nickname === '我' && board.rows[1].avatarUrl === null, '暱稱去控制字元、不安全頭像丟掉')
assert(board?.me?.rank === 2 && board.me.listed, '自己的名次')
assert(board?.nextWeekAt === Date.parse('2026-11-02T00:00:00+08:00'), '下次換週為台灣時間週一 00:00')
assert(shortDay(board?.weekStart ?? null) === '10/26' && shortDay(board?.weekEnd ?? null) === '11/1', '週期日期顯示')

const hidden = parseStreetBoard({ ...base, rows: [row({ published: false, userId: a })], me: null }, expect)
assert(hidden?.rows[0].userId === null, '未公開的會員不能帶出可拜訪的編號')

assert(parseStreetBoard({ ...base, board: 'steal', rows: [], me: null }, expect) === null, '回應的榜單種類對不上時丟掉')
assert(parseStreetBoard({ ...base, period: 'all', rows: [], me: null }, expect) === null, '回應的期間對不上時丟掉')
assert(parseStreetBoard({ ...base, rows: [row({ score: -1 })], me: null }, expect) === null, '負分整份丟掉')
assert(parseStreetBoard({ ...base, rows: [row({ rank: 0 })], me: null }, expect) === null, '名次 0 整份丟掉')
assert(parseStreetBoard({ ...base, weekStart: null, rows: [], me: null }, expect) === null, '週榜缺少週期時丟掉')
assert(parseStreetBoard({ ...base, rows: [], me: { rank: null, score: 1, extra: 0, listed: true, published: true } }, expect) === null, '列入榜單卻沒有名次時丟掉')
const unlisted = parseStreetBoard({ ...base, rows: [], me: { rank: 9, score: 4, extra: 1, listed: false, published: false } }, expect)
assert(unlisted?.me?.rank === null && unlisted.me.score === 4, '未列入時不顯示名次')
const all = parseStreetBoard({ ...base, period: 'all', weekStart: null, weekEnd: null, rows: [], me: null }, { ...expect, period: 'all' })
assert(all?.period === 'all' && all.weekStart === null, '累計榜沒有週期')
assert(boardReasonText('invalid').length > 0 && boardReasonText('???').length > 0, '原因文字')

const sql = readFileSync('supabase/manual/20261030000100_street_leaderboard_apply.sql', 'utf8')
const body = sql.slice(sql.indexOf('BEGIN;'))
const fnStart = body.indexOf('CREATE OR REPLACE FUNCTION public.get_street_leaderboard')
const fnBody = body.slice(fnStart, body.indexOf('$$;', fnStart))
for (const bad of ['post_member_reward', 'member_point', 'reward_claims', 'member_perk', 'checkout_enabled']) {
  assert(!fnBody.includes(bad), `排行榜函式不能碰：${bad}`)
}
for (const bad of [
  'INSERT INTO', 'UPDATE public.', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP ', 'TRUNCATE', 'CREATE INDEX', 'CREATE TRIGGER', 'set_config',
]) {
  assert(!body.includes(bad), `第 8 批 SQL 不能出現：${bad}`)
}
for (const fn of [
  'street_taipei_day', 'street_public_identity', 'request_street_friend', 'help_street_friend', 'steal_street_goods',
  'explore_public_streets', 'get_public_street', 'set_my_street_exhibit',
]) {
  assert(!body.includes(`CREATE OR REPLACE FUNCTION public.${fn}(`), `不能覆蓋第 5～7 批函式：${fn}`)
}
assert((body.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length === 1, '只新增一個函式')
assert(/LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = pg_catalog/.test(body), '函式要唯讀、SECURITY DEFINER、固定 search_path')
assert(body.includes('v_uid uuid := auth.uid()') && !/p_user|p_score|p_rank|p_member/.test(body), '身分只取 auth.uid()，不接受分數或會員編號參數')
assert(body.includes("FILTER (WHERE s.outcome = 'success')") && body.includes("FILTER (WHERE s.outcome = 'miss')"), '偷貨成功與失手分開計算')
assert(body.includes("f.status = 'accepted'"), '好友榜只用已互相確認的好友')
assert(body.includes('sc.published AND sc.score > 0'), '全站榜只列已公開且有成績的會員')
assert(body.includes("CASE WHEN j.published THEN j.member ELSE NULL END"), '未公開的會員不回傳編號')
assert(body.includes('ORDER BY sc.score DESC, sc.reached_at ASC NULLS LAST, sc.member ASC'), '同分規則固定')
assert(body.includes("EXTRACT(isodow FROM v_today)") && body.includes("AT TIME ZONE 'Asia/Taipei'"), '週一台灣時間換週')
assert(body.includes('REVOKE ALL ON FUNCTION public.get_street_leaderboard(text, text, text) FROM PUBLIC, anon'), '訪客不能查排行榜')
assert(!/GRANT[^;]*TO[^;]*\banon\b/.test(body), '不能授權給訪客')

const check = readFileSync('supabase/manual/20261030000000_street_leaderboard_readonly_check.sql', 'utf8')
assert(check.includes('BEGIN TRANSACTION READ ONLY;') && check.trimEnd().endsWith('ROLLBACK;'), '預檢必須唯讀並 ROLLBACK')

const ui = readFileSync('components/arcade/dream-street.tsx', 'utf8')
for (const label of ['社交排行榜', '經營排行暫不開放', '我的名次', '加好友', '幫忙打理', '探索商店街', '允許其他玩家趣味偷貨', '複製拜訪連結']) {
  assert(ui.includes(label), `畫面缺少「${label}」`)
}

console.log('street board checks passed')
