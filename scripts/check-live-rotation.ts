// 每日／每週／每月／遊戲季的台北時間輪替。不連資料庫、不改系統時間。
// 用法：npx tsx scripts/check-live-rotation.ts
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dailySpec, taipeiDayKey } from '../lib/arcade/block-modes'
import { GAME_REWARD_PAYOUT_ENABLED } from '../lib/arcade/game-reward-policy'
import { parseLiveEvents, resolveLiveBoard } from '../lib/arcade/live-events-snapshot'
import { LIVE_EVENTS, activeLiveEvents, anchoredNow, livePeriod, type LiveCadence } from '../lib/arcade/live-ops'
import { MERGE_QUEST_COINS, MERGE_QUEST_TARGET, MERGE_QUEST_XP } from '../lib/arcade/merge-rules'

const at = (iso: string) => Date.parse(iso)

const boundaries: ReadonlyArray<readonly [string, Exclude<LiveCadence, 'festival'>, string]> = [
  ['2026-10-29T23:59:59+08:00', 'daily', 'd:2026-10-29'],
  ['2026-10-30T00:00:00+08:00', 'daily', 'd:2026-10-30'],
  ['2026-10-29T16:00:00Z', 'daily', 'd:2026-10-30'],
  ['2026-11-01T23:59:59+08:00', 'weekly', 'w:2026-10-26'],
  ['2026-11-02T00:00:00+08:00', 'weekly', 'w:2026-11-02'],
  ['2026-10-31T23:59:59+08:00', 'monthly', 'm:2026-10'],
  ['2026-11-01T00:00:00+08:00', 'monthly', 'm:2026-11'],
  ['2026-10-31T16:30:00Z', 'monthly', 'm:2026-11'],
  ['2026-12-31T23:59:59+08:00', 'daily', 'd:2026-12-31'],
  ['2027-01-01T00:00:00+08:00', 'daily', 'd:2027-01-01'],
  ['2027-01-01T00:00:00+08:00', 'monthly', 'm:2027-01'],
  ['2027-01-01T00:00:00+08:00', 'weekly', 'w:2026-12-28'],
  ['2027-01-04T00:00:00+08:00', 'weekly', 'w:2027-01-04'],
  ['2027-02-28T23:59:59+08:00', 'season', 's:2026-winter'],
  ['2027-03-01T00:00:00+08:00', 'season', 's:2027-spring'],
  ['2027-05-31T23:59:59+08:00', 'season', 's:2027-spring'],
  ['2027-06-01T00:00:00+08:00', 'season', 's:2027-summer'],
  ['2027-08-31T23:59:59+08:00', 'season', 's:2027-summer'],
  ['2027-09-01T00:00:00+08:00', 'season', 's:2027-autumn'],
  ['2027-11-30T23:59:59+08:00', 'season', 's:2027-autumn'],
  ['2027-12-01T00:00:00+08:00', 'season', 's:2027-winter'],
  ['2027-01-15T12:00:00+08:00', 'season', 's:2026-winter'],
]

function periodDump() {
  return boundaries.map(([iso, cadence]) => livePeriod(cadence, at(iso)).key)
}

if (process.env.LIVE_ROTATION_CHILD === '1') {
  console.log(`ZONE ${Intl.DateTimeFormat().resolvedOptions().timeZone}`)
  console.log(`DUMP ${JSON.stringify(periodDump())}`)
  process.exit(0)
}

const zones = ['UTC', 'America/New_York', 'Pacific/Auckland', 'Asia/Taipei']
const dumps: string[] = []
const seen: string[] = []
for (const tz of zones) {
  const run = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    env: { ...process.env, TZ: tz, LIVE_ROTATION_CHILD: '1' },
    encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr || run.stdout)
  const zone = run.stdout.match(/^ZONE (.+)$/m)?.[1] ?? ''
  const dump = run.stdout.match(/^DUMP (.+)$/m)?.[1] ?? ''
  seen.push(`${tz}->${zone}`)
  dumps.push(dump)
}
assert.equal(new Set(dumps).size, 1, `不同裝置時區的週期必須相同：${seen.join(', ')}`)

for (const [iso, cadence, key] of boundaries) {
  assert.equal(livePeriod(cadence, at(iso)).key, key, `${cadence} ${iso}`)
  assert.equal(livePeriod(cadence, at(iso)).key, livePeriod(cadence, at(iso)).key)
}

const midday = at('2026-10-29T15:00:00+08:00')
const first = activeLiveEvents(midday).map((event) => `${event.claimKey}|${event.title}|${event.target}`)
const second = activeLiveEvents(midday).map((event) => `${event.claimKey}|${event.title}|${event.target}`)
assert.deepEqual(second, first, '同一期重新計算不得換題')

const thisWeek = activeLiveEvents(at('2026-10-29T12:00:00+08:00')).find((event) => event.id === 'merge_weekly_rush')
const nextWeek = activeLiveEvents(at('2026-11-02T12:00:00+08:00')).find((event) => event.id === 'merge_weekly_rush')
const stillThisWeek = activeLiveEvents(at('2026-11-01T23:00:00+08:00')).find((event) => event.id === 'merge_weekly_rush')
assert.equal(stillThisWeek?.claimKey, thisWeek?.claimKey)
assert.notEqual(nextWeek?.claimKey, thisWeek?.claimKey)
assert.notEqual(nextWeek?.title, thisWeek?.title, '每週內容池跨週要換題')

const spring = activeLiveEvents(at('2027-04-01T12:00:00+08:00')).find((event) => event.id === 'season_street_parade')
const summer = activeLiveEvents(at('2027-07-01T12:00:00+08:00')).find((event) => event.id === 'season_street_parade')
assert.equal(spring?.period.key, 's:2027-spring')
assert.equal(summer?.period.key, 's:2027-summer')
assert.equal(spring?.title, summer?.title, '遊戲季目前只有一種內容，換季只換期別')
assert.equal(spring?.target, 400)

const core = LIVE_EVENTS.filter((event) => event.cadence !== 'festival')
assert.deepEqual(core.map((event) => event.id), [
  'merge_daily_errand',
  'street_daily_rounds',
  'merge_weekly_rush',
  'street_monthly_fair',
  'block_weekly_cup',
  'season_street_parade',
])
assert.deepEqual(core.map((event) => event.variants.map((variant) => variant.target)), [
  [5, 15],
  [20, 800],
  [25, 60, 35],
  [120, 6000, 160],
  [3, 4000],
  [400],
])
assert.ok(core.every((event) => event.payPoints === 0))
assert.equal(GAME_REWARD_PAYOUT_ENABLED, false)
assert.equal(MERGE_QUEST_TARGET, 3)
assert.equal(MERGE_QUEST_COINS, 24)
assert.equal(MERGE_QUEST_XP, 12)

const byGame = (game: string) => [...new Set(core.filter((event) => event.game === game).map((event) => event.cadence))].sort()
assert.deepEqual(byGame('merge_shop'), ['daily', 'weekly'])
assert.deepEqual(byGame('block_challenge'), ['weekly'])
assert.deepEqual(byGame('dream_street'), ['daily', 'monthly', 'season'])

const day = '2026-10-29'
assert.equal(dailySpec(day).key, `daily:${day}`)
assert.deepEqual(dailySpec(day), dailySpec(day))
assert.notEqual(dailySpec(day).key, dailySpec('2026-10-30').key)
assert.equal(taipeiDayKey(at('2026-10-29T16:00:00Z')), '2026-10-30')
assert.equal(taipeiDayKey(at('2026-10-29T15:59:59Z')), '2026-10-29')

assert.equal(anchoredNow(1_000, 5_000, 8_000), 4_000)
assert.equal(anchoredNow(1_000, 8_000, 5_000), 1_000)

const server = parseLiveEvents({
  serverNow: '2026-10-29T15:00:00+08:00',
  events: [{
    eventId: 'merge_daily_errand',
    gameId: 'merge_shop',
    cadence: 'daily',
    periodKey: 'd:2026-10-29',
    variant: 0,
    target: 5,
    progress: 4,
    available: true,
    claimed: false,
    endsAt: '2026-10-30T00:00:00+08:00',
  }],
  records: [{ eventId: 'merge_weekly_rush', periodKey: 'w:2026-10-19', variant: 1, medal: 'ic-quest', claimedAt: '2026-10-20T00:00:00+08:00' }],
})
assert.ok(server)
assert.equal(server?.serverNow, at('2026-10-29T15:00:00+08:00'))
const held = resolveLiveBoard(at('2026-10-30T01:00:00+08:00'), server, 'merge_shop')
assert.equal(held.length, 1)
assert.equal(held[0]?.periodKey, 'd:2026-10-29')
assert.equal(held[0]?.source, 'server')
assert.equal(held[0]?.progress, 4)
const preview = resolveLiveBoard(at('2026-10-30T01:00:00+08:00'), null, 'merge_shop')
assert.equal(preview.find((card) => card.id === 'merge_daily_errand')?.periodKey, 'd:2026-10-30')
assert.ok(preview.every((card) => card.gameId === 'merge_shop' && card.source === 'preview'))
assert.equal(parseLiveEvents({ events: [], records: [] })?.serverNow, null)
assert.equal(parseLiveEvents({ events: [], records: [], serverNow: 'nope' }), null)

console.log(`live rotation checks ok (${boundaries.length} boundaries, zones ${seen.join(', ')})`)
