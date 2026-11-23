import { newStreet, newSim, serve, snapshot, tick, parseStreet, type StreetState } from '../lib/arcade/street-rules'
import { EMPTY_CLOUD_CACHE, cloudReasonText, parseCloudCache, parseCloudRow, progressSig, rebaseProgress } from '../lib/arcade/street-cloud'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const key = '11111111-1111-4111-8111-111111111111'
const base = newStreet(Date.parse('2026-10-29T12:00:00+08:00'))

// 營業經驗另外累計，互助／偷貨獎勵不算進去。
let state: StreetState = { progress: { ...base, open: true }, sim: newSim(base) }
const rand = () => 0.1
for (let i = 0; i < 200 && !state.sim.customers.some((c) => c.phase === 'wait'); i += 1) state = tick(state, 250, rand, Date.now()).state
const guest = state.sim.customers.find((c) => c.phase === 'wait')
assert(Boolean(guest), '測試要有一位等待中的顧客')
state = { ...state, progress: { ...state.progress, stock: { ...state.progress.stock, croissant: 3, milktea: 3, cookie: 3, cocoa: 3 } } }
const served = serve(state, guest!.id, Date.now())
assert(served.ok, '可以結帳')
if (served.ok) {
  const p = served.state.progress
  assert(p.stats.xpEarned === p.xp && p.xp > 0, '結帳經驗累計到 stats.xpEarned')
}
assert(parseStreet({ ...base, stats: { served: 1 } })?.stats.xpEarned === 0, '舊存檔沒有 xpEarned 時從 0 開始')

// 雲端回覆解析
const row = parseCloudRow({ revision: 3, progress: base, importSource: 'browser', importAdjusted: true })
assert(row?.revision === 3 && row.importSource === 'browser' && row.importAdjusted, '解析雲端存檔')
assert(parseCloudRow({ revision: 0, progress: base }) === null, 'revision 必須從 1 開始')
assert(parseCloudRow({ revision: 2, progress: { v: 9 } }) === null, '看不懂的存檔整份丟掉')

// 本機同步紀錄
assert(parseCloudCache(null) === EMPTY_CLOUD_CACHE, '沒有同步紀錄')
const cache = parseCloudCache({ rev: 4, dirty: true, sig: 'x', inflight: { key: key.toUpperCase(), base: 4, payload: base }, importKey: 'nope' })
assert(cache.rev === 4 && cache.dirty && cache.inflight?.key === key && cache.inflight.base === 4, '送出中的存檔保留原本的鍵與內容')
assert(cache.importKey === null, '格式錯的轉移鍵丟掉')
assert(parseCloudCache({ rev: 4, inflight: { key, base: 4, payload: { v: 9 } } }).inflight === null, '送出內容壞掉就不重送')

// 對帳：資產以資料庫為準，送出後才賺到的保留下來
const sent = { ...base, coins: 500, xp: 100 }
const local = { ...base, coins: 540, xp: 110 }
const server = { ...base, coins: 320, xp: 90 }
const rebased = rebaseProgress(local, sent, server)
assert(rebased.coins === 360 && rebased.xp === 100, '回覆後金幣 = 資料庫金幣 + 送出後的變動')
assert(rebaseProgress({ ...base, coins: 0 }, { ...base, coins: 100 }, { ...base, coins: 10 }).coins === 0, '對帳後不會變成負數')

// 變更判斷：製作剩餘時間、金幣與經驗不算變更
const jobsA = snapshot({ progress: base, sim: { ...newSim(base), jobs: [{ id: 1, product: 'cookie', count: 2, t0: 0, t1: 2000 }] } })
const jobsB = snapshot({ progress: base, sim: { ...newSim(base), t: 900, jobs: [{ id: 1, product: 'cookie', count: 2, t0: 0, t1: 2000 }] } })
assert(progressSig(jobsA) === progressSig(jobsB), '製作進度推進不算變更')
assert(progressSig({ ...base, coins: 1 }) === progressSig(base), '只有金幣不同不算變更')
assert(progressSig({ ...base, shopLevel: 2 }) !== progressSig(base), '升級算變更')

assert(cloudReasonText('conflict').includes('較新'), '衝突提示')
assert(cloudReasonText('whatever').includes('保留在這台裝置'), '未知原因的提示')

console.log('street cloud checks passed')
