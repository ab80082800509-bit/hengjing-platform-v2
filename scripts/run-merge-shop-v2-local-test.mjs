// 只在本機隔離 Supabase（docker）跑第 9 批合成小舖 v2 SQL 驗收，整段在一個交易裡，最後 ROLLBACK，不留任何資料。
// 用法：node scripts/run-merge-shop-v2-local-test.mjs [容器名稱]
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const container = process.argv[2] ?? 'supabase_db_hengjing-stage45-local'
const body = (file) => {
  const sql = readFileSync(file, 'utf8')
  const start = sql.indexOf('BEGIN;')
  const end = sql.lastIndexOf('COMMIT;')
  if (start < 0 || end < start) throw new Error(`${file} 沒有 BEGIN/COMMIT`)
  return sql.slice(start + 'BEGIN;'.length, end)
}

// 套用 v2 之前先用 v1 函式建立一筆 Lv.3 舊存檔，記下訂單與圖鑑。
const legacy = `
INSERT INTO auth.users (id, email, aud, role, instance_id)
VALUES
  ('cccccccc-0000-4000-8000-0000000000e1', 'merge-old@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('dddddddd-0000-4000-8000-0000000000e2', 'merge-new@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
SELECT set_config('request.jwt.claims', json_build_object('sub', 'cccccccc-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-0000000000e1', true);
SET LOCAL ROLE authenticated;
SELECT public.apply_my_merge_shop_action(gen_random_uuid()::text, 'start', '{}');
RESET ROLE;
SELECT set_config('merge.internal', 'on', true);
UPDATE public.member_merge_shops SET shop_level = 3, catalog = '["tea-1","tea-2","snack-1","gift-1"]', orders = jsonb_build_array(public.merge_make_order(3, 4, 9), public.merge_make_order(3, 5, 9)) WHERE user_id = 'cccccccc-0000-4000-8000-0000000000e1';
SELECT set_config('merge.internal', 'off', true);
SELECT set_config('test.v1_orders', (SELECT orders::text FROM public.member_merge_shops WHERE user_id = 'cccccccc-0000-4000-8000-0000000000e1'), true);
SELECT set_config('test.v1_catalog', (SELECT catalog::text FROM public.member_merge_shops WHERE user_id = 'cccccccc-0000-4000-8000-0000000000e1'), true);
`

const parts = [
  'BEGIN;',
  legacy,
  body('supabase/manual/20261030030100_merge_shop_v2_apply.sql'),
  readFileSync('supabase/manual/20261030030400_merge_shop_v2_local_test.sql', 'utf8'),
  'ROLLBACK;',
]

const run = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: parts.join('\n'), encoding: 'utf8' })
const lines = String(run.stderr ?? '').split('\n').filter((line) => /PASS|FAIL|ERROR/.test(line))
console.log(lines.join('\n'))
if (run.status !== 0) process.exit(1)
console.log(`merge shop v2 local SQL test passed: ${lines.filter((line) => line.includes('PASS')).length} checks (rolled back)`)
