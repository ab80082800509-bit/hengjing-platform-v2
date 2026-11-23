// 只在本機隔離 Supabase（docker）驗收開放兌換 SQL 與唯讀預檢。每個情境各自一個交易，最後 ROLLBACK，不留任何資料。
// 商城 v2 已安裝時不再重跑會拒絕重複套用的歷史檔。開放 SQL 仍要求 40 件全部上架，
// 所以情境交易內只把已停售的 sticker-party 暫時改回上架，結束時回復。
// 正常情境：預檢「可以開放」，開放 SQL 成功。異常情境：預檢「不可開放」，開放 SQL 以預期訊息中止並整筆回滾。
// 用法：node scripts/run-points-mall-open-purchase-local-test.mjs [容器名稱]
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

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
const mallInstalled = has('public.member_perk_sale_windows')
if (!mallInstalled) setup.push(body('supabase/manual/20261030020100_points_mall_v2_apply.sql'))
setup.push('UPDATE public.member_perk_settings SET purchase_enabled = false WHERE id = true;')
setup.push(`DO $restore_open_precondition$
BEGIN
  IF to_regclass('public.member_perk_catalog') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_perk_catalog WHERE active IS NOT TRUE AND id <> 'sticker-party') THEN
    RETURN;
  END IF;
  PERFORM set_config('app.perk_catalog', 'on', true);
  UPDATE public.member_perk_catalog SET active = true WHERE id = 'sticker-party' AND active IS DISTINCT FROM true;
  PERFORM set_config('app.perk_catalog', 'off', true);
END
$restore_open_precondition$;`)

const precheck = between('supabase/manual/20261030020190_points_mall_open_purchase_readonly_check.sql', 'BEGIN READ ONLY;', 'ROLLBACK;')
const open = body('supabase/manual/20261030020200_points_mall_open_purchase.sql')
const replica = (sql) => `SET LOCAL session_replication_role = replica; ${sql} SET LOCAL session_replication_role = origin;`
const rewrite = (fn, from, to) => `DO $x$ BEGIN EXECUTE replace(pg_get_functiondef('${fn}'::regprocedure), '${from}', '${to}'); END $x$;`

const after = `DO $after$ BEGIN
  IF (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) IS NOT TRUE
     OR (SELECT checkout_enabled FROM public.commerce_settings WHERE id = true) IS DISTINCT FROM false
     OR (SELECT coalesce(bool_or(payout_enabled), false) FROM public.game_reward_policies)
     OR (SELECT sum(cost) FROM public.member_perk_catalog) IS DISTINCT FROM 5994 THEN
    RAISE EXCEPTION 'FAIL 開放後狀態不正確';
  END IF;
END $after$;`

const scenarios = [
  ['正常情況可以開放', '', null],
  ['價格被改動', replica(`UPDATE public.member_perk_catalog SET cost = cost + 1 WHERE id = 'pet-cat';`), '40 件商品價格'],
  ['總額不變但有 0 點商品', `ALTER TABLE public.member_perk_catalog DROP CONSTRAINT member_perk_catalog_cost_check; ${replica(`UPDATE public.member_perk_catalog SET cost = 0 WHERE id = 'pet-cat'; UPDATE public.member_perk_catalog SET cost = 240 WHERE id = 'pet-shiba';`)}`, '40 件商品價格'],
  ['商品下架', replica(`UPDATE public.member_perk_catalog SET active = false WHERE id = 'pet-cat';`), '40 件商品價格'],
  ['商品少一件', replica(`DELETE FROM public.member_perk_holds WHERE perk_id = 'sticker-party'; DELETE FROM public.member_perk_catalog WHERE id = 'sticker-party';`), '40 件商品價格'],
  ['節慶販售期間少一筆', replica(`DELETE FROM public.member_perk_sale_windows WHERE perk_id = 'collect-moon' AND starts_on = '2030-09-11';`), '節慶販售期間'],
  ['數量上限被移除', replica(`UPDATE public.member_perk_catalog SET stock_limit = NULL WHERE id = 'collect-moon';`), '數量上限或解鎖條件'],
  ['解鎖條件被移除', replica(`UPDATE public.member_perk_catalog SET unlock_metric = NULL, unlock_target = NULL WHERE id = 'decor-fountain';`), '數量上限或解鎖條件'],
  ['兌換開關設定列不見', replica('DELETE FROM public.member_perk_settings;'), '兌換開關設定列異常'],
  ['checkout_enabled 為 true', replica('UPDATE public.commerce_settings SET checkout_enabled = true WHERE id = true;'), 'checkout_enabled 必須維持 false'],
  ['遊戲 Pay 點數發放打開', `ALTER TABLE public.game_reward_policies DROP CONSTRAINT game_reward_payout_closed; ${replica('UPDATE public.game_reward_policies SET payout_enabled = true;')}`, '遊戲 Pay 點數發放必須維持關閉'],
  ['依賴函式缺少', 'DROP FUNCTION public.perk_sale_open(text, date) CASCADE;', '請先套用點數商城 v2'],
  ['兌換入口不入庫', rewrite('public.purchase_my_perk(text)', 'INSERT INTO public.member_perk_holds', 'INSERT INTO public.member_perk_holds_off'), '兌換入口缺少'],
  ['兌換入口不檢查登入', rewrite('public.purchase_my_perk(text)', 'auth.uid()', 'NULL::uuid'), '兌換入口缺少'],
  ['兌換入口吞掉錯誤', `DO $x$ BEGIN EXECUTE regexp_replace(pg_get_functiondef('public.purchase_my_perk(text)'::regprocedure), 'END;\\s*\\$function\\$\\s*$', E'EXCEPTION\\n  WHEN OTHERS THEN RETURN NULL;\\nEND;\\n$function$'); END $x$;`, '兌換入口缺少'],
  ['扣點不寫點數流水', rewrite('public.post_perk_unlock_debit(uuid, text, jsonb)', 'INSERT INTO public.member_point_entries', 'INSERT INTO public.member_point_entries_off'), '扣點函式缺少點數流水'],
  ['兌換入口改為 SECURITY INVOKER', 'ALTER FUNCTION public.purchase_my_perk(text) SECURITY INVOKER;', 'SECURITY DEFINER'],
  ['防重複唯一鍵被移除', 'ALTER TABLE public.member_perk_holds DROP CONSTRAINT member_perk_holds_user_perk;', '防重複購買的唯一鍵'],
  ['點數流水唯一鍵被移除', 'ALTER TABLE public.member_point_entries DROP CONSTRAINT member_point_entries_user_claim;', '防重複購買的唯一鍵'],
  ['訪客可呼叫兌換', 'GRANT EXECUTE ON FUNCTION public.purchase_my_perk(text) TO anon;', '兌換入口權限不正確'],
  ['扣點函式開放給 API', 'GRANT EXECUTE ON FUNCTION public.post_perk_unlock_debit(uuid, text, jsonb) TO authenticated;', '內部函式不能開放給 API'],
  ['會員可直接改點數帳戶', 'GRANT UPDATE ON public.member_point_accounts TO authenticated;', '會員不能直接寫入'],
  ['收藏表關閉 RLS', 'ALTER TABLE public.member_perk_holds DISABLE ROW LEVEL SECURITY;', '資料表必須啟用 RLS'],
  ['開關保護觸發器停用', 'ALTER TABLE public.member_perk_settings DISABLE TRIGGER member_perk_settings_guard;', '保護觸發器'],
]

const snapshot = () => query(`select concat_ws(',', (select purchase_enabled from public.member_perk_settings), (select count(*) from public.member_perk_catalog), (select count(*) from public.member_perk_catalog where active), (select active from public.member_perk_catalog where id = 'sticker-party'), (select sum(cost) from public.member_perk_catalog), (select count(*) from public.member_perk_sale_windows), (select checkout_enabled from public.commerce_settings), (select bool_or(payout_enabled) from public.game_reward_policies), (select count(*) from public.member_point_entries), (select coalesce(sum(balance), 0) from public.member_point_accounts), (select count(*) from public.member_perk_holds))`)
const before = snapshot()
let failed = 0

const readOnly = spawnSync('docker', psqlArgs, { input: readFileSync('supabase/manual/20261030020190_points_mall_open_purchase_readonly_check.sql'), encoding: 'utf8' })
const readOnlyLines = String(readOnly.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
const gateNow = readOnlyLines.find((line) => line.startsWith('0|')) ?? ''
const item2Now = readOnlyLines.find((line) => line.startsWith('2|')) ?? ''
const liveOk = readOnly.status === 0 && (gateNow.includes('|已開放|') || gateNow.includes('|可以開放|')) && item2Now.endsWith('|t')
if (!liveOk) failed = 1
console.log(`${liveOk ? 'PASS' : 'FAIL'} 目前目錄是兩種合法狀態之一${liveOk ? '' : `\n  預檢：${gateNow || readOnly.stderr}`}`)

const otherOff = ['BEGIN;', `SELECT set_config('app.perk_catalog', 'on', true);`, `UPDATE public.member_perk_catalog SET active = false WHERE id = 'pet-cat';`, precheck, 'ROLLBACK;'].join('\n')
const otherOffRun = spawnSync('docker', psqlArgs, { input: otherOff, encoding: 'utf8' })
const otherOffGate = String(otherOffRun.stdout ?? '').split('\n').find((line) => line.startsWith('0|')) ?? ''
const otherOffItem = String(otherOffRun.stdout ?? '').split('\n').find((line) => line.startsWith('2|')) ?? ''
const otherOffOk = otherOffRun.status === 0 && otherOffGate.includes('不可開放') && otherOffItem.endsWith('|f')
if (!otherOffOk) failed = 1
console.log(`${otherOffOk ? 'PASS' : 'FAIL'} 其他商品下架不能通過預檢${otherOffOk ? '' : `\n  預檢：${otherOffGate}\n  第2項：${otherOffItem}\n  錯誤：${otherOffRun.stderr}`}`)

const buyer = 'e1000000-0000-4000-8000-0000000000e1'
const purchaseProbe = `BEGIN;
INSERT INTO auth.users (id, email, aud, role, instance_id) VALUES ('${buyer}', 'mall-stop-sale@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
SET LOCAL session_replication_role = replica;
WITH seed AS (
  INSERT INTO public.member_point_entries (user_id, delta, balance_after, kind, claim_key, taipei_day, metadata)
  VALUES ('${buyer}', 500, 500, 'scratch', 'scratch:mall-stop-sale', public.taipei_today(), '{}'::jsonb)
  RETURNING id, user_id, delta, balance_after, kind, claim_key, taipei_day
)
INSERT INTO public.reward_claims (user_id, kind, claim_key, taipei_day, delta, balance_after, point_entry_id, metadata)
SELECT user_id, kind, claim_key, taipei_day, delta, balance_after, id, '{}'::jsonb FROM seed;
INSERT INTO public.member_point_accounts (user_id, balance) VALUES ('${buyer}', 500);
SET LOCAL session_replication_role = origin;
CREATE TEMP TABLE mall_probe(step text, detail text) ON COMMIT DROP;
GRANT ALL ON TABLE mall_probe TO authenticated;
SELECT set_config('request.jwt.claim.sub', '${buyer}', true);
SELECT set_config('request.jwt.claims', '{"sub":"${buyer}","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $buy$
DECLARE
  msg text;
  bought jsonb;
BEGIN
  BEGIN
    PERFORM public.purchase_my_perk('sticker-party');
    RAISE EXCEPTION '停售貼圖包被兌換成功';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg NOT LIKE '%無法購買%' THEN
      RAISE EXCEPTION '停售貼圖包的拒絕原因不對：%', msg;
    END IF;
  END;
  bought := public.purchase_my_perk('board-wood');
  INSERT INTO mall_probe VALUES ('bought', bought::text);
END
$buy$;
RESET ROLE;
DO $check$
DECLARE
  bought jsonb;
BEGIN
  SELECT detail::jsonb INTO bought FROM mall_probe WHERE step = 'bought';
  IF (bought->>'balance')::int IS DISTINCT FROM 410
     OR NOT coalesce((bought->'owned') ? 'board-wood', false)
     OR coalesce((bought->'owned') ? 'sticker-party', false) THEN
    RAISE EXCEPTION '兌換結果不對：%', bought;
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_perk_holds WHERE user_id = '${buyer}' AND perk_id = 'sticker-party')
     OR EXISTS (SELECT 1 FROM public.member_point_entries WHERE user_id = '${buyer}' AND claim_key = 'perk_unlock:sticker-party') THEN
    RAISE EXCEPTION '停售貼圖包寫入了持有或點數流水';
  END IF;
  IF (SELECT balance FROM public.member_point_accounts WHERE user_id = '${buyer}') IS DISTINCT FROM 410
     OR (SELECT cost FROM public.member_perk_holds WHERE user_id = '${buyer}' AND perk_id = 'board-wood') IS DISTINCT FROM 90 THEN
    RAISE EXCEPTION '符合條件的商品沒有按原價入庫';
  END IF;
END
$check$;
ROLLBACK;`
const purchaseRun = spawnSync('docker', psqlArgs, { input: purchaseProbe, encoding: 'utf8' })
const purchaseOk = purchaseRun.status === 0 && !String(purchaseRun.stderr ?? '').includes('ERROR')
if (!purchaseOk) failed = 1
console.log(`${purchaseOk ? 'PASS' : 'FAIL'} 停售貼圖包不能購買且不扣點，其他商品可按原價兌換${purchaseOk ? '' : `\n  錯誤：${String(purchaseRun.stderr ?? '').split('\n').find((line) => line.includes('ERROR')) ?? purchaseRun.stderr}`}`)

for (const [label, mutation, want] of scenarios) {
  const sql = ['BEGIN;', ...setup, mutation, precheck, open, want ? '' : after, 'ROLLBACK;'].join('\n')
  const run = spawnSync('docker', psqlArgs, { input: sql, encoding: 'utf8' })
  const gate = String(run.stdout ?? '').split('\n').find((line) => line.startsWith('0|')) ?? ''
  const error = String(run.stderr ?? '').split('\n').find((line) => line.includes('ERROR')) ?? ''
  const ok = want
    ? run.status !== 0 && error.includes(want) && gate.includes('不可開放')
    : run.status === 0 && gate.includes('|可以開放|')
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${want ? `：${error.replace(/^.*ERROR:\s*/, '')}` : ''}${ok ? '' : `\n  預檢：${gate}\n  錯誤：${error}`}`)
}

const afterAll = snapshot()
if (afterAll !== before) {
  failed += 1
  console.log(`FAIL 本機資料庫在測試後有變動：${before} -> ${afterAll}`)
} else {
  console.log('PASS 全部情境回滾，本機資料庫狀態未變')
}
if (failed) process.exit(1)
console.log(`points mall open purchase local test passed: ${scenarios.length + 4} checks (rolled back)`)
