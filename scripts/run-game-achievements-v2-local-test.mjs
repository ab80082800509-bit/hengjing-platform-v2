// 只在本機隔離 Supabase（docker）跑第 9 批成就 v2 SQL 驗收，整段在一個交易裡，最後 ROLLBACK，不留任何資料。
// 用法：node scripts/run-game-achievements-v2-local-test.mjs [容器名稱]
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const container = process.argv[2] ?? 'supabase_db_hengjing-stage45-local'
const body = (file) => {
  const sql = readFileSync(file, 'utf8')
  const start = sql.indexOf('BEGIN;')
  const end = sql.lastIndexOf('COMMIT;')
  if (start < 0 || end < start) throw new Error(`${file} 沒有 BEGIN/COMMIT`)
  return sql.slice(start + 'BEGIN;'.length, end)
}
const psql = (args) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8' })
const has = (rel) => psql(['-tAc', `select to_regclass('${rel}') is not null`]).trim() === 't'

const A = 'aaaaaaaa-0000-4000-8000-0000000000a7'
const B = 'bbbbbbbb-0000-4000-8000-0000000000b7'
const asMember = (id) => `
SELECT set_config('request.jwt.claims', json_build_object('sub', '${id}', 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', '${id}', true);
SET LOCAL ROLE authenticated;`
// 套用成就 v2 之前：A 開張並完成一張訂單，解鎖舊成就 merge_first_order。
const legacy = `
INSERT INTO auth.users (id, email, aud, role, instance_id)
VALUES ('${A}', 'achv-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
       ('${B}', 'achv-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
${asMember(A)}
SELECT public.apply_my_merge_shop_action(gen_random_uuid()::text, 'start', '{}');
SELECT public.apply_my_merge_shop_action(gen_random_uuid()::text, 'serve', '{"orderId":"ord-0-0","cells":[0,1]}');
SELECT public.sync_my_game_achievements();
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.member_game_achievements WHERE user_id = '${A}' AND achievement_id = 'merge_first_order') THEN
    RAISE EXCEPTION 'FAIL 前置：舊成就沒有解鎖';
  END IF;
END $$;
`

const parts = ['BEGIN;']
if (!has('public.member_street_friends')) parts.push(body('supabase/manual/20261029220200_street_friend_help_apply.sql'))
if (!has('public.member_street_steals')) parts.push(body('supabase/manual/20261029230100_street_steal_explore_apply.sql'))
if (!has('public.member_street_saves')) parts.push(body('supabase/manual/20261030010100_street_cloud_save_apply.sql'))
if (!has('public.block_ranked_runs')) parts.push(body('supabase/manual/20261027010000_block_weekly_board_preview.sql'))
parts.push(body('supabase/manual/20261030030100_merge_shop_v2_apply.sql'))
parts.push(legacy)
parts.push(body('supabase/manual/20261030030300_game_achievements_v2_apply.sql'))
parts.push(readFileSync('supabase/manual/20261030030600_game_achievements_v2_local_test.sql', 'utf8'))
parts.push('ROLLBACK;')

const run = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: parts.join('\n'), encoding: 'utf8' })
const lines = String(run.stderr ?? '').split('\n').filter((line) => /PASS|FAIL|ERROR/.test(line))
console.log(lines.join('\n'))
if (run.status !== 0) process.exit(1)
console.log(`game achievements v2 local SQL test passed: ${lines.filter((line) => line.includes('PASS')).length} checks (rolled back)`)
