import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const out = execSync('npx --yes supabase status -o env', {
  cwd: 'C:\\Users\\信\\Desktop\\hengjing-stage45-local',
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const values = {}
for (const line of out.split(/\r?\n/)) {
  const mark = line.indexOf('=')
  if (mark <= 0) continue
  const key = line.slice(0, mark).trim()
  let value = line.slice(mark + 1).trim()
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1)
  }
  values[key] = value
}
const url = values.API_URL || values.SUPABASE_URL || ''
const anon = values.ANON_KEY || values.SUPABASE_ANON_KEY || ''
if (url !== 'http://127.0.0.1:54321') {
  console.error('BAD_URL')
  process.exit(1)
}
const payload = JSON.parse(Buffer.from(anon.split('.')[1], 'base64url').toString('utf8'))
if (payload.role !== 'anon') {
  console.error('BAD_ROLE')
  process.exit(1)
}
const localAnon = (readFileSync('.env.local', 'utf8').match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m) || [])[1] || ''
if (!anon || anon === localAnon.trim()) {
  console.error('ANON_MATCHES_OR_EMPTY')
  process.exit(1)
}
const kept = []
try {
  for (const line of readFileSync('.env.play.local', 'utf8').split(/\r?\n/)) {
    if (line.startsWith('PLAYTEST_')) kept.push(line)
  }
} catch {
  // 第一次建立時還沒有試玩會員欄位。
}
writeFileSync('.env.play.local', [
  'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321',
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`,
  ...kept,
  '',
].join('\n'))
console.log(JSON.stringify({
  url,
  role: payload.role,
  iss: payload.iss,
  anonLength: anon.length,
  distinctFromEnvLocal: true,
  serviceRoleWritten: false,
}))
