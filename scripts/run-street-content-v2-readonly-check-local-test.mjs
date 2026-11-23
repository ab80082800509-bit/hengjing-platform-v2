// 只在本機隔離 Supabase（docker）驗收商店街 v2 唯讀預檢。每個情境各自一個交易，最後 ROLLBACK，不留任何資料。
// 交易內先補齊正式庫目前的狀態（商店街第 6、7、9 批、合成小舖 v2、40 件點數商城並開放），再建兩份會員雲端存檔。
// 用法：node scripts/run-street-content-v2-readonly-check-local-test.mjs [容器名稱]
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// 指紋只把 CRLF 收成 LF，不刪字串裡的空白。常數必須等於套用檔本文，不能從待檢資料庫抄。
const md5 = (text) => createHash('md5').update(text.replace(/\r\n/g, '\n')).digest('hex')
const functionBody = (sql, marker) => {
  const at = sql.indexOf(marker)
  if (at < 0) throw new Error(`套用檔找不到 ${marker}`)
  const as = sql.indexOf('AS $$', at)
  const end = sql.indexOf('\n$$', as + 5)
  if (as < 0 || end < 0) throw new Error(`套用檔函式本文無法截取 ${marker}`)
  return sql.slice(as + 'AS $$'.length, end + 1)
}
const sourceBody = (file, marker) => functionBody(readFileSync(file, 'utf8'), marker)
const cloud = 'supabase/manual/20261030010100_street_cloud_save_apply.sql'
const social = 'supabase/manual/20261029220100_street_social_apply.sql'
const v2file = 'supabase/manual/20261030030200_street_content_v2_apply.sql'
const fromFiles = {
  street_cloud_spec: [sourceBody(cloud, 'CREATE FUNCTION public.street_cloud_spec()'), sourceBody(v2file, 'CREATE OR REPLACE FUNCTION public.street_cloud_spec()')],
  street_cloud_build: [sourceBody(cloud, 'CREATE FUNCTION public.street_cloud_build('), sourceBody(v2file, 'CREATE OR REPLACE FUNCTION public.street_cloud_build(')],
  street_cloud_row_json: [sourceBody(cloud, 'CREATE FUNCTION public.street_cloud_row_json('), sourceBody(v2file, 'CREATE OR REPLACE FUNCTION public.street_cloud_row_json(')],
  get_my_street_save: [sourceBody(cloud, 'CREATE FUNCTION public.get_my_street_save()'), sourceBody(v2file, 'CREATE OR REPLACE FUNCTION public.get_my_street_save()')],
  street_decor_min_level: [sourceBody(social, 'CREATE OR REPLACE FUNCTION public.street_decor_min_level('), sourceBody(v2file, 'CREATE OR REPLACE FUNCTION public.street_decor_min_level(')],
  street_decor_slot: [sourceBody(social, 'CREATE OR REPLACE FUNCTION public.street_decor_slot('), sourceBody(v2file, 'CREATE OR REPLACE FUNCTION public.street_decor_slot(')],
}

const container = process.argv[2] ?? 'supabase_db_hengjing-stage45-local'
const between = (file, open, close) => {
  const sql = readFileSync(file, 'utf8')
  const start = sql.indexOf(open)
  const end = sql.lastIndexOf(close)
  if (start < 0 || end < start) throw new Error(`${file} 沒有 ${open}/${close}`)
  return sql.slice(start + open.length, end)
}
const body = (file) => between(file, 'BEGIN;', 'COMMIT;')
const psqlArgs = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|']
const query = (sql) => execFileSync('docker', [...psqlArgs, '-c', sql], { encoding: 'utf8' }).trim()
const has = (rel) => query(`select to_regclass('${rel}') is not null`) === 't'

const setup = []
if (!has('public.member_street_friends')) setup.push(body('supabase/manual/20261029220200_street_friend_help_apply.sql'))
if (!has('public.member_street_steals')) setup.push(body('supabase/manual/20261029230100_street_steal_explore_apply.sql'))
if (!has('public.member_street_saves')) setup.push(body('supabase/manual/20261030010100_street_cloud_save_apply.sql'))
if (query("select to_regprocedure('public.merge_item_ok(text)') is not null") !== 't') setup.push(body('supabase/manual/20261030030100_merge_shop_v2_apply.sql'))
if (!has('public.member_perk_sale_windows')) setup.push(body('supabase/manual/20261030020100_points_mall_v2_apply.sql'))
setup.push('UPDATE public.member_perk_settings SET purchase_enabled = false WHERE id = true;')
setup.push(body('supabase/manual/20261030020200_points_mall_open_purchase.sql'))
setup.push(`
INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'street-check-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('bbbbbbbb-0000-4000-8000-0000000000e2', 'street-check-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
CREATE FUNCTION pg_temp.import_as(p uuid, progress jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := public.import_my_street_save(progress, gen_random_uuid());
  EXECUTE 'RESET ROLE';
  IF (r ->> 'ok') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'SETUP 存檔建立失敗：%', r; END IF;
  RETURN r;
END $$;
SELECT pg_temp.import_as('aaaaaaaa-0000-4000-8000-0000000000e1', '{"v":3,"shopLevel":3,"coins":0,"xp":440,"buildings":[],"ownedDecors":["mat","flower"],"stats":{"served":20,"itemsSold":40,"earned":1000,"xpEarned":440},"stock":{"cake":2}}');
SELECT pg_temp.import_as('bbbbbbbb-0000-4000-8000-0000000000e2', '{"v":3,"shopLevel":1,"coins":0,"xp":0,"stats":{}}');
RESET request.jwt.claims; RESET request.jwt.claim.sub;
`)

const precheckFile = readFileSync('supabase/manual/20261030030190_street_content_v2_readonly_check.sql', 'utf8')
const declared = Object.fromEntries([...precheckFile.matchAll(/\('([a-z_]+)', '(public\.[^']+)', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)].map((m) => [m[1], [m[3], m[4]]]))
for (const [name, bodies] of Object.entries(fromFiles)) {
  const got = bodies.map(md5)
  if (!declared[name] || declared[name][0] !== got[0] || declared[name][1] !== got[1]) {
    throw new Error(`${name} 的指紋常數與套用檔本文不一致，拒絕把資料庫現況登錄為可信版本`)
  }
}
const patchFile = 'supabase/manual/20261030030210_street_equip_guard_apply.sql'
const guardFile = 'supabase/manual/20261030030220_street_equip_guard_readonly_check.sql'
const fixHash = md5(sourceBody(patchFile, 'CREATE OR REPLACE FUNCTION public.street_cloud_build('))
const patchSql = readFileSync(patchFile, 'utf8')
const guardSql = readFileSync(guardFile, 'utf8')
if (fixHash === declared.street_cloud_build[1]) throw new Error('修正版指紋不該等於未修補的 v2')
for (const file of [precheckFile, patchSql, guardSql]) {
  if (!file.includes(fixHash)) throw new Error('修正版指紋必須等於修補檔函式本文，不能改從資料庫抄')
}
if (!patchSql.includes(declared.street_cloud_build[1]) || !guardSql.includes(declared.street_cloud_build[1])) {
  throw new Error('修補判斷沒有引用 v2 套用檔的 street_cloud_build 指紋')
}
for (const [name, bodies] of Object.entries(fromFiles)) {
  if (name === 'street_cloud_build') continue
  if (!guardSql.includes(md5(bodies[1]))) throw new Error(`${name} 的 v2 指紋沒有寫進修補預檢`)
}
const spec = fromFiles.street_cloud_spec[0].replace(/\r\n/g, '\n')
const specChanged = spec.replace('"price": 18', '"price": 1 8')
if (spec.replace(/\s+/g, '') !== specChanged.replace(/\s+/g, '') || md5(spec) === md5(specChanged)) {
  throw new Error('字串內空白的指紋測試案例無效')
}
const precheck = between('supabase/manual/20261030030190_street_content_v2_readonly_check.sql', 'BEGIN READ ONLY;', 'ROLLBACK;')
const patch = body(patchFile)
const guard = between(guardFile, 'BEGIN READ ONLY;', 'ROLLBACK;')
const snapshotOk = (line) => typeof line === 'string' && /^\d+ \/ \d+～\d+ \/ \d+ \/ \d+ \/ \d+ \/ [0-9a-f]{32}\|/.test(line) && !line.includes('undefined')
const v2 = body('supabase/manual/20261030030200_street_content_v2_apply.sql')
const replica = (sql) => `SET LOCAL session_replication_role = replica; ${sql} SET LOCAL session_replication_role = origin;`
const rewrite = (fn, from, to) => `DO $x$ BEGIN EXECUTE replace(pg_get_functiondef('${fn}'::regprocedure), '${from}', '${to}'); END $x$;`

const run = (sql) => {
  const out = spawnSync('docker', psqlArgs, { input: ['BEGIN;', ...setup, sql, 'ROLLBACK;'].join('\n'), encoding: 'utf8' })
  const lines = String(out.stdout ?? '').split('\n')
  return {
    status: out.status,
    gate: lines.find((line) => line.startsWith('0|')) ?? '',
    functions: lines.filter((line) => /^2[1-6]\|函式 /.test(line)),
    snapshots: lines.filter((line) => line.split('|').length >= 11),
    gates: lines.filter((line) => line.startsWith('0|')),
    snaps: lines.filter((line) => line.startsWith('snap|')),
    lines,
    error: String(out.stderr ?? '').split('\n').find((line) => line.includes('ERROR')) ?? '',
  }
}

const localState = () => query("select concat_ws(',', coalesce(to_regclass('public.member_street_saves')::text, '-'), (select count(*) from auth.users where email like 'street-check-%'), coalesce(to_regprocedure('public.merge_item_ok(text)')::text, '-'), (select count(*) from public.member_perk_catalog), (select purchase_enabled from public.member_perk_settings))")
const initial = localState()

let failed = 0
const report = (ok, label, detail = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `：${detail}` : ''}`)
}

report(true, '指紋常數與套用檔本文一致，且字串內空白不會被忽略')

const before = run(precheck)
report(before.status === 0 && before.error === '' && before.gate.includes('|可以套用|') && snapshotOk(before.snapshots[0]) && before.functions.length === 6 && before.functions.every((line) => line.endsWith('：v1|t')),
  '正式庫現況（v1）預檢為可以套用', before.gate || before.error || JSON.stringify(before.snapshots))

const after = run(`${precheck}\n${v2}\n${precheck}`)
const afterFunctions = after.functions.slice(6)
report(after.status === 0 && after.error === '' && after.gates.length === 2 && after.gates[1].includes('|已套用|') && afterFunctions.length === 6 && afterFunctions.every((line) => line.endsWith('：v2|t')),
  '交易內套用 v2 後預檢為已套用', after.gates[1] || after.error)
report(after.status === 0 && after.error === '' && after.snapshots.length === 2 && snapshotOk(after.snapshots[0]) && after.snapshots[0] === after.snapshots[1],
  '套用前後存檔、獎勵、點數、合成小舖數字完全相同', after.snapshots[1] || after.error || '沒有取得快照')

const dataSnap = `SELECT 'snap|' || concat_ws('|',
  (SELECT count(*) FROM public.member_street_saves),
  (SELECT coalesce(sum(coins), 0) FROM public.member_street_saves),
  (SELECT coalesce(sum(xp), 0) FROM public.member_street_saves),
  (SELECT md5(coalesce(string_agg(md5(progress::text), '' ORDER BY user_id), '')) FROM public.member_street_saves),
  (SELECT count(*) FROM public.member_point_entries),
  (SELECT coalesce(sum(balance), 0) FROM public.member_point_accounts),
  (SELECT count(*) FROM public.member_perk_catalog),
  (SELECT coalesce(sum(cost), 0) FROM public.member_perk_catalog),
  (SELECT count(*) FROM public.member_perk_holds),
  (SELECT count(*) FROM public.member_merge_shops));`
const canFix = run(`${v2}\n${guard}`)
report(canFix.status === 0 && canFix.error === '' && canFix.gate.includes('|可修補|') && !canFix.gate.includes('不可修補'),
  'v2 尚未修補時，修補預檢為可修補', canFix.gate || canFix.error)
const fixed = run(`${v2}\n${patch}\n${precheck}`)
const fixedFunctions = fixed.functions
report(fixed.status === 0 && fixed.error === '' && fixed.gate.includes('已套用（含套用欄位修正）') && !fixed.gate.includes('可以套用')
  && fixedFunctions.some((line) => line.includes('street_cloud_build：v2修正|t'))
  && fixedFunctions.filter((line) => line.endsWith('：v2|t')).length === 5,
  '修正版不會被舊 v2 預檢引導成可以重套', fixed.gate || fixed.error || fixedFunctions.join(' / '))
const already = run(`${v2}\n${patch}\n${guard}`)
report(already.status === 0 && already.error === '' && already.gate.includes('|已修補|'),
  '修補後預檢為已修補', already.gate || already.error)
const stable = run(`${v2}\n${dataSnap}\n${patch}\n${dataSnap}\n${patch}\n${dataSnap}`)
report(stable.status === 0 && stable.error === '' && stable.snaps.length === 3 && stable.snaps[0] === stable.snaps[1] && stable.snaps[1] === stable.snaps[2],
  '修補與重複執行都不改存檔、Pay 點數、商城或合成小舖', stable.snaps.join(' || ') || stable.error)
const unknown = run(`${v2}\n${rewrite('public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint)', '未解鎖的商品歸零', '未解鎖的商品歸零 ')}\n${guard}`)
report(unknown.status === 0 && unknown.error === '' && unknown.gate.includes('不可修補') && unknown.functions.some((line) => line.includes('street_cloud_build：未知版本')),
  '未知函式版本不可修補', unknown.gate || unknown.error)
const v1Patch = run(patch)
report(v1Patch.status !== 0 && v1Patch.error.includes('不可修補'),
  'v1 直接執行修補檔會拒絕', v1Patch.error || v1Patch.gate)

const user = 'aaaaaaaa-0000-4000-8000-0000000000e1'
const faults = [
  ['其他階段改過 get_my_street_save', rewrite('public.get_my_street_save()', "''disabled''", "''disabled_by_other_stage''"), 3],
  ['存檔裡有 v2 不認得的裝潢', replica(`UPDATE public.member_street_saves SET progress = jsonb_set(progress, '{ownedDecors}', '["mat","rooftop"]') WHERE user_id = '${user}';`), 6],
  ['buildings 不是陣列', `UPDATE public.member_street_saves SET progress = jsonb_set(progress, '{buildings}', '{"tea":1}'::jsonb) WHERE user_id = '${user}';`, 6],
  ['ownedDecors 不是陣列', `UPDATE public.member_street_saves SET progress = jsonb_set(progress, '{ownedDecors}', '"lantern"'::jsonb) WHERE user_id = '${user}';`, 6],
  ['存檔內容與欄位不一致', replica(`UPDATE public.member_street_saves SET coins = coins + 1 WHERE user_id = '${user}';`), 5],
  ['獎勵入帳防重複主鍵被移除', 'ALTER TABLE public.member_street_save_credits DROP CONSTRAINT member_street_save_credits_pkey;', 7],
  ['存檔函式碰到點數帳本', rewrite('public.save_my_street(bigint, jsonb, uuid)', '請先登入', '請先登入 member_point_entries'), 8],
  ['輔助函式寫入點數帳本', rewrite('public.street_cloud_int(jsonb, bigint, bigint)', 'BEGIN', 'BEGIN UPDATE public.member_point_accounts SET balance = balance WHERE false;'), 8],
  ['觸發器寫入點數帳本', `CREATE FUNCTION pg_temp.street_points_touch() RETURNS trigger LANGUAGE plpgsql AS $t$ BEGIN UPDATE public.member_point_accounts SET balance = balance WHERE false; RETURN NEW; END $t$; CREATE TRIGGER street_saves_points BEFORE UPDATE ON public.member_street_saves FOR EACH ROW EXECUTE FUNCTION pg_temp.street_points_touch();`, 8],
  ['缺少輔助函式', 'DROP FUNCTION public.street_cloud_int(jsonb, bigint, bigint);', 8],
  ['遊戲 Pay 點數發放打開', `ALTER TABLE public.game_reward_policies DROP CONSTRAINT game_reward_payout_closed; ${replica('UPDATE public.game_reward_policies SET payout_enabled = true;')}`, 9],
  ['會員可直接讀存檔表', 'GRANT SELECT ON public.member_street_saves TO authenticated;', 10],
  ['點數商城被關閉', 'UPDATE public.member_perk_settings SET purchase_enabled = false WHERE id = true;', 12],
  ['缺少存檔函式', 'DROP FUNCTION public.save_my_street(bigint, jsonb, uuid);', 1],
  ['缺少資料表', 'DROP TABLE public.street_cloud_settings;', 1],
  ['缺少欄位', 'ALTER TABLE public.member_street_saves DROP COLUMN import_adjusted;', 2],
  ['欄位可為空', 'ALTER TABLE public.street_cloud_settings ALTER COLUMN enabled DROP NOT NULL;', 2],
  ['欄位型別不符', 'ALTER TABLE public.member_street_saves ALTER COLUMN shop_level TYPE integer USING shop_level::integer;', 2],
  ['只改字串內空白', rewrite('public.street_cloud_spec()', '"tea"', '"te a"'), 3, (r) => r.functions.some((line) => line.includes('street_cloud_spec：未知版本'))],
  ['匿名者可執行存檔', 'GRANT EXECUTE ON FUNCTION public.save_my_street(bigint, jsonb, uuid) TO anon;', 13],
  ['存檔函式不再驗證登入', rewrite('public.import_my_street_save(jsonb, uuid)', 'auth.uid()', 'NULL::uuid'), 13],
]
const items = Object.fromEntries([...precheck.matchAll(/SELECT (\d+), '([^']+)'/g)].map((m) => [m[1], m[2]]))
for (const [label, fault, item, extra] of faults) {
  if (!items[item]) throw new Error(`預檢沒有第 ${item} 項`)
  const r = run(`${fault}\n${precheck}`)
  const ok = r.status === 0 && r.error === '' && r.gate.includes('不可套用') && r.gate.includes(items[item]) && (extra ? extra(r) : true)
  report(ok, `異常「${label}」預檢為不可套用並指出第 ${item} 項`, ok ? '' : r.gate || r.error || `status ${r.status}`)
}

report(localState() === initial, '全部情境回滾，本機資料庫維持原狀', localState())

if (failed) process.exit(1)
console.log(`street content v2 readonly check local test passed: ${faults.length + 10} checks (rolled back)`)
