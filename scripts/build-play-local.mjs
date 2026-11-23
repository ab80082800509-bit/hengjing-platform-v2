/**
 * 用隔離試玩設定編譯到 .next-play-build。
 * 不使用 .next，也不把 Service Role 放進這個程序。
 */
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const values = {}
for (const line of readFileSync(resolve(root, '.env.play.local'), 'utf8').split(/\r?\n/)) {
  if (!line || line.trim().startsWith('#')) continue
  const mark = line.indexOf('=')
  if (mark <= 0) continue
  values[line.slice(0, mark).trim()] = line.slice(mark + 1).trim()
}
const url = values.NEXT_PUBLIC_SUPABASE_URL
const anon = values.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (url !== 'http://127.0.0.1:54321' || !anon) {
  console.error('拒絕編譯：試玩 API 不是本機 54321')
  process.exit(1)
}
const claim = JSON.parse(Buffer.from(anon.split('.')[1], 'base64url').toString('utf8'))
if (claim.role !== 'anon') {
  console.error('拒絕編譯：key 的 role 不是 anon')
  process.exit(1)
}
const childEnv = { ...process.env }
delete childEnv.SUPABASE_SERVICE_ROLE_KEY
childEnv.NEXT_PUBLIC_SUPABASE_URL = url
childEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon
childEnv.SUPABASE_SERVICE_ROLE_KEY = ''
childEnv.PLAY_DIST_DIR = '.next-play-build'
const child = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'build'], {
  cwd: root,
  env: childEnv,
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 0))
