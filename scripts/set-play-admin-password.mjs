/**
 * 為 3001 隔離試玩（hengjing-stage45-local Docker）的「既有」本機管理員設定登入密碼。
 * - 只操作本機容器 supabase_db_hengjing-stage45-local。
 * - 只接受 profiles.role 已經是 admin 的帳號；不建立帳號、不變更角色。
 * - 密碼為本機隨機產生，寫回 .env.play.local 的 PLAYTEST_ADMIN_*（已被 .gitignore 排除）。
 * 用法：node scripts/set-play-admin-password.mjs [email]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const envFile = resolve(root, '.env.play.local')
const container = 'supabase_db_hengjing-stage45-local'
const email = (process.argv[2] || 'seller-rls-admin-20261027@example.test').trim().toLowerCase()

if (!/^[a-z0-9._+-]+@example\.test$/.test(email)) {
  console.error('拒絕：只處理 @example.test 的本機測試帳號')
  process.exit(1)
}

const password = `Play-${randomBytes(12).toString('base64url')}`

const sql = `
\\set ON_ERROR_STOP on
\\set admin_email '${email}'
\\set admin_password '${password}'
BEGIN;
SELECT set_config('play.admin_email', :'admin_email', true);
DO $$
DECLARE
  target uuid;
BEGIN
  SELECT u.id INTO target
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = current_setting('play.admin_email')
    AND p.role = 'admin'
    AND u.deleted_at IS NULL;
  IF target IS NULL THEN
    RAISE EXCEPTION '找不到既有本機管理員，未做任何變更';
  END IF;
END;
$$;
UPDATE auth.users
SET
  encrypted_password = extensions.crypt(:'admin_password', extensions.gen_salt('bf')),
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change = coalesce(email_change, ''),
  updated_at = now()
WHERE lower(email) = :'admin_email';
COMMIT;
`

execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-q'], {
  input: sql,
  stdio: ['pipe', 'ignore', 'inherit'],
})

const kept = readFileSync(envFile, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith('PLAYTEST_ADMIN_'))
writeFileSync(envFile, [...kept, `PLAYTEST_ADMIN_EMAIL=${email}`, `PLAYTEST_ADMIN_PASSWORD=${password}`, ''].join('\n'))
console.log(JSON.stringify({ email, passwordWritten: '.env.play.local', roleChanged: false }))
