/**
 * 第六階段第四批：節慶主題的台北時間、開始結束、優先順序與恢復預設外觀。
 * 純函式測試，不連資料庫。
 */
import {
  BRAND_THEME,
  FESTIVAL_THEMES,
  festivalScheduleIssues,
  lunarToSolar,
  newYearMoment,
  readFestivalOverride,
  resolveFestivalTheme,
  solarToLunar,
  themeActiveOn,
  type FestivalTheme,
} from '../lib/arcade/festival-theme'
import { solarTermTaipeiDay } from '../lib/arcade/solar-term'
import { festivalYear } from '../components/festival/festival-store'

let passed = 0
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
  passed += 1
}
const at = (iso: string) => resolveFestivalTheme(new Date(iso)).id

// 預設與既有主題
assert(at('2026-10-26T12:00:00+08:00') === 'brand', '今天（10/26）沒有節慶，應為預設外觀')
assert(at('2026-10-25T00:00:00+08:00') === 'retrocession' && at('2026-10-25T23:59:59+08:00') === 'retrocession', '光復節整天有效')
assert(at('2026-10-24T23:59:59+08:00') === 'brand' && at('2026-10-26T00:00:00+08:00') === 'brand', '光復節前後回到預設')

// 跨年：12/31 18:00 開始，1/2 00:00 結束（含頭不含尾）
assert(at('2026-12-31T17:59:59+08:00') === 'brand', '跨年 18:00 前不開始')
assert(at('2026-12-31T18:00:00+08:00') === 'new-year-eve', '跨年 18:00 準時開始')
assert(at('2027-01-01T23:59:00+08:00') === 'new-year-eve', '元旦整天仍是跨年主題')
assert(at('2027-01-02T00:00:00+08:00') === 'brand', '1/2 00:00 結束並恢復預設')
assert(at('2026-12-31T10:00:00Z') === 'new-year-eve', 'UTC 10:00 = 台北 18:00，應以台北時間判斷')
assert(at('2026-12-31T09:59:00Z') === 'brand', 'UTC 09:59 = 台北 17:59，尚未開始')

// 聖誕 12/20–12/25（國曆區間）
assert(at('2026-12-19T23:59:00+08:00') === 'brand' && at('2026-12-20T00:00:00+08:00') === 'christmas', '聖誕 12/20 開始')
assert(at('2026-12-25T23:59:00+08:00') === 'christmas' && at('2026-12-26T00:00:00+08:00') === 'brand', '聖誕 12/25 結束')

// 農曆：春節 15 天，元宵優先順序較高
const cny2027 = lunarToSolar(2027, 1, 1)
const lantern2027 = lunarToSolar(2027, 1, 15)
assert(cny2027 === '2027-02-06' && lantern2027 === '2027-02-20', `2027 春節/元宵換算錯誤：${cny2027} ${lantern2027}`)
assert(at(`${cny2027}T00:00:00+08:00`) === 'lunar-new-year', '春節初一開始')
assert(at('2027-02-19T12:00:00+08:00') === 'lunar-new-year', '正月十四仍是春節')
assert(at(`${lantern2027}T12:00:00+08:00`) === 'lantern-festival', '元宵當天優先順序高於春節')
assert(at('2027-02-21T00:00:00+08:00') === 'brand', '元宵隔天恢復預設')
assert(at(`${lunarToSolar(2027, 5, 5)}T09:00:00+08:00`) === 'dragon-boat', '端午依農曆換算')
assert(lunarToSolar(2026, 5, 5) === '2026-06-19' && at('2026-06-19T09:00:00+08:00') === 'dragon-boat', '2026 端午為 6/19')

// 單次活動區間與優先順序
const campaign: FestivalTheme = {
  ...BRAND_THEME,
  id: 'campaign',
  name: '測試活動',
  priority: 99,
  schedule: { kind: 'window', startAt: '2026-11-01T10:00:00+08:00', endAt: '2026-11-03T22:00:00+08:00' },
}
const list = [...FESTIVAL_THEMES, campaign]
assert(resolveFestivalTheme(new Date('2026-11-01T09:59:59+08:00'), list).id === 'brand', '單次活動開始前為預設')
assert(resolveFestivalTheme(new Date('2026-11-01T10:00:00+08:00'), list).id === 'campaign', '單次活動準時開始')
assert(resolveFestivalTheme(new Date('2026-11-03T22:00:00+08:00'), list).id === 'brand', '單次活動準時結束')
const overXmas: FestivalTheme = { ...campaign, schedule: { kind: 'window', startAt: '2026-12-24T00:00:00+08:00', endAt: '2026-12-26T00:00:00+08:00' } }
assert(resolveFestivalTheme(new Date('2026-12-24T12:00:00+08:00'), [...FESTIVAL_THEMES, overXmas]).id === 'campaign', '重疊時採用優先順序較高者')
assert(resolveFestivalTheme(new Date('2026-12-24T12:00:00+08:00'), [...FESTIVAL_THEMES, { ...overXmas, priority: 1 }]).id === 'christmas', '優先順序較低時不覆蓋')
const broken: FestivalTheme = { ...campaign, schedule: { kind: 'window', startAt: 'not-a-date', endAt: '2026-12-26T00:00:00+08:00' } }
assert(!themeActiveOn(broken, '2026-12-24', new Date('2026-12-24T12:00:00+08:00')), '設定錯誤的區間不生效，不會卡住外觀')
const badTime: FestivalTheme = { ...campaign, schedule: { kind: 'solarTime', start: '13-40 25:00', end: '01-01 00:00' } }
assert(!themeActiveOn(badTime, '2026-12-24', new Date('2026-12-24T12:00:00+08:00')), '格式錯誤的時間不生效')

// 每個主題都有完整外觀設定
for (const theme of FESTIVAL_THEMES) {
  assert(theme.palette && /^#[0-9a-f]{6}$/i.test(theme.palette.accent) && theme.decor, `${theme.id} 缺少配色或裝飾`)
}
assert(new Set(FESTIVAL_THEMES.map((theme) => theme.id)).size === FESTIVAL_THEMES.length, '主題編號不可重複')

// 驗收用網址參數
assert(readFestivalOverride('?festival=mid-autumn').previewId === 'mid-autumn', '可用網址預覽主題')
assert(readFestivalOverride('?festival=hack').previewId === null, '未知主題編號被忽略')
assert(readFestivalOverride('?festivalAt=2026-12-31T19:00:00%2B08:00').at?.toISOString() === '2026-12-31T11:00:00.000Z', '可用網址模擬時間')
assert(readFestivalOverride('?festivalAt=garbage').at === null, '錯誤時間被忽略')

// 母親節：五月第二個星期日，提前 6 天開始
assert(at('2026-05-03T23:59:00+08:00') === 'brand' && at('2026-05-04T00:00:00+08:00') === 'mothers-day', '2026 母親節前一週開始')
assert(at('2026-05-10T12:00:00+08:00') === 'mothers-day' && at('2026-05-11T00:00:00+08:00') === 'brand', '2026 母親節為 5/10，隔天結束')
assert(at('2027-05-09T12:00:00+08:00') === 'mothers-day' && at('2027-05-10T00:00:00+08:00') === 'brand', '2027 母親節為 5/9')

// 節氣：清明、冬至依太陽黃經換算，優先於同期的兒童節、聖誕
assert(solarTermTaipeiDay(2026, 'qingming') === '2026-04-05', '2026 清明為 4/5')
assert(solarTermTaipeiDay(2028, 'qingming') === '2028-04-04', '2028 清明為 4/4')
assert(solarTermTaipeiDay(2038, 'qingming') === '2038-04-05', '2038 清明為 4/5')
assert(solarTermTaipeiDay(2042, 'qingming') === '2042-04-04', '2042 清明為 4/4')
assert(at('2038-04-04T23:59:59+08:00') !== 'qingming' && at('2038-04-05T00:00:00+08:00') === 'qingming' && at('2038-04-06T00:00:00+08:00') !== 'qingming', '2038 清明從台北 4/5 午夜開始，隔天午夜結束')
assert(at('2042-04-03T23:59:59+08:00') !== 'qingming' && at('2042-04-04T00:00:00+08:00') === 'qingming' && at('2042-04-05T00:00:00+08:00') !== 'qingming', '2042 清明從台北 4/4 午夜開始，隔天午夜結束')
assert(solarTermTaipeiDay(2025, 'dongzhi') === '2025-12-21' && solarTermTaipeiDay(2026, 'dongzhi') === '2026-12-22', '冬至 2025/12/21、2026/12/22')
assert(at('2026-04-04T12:00:00+08:00') === 'childrens-day' && at('2026-04-05T12:00:00+08:00') === 'qingming' && at('2026-04-06T00:00:00+08:00') === 'brand', '清明當天取代兒童節，隔天恢復')
assert(at('2025-12-21T12:00:00+08:00') === 'dongzhi' && at('2025-12-22T12:00:00+08:00') === 'christmas', '2025 冬至優先於聖誕，隔天回到聖誕')
assert(at('2026-12-21T12:00:00+08:00') === 'christmas' && at('2026-12-22T12:00:00+08:00') === 'dongzhi', '2026 冬至為 12/22')

// 其他農曆節日（2026）
assert(lunarToSolar(2026, 7, 7) === '2026-08-19' && at('2026-08-18T12:00:00+08:00') === 'qixi' && at('2026-08-19T12:00:00+08:00') === 'qixi', '2026 七夕 8/19，前一天開始')
assert(lunarToSolar(2026, 7, 15) === '2026-08-27' && at('2026-08-27T12:00:00+08:00') === 'ghost-festival', '2026 中元 8/27')
assert(lunarToSolar(2026, 8, 15) === '2026-09-25' && at('2026-09-25T12:00:00+08:00') === 'mid-autumn', '2026 中秋 9/25')
assert(lunarToSolar(2026, 9, 9) === '2026-10-18' && at('2026-10-18T12:00:00+08:00') === 'double-ninth', '2026 重陽 10/18')
assert(at('2026-02-16T00:00:00+08:00') === 'lunar-new-year' && at('2026-02-15T23:59:00+08:00') === 'brand', '2026 除夕（2/16）開始春節')
assert(at('2027-02-05T12:00:00+08:00') === 'lunar-new-year', '2027 除夕跨農曆年仍屬春節')
assert(at('2026-03-03T12:00:00+08:00') === 'lantern-festival', '2026 元宵 3/3')

// 國曆節日與購物檔期
const fixed: [string, string][] = [
  ['2026-02-14', 'valentine'], ['2026-03-08', 'womens-day'], ['2026-03-14', 'white-day'], ['2026-04-02', 'childrens-day'],
  ['2026-05-01', 'labor-day'], ['2026-05-20', 'day-520'], ['2026-06-17', 'mid-year-618'], ['2027-06-18', 'mid-year-618'], ['2026-08-08', 'fathers-day'],
  ['2026-09-09', 'double-9'], ['2026-09-28', 'teachers-day'], ['2026-10-10', 'national-day'], ['2026-10-31', 'halloween'],
  ['2026-11-11', 'double-11'], ['2026-12-12', 'double-12'], ['2026-12-25', 'christmas'],
]
for (const [day, id] of fixed) assert(at(`${day}T12:00:00+08:00`) === id, `${day} 應為 ${id}，實際 ${at(`${day}T12:00:00+08:00`)}`)
assert(at('2026-06-18T12:00:00+08:00') === 'dragon-boat', '2026 端午前一天與 618 重疊，節日優先於購物檔期')
assert(at('2026-11-08T12:00:00+08:00') === 'brand' && at('2026-11-12T00:00:00+08:00') === 'brand', '雙 11 檔期前後恢復預設')

// 跨年年份
const countdown = newYearMoment(new Date('2026-12-31T23:00:00+08:00'))
assert(countdown?.kind === 'countdown' && countdown.year === 2027 && countdown.minutesLeft === 60, '12/31 23:00 倒數 60 分鐘迎接 2027')
const celebrate = newYearMoment(new Date('2027-01-01T00:00:00+08:00'))
assert(celebrate?.kind === 'celebrate' && celebrate.year === 2027, '1/1 00:00 顯示 2027')
assert(newYearMoment(new Date('2026-10-26T12:00:00+08:00')) === null, '其他日子沒有倒數')
assert(festivalYear(Date.parse('2026-10-26T12:00:00+08:00')) === 2027, '10 月預覽跨年顯示 2027')
assert(festivalYear(Date.parse('2027-01-15T12:00:00+08:00')) === 2027, '1 月預覽跨年顯示當年')
assert(festivalYear(Date.parse('2026-12-31T15:59:00Z')) === 2027, 'UTC 12/31 15:59 = 台北 23:59，仍是 2027')

// 無法可靠計算時略過並留下紀錄
assert(festivalScheduleIssues(new Date('2026-10-26T12:00:00+08:00')).length === 0, '曆表範圍內沒有異常')
const issues2051 = festivalScheduleIssues(new Date('2051-03-01T12:00:00+08:00'))
assert(issues2051.some((issue) => issue.startsWith('lunar-new-year')) && issues2051.some((issue) => issue.startsWith('mid-autumn')), '2051 超出農曆曆表時回報')
assert(at('2051-02-01T12:00:00+08:00') === 'brand' && at('2051-12-25T12:00:00+08:00') === 'christmas', '超出曆表時農曆節日不生效，國曆節日照常')

// 場景：每個節慶都有動畫；莊重節日不得有歡慶特效
for (const theme of FESTIVAL_THEMES) {
  if (theme.id === 'brand') {
    assert(!theme.scene, '預設品牌外觀不加動畫')
    continue
  }
  assert(theme.scene, `${theme.id} 缺少動畫場景`)
  if (theme.scene?.mood === 'solemn') assert(theme.scene.special === null && !theme.scene.topper, `${theme.id} 為莊重節日，不可有特效或掛飾`)
}
assert(['qingming', 'ghost-festival'].every((id) => FESTIVAL_THEMES.find((theme) => theme.id === id)?.scene?.mood === 'solemn'), '清明、中元為莊重模式')
for (const theme of FESTIVAL_THEMES.filter((item) => item.scene?.mood === 'shopping')) {
  assert(!/\d+\s*(折|%|％)|免運|現折/.test(theme.banner) && theme.banner.includes('以各賣場實際公告為準'), `${theme.id} 不可顯示平台未提供的折扣`)
}

// 農曆曆表逐日比對 Intl 農曆（2024–2050）。ICU 在 2027、2030 正月初一與台灣、香港官方曆差一天，以官方曆為準。
const chinese = new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: 'UTC', month: 'numeric', day: 'numeric' })
const icuKnownWrong = [['2027-02-06', '2027-03-08'], ['2030-02-02', '2030-03-04']]
let lunarDays = 0
for (let time = Date.UTC(2024, 1, 10); time < Date.UTC(2051, 0, 1); time += 86400000) {
  const day = new Date(time).toISOString().slice(0, 10)
  if (icuKnownWrong.some(([from, to]) => day >= from && day < to)) continue
  const mine = solarToLunar(day)
  const parts = chinese.formatToParts(new Date(time))
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const date = Number(parts.find((part) => part.type === 'day')?.value)
  if (!mine || mine.month !== parseInt(month, 10) || mine.day !== date || mine.leap !== /bis/.test(month)) {
    throw new Error(`${day} 農曆換算與 Intl 不一致：${JSON.stringify(mine)} / ${month} ${date}`)
  }
  lunarDays += 1
}
assert(lunarDays > 9700, '農曆逐日比對天數不足')
assert(lunarToSolar(2027, 1, 1) === '2027-02-06' && lunarToSolar(2030, 1, 1) === '2030-02-03', '2027、2030 春節依官方曆')

console.log(`節慶主題測試：${passed} 項通過（農曆逐日比對 ${lunarDays} 天）`)
