// 只在本機隔離 Supabase（docker）驗收活動輪替唯讀預檢。每個情境各自一個交易，最後 ROLLBACK，不留任何資料。
// 用法：node scripts/run-live-events-readonly-check-local-test.mjs [容器名稱]
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const md5 = (text) => createHash('md5').update(text.replace(/\r\n/g, '\n')).digest('hex')
const functionBody = (sql, marker) => {
  const at = sql.indexOf(marker)
  if (at < 0) throw new Error(`套用檔找不到 ${marker}`)
  const as = sql.indexOf('AS $$', at)
  const end = sql.indexOf('\n$$', as + 5)
  if (as < 0 || end < 0) throw new Error(`套用檔函式本文無法截取 ${marker}`)
  return sql.slice(as + 'AS $$'.length, end + 1)
}

const container = process.argv[2] ?? 'supabase_db_hengjing-stage45-local'
const applyFile = 'supabase/manual/20261030030700_live_events_apply.sql'
const checkFile = 'supabase/manual/20261030030790_live_events_readonly_check.sql'
const applySql = readFileSync(applyFile, 'utf8')
const checkSql = readFileSync(checkFile, 'utf8')
const between = (sql, open, close) => {
  const start = sql.indexOf(open)
  const end = sql.lastIndexOf(close)
  if (start < 0 || end < start) throw new Error(`沒有 ${open}/${close}`)
  return sql.slice(start + open.length, end)
}
const body = (file) => between(readFileSync(file, 'utf8'), 'BEGIN;', 'COMMIT;')
const precheck = between(checkSql, 'BEGIN READ ONLY;', 'ROLLBACK;')
const psqlBase = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-F', '|']
const query = (sql) => execFileSync('docker', [...psqlBase, '-t', '-c', sql], { encoding: 'utf8' }).trim()
const has = (rel) => query(`select to_regclass('${rel}') is not null`) === 't'

const names = [
  'live_event_period',
  'live_event_available',
  'live_event_metric',
  'live_event_state',
  'live_event_claim',
  'get_my_live_events',
  'claim_my_live_event',
]
const declared = Object.fromEntries([...checkSql.matchAll(/\('([a-z_]+)', '(public\.[^']+)', '([0-9a-f]{32})'/g)].map((m) => [m[1], m[3]]))
for (const name of names) {
  const got = md5(functionBody(applySql, `CREATE OR REPLACE FUNCTION public.${name}(`))
  if (declared[name] !== got) throw new Error(`${name} 的指紋常數與套用檔本文不一致，拒絕把資料庫現況登錄為可信版本`)
}
const claim = functionBody(applySql, 'CREATE OR REPLACE FUNCTION public.live_event_claim(')
const claimChanged = claim.replace('這一期已經領過活動紀錄', '這一期已經 領過活動紀錄')
if (claim === claimChanged || claim.replace(/\s+/g, '') !== claimChanged.replace(/\s+/g, '') || md5(claim) === md5(claimChanged)) {
  throw new Error('字串內空白的指紋測試案例無效')
}
const code = checkSql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
const statements = code.replace(/\$q\$[\s\S]*?\$q\$/g, '').replace(/'(?:[^']|'')*'/g, '')
for (const word of ['CREATE', 'INSERT', 'UPDATE', 'DELETE', 'ALTER', 'DROP', 'TRUNCATE']) {
  if (new RegExp(`\\b${word}\\b`, 'i').test(statements)) throw new Error(`唯讀預檢含有 ${word}`)
}
const calls = code.match(/live_event_(state|claim)\s*\(/g) ?? []
const quoted = code.match(/'public\.live_event_(state|claim)\([^']*\)'/g) ?? []
if (calls.length !== quoted.length) throw new Error('唯讀預檢不可呼叫會寫入活動紀錄的函式')
const sliceAfter = (sql, open, close) => {
  const start = sql.indexOf(open)
  const end = sql.indexOf(close, start + open.length)
  if (start < 0 || end < 0) throw new Error(`沒有 ${open}/${close}`)
  return sql.slice(start + open.length, end)
}
const eventInsert = sliceAfter(applySql, 'INSERT INTO public.game_live_events', 'ON CONFLICT')
const windowInsert = sliceAfter(applySql, 'INSERT INTO public.game_live_festival_windows', 'ON CONFLICT')
const eventParsed = [...eventInsert.matchAll(/^\s+\('([^']*)', '([^']*)', '([^']*)', (NULL|'[^']*'), '(\[.*\])'::jsonb, '([^']*)'\)/gm)].map((m) => {
  const festival = m[4] === 'NULL' ? '' : m[4].slice(1, -1)
  const variants = JSON.parse(m[5]).map((v) => `${v.metric}:${v.target}`).join(',')
  return { id: m[1], line: [m[1], m[2], m[3], festival, variants, m[6], '0', 'true'].join('|') }
})
eventParsed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
const windowParsed = [...windowInsert.matchAll(/^\s+\('([^']*)', DATE '(\d{4}-\d{2}-\d{2})', DATE '(\d{4}-\d{2}-\d{2})'\)/gm)].map((m) => ({
  festival: m[1],
  start: m[2],
  line: `${m[1]}|${m[2]}|${m[3]}`,
}))
windowParsed.sort((a, b) => (a.festival < b.festival ? -1 : a.festival > b.festival ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
const eventHash = md5(eventParsed.map((row) => row.line).join('\n'))
const windowHash = md5(windowParsed.map((row) => row.line).join('\n'))
const changedHash = md5(eventParsed.map((row) => (row.id === 'merge_daily_errand' ? row.line.replace('merge.merges:15', 'merge.merges:16') : row.line)).join('\n'))
if (eventParsed.length !== 33 || windowParsed.length !== 673 || eventHash === changedHash) {
  throw new Error(`套用檔目錄指紋無法逐列建立：${eventParsed.length}/${windowParsed.length}`)
}
const declaredCatalog = Object.fromEntries([...checkSql.matchAll(/\('(events|windows)', '([0-9a-f]{32})'\)/g)].map((m) => [m[1], m[2]]))
if (declaredCatalog.events !== eventHash || declaredCatalog.windows !== windowHash) {
  throw new Error('目錄指紋常數與套用檔逐列內容不一致，拒絕把資料庫現況登錄為可信版本')
}
if (!checkSql.includes("->> 'metric'") || !checkSql.includes("->> 'target'") || !checkSql.includes('to_char(starts_on,')) {
  throw new Error('預檢沒有逐列核對題目、目標與起訖日期')
}
if (/可以套用|可重跑|重跑整份/.test(checkSql)) throw new Error('尚未安裝不可寫成可重跑套用檔')

const deps = []
if (!has('public.member_merge_shop_events')) deps.push(body('supabase/manual/20261030030100_merge_shop_v2_apply.sql'))
const apply = body(applyFile)
const rewrite = `DO $x$ BEGIN EXECUTE replace(pg_get_functiondef('public.live_event_claim(uuid,text,timestamptz)'::regprocedure), '這一期已經領過活動紀錄', '這一期已經 領過活動紀錄'); END $x$;`
const dropPayCheck = `DO $x$ DECLARE n name; BEGIN SELECT conname INTO n FROM pg_constraint WHERE conrelid = 'public.game_live_events'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%pay_points = 0%' LIMIT 1; EXECUTE format('ALTER TABLE public.game_live_events DROP CONSTRAINT %I', n); END $x$;`
const dropPk = `DO $x$ DECLARE n name; BEGIN SELECT conname INTO n FROM pg_constraint WHERE conrelid = 'public.member_live_event_entries'::regclass AND contype = 'p'; EXECUTE format('ALTER TABLE public.member_live_event_entries DROP CONSTRAINT %I', n); END $x$;`
const openPayout = `DO $x$ DECLARE n name; BEGIN IF to_regclass('public.game_reward_policies') IS NULL THEN RAISE EXCEPTION '缺少 game_reward_policies'; END IF; FOR n IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.game_reward_policies'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%payout_enabled%' LOOP EXECUTE format('ALTER TABLE public.game_reward_policies DROP CONSTRAINT %I', n); END LOOP; END $x$; SET LOCAL session_replication_role = replica; UPDATE public.game_reward_policies SET payout_enabled = true; SET LOCAL session_replication_role = origin;`
const onlyEvents = `
DROP FUNCTION IF EXISTS public.claim_my_live_event(text);
DROP FUNCTION IF EXISTS public.get_my_live_events();
DROP FUNCTION IF EXISTS public.live_event_claim(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.live_event_state(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.live_event_metric(uuid, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.live_event_available(text);
DROP FUNCTION IF EXISTS public.live_event_period(text, timestamptz);
DROP TABLE IF EXISTS public.member_live_event_entries;
DROP TABLE IF EXISTS public.game_live_festival_windows;
DROP TABLE IF EXISTS public.game_live_events;
CREATE TABLE public.game_live_events (
  id text PRIMARY KEY,
  game_id text NOT NULL,
  cadence text NOT NULL,
  festival_id text,
  variants jsonb NOT NULL,
  medal text NOT NULL,
  pay_points integer NOT NULL DEFAULT 0 CHECK (pay_points = 0),
  active boolean NOT NULL DEFAULT true
);
ALTER TABLE public.game_live_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_live_events FROM PUBLIC, anon, authenticated;
`
const diag = `SELECT 'diag|' || p.proname || '|' || md5(replace(p.prosrc, E'\\r\\n', E'\\n')) || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(p.proconfig::text, '-')
FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND (p.proname LIKE 'live_event%' OR p.proname IN ('get_my_live_events', 'claim_my_live_event'))
ORDER BY p.proname;`

const run = (sql, { readOnlyFile = false } = {}) => {
  const input = readOnlyFile ? checkSql : ['BEGIN;', ...deps, sql, 'ROLLBACK;'].join('\n')
  const out = spawnSync('docker', psqlBase, { input, encoding: 'utf8' })
  const lines = String(out.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
  return {
    status: out.status,
    header: lines.find((line) => line.startsWith('judgment|')) ?? '',
    rows: lines.filter((line) => /^(已安裝且相容|尚未安裝|版本不相容)\|/.test(line)),
    diags: lines.filter((line) => line.startsWith('diag|')),
    error: String(out.stderr ?? '').split('\n').find((line) => line.includes('ERROR')) ?? '',
  }
}
const row = (result) => result.rows[0]?.split('|') ?? []
let headerNames = []
const col = (fields, name) => fields[headerNames.indexOf(name)] ?? ''
const fn = (fields, name) => col(fields, `fn_${name}`)

const localState = () => query("select concat_ws(',', coalesce(to_regclass('public.game_live_events')::text, '-'), coalesce(to_regclass('public.game_live_festival_windows')::text, '-'), coalesce(to_regclass('public.member_live_event_entries')::text, '-'), coalesce(to_regprocedure('public.claim_my_live_event(text)')::text, '-'), coalesce(to_regprocedure('public.live_event_claim(uuid,text,timestamptz)')::text, '-'))")
const initial = localState()
let failed = 0
const report = (ok, label, detail = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `：${detail}` : ''}`)
}

report(true, '指紋常數與套用檔本文一致，字串內空白不會被忽略，預檢不含寫入語句')

const bare = run('', { readOnlyFile: true })
const bareFields = row(bare)
headerNames = bare.header.split('|')
report(bare.status === 0 && bare.error === '' && bare.rows.length === 1 && headerNames.length === 27 && new Set(headerNames).size === 27 && col(bareFields, 'judgment') === '尚未安裝' && col(bareFields, 'reasons').includes('完全未安裝') && !col(bareFields, 'reasons').includes('部分安裝'),
  '目前隔離庫完全未安裝，預檢只回一列且欄名不重複', `${col(bareFields, 'judgment')} ${col(bareFields, 'reasons') || bare.error}`)
report(bare.status === 0 && col(bareFields, 'snap_point_accounts') && col(bareFields, 'snap_game_reward_payout') === '關閉' && col(bareFields, 'source_merge_events') === '就緒' && col(bareFields, 'source_street_saves') === '未就緒' && col(bareFields, 'source_block_runs') === '未就緒',
  '尚未安裝時仍標出必要依賴、可選資料來源與點數發放', [col(bareFields, 'source_merge_events'), col(bareFields, 'source_street_saves'), col(bareFields, 'source_block_runs'), col(bareFields, 'snap_game_reward_payout'), col(bareFields, 'snap_point_accounts')].join(' / ') || bare.error)

const installed = run(`${apply}\n${diag}\n${precheck}`)
const installedFields = row(installed)
const compatible = installed.status === 0 && installed.error === '' && installed.rows.length === 1
  && col(installedFields, 'judgment') === '已安裝且相容' && col(installedFields, 'reasons') === '無'
  && names.every((name) => fn(installedFields, name) === '相容')
  && col(installedFields, 'tables_columns') === '相容' && col(installedFields, 'rls_state') === '已開' && col(installedFields, 'claim_guard') === '防重主鍵在'
  && col(installedFields, 'pay_points_gate') === '關閉' && col(installedFields, 'member_access') === '僅會員入口' && col(installedFields, 'catalog_state') === '相容'
  && col(installedFields, 'snap_live_events') === '33/0' && col(installedFields, 'snap_live_entries') === '0/0' && col(installedFields, 'snap_festival_windows') === '673'
  && col(installedFields, 'snap_game_reward_payout') === '關閉'
  && col(installedFields, 'source_merge_events') === '就緒'
  && col(installedFields, 'source_street_saves') === '未就緒'
  && col(installedFields, 'source_block_runs') === '未就緒'
report(compatible, '交易內套用既有檔後判定為已安裝且相容', compatible ? installedFields.slice(0, 15).join(' | ') : `${installedFields.join(' | ') || installed.error} ${installed.diags.join(' ; ')}`)

const progress = ['snap_point_accounts', 'snap_point_entries', 'snap_merge_shops', 'snap_street_saves', 'snap_block_runs', 'snap_game_reward_payout']
report(compatible && progress.every((name) => col(bareFields, name) === col(installedFields, name)),
  '套用前後點數、合成小舖、商店街、方塊與 Pay 發放快照不變', progress.map((name) => `${col(bareFields, name)}=>${col(installedFields, name)}`).join(' ; '))

const unknown = run(`${apply}\n${rewrite}\n${precheck}`)
const unknownFields = row(unknown)
report(unknown.status === 0 && unknown.error === '' && col(unknownFields, 'judgment') === '版本不相容' && fn(unknownFields, 'live_event_claim') === '未知版本' && names.filter((name) => name !== 'live_event_claim').every((name) => fn(unknownFields, name) === '相容'),
  '領獎函式只改字串內空白時判定為版本不相容', `${col(unknownFields, 'judgment')} ${fn(unknownFields, 'live_event_claim') || unknown.error}`)

const droppedFn = run(`${apply}\nDROP FUNCTION public.get_my_live_events();\n${precheck}`)
const droppedFnFields = row(droppedFn)
report(droppedFn.status === 0 && droppedFn.error === '' && col(droppedFnFields, 'judgment') === '尚未安裝' && col(droppedFnFields, 'reasons').includes('部分安裝') && !col(droppedFnFields, 'reasons').startsWith('完全未安裝') && fn(droppedFnFields, 'get_my_live_events') === '缺少',
  '缺少會員讀取函式時判定為部分安裝', `${col(droppedFnFields, 'judgment')} ${col(droppedFnFields, 'reasons') || droppedFn.error}`)

const partial = run(`${onlyEvents}\n${precheck}`)
const partialFields = row(partial)
report(partial.status === 0 && partial.error === '' && partial.rows.length === 1 && col(partialFields, 'judgment') === '尚未安裝' && col(partialFields, 'reasons').includes('部分安裝') && !col(partialFields, 'reasons').includes('完全未安裝') && fn(partialFields, 'live_event_period') === '缺少',
  '只有活動表、缺少節慶窗口與函式時不會中斷', `${col(partialFields, 'judgment')} ${col(partialFields, 'reasons') || partial.error}`)

const both = run(`${apply}\n${rewrite}\nDROP FUNCTION public.get_my_live_events();\n${precheck}`)
const bothFields = row(both)
report(both.status === 0 && both.error === '' && col(bothFields, 'judgment') === '版本不相容' && fn(bothFields, 'live_event_claim') === '未知版本' && fn(bothFields, 'get_my_live_events') === '缺少',
  '未知版本與缺少物件同時存在時判定為版本不相容', `${col(bothFields, 'judgment')} ${both.error}`)

const noPk = run(`${apply}\n${dropPk}\n${precheck}`)
const noPkFields = row(noPk)
report(noPk.status === 0 && noPk.error === '' && col(noPkFields, 'judgment') === '版本不相容' && col(noPkFields, 'claim_guard') === '主鍵缺少',
  '拿掉領獎防重主鍵時判定為版本不相容', `${col(noPkFields, 'judgment')} ${col(noPkFields, 'claim_guard') || noPk.error}`)

const extraPk = run(`${apply}\n${dropPk}\nALTER TABLE public.member_live_event_entries ADD PRIMARY KEY (user_id, event_id, period_key, variant);\n${precheck}`)
const extraPkFields = row(extraPk)
report(extraPk.status === 0 && extraPk.error === '' && col(extraPkFields, 'judgment') === '版本不相容' && col(extraPkFields, 'claim_guard') === '主鍵範圍不符',
  '防重主鍵多一欄時判定為版本不相容', `${col(extraPkFields, 'judgment')} ${col(extraPkFields, 'claim_guard') || extraPk.error}`)

const wide = run(`${apply}\nGRANT EXECUTE ON FUNCTION public.live_event_claim(uuid, text, timestamptz) TO authenticated;\n${precheck}`)
const wideFields = row(wide)
report(wide.status === 0 && wide.error === '' && col(wideFields, 'judgment') === '版本不相容' && col(wideFields, 'member_access') === '權限過寬',
  '會員可直接執行內部領獎函式時判定為版本不相容', `${col(wideFields, 'judgment')} ${col(wideFields, 'member_access') || wide.error}`)

const anonExec = run(`${apply}\nGRANT EXECUTE ON FUNCTION public.live_event_period(text, timestamptz) TO anon;\n${precheck}`)
const anonExecFields = row(anonExec)
report(anonExec.status === 0 && anonExec.error === '' && col(anonExecFields, 'judgment') === '版本不相容' && col(anonExecFields, 'member_access') === '權限過寬',
  '匿名者可執行內部函式時判定為版本不相容', `${col(anonExecFields, 'judgment')} ${col(anonExecFields, 'member_access') || anonExec.error}`)

const wideTable = run(`${apply}\nGRANT INSERT ON public.member_live_event_entries TO authenticated;\n${precheck}`)
const wideTableFields = row(wideTable)
report(wideTable.status === 0 && wideTable.error === '' && col(wideTableFields, 'judgment') === '版本不相容' && col(wideTableFields, 'member_access') === '權限過寬',
  '會員可直接寫領獎紀錄時判定為版本不相容', `${col(wideTableFields, 'judgment')} ${col(wideTableFields, 'member_access') || wideTable.error}`)

const widePublic = run(`${apply}\nGRANT SELECT ON public.game_live_events TO PUBLIC;\n${precheck}`)
const widePublicFields = row(widePublic)
report(widePublic.status === 0 && widePublic.error === '' && col(widePublicFields, 'judgment') === '版本不相容' && col(widePublicFields, 'member_access') === '權限過寬',
  'PUBLIC 可讀活動表時判定為版本不相容', `${col(widePublicFields, 'judgment')} ${col(widePublicFields, 'member_access') || widePublic.error}`)

const noPay = run(`${apply}\n${dropPayCheck}\n${precheck}`)
const noPayFields = row(noPay)
report(noPay.status === 0 && noPay.error === '' && col(noPayFields, 'judgment') === '版本不相容' && col(noPayFields, 'pay_points_gate') === '檢查缺少',
  '拿掉 pay_points 必須為 0 的檢查時判定為版本不相容', `${col(noPayFields, 'judgment')} ${col(noPayFields, 'pay_points_gate') || noPay.error}`)

const wrongType = run(`${apply}\nALTER TABLE public.member_live_event_entries ALTER COLUMN variant TYPE bigint;\n${precheck}`)
const wrongTypeFields = row(wrongType)
report(wrongType.status === 0 && wrongType.error === '' && col(wrongTypeFields, 'judgment') === '版本不相容' && col(wrongTypeFields, 'tables_columns').includes('型別不符'),
  '欄位型別不同時判定為版本不相容', `${col(wrongTypeFields, 'judgment')} ${col(wrongTypeFields, 'tables_columns') || wrongType.error}`)

const missingCol = run(`${apply}\nALTER TABLE public.game_live_events DROP COLUMN medal;\n${precheck}`)
const missingColFields = row(missingCol)
report(missingCol.status === 0 && missingCol.error === '' && col(missingColFields, 'judgment') === '尚未安裝' && col(missingColFields, 'reasons').includes('部分安裝') && col(missingColFields, 'tables_columns').includes('缺少欄位') && col(missingColFields, 'catalog_state') === '缺少欄位',
  '缺少目錄查詢欄位時不中斷，並判定為部分安裝', `${col(missingColFields, 'judgment')} ${col(missingColFields, 'catalog_state') || missingCol.error}`)

const changed = run(`${apply}\nUPDATE public.game_live_events SET variants = '[{"metric":"merge.orders","target":5},{"metric":"merge.merges","target":16}]'::jsonb WHERE id = 'merge_daily_errand';\n${precheck}`)
const changedFields = row(changed)
report(changed.status === 0 && changed.error === '' && col(changedFields, 'judgment') === '版本不相容' && col(changedFields, 'catalog_state') === '內容不符' && col(changedFields, 'snap_live_events') === '33/0' && col(changedFields, 'snap_festival_windows') === '673',
  '同筆數但題目目標改變時判定為版本不相容', `${col(changedFields, 'judgment')} ${col(changedFields, 'catalog_state') || changed.error}`)

const inactive = run(`${apply}\nUPDATE public.game_live_events SET active = false WHERE id = 'season_street_parade';\n${precheck}`)
const inactiveFields = row(inactive)
report(inactive.status === 0 && inactive.error === '' && col(inactiveFields, 'judgment') === '版本不相容' && col(inactiveFields, 'catalog_state') === '內容不符' && col(inactiveFields, 'snap_live_events') === '33/0',
  'active 被關掉時判定為版本不相容', `${col(inactiveFields, 'judgment')} ${col(inactiveFields, 'catalog_state') || inactive.error}`)

const movedDate = run(`${apply}\nUPDATE public.game_live_festival_windows SET ends_on = DATE '2026-03-05' WHERE festival_id = 'lantern-festival' AND starts_on = DATE '2026-03-03';\n${precheck}`)
const movedDateFields = row(movedDate)
report(movedDate.status === 0 && movedDate.error === '' && col(movedDateFields, 'judgment') === '版本不相容' && col(movedDateFields, 'catalog_state') === '內容不符' && col(movedDateFields, 'snap_festival_windows') === '673',
  '節慶日期改變時判定為版本不相容', `${col(movedDateFields, 'judgment')} ${col(movedDateFields, 'catalog_state') || movedDate.error}`)

const mismatch = run(`${apply}\nDELETE FROM public.game_live_festival_windows WHERE ctid IN (SELECT ctid FROM public.game_live_festival_windows LIMIT 1);\n${precheck}`)
const mismatchFields = row(mismatch)
report(mismatch.status === 0 && mismatch.error === '' && col(mismatchFields, 'judgment') === '版本不相容' && col(mismatchFields, 'catalog_state') === '內容不符',
  '目錄筆數與套用檔不同時判定為版本不相容', `${col(mismatchFields, 'judgment')} ${col(mismatchFields, 'catalog_state') || mismatch.error}`)

const payout = run(`${apply}\n${openPayout}\n${precheck}`)
const payoutFields = row(payout)
report(payout.status === 0 && payout.error === '' && col(payoutFields, 'judgment') === '版本不相容' && col(payoutFields, 'snap_game_reward_payout') === '已開啟' && col(payoutFields, 'reasons').includes('遊戲 Pay 點數發放已開啟'),
  '遊戲 Pay 點數發放被打開時判定為版本不相容', `${col(payoutFields, 'judgment')} ${col(payoutFields, 'snap_game_reward_payout') || payout.error}`)

const noPayout = run(`${apply}\nALTER TABLE public.game_reward_policies DROP COLUMN payout_enabled CASCADE;\n${precheck}`)
const noPayoutFields = row(noPayout)
report(noPayout.status === 0 && noPayout.error === '' && col(noPayoutFields, 'judgment') === '版本不相容' && col(noPayoutFields, 'snap_game_reward_payout') !== '關閉' && col(noPayoutFields, 'reasons').includes('無法確認關閉'),
  '缺少點數發放設定時不可判定為已確認關閉', `${col(noPayoutFields, 'judgment')} ${col(noPayoutFields, 'snap_game_reward_payout') || noPayout.error} ${col(noPayoutFields, 'reasons')}`)

const missingBalance = run(`${apply}\nALTER TABLE public.member_point_accounts DROP COLUMN balance CASCADE;\n${precheck}`)
const missingBalanceFields = row(missingBalance)
report(missingBalance.status === 0 && missingBalance.error === '' && missingBalance.rows.length === 1 && col(missingBalanceFields, 'snap_point_accounts') === '欄位缺少' && col(missingBalanceFields, 'judgment') === '已安裝且相容',
  '缺少快照查詢欄位時不中斷，並在快照欄標出原因', `${col(missingBalanceFields, 'judgment')} ${col(missingBalanceFields, 'snap_point_accounts') || missingBalance.error}`)

const missingDependency = run(`${apply}\nALTER TABLE public.member_merge_shop_events RENAME TO member_merge_shop_events_hidden;\n${precheck}`)
const missingDependencyFields = row(missingDependency)
report(missingDependency.status === 0 && missingDependency.error === '' && col(missingDependencyFields, 'judgment') === '版本不相容' && col(missingDependencyFields, 'source_merge_events') === '缺少資料表' && col(missingDependencyFields, 'reasons').includes('必要依賴 member_merge_shop_events'),
  '必要依賴缺少時不可判定為已安裝且相容', `${col(missingDependencyFields, 'judgment')} ${col(missingDependencyFields, 'source_merge_events') || missingDependency.error}`)

const after = localState()
report(after === initial, '全部情境都已回滾，隔離庫活動物件與測試前相同', `${initial} => ${after}`)

if (failed > 0) process.exit(1)
console.log('live events readonly check local test passed (rolled back)')
