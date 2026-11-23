/**
 * 核對 27 種節慶：主題生效日、活動窗口、限定收藏販售日是否同一套台北時間規則。
 * 只讀檔與純函式，不連資料庫、不改日期。
 */
import { readFileSync } from 'node:fs'
import { FESTIVAL_THEMES, festivalScheduleIssues, resolveFestivalTheme, themeActiveOn, type FestivalTheme } from '../lib/arcade/festival-theme'
import { solarTermTaipeiDay } from '../lib/arcade/solar-term'
import { festivalPeriod, festivalWindows, LIVE_EVENTS } from '../lib/arcade/live-ops'
import { PERK_CATALOG } from '../lib/rewards/perk-catalog'
import { perkView } from '../lib/rewards/perk-mall-state'

const FROM = 2026
const TO = 2050
const SALE_TO = TO
const themes = FESTIVAL_THEMES.filter((theme) => theme.id !== 'brand')
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

function parseRows(sql: string, table: string): Map<string, string[]> {
  const start = sql.indexOf(`INSERT INTO public.${table}`)
  const end = sql.indexOf('ON CONFLICT', start)
  const block = sql.slice(start, end > start ? end : sql.indexOf(';', start))
  const rows = new Map<string, string[]>()
  for (const match of block.matchAll(/\('([a-z0-9-]+)', (?:DATE )?'(\d{4}-\d{2}-\d{2})', (?:DATE )?'(\d{4}-\d{2}-\d{2})'\)/g)) {
    const list = rows.get(match[1]) ?? []
    list.push(`${match[2]}..${match[3]}`)
    rows.set(match[1], list)
  }
  return rows
}

function dayActive(theme: FestivalTheme, day: string): boolean {
  const start = Date.parse(`${day}T00:00:00+08:00`)
  const end = Date.parse(`${day}T24:00:00+08:00`)
  if (themeActiveOn(theme, day, new Date(start)) || themeActiveOn(theme, day, new Date(end - 1))) return true
  return themeActiveOn(theme, day, new Date(`${day}T12:00:00+08:00`))
}

const liveSql = readFileSync('supabase/manual/20261030030700_live_events_apply.sql', 'utf8')
const gapSql = readFileSync('supabase/manual/20261030031200_festival_date_gaps.sql', 'utf8')
const mallSql = readFileSync('supabase/manual/20261030020100_points_mall_v2_apply.sql', 'utf8')
const liveRows = parseRows(liveSql, 'game_live_festival_windows')
const saleRows = parseRows(mallSql, 'member_perk_sale_windows')
for (const [id, list] of parseRows(gapSql, 'game_live_festival_windows')) liveRows.set(id, [...(liveRows.get(id) ?? []), ...list].sort())
for (const [id, list] of parseRows(gapSql, 'member_perk_sale_windows')) saleRows.set(id, [...(saleRows.get(id) ?? []), ...list].sort())

const gaps: string[] = []
const leads: string[] = []
const unreliable: string[] = []
let boundaryChecks = 0
let overlapDays = 0

assert(themes.length === 27, `節慶主題不是 27 種（${themes.length}）`)
const festivalEvents = LIVE_EVENTS.filter((event) => event.cadence === 'festival')
assert(festivalEvents.length === 27, `節慶活動不是 27 個（${festivalEvents.length}）`)
for (const theme of themes) {
  const event = festivalEvents.find((item) => item.festivalId === theme.id)
  assert(event, `${theme.id} 沒有對應活動`)
  assert(event!.payPoints === 0, `${theme.id} 活動發放 Pay 點數`)
  const expected = festivalWindows(theme.id, FROM, TO).map((window) => `${window.startsOn}..${window.endsOn}`)
  const actual = liveRows.get(theme.id) ?? []
  if (expected.join('|') !== actual.join('|')) {
    gaps.push(`${theme.id} 活動窗口與主題計算不同：規則 ${expected.length} 段、SQL ${actual.length} 段`)
    const missing = expected.filter((row) => !actual.includes(row))
    const extra = actual.filter((row) => !expected.includes(row))
    if (missing.length) gaps.push(`  規則有、SQL 無：${missing.slice(0, 6).join('、')}${missing.length > 6 ? '…' : ''}`)
    if (extra.length) gaps.push(`  SQL 有、規則無：${extra.slice(0, 6).join('、')}${extra.length > 6 ? '…' : ''}`)
  }
  const covered = new Set<string>()
  for (const window of festivalWindows(theme.id, FROM, TO)) {
    const open = Date.parse(`${window.startsOn}T00:00:00+08:00`)
    const close = Date.parse(`${window.endsOn}T00:00:00+08:00`)
    if (!themeActiveOn(theme, window.startsOn)) gaps.push(`${theme.id} ${window.startsOn} 窗口開始日正午主題未生效`)
    if (themeActiveOn(theme, window.endsOn)) gaps.push(`${theme.id} ${window.endsOn} 窗口結束日正午主題仍生效`)
    for (const at of [open, close - 1000]) {
      const period = festivalPeriod(theme.id, at)
      if (period?.key !== `f:${theme.id}:${window.startsOn}` || period.endMs !== close) {
        gaps.push(`${theme.id} ${new Date(at).toISOString()} 期別 ${period?.key ?? '無'} 與窗口 ${window.startsOn}..${window.endsOn} 不同`)
      }
    }
    const before = festivalPeriod(theme.id, open - 1000)
    if (before?.key === `f:${theme.id}:${window.startsOn}`) gaps.push(`${theme.id} 在 ${window.startsOn} 開始前就進入這一期`)
    const after = festivalPeriod(theme.id, close)
    if (after?.key === `f:${theme.id}:${window.startsOn}`) gaps.push(`${theme.id} 在 ${window.endsOn} 結束後仍停在這一期`)
    for (let ms = open; ms < close; ms += 86400000) covered.add(new Date(ms + 12 * 3600_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }))
    boundaryChecks += 1
  }
  for (let ms = Date.parse(`${FROM}-01-01T00:00:00+08:00`); ms < Date.parse(`${TO + 1}-01-01T00:00:00+08:00`); ms += 86400000) {
    const day = new Date(ms + 12 * 3600_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    const noon = themeActiveOn(theme, day)
    if (noon && !covered.has(day)) gaps.push(`${theme.id} ${day} 正午主題生效，活動窗口沒有這一天`)
    if (!noon && dayActive(theme, day)) leads.push(`${theme.id} ${day}`)
  }
  if (theme.schedule.kind === 'solarTerm') {
    for (let year = FROM; year <= TO; year += 1) {
      if (!solarTermTaipeiDay(year, theme.schedule.term)) unreliable.push(`${theme.id} ${year}`)
    }
  }
}

const saleMap: Record<string, string> = {
  'collect-newyear': 'lunar-new-year',
  'collect-moon': 'mid-autumn',
  'collect-snowman': 'christmas',
}
for (const [perkId, festivalId] of Object.entries(saleMap)) {
  const expected = festivalWindows(festivalId, FROM, SALE_TO).map((window) => `${window.startsOn}..${window.endsOn}`)
  const actual = saleRows.get(perkId) ?? []
  if (expected.join('|') !== actual.join('|')) {
    gaps.push(`${perkId} 販售期間與 ${festivalId} 主題不同`)
    const missing = expected.filter((row) => !actual.includes(row))
    if (missing.length) gaps.push(`  缺少：${missing.join('、')}`)
  }
}

const eventSql = liveSql.slice(liveSql.indexOf('INSERT INTO public.game_live_events'), liveSql.indexOf('INSERT INTO public.game_live_festival_windows'))
for (const event of festivalEvents) {
  const variant = event.variants[0]
  const row = `('${event.id}', '${event.game}', 'festival', '${event.festivalId}', '[{"metric":"${variant.metric}","target":${variant.target}}]'`
  if (!eventSql.includes(row)) gaps.push(`${event.festivalId} 的活動列與規則不同：${event.id}`)
}
assert((eventSql.match(/'festival'/g) ?? []).length === 27, '活動套用檔的節慶列不是 27 筆')

for (let ms = Date.parse(`${FROM}-01-01T12:00:00+08:00`); ms < Date.parse(`${TO + 1}-01-01T12:00:00+08:00`); ms += 86400000) {
  const instant = new Date(ms)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
  const active = themes.filter((theme) => themeActiveOn(theme, day, instant))
  if (active.length < 2) continue
  overlapDays += 1
  const winner = [...active].sort((a, b) => b.priority - a.priority || themes.indexOf(a) - themes.indexOf(b))[0]
  if (resolveFestivalTheme(instant).id !== winner.id) gaps.push(`${day} 重疊主題沒有沿用優先順序 ${winner.id}`)
}

const collections = PERK_CATALOG.filter((perk) => perk.category === 'collection')
const reason: Record<string, string> = { not_started: '尚未開始', ended: '已過期', sold_out: '已售完' }
for (const perk of collections) {
  for (const state of ['not_started', 'ended', 'sold_out'] as const) {
    const view = perkView(perk, {
      loggedIn: true,
      owned: false,
      balance: 999,
      purchaseOpen: true,
      server: new Map([[perk.id, { id: perk.id, cost: perk.cost, state, opensOn: '2027-02-05', stockLimit: 500, stockLeft: 0 }]]),
    })
    assert(view.label === reason[state], `${perk.id} 的 ${state} 顯示成「${view.label}」`)
    assert(view.canBuy === false, `${perk.id} 的 ${state} 仍可兌換`)
  }
  const owned = perkView(perk, {
    loggedIn: true,
    owned: true,
    balance: 0,
    purchaseOpen: true,
    server: new Map([[perk.id, { id: perk.id, cost: perk.cost, state: 'ended' }]]),
  })
  assert(owned.kind === 'owned' && owned.label.startsWith('已擁有'), '活動結束後已兌換收藏沒有保留持有')
}
const shop = readFileSync('components/home/perks-shop.tsx', 'utf8')
const arcade = readFileSync('components/arcade/points-mall.tsx', 'utf8')
assert(shop.includes('purchaseOpen === false') && shop.lastIndexOf('{view.label}') > shop.indexOf('兌換未開放'), '會員中心沒有把未開賣、已結束、售完分開顯示')
assert(arcade.includes('{view.label}') && !arcade.includes('兌換未開放'), '遊樂園商城把限定原因收成兌換未開放')

const overlap = Date.parse('2027-02-20T12:00:00+08:00')
const active = themes.filter((theme) => themeActiveOn(theme, '2027-02-20', new Date(overlap)))
assert(active.some((theme) => theme.id === 'lunar-new-year') && active.some((theme) => theme.id === 'lantern-festival'), '2027 元宵當天春節與元宵沒有同時處於期間')
assert(resolveFestivalTheme(new Date(overlap)).id === 'lantern-festival', '重疊時沒有沿用較高優先順序')
const eve = Date.parse('2026-12-31T18:00:00+08:00')
const eveBefore = Date.parse('2026-12-31T17:59:59+08:00')
const yearOpen = Date.parse('2026-12-31T16:00:00.000Z')
const yearBefore = Date.parse('2026-12-31T15:59:59.000Z')
assert(resolveFestivalTheme(new Date(eve)).id === 'new-year-eve', '跨年 18:00 主題未開始')
assert(resolveFestivalTheme(new Date(eveBefore)).id !== 'new-year-eve', '跨年 18:00 前主題已開始')
assert(festivalPeriod('new-year-eve', eve) == null, '跨年 18:00 的活動期別超前於已安裝窗口')
assert(festivalPeriod('new-year-eve', yearOpen)?.key === 'f:new-year-eve:2027-01-01', '台北 1 月 1 日 00:00 沒有進入跨年活動')
assert(festivalPeriod('new-year-eve', yearBefore) == null, '台北 12 月 31 日 23:59 被算進隔年活動')
assert(resolveFestivalTheme(new Date(yearOpen)).id === resolveFestivalTheme(new Date(yearBefore)).id, '跨過台北午夜後主題沒有維持')
const firstLook = `${resolveFestivalTheme(new Date(eve)).id}|${festivalPeriod('new-year-eve', eve)?.key ?? 'none'}`
const secondLook = `${resolveFestivalTheme(new Date(eve)).id}|${festivalPeriod('new-year-eve', eve)?.key ?? 'none'}`
assert(firstLook === 'new-year-eve|none' && firstLook === secondLook, '重整後跨年主題或活動期別變了')
assert(leads.length === 25 && leads.every((lead) => /^new-year-eve 20\d\d-12-31$/.test(lead)), `正午以外的主題時段不是跨年 12/31：${leads.slice(0, 4).join('、')}`)
assert(festivalScheduleIssues(new Date('2026-11-08T12:00:00+08:00')).length === 0, '宣告年份內的今天不該有無法計算的節慶')
assert(unreliable.length === 0, `節氣仍無法可靠判定：${unreliable.join('、')}`)

console.log(`主題 ${themes.length}、活動 ${festivalEvents.length}、窗口邊界 ${boundaryChecks}、重疊日 ${overlapDays}`)
console.log(`節氣無法可靠判定：${unreliable.length === 0 ? '無' : unreliable.join('、')}`)
console.log(`畫面早於活動窗口：${leads.length} 個跨年 12/31 傍晚，活動仍從 1/1 起算`)
if (gaps.length) {
  console.log(gaps.join('\n'))
  process.exit(1)
}
console.log('27 種節慶的主題、活動窗口與三件限定收藏販售日一致')
