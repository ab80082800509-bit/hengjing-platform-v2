/**
 * 對本機隔離 Supabase（127.0.0.1:54322）執行合成交易。
 * 不連正式專案，也不改第四階段點數流水。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { applyMergeAction, type MergeClock, type MergeState } from '../lib/arcade/merge-rules'
import { parseMergeRead, type MergeSnapshot } from '../lib/arcade/merge-snapshot'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const HOST = '127.0.0.1'
const PORT = 54322
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const USER_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const USERS = [USER_A, USER_B]
const keyOf = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`

const password = execSync('docker exec supabase_db_hengjing-stage45-local printenv POSTGRES_PASSWORD', { encoding: 'utf8' }).trim()
const client = new pg.Client({ host: HOST, port: PORT, user: 'postgres', password, database: 'postgres' })
const other = new pg.Client({ host: HOST, port: PORT, user: 'postgres', password, database: 'postgres' })

async function pointSnapshot(db: pg.Client) {
  const entries = await db.query('select count(*)::int as count from public.member_point_entries')
  const accounts = await db.query('select coalesce(sum(balance), 0)::int as balance, count(*)::int as count from public.member_point_accounts')
  const claims = await db.query('select count(*)::int as count from public.reward_claims')
  return {
    entries: entries.rows[0].count as number,
    balance: accounts.rows[0].balance as number,
    accounts: accounts.rows[0].count as number,
    claims: claims.rows[0].count as number,
  }
}

async function asUser(db: pg.Client, userId: string) {
  await db.query('RESET ROLE')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId])
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  await db.query('SET ROLE authenticated')
  const uid = await db.query('select auth.uid() as uid')
  assert(uid.rows[0].uid === userId, '隔離庫沒有把交易綁到指定會員')
}

async function act(db: pg.Client, key: string, type: string, payload: Record<string, unknown>) {
  const result = await db.query('select public.apply_my_merge_shop_action($1, $2, $3::jsonb) as data', [key, type, JSON.stringify(payload)])
  const parsed = parseMergeRead(result.rows[0].data)
  if (!parsed || !parsed.exists) throw new Error(`${type} 的資料庫回應不能採用`)
  return parsed
}

function viewOf(snapshot: MergeSnapshot): Partial<MergeState> & { orders: MergeSnapshot['orders'] } {
  return {
    coins: snapshot.coins,
    xp: snapshot.xp,
    shopLevel: snapshot.shopLevel,
    cells: snapshot.cells,
    catalog: snapshot.catalog,
    orders: snapshot.orders,
    orderSerial: snapshot.orderSerial,
    lifetimeOrders: snapshot.lifetimeOrders,
    ordersCompletedToday: snapshot.ordersCompletedToday,
    questClaimed: snapshot.questClaimed,
    producerCharges: snapshot.producerCharges,
    actionSeq: snapshot.revision - 1,
    revision: snapshot.revision,
  }
}

async function main() {
  assert(HOST === '127.0.0.1' && PORT === 54322, '拒絕連到隔離庫以外的資料庫')
  await client.connect()
  await other.connect()
  const marker = await client.query(`select current_database() as db, inet_server_port() as port`)
  assert(marker.rows[0].db === 'postgres', '隔離庫資料庫名稱不對')
  const dockerPort = execSync('docker port supabase_db_hengjing-stage45-local 5432', { encoding: 'utf8' })
  assert(dockerPort.includes('54322'), '54322 不是 hengjing-stage45-local')

  const sql = readFileSync(resolve(process.cwd(), 'supabase/manual/20261025201700_merge_shop_preview.sql'), 'utf8')
  await client.query(sql)

  await client.query('RESET ROLE')
  await client.query(`select set_config('merge.internal', 'on', false)`)
  await client.query('delete from public.member_merge_shop_events where user_id = any($1::uuid[])', [USERS])
  await client.query('delete from public.member_merge_shops where user_id = any($1::uuid[])', [USERS])
  await client.query(`select set_config('merge.internal', 'off', false)`)

  const before = await pointSnapshot(client)
  await asUser(client, USER_A)
  const empty = parseMergeRead((await client.query('select public.get_my_merge_shop() as data')).rows[0].data)
  assert(empty?.exists === false && empty.payPointsDelta === 0, '新會員不該有合成進度或 Pay 點')

  const started = await act(client, keyOf(1), 'start', {})
  assert(started.coins === 0 && started.xp === 0 && started.shopLevel === 1 && started.cells.filter((cell) => cell === 'tea-1').length === 3, '資料庫開張狀態不對')
  assert(started.payPointsDelta === 0 && started.payoutEnabled === false && started.upgradeCost === 30, '開張不能帶 Pay 點，升級成本應由資料庫給')
  const clock: MergeClock = { nowMs: Date.parse(started.serverNow), taipeiDay: started.taipeiDay }
  let spec = applyMergeAction(null, { type: 'start' }, clock)
  const restarted = await act(client, keyOf(2), 'start', { coins: 99999 })
  assert(restarted.coins === 0 && restarted.revision === 1, '再次開張不能重置，也不能吃前端金幣')

  const steps: Array<{ key: number; type: 'serve' | 'spawn' | 'merge' | 'upgrade' | 'claim_quest'; payload: Record<string, unknown> }> = [
    { key: 3, type: 'serve', payload: { orderId: 'ord-0-0', cells: [0, 1] } },
    { key: 4, type: 'spawn', payload: { to: 0 } },
    { key: 5, type: 'merge', payload: { from: 0, to: 2 } },
    { key: 6, type: 'serve', payload: { orderId: 'ord-0-1', cells: [2] } },
    { key: 7, type: 'spawn', payload: { to: 0 } },
    { key: 8, type: 'spawn', payload: { to: 1 } },
    { key: 9, type: 'serve', payload: { orderId: 'ord-1-2', cells: [0, 1] } },
    { key: 10, type: 'claim_quest', payload: {} },
    { key: 11, type: 'upgrade', payload: {} },
  ]
  let saved!: MergeSnapshot
  for (const step of steps) {
    spec = applyMergeAction(spec, step.type === 'serve'
      ? { type: 'serve', orderId: String(step.payload.orderId), cells: step.payload.cells as number[] }
      : step.type === 'spawn'
        ? { type: 'spawn', to: Number(step.payload.to) }
        : step.type === 'merge'
          ? { type: 'merge', from: Number(step.payload.from), to: Number(step.payload.to) }
          : { type: step.type }, clock, spec.revision)
    saved = await act(client, keyOf(step.key), step.type, { ...step.payload, expectedRevision: spec.revision - 1, coins: 99999, xp: 99999 })
    assert(saved.coins === spec.coins && saved.xp === spec.xp && saved.shopLevel === spec.shopLevel, `${step.type} 的金幣、經驗或等級與規格不同`)
    assert(JSON.stringify(saved.cells) === JSON.stringify(spec.cells), `${step.type} 的棋盤與規格不同`)
    assert(JSON.stringify(saved.orders) === JSON.stringify(spec.orders), `${step.type} 的訂單與規格不同`)
    assert(saved.catalog.join() === spec.catalog.join() && saved.questClaimed === spec.questClaimed, `${step.type} 的圖鑑或任務與規格不同`)
    assert(saved.producerCharges === spec.producerCharges && saved.payPointsDelta === 0, `${step.type} 的原料或 Pay 點不對`)
  }
  assert(saved.shopLevel === 2 && saved.catalog.includes('snack-1') && saved.coins === 30 && saved.questClaimed, '資料庫沒有完成升級與每日任務')

  const beforeReplay = parseMergeRead((await client.query('select public.get_my_merge_shop() as data')).rows[0].data)
  const replay = await act(client, keyOf(9), 'serve', { orderId: 'ord-1-2', cells: [0, 1], coins: 99999 })
  const afterReplay = parseMergeRead((await client.query('select public.get_my_merge_shop() as data')).rows[0].data)
  assert(replay.replayed && beforeReplay?.exists && afterReplay?.exists && afterReplay.coins === beforeReplay.coins && afterReplay.revision === beforeReplay.revision, '同一動作編號不能再發一次獎勵')

  let conflict = ''
  try {
    await act(client, keyOf(12), 'merge', { from: 0, to: 1, expectedRevision: 1 })
  } catch (error) {
    conflict = error instanceof Error ? error.message : ''
  }
  assert(conflict.includes('遊戲進度已更新，請重新整理'), '舊修訂要被資料庫拒絕')

  await client.query('RESET ROLE')
  const reloaded = parseMergeRead((await (async () => {
    await asUser(client, USER_A)
    return client.query('select public.get_my_merge_shop() as data')
  })()).rows[0].data)
  assert(reloaded?.exists && reloaded.coins === 30 && reloaded.shopLevel === 2, '重新讀取應恢復同一會員的進度')

  await asUser(other, USER_B)
  const b = await act(other, keyOf(20), 'start', {})
  assert(b.coins === 0 && b.shopLevel === 1, '另一位會員應從自己的新局開始')
  await other.query('RESET ROLE')
  await asUser(client, USER_A)
  const stillA = parseMergeRead((await client.query('select public.get_my_merge_shop() as data')).rows[0].data)
  assert(stillA?.exists && stillA.coins === 30 && stillA.shopLevel === 2, '會員 B 開張不能改到會員 A')

  await client.query('RESET ROLE')
  let denied = ''
  try {
    await client.query('SET ROLE authenticated')
    await client.query('update public.member_merge_shops set coins = 999 where user_id = $1', [USER_A])
  } catch (error) {
    denied = error instanceof Error ? error.message : ''
  }
  assert(/permission denied|遊戲進度只能由合成交易更新/i.test(denied), '會員不能直接改遊戲金幣')

  await client.query('RESET ROLE')
  let blockedGrant = ''
  try {
    await client.query(`select public.grant_game_pay_points(10, 'game:merge_shop:test')`)
  } catch (error) {
    blockedGrant = error instanceof Error ? error.message : ''
  }
  assert(blockedGrant.includes('遊戲 Pay 點數尚未正式簽核，不能入帳'), '發點閘門沒有關上')
  let blockedSwitch = ''
  try {
    await client.query(`update public.game_reward_policies set payout_enabled = true where id = 'stage6'`)
  } catch (error) {
    blockedSwitch = error instanceof Error ? error.message : ''
  }
  assert(/payout_enabled|check constraint/i.test(blockedSwitch), '發放開關不能被改成開啟')

  await asUser(client, USER_A)
  await asUser(other, USER_A)
  const results = await Promise.allSettled([
    act(client, keyOf(30), 'spawn', { to: 3, expectedRevision: saved.revision }),
    act(other, keyOf(31), 'spawn', { to: 3, expectedRevision: saved.revision }),
  ])
  const fulfilled = results.filter((result) => result.status === 'fulfilled')
  const rejected = results.filter((result) => result.status === 'rejected')
  assert(fulfilled.length === 1 && rejected.length === 1, '同時補進同一格只能成功一次')
  const winner = fulfilled[0]?.status === 'fulfilled' ? fulfilled[0].value : null
  assert(winner?.cells[3] != null && winner.producerCharges === saved.producerCharges - 1, '成功的那次才消耗一份原料')
  assert(String(rejected[0]?.status === 'rejected' ? rejected[0].reason : '').includes('遊戲進度已更新') || String(rejected[0]?.status === 'rejected' ? rejected[0].reason : '').includes('這個位置已經有商品'), '失敗的那次不能再放一份商品')

  await client.query('RESET ROLE')
  const after = await pointSnapshot(client)
  assert(JSON.stringify(before) === JSON.stringify(after), `遊戲交易改到了 Pay 點數帳本 ${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
  const plan = await client.query('select public.get_my_game_reward_plan() as data')
  assert(plan.rows[0].data.payoutEnabled === false && plan.rows[0].data.issuedPayPoints === null, '獎勵計畫不能回報已發放點數')

  await client.query(`select set_config('merge.internal', 'on', false)`)
  await client.query('delete from public.member_merge_shop_events where user_id = any($1::uuid[])', [USERS])
  await client.query('delete from public.member_merge_shops where user_id = any($1::uuid[])', [USERS])
  await client.query(`select set_config('merge.internal', 'off', false)`)
  console.log('isolated merge shop transactions ok')
  console.log('point ledger unchanged', after)
  void viewOf
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  await client.end().catch(() => undefined)
  await other.end().catch(() => undefined)
})
