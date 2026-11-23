// 只在本機隔離 Supabase（docker）跑第 9 批雲端存檔 SQL 驗收，整段在一個交易裡，最後 ROLLBACK，不留任何資料。
// 用法：node scripts/run-street-cloud-local-test.mjs [容器名稱]
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
const psql = (args, input) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const has = (rel) => psql(['-tAc', `select to_regclass('${rel}') is not null`]).trim() === 't'

const parts = ['BEGIN;']
if (!has('public.member_street_friends')) parts.push(body('supabase/manual/20261029220200_street_friend_help_apply.sql'))
if (!has('public.member_street_steals')) parts.push(body('supabase/manual/20261029230100_street_steal_explore_apply.sql'))
parts.push(body('supabase/manual/20261030010100_street_cloud_save_apply.sql'))
parts.push(readFileSync('supabase/manual/20261030010200_street_cloud_save_local_test.sql', 'utf8'))
parts.push('ROLLBACK;')

const run = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: parts.join('\n'), encoding: 'utf8' })
const notices = String(run.stderr ?? '').split('\n').filter((line) => /PASS|FAIL|ERROR/.test(line))
console.log(notices.join('\n'))
if (run.status !== 0) process.exit(1)
console.log(`street cloud save local SQL test passed: ${notices.filter((line) => line.includes('PASS')).length} checks (rolled back)`)
