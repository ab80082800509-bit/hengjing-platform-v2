/**
 * 3001 隔離試玩：member-avatars / product-images 權限檢查（只連 .env.play.local 的本機 API，用 anon key）。
 * 用法：node scripts/check-play-avatar-storage.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..') + '/'
const require = createRequire(root + 'package.json')
const { createClient } = require('@supabase/supabase-js')

const env = Object.fromEntries(readFileSync(root + '.env.play.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const mk = () => createClient(url, key, { auth: { persistSession: false } })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const out = {}

const a = mk(); const b = mk(); const anon = mk()
const sa = await a.auth.signInWithPassword({ email: env.PLAYTEST_USER_A_EMAIL, password: env.PLAYTEST_USER_A_PASSWORD })
const sb = await b.auth.signInWithPassword({ email: env.PLAYTEST_USER_B_EMAIL, password: env.PLAYTEST_USER_B_PASSWORD })
const ua = sa.data.user.id, ub = sb.data.user.id
const path = `${ua}/apicheck-${Date.now()}.png`

out.ownUpload = (await a.storage.from('member-avatars').upload(path, png, { contentType: 'image/png' })).error?.message ?? 'ok'
const pub = anon.storage.from('member-avatars').getPublicUrl(path).data.publicUrl
out.publicFetch = (await fetch(pub)).status
out.crossUpload = (await b.storage.from('member-avatars').upload(`${ua}/evil.png`, png, { contentType: 'image/png' })).error?.message ?? 'UNEXPECTED_OK'
out.crossOverwrite = (await b.storage.from('member-avatars').upload(path, png, { contentType: 'image/png', upsert: true })).error?.message ?? 'UNEXPECTED_OK'
const del = await b.storage.from('member-avatars').remove([path])
out.crossDeleteRemoved = del.data?.length ?? 0
out.stillThereAfterCrossDelete = (await fetch(pub)).status
out.anonUpload = (await anon.storage.from('member-avatars').upload(`${ua}/anon.png`, png, { contentType: 'image/png' })).error?.message ?? 'UNEXPECTED_OK'
out.badMime = (await a.storage.from('member-avatars').upload(`${ua}/x.txt`, Buffer.from('hi'), { contentType: 'text/plain' })).error?.message ?? 'UNEXPECTED_OK'

const before = (await a.from('profiles').select('avatar_url').eq('id', ua).single()).data?.avatar_url ?? null
const crossProfile = await b.from('profiles').update({ avatar_url: 'https://evil.example/x.png' }).eq('id', ua).select('id')
out.crossProfileRowsUpdated = crossProfile.data?.length ?? 0
out.crossProfileError = crossProfile.error?.message ?? null
const after = (await a.from('profiles').select('avatar_url').eq('id', ua).single()).data?.avatar_url ?? null
out.profileUnchanged = before === after

out.productImagesBuyerUpload = (await a.storage.from('product-images').upload(`${ua}/p.png`, png, { contentType: 'image/png' })).error?.message ?? 'UNEXPECTED_OK'

out.cleanup = (await a.storage.from('member-avatars').remove([path])).data?.length ?? 0
out.idsDistinct = ua !== ub
console.log(JSON.stringify(out, null, 2))
