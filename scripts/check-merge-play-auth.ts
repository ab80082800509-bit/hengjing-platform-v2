/**
 * 只對本機 127.0.0.1:54321 的隔離 Auth / RPC 操作。
 * 連到其他主機就停止。不使用 Service Role。
 *
 *   npx tsx scripts/check-merge-play-auth.ts target
 *   npx tsx scripts/check-merge-play-auth.ts prepare
 *   npx tsx scripts/check-merge-play-auth.ts play
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cellsForOrder, firstEmptyCell, nextItem } from '../lib/arcade/merge-rules'
import { parseMergeRead, type MergeRead, type MergeSnapshot } from '../lib/arcade/merge-snapshot'

const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
const API = 'http://127.0.0.1:54321'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function readPlayEnv() {
  const values: Record<string, string> = {}
  for (const line of readFileSync(resolve(root, '.env.play.local'), 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue
    const mark = line.indexOf('=')
    if (mark <= 0) continue
    values[line.slice(0, mark).trim()] = line.slice(mark + 1).trim()
  }
  assert(values.NEXT_PUBLIC_SUPABASE_URL === API, '試玩設定的 API 不是 127.0.0.1:54321，停止')
  assert(!values.SUPABASE_SERVICE_ROLE_KEY && !values.SERVICE_ROLE_KEY, '試玩設定含管理金鑰，停止')
  const anon = values.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const emailA = values.PLAYTEST_USER_A_EMAIL
  const passwordA = values.PLAYTEST_USER_A_PASSWORD
  const emailB = values.PLAYTEST_USER_B_EMAIL
  const passwordB = values.PLAYTEST_USER_B_PASSWORD
  assert(anon && emailA && passwordA && emailB && passwordB, '試玩設定缺少 anon key 或測試會員')
  const payload = JSON.parse(Buffer.from(anon.split('.')[1] ?? '', 'base64url').toString('utf8')) as { role?: string }
  assert(payload.role === 'anon', 'key 的 role 不是 anon，停止')
  return { anon, emailA, passwordA, emailB, passwordB }
}

function stableShop(read: MergeRead | null) {
  if (!read || !read.exists) return { exists: false as const }
  const { serverNow: _serverNow, ...rest } = read
  return rest
}

function shop(read: MergeRead | null | undefined, message: string): MergeSnapshot {
  if (!read || read.exists !== true) throw new Error(message)
  return read
}

function dockerPort(container: string, port: string) {
  return execFileSync('docker', ['port', container, port], { encoding: 'utf8' })
}

function assertIsolatedPorts() {
  const db = dockerPort('supabase_db_hengjing-stage45-local', '5432')
  const api = dockerPort('supabase_kong_hengjing-stage45-local', '8000')
  assert(db.includes('54322'), '54322 不是 hengjing-stage45-local，停止')
  assert(api.includes('54321'), '54321 不是 hengjing-stage45-local，停止')
}

function ledger() {
  const sql = `
    select json_build_object(
      'points', (select count(*) from public.member_point_entries),
      'balance', (select coalesce(sum(balance), 0) from public.member_point_accounts),
      'accounts', (select count(*) from public.member_point_accounts),
      'claims', (select count(*) from public.reward_claims),
      'coupons', (select count(*) from public.member_coupon_holds),
      'perks', (select count(*) from public.member_perk_holds),
      'sellerCoupons', (select count(*) from public.seller_coupons),
      'payout', (select payout_enabled from public.game_reward_policies where id = 'stage6')
    )::text
  `
  return execFileSync('docker', [
    'exec', 'supabase_db_hengjing-stage45-local',
    'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql,
  ], { encoding: 'utf8' }).trim()
}

function jwtIss(token: string) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { iss?: string; sub?: string }
  assert(typeof payload.iss === 'string' && !payload.iss.includes('supabase.co'), `登入簽發者不是隔離環境：${payload.iss ?? ''}`)
  assert(payload.iss.includes('127.0.0.1:54321') || payload.iss.includes('localhost:54321'), `登入簽發者不是本機 54321：${payload.iss}`)
  return payload
}

async function authFetch(anon: string, path: string, body: Record<string, string>) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await response.json() as { access_token?: string; user?: { id?: string }; msg?: string; error_description?: string; message?: string }
  return { ok: response.ok, status: response.status, data }
}

async function signIn(anon: string, email: string, password: string) {
  const signed = await authFetch(anon, '/auth/v1/token?grant_type=password', { email, password })
  const token = signed.data.access_token
  const userId = signed.data.user?.id
  assert(signed.ok && token && userId, `登入失敗 ${email} ${signed.status}`)
  const claim = jwtIss(token)
  assert(claim.sub === userId, 'access token 與使用者不一致')
  return { token, userId }
}

async function rpc(anon: string, token: string, name: string, args: Record<string, unknown>) {
  const response = await fetch(`${API}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const data = await response.json() as unknown
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : response.statusText
    return { data: null as MergeRead | null, error: message }
  }
  const parsed = parseMergeRead(data)
  if (!parsed) return { data: null, error: '遊戲回應不能採用' }
  return { data: parsed, error: null }
}

function choose(snapshot: MergeSnapshot): { type: 'serve' | 'merge' | 'spawn' | 'upgrade' | 'claim_quest'; payload: Record<string, unknown> } | null {
  for (const order of snapshot.orders) {
    const cells = cellsForOrder(snapshot.cells, order.itemId, order.qty)
    if (cells) return { type: 'serve', payload: { orderId: order.id, cells } }
  }
  for (let from = 0; from < snapshot.cells.length; from += 1) {
    const source = snapshot.cells[from]
    if (!source || !nextItem(source)) continue
    const to = snapshot.cells.findIndex((cell, index) => index !== from && cell === source)
    if (to >= 0) return { type: 'merge', payload: { from, to } }
  }
  if (!snapshot.questClaimed && snapshot.ordersCompletedToday >= snapshot.questTarget) {
    return { type: 'claim_quest', payload: {} }
  }
  if (snapshot.shopLevel < 3 && snapshot.upgradeCost != null && snapshot.coins >= snapshot.upgradeCost) {
    return { type: 'upgrade', payload: {} }
  }
  const empty = firstEmptyCell(snapshot.cells)
  if (snapshot.producerCharges > 0 && empty != null) return { type: 'spawn', payload: { to: empty } }
  return null
}

async function target() {
  assertIsolatedPorts()
  const health = await fetch(`${API}/auth/v1/health`)
  assert(health.ok, '本機 Auth 健康檢查失敗')
  const cors = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3001',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'apikey,authorization,content-type',
    },
  })
  const allow = cors.headers.get('access-control-allow-origin')
  assert(allow === '*' || allow === 'http://localhost:3001', `localhost:3001 不被本機 Auth 允許：${allow ?? 'none'}`)
  console.log('target ok', API, 'ledger', ledger())
}

async function prepare() {
  await target()
  const env = readPlayEnv()
  const before = ledger()
  for (const [email, password] of [[env.emailA, env.passwordA], [env.emailB, env.passwordB]] as const) {
    assert(Boolean(email && password), '試玩會員帳號不完整')
    const created = await authFetch(env.anon, '/auth/v1/signup', { email, password })
    if (!created.ok || !created.data.access_token) {
      const signed = await signIn(env.anon, email, password)
      console.log('existing local user', email, signed.userId)
      continue
    }
    jwtIss(created.data.access_token)
    console.log('created local user', email, created.data.user?.id)
  }
  const after = ledger()
  assert(before === after, `建立測試會員時改到了點數或優惠資料 ${before} -> ${after}`)
  console.log('prepare ok')
}

async function play() {
  await target()
  const env = readPlayEnv()
  const before = ledger()
  const session = await signIn(env.anon, env.emailA, env.passwordA)
  const other = await signIn(env.anon, env.emailB, env.passwordB)
  assert(session.userId !== other.userId, '兩位測試會員必須不同')
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(session.userId), '會員 A 編號不是 UUID')
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(other.userId), '會員 B 編號不是 UUID')

  const mine = await rpc(env.anon, session.token, 'get_my_merge_shop', {})
  let current = shop(mine.data, mine.error ?? '會員 A 還沒有可繼續的進度')
  const foreign = await rpc(env.anon, other.token, 'get_my_merge_shop', {})
  assert(foreign.data != null, foreign.error ?? '會員 B 無法讀取自己的進度')
  const owners = execFileSync('docker', [
    'exec', 'supabase_db_hengjing-stage45-local',
    'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c',
    `select count(distinct user_id) from public.member_merge_shops where user_id in ('${session.userId}'::uuid, '${other.userId}'::uuid)`,
  ], { encoding: 'utf8' }).trim()
  assert(owners === '1' || owners === '2', '隔離庫裡的測試會員進度筆數不對')

  const startedCoins = current.coins
  let steps = 0
  let invalidMerge = ''
  const deadline = Date.now() + 8 * 60 * 1000
  while (Date.now() < deadline && steps < 160) {
    const done = current.shopLevel >= 3 && current.catalog.includes('snack-1') && current.catalog.includes('gift-1') && current.questClaimed
    if (done && invalidMerge) break
    if (!invalidMerge) {
      const tea = current.cells.findIndex((cell) => cell?.startsWith('tea-'))
      const otherItem = current.cells.findIndex((cell) => cell && !cell.startsWith('tea-'))
      if (tea >= 0 && otherItem >= 0) {
        const rejected = await rpc(env.anon, session.token, 'apply_my_merge_shop_action', {
          p_action_key: crypto.randomUUID(),
          p_action_type: 'merge',
          p_payload: { from: tea, to: otherItem, expectedRevision: current.revision },
        })
        assert(rejected.data == null && (rejected.error ?? '').includes('要兩件相同商品才能合成'), `不同商品合成應被拒絕：${rejected.error}`)
        const reread = shop((await rpc(env.anon, session.token, 'get_my_merge_shop', {})).data, '拒絕合成後讀不到進度')
        assert(reread.coins === current.coins && reread.revision === current.revision, '拒絕合成後進度被改掉')
        invalidMerge = 'rejected'
        current = reread
        continue
      }
    }
    let action = choose(current)
    if (!action) {
      const empty = firstEmptyCell(current.cells)
      assert(empty != null, '棋盤已滿，試玩無法在不改規則的情況下繼續')
      await new Promise((resolveWait) => setTimeout(resolveWait, 31000))
      action = { type: 'spawn', payload: { to: empty } }
    }
    const key = crypto.randomUUID()
    const acted = await rpc(env.anon, session.token, 'apply_my_merge_shop_action', {
      p_action_key: key,
      p_action_type: action.type,
      p_payload: { ...action.payload, expectedRevision: current.revision },
    })
    if ((acted.error ?? '').includes('原料補貨還沒準備好')) continue
    const saved = shop(acted.data, `${action.type} 失敗：${acted.error}`)
    assert(saved.payPointsDelta === 0 && saved.payoutEnabled === false, '動作帶回 Pay 點')
    const replay = await rpc(env.anon, session.token, 'apply_my_merge_shop_action', {
      p_action_key: key,
      p_action_type: action.type,
      p_payload: { ...action.payload, expectedRevision: current.revision, coins: 99999 },
    })
    const replayed = shop(replay.data, '相同動作編號沒有被視為重送')
    assert(replayed.replayed === true, '相同動作編號沒有被視為重送')
    assert(replayed.coins === saved.coins && replayed.xp === saved.xp && replayed.revision === saved.revision, '重送同一動作又發了金幣或經驗')
    current = replayed
    steps += 1
    if (steps === 1) {
      const stale = await rpc(env.anon, session.token, 'apply_my_merge_shop_action', {
        p_action_key: crypto.randomUUID(),
        p_action_type: 'spawn',
        p_payload: { to: 10, expectedRevision: 0 },
      })
      assert((stale.error ?? '').includes('遊戲進度已更新，請重新整理'), `舊修訂沒有被拒絕：${stale.error}`)
    }
  }

  assert(current.shopLevel >= 2 && current.catalog.includes('snack-1'), `點心沒有解鎖進圖鑑：Lv${current.shopLevel} ${current.catalog.join(',')}`)
  assert(current.shopLevel >= 3 && current.catalog.includes('gift-1'), `禮品沒有解鎖進圖鑑：Lv${current.shopLevel} ${current.catalog.join(',')}`)
  assert(current.questClaimed, '每日任務沒有被領取並保存')
  assert(current.coins !== startedCoins || current.xp > 0, '完成訂單後金幣與經驗都沒有增加')
  assert(invalidMerge === 'rejected', '還沒測到不同商品的合成拒絕')

  const empty = firstEmptyCell(current.cells)
  assert(empty != null && current.producerCharges > 0, '沒有空位或原料，無法測同時操作')
  const revision = current.revision
  const charges = current.producerCharges
  const pair = await Promise.all([
    rpc(env.anon, session.token, 'apply_my_merge_shop_action', {
      p_action_key: crypto.randomUUID(),
      p_action_type: 'spawn',
      p_payload: { to: empty, expectedRevision: revision },
    }),
    rpc(env.anon, session.token, 'apply_my_merge_shop_action', {
      p_action_key: crypto.randomUUID(),
      p_action_type: 'spawn',
      p_payload: { to: empty, expectedRevision: revision },
    }),
  ])
  const won = pair.filter((item) => item.data?.exists)
  const lost = pair.filter((item) => item.error)
  assert(won.length === 1 && lost.length === 1, '同時補進同一格沒有一成一敗')
  assert((lost[0]?.error ?? '').includes('遊戲進度已更新') || (lost[0]?.error ?? '').includes('這個位置已經有商品'), `並發失敗原因不對：${lost[0]?.error}`)
  const finalRead = shop((await rpc(env.anon, session.token, 'get_my_merge_shop', {})).data, '並發後讀不到進度')
  assert(finalRead.producerCharges === charges - 1, '並發補貨消耗的原料不是一份')
  const stillOther = await rpc(env.anon, other.token, 'get_my_merge_shop', {})
  assert(JSON.stringify(stableShop(stillOther.data)) === JSON.stringify(stableShop(foreign.data)), '會員 A 的操作改到了會員 B')

  const after = ledger()
  assert(before === after, `遊戲交易改到了點數、優惠券或特權 ${before} -> ${after}`)
  console.log('play ok', {
    userA: session.userId,
    userB: other.userId,
    steps,
    shopLevel: finalRead.shopLevel,
    coins: finalRead.coins,
    xp: finalRead.xp,
    catalog: finalRead.catalog,
    questClaimed: finalRead.questClaimed,
    ordersToday: finalRead.ordersCompletedToday,
  })
}

async function race() {
  await target()
  const env = readPlayEnv()
  const before = ledger()
  const session = await signIn(env.anon, env.emailA, env.passwordA)
  const other = await signIn(env.anon, env.emailB, env.passwordB)
  const foreign = await rpc(env.anon, other.token, 'get_my_merge_shop', {})
  assert(foreign.data != null, foreign.error ?? '會員 B 無法讀取')
  let current = shop((await rpc(env.anon, session.token, 'get_my_merge_shop', {})).data, '會員 A 沒有進度')
  const waited = Date.now() + 35000
  while (Date.now() < waited) {
    const elapsed = Date.parse(current.serverNow) - Date.parse(current.producerAnchor)
    const gained = Math.max(0, Math.floor(elapsed / (current.regenSeconds * 1000)))
    const available = Math.min(current.producerCap, current.producerCharges + gained)
    if (available >= 1 && elapsed % (current.regenSeconds * 1000) > 5000) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 5000))
    current = shop((await rpc(env.anon, session.token, 'get_my_merge_shop', {})).data, '等待原料時讀不到進度')
  }
  const empty = firstEmptyCell(current.cells)
  assert(empty != null, '沒有空位，無法測同時操作')
  const elapsed = Date.parse(current.serverNow) - Date.parse(current.producerAnchor)
  const gained = Math.max(0, Math.floor(elapsed / (current.regenSeconds * 1000)))
  const available = Math.min(current.producerCap, current.producerCharges + gained)
  assert(available >= 1, '原料還沒恢復，停止同時操作測試')
  const pair = await Promise.all([
    rpc(env.anon, session.token, 'apply_my_merge_shop_action', {
      p_action_key: crypto.randomUUID(),
      p_action_type: 'spawn',
      p_payload: { to: empty, expectedRevision: current.revision },
    }),
    rpc(env.anon, session.token, 'apply_my_merge_shop_action', {
      p_action_key: crypto.randomUUID(),
      p_action_type: 'spawn',
      p_payload: { to: empty, expectedRevision: current.revision },
    }),
  ])
  const won = pair.filter((item) => item.data?.exists)
  const lost = pair.filter((item) => item.error)
  assert(won.length === 1 && lost.length === 1, '同時補進同一格沒有一成一敗')
  assert((lost[0]?.error ?? '').includes('遊戲進度已更新') || (lost[0]?.error ?? '').includes('這個位置已經有商品'), `並發失敗原因不對：${lost[0]?.error}`)
  const finalRead = shop((await rpc(env.anon, session.token, 'get_my_merge_shop', {})).data, '並發後讀不到進度')
  assert(finalRead.cells[empty] != null, '成功的那次沒有把商品放進同一格')
  assert(finalRead.producerCharges === available - 1, `並發補貨消耗的原料不是一份：${finalRead.producerCharges} / ${available}`)
  const stillOther = await rpc(env.anon, other.token, 'get_my_merge_shop', {})
  assert(JSON.stringify(stableShop(stillOther.data)) === JSON.stringify(stableShop(foreign.data)), '會員 A 的操作改到了會員 B')
  const after = ledger()
  assert(before === after, `同時操作改到了點數、優惠券或特權 ${before} -> ${after}`)
  console.log('race ok', { cell: empty, charges: finalRead.producerCharges, revision: finalRead.revision })
}

const commands: Record<string, () => Promise<void>> = { target, prepare, play, race }
const command = commands[mode ?? '']
if (!command) {
  console.error('用法：target | prepare | play | race')
  process.exit(1)
}
command().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
