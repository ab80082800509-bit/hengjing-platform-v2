/**
 * 在 3001 啟動隔離試玩。只讀 .env.play.local 的公開 URL 與 anon key。
 * 不讀、不傳 Service Role，也不改 .env.local。
 */
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const file = resolve(root, '.env.play.local')

function readPlayEnv(path) {
  const values = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue
    const mark = line.indexOf('=')
    if (mark <= 0) continue
    values[line.slice(0, mark).trim()] = line.slice(mark + 1).trim()
  }
  return values
}

function jwtPayload(token) {
  const part = token.split('.')[1]
  if (!part) throw new Error('anon key 不是 JWT')
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

const play = readPlayEnv(file)
const url = play.NEXT_PUBLIC_SUPABASE_URL ?? ''
const anon = play.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
let parsed
try {
  parsed = new URL(url)
} catch {
  console.error('拒絕啟動：試玩 API URL 無法解析')
  process.exit(1)
}
if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== '54321') {
  console.error('拒絕啟動：試玩 API 必須是本機 54321')
  process.exit(1)
}
if (!anon || play.SUPABASE_SERVICE_ROLE_KEY || play.SERVICE_ROLE_KEY) {
  console.error('拒絕啟動：試玩設定只能放公開 anon key')
  process.exit(1)
}
const claim = jwtPayload(anon)
if (claim.role !== 'anon') {
  console.error('拒絕啟動：這把 key 的 role 不是 anon')
  process.exit(1)
}

const childEnv = { ...process.env }
delete childEnv.SUPABASE_SERVICE_ROLE_KEY
delete childEnv.SERVICE_ROLE_KEY
childEnv.NEXT_PUBLIC_SUPABASE_URL = url
childEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon
childEnv.SUPABASE_SERVICE_ROLE_KEY = ''
childEnv.PLAY_DIST_DIR = '.next-play'

const child = spawn(process.execPath, [
  resolve(root, 'node_modules/next/dist/bin/next'),
  'dev',
  '--port',
  '3001',
  '--hostname',
  'localhost',
], {
  cwd: root,
  env: childEnv,
  stdio: 'inherit',
})

child.on('exit', (code) => process.exit(code ?? 0))
