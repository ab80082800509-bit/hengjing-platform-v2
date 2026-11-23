/**
 * 全站節慶主題。只決定畫面文字、色票與動畫場景，不寫訂單、點數、Inventory 或遊戲進度。
 * 農曆節慶用農曆月日、節氣用太陽黃經、母親節用「第 N 個星期幾」，每年由系統換算，不把某一屆寫死成規則。
 */
import { taipeiCalendarDate } from '@/lib/rewards/taipei-day'
import { solarTermTaipeiDay, type SolarTermId } from './solar-term'

export type ThemeSchedule =
  | { kind: 'always' }
  | { kind: 'solar'; startMonth: number; startDay: number; endMonth: number; endDay: number }
  /** leadDays：提前幾天開始；durationDays：從當天起算幾天（含當天）。 */
  | { kind: 'lunar'; month: number; day: number; durationDays: number; leadDays?: number }
  /** 每年 month 月第 nth 個星期 weekday（0 = 星期日），例如母親節。 */
  | { kind: 'nthWeekday'; month: number; weekday: number; nth: number; durationDays: number; leadDays?: number }
  /** 二十四節氣，例如清明、冬至。 */
  | { kind: 'solarTerm'; term: SolarTermId; durationDays: number; leadDays?: number }
  /** 每年重複的台北時間區間，精確到分鐘，可跨年。start、end 格式為 MM-DD HH:mm，含頭不含尾。 */
  | { kind: 'solarTime'; start: string; end: string }
  /** 單次活動，ISO 時間需帶 +08:00。含頭不含尾。 */
  | { kind: 'window'; startAt: string; endAt: string }

export type FestivalDecor =
  | 'none' | 'lantern' | 'moon' | 'chrysanthemum' | 'firework' | 'snow' | 'wave' | 'ray'
  | 'heart' | 'flower' | 'gift' | 'bag' | 'star' | 'willow' | 'pumpkin' | 'tangyuan' | 'lotus' | 'book' | 'crown' | 'balloon' | 'gear' | 'tie'

/** 全站沉浸式場景。mood 為 solemn 的節日不得使用煙火、彩帶等歡慶特效。 */
export type FestivalMood = 'festive' | 'warm' | 'romantic' | 'shopping' | 'solemn'

export type FestivalParticle =
  | 'snow' | 'red-envelope' | 'glow-orb' | 'heart-rise' | 'diamond' | 'heart-white' | 'bubble' | 'drizzle'
  | 'warm-mote' | 'carnation-petal' | 'love-letter' | 'bamboo-leaf' | 'confetti-cool' | 'star-twinkle'
  | 'gold-bokeh' | 'candle-mote' | 'streamer' | 'osmanthus' | 'apricot-petal' | 'sparkle-tricolor'
  | 'sparkle-gold' | 'chrysanthemum-petal' | 'bat' | 'confetti-hot' | 'ribbon-curl' | 'steam' | 'star-glitter'

export type FestivalSpecial =
  | 'santa' | 'fireworks' | 'fireworks-gold' | 'sky-lanterns' | 'heart-balloons' | 'gift-rise' | 'glint-pop'
  | 'paper-plane' | 'sun-rays' | 'heart-bloom' | 'envelope-plane' | 'dragon-boat' | 'cart-dash' | 'magpie-bridge'
  | 'light-sweep' | 'bag-bounce' | 'cloud-drift' | 'geese' | 'ghost-float' | 'bag-rush' | 'gift-pop'

export type FestivalTopper = 'xmas-lights' | 'lanterns' | 'bunting' | 'spooky-bunting' | 'pennants'

export type FestivalScene = {
  mood: FestivalMood
  particle: FestivalParticle
  special: FestivalSpecial | null
  topper?: FestivalTopper
}

export type FestivalTheme = {
  id: string
  name: string
  priority: number
  schedule: ThemeSchedule
  eyebrow: string
  banner: string
  motif: string
  decor: FestivalDecor
  /** 主色、柔和底色、亮點色。只用在節慶裝飾與背景氛圍，不改網站主按鈕。 */
  palette: { accent: string; soft: string; glow: string }
  /** 合成小舖店面掛飾的文字，例如春聯。 */
  shopSign?: string
  /** 全站動畫場景；預設品牌主題沒有。 */
  scene?: FestivalScene
}

/** 農曆 2024 正月初一是國曆 2024-02-10。之後各年用月長表往後推。 */
const LUNAR_EPOCH_YEAR = 2024
const LUNAR_EPOCH_UTC = Date.UTC(2024, 1, 10)

/**
 * 月長編碼：bit15–bit4 為正月到臘月（1 為 30 日），低 4 bit 為閏月，bit16 為閏月 30 日。
 * 資料涵蓋 2024–2050（測試逐日比對 Intl 農曆），超出範圍就不當成節慶生效並留下檢查紀錄。
 */
const LUNAR_INFO: Record<number, number> = {
  2024: 0x04b60,
  2025: 0x0a6e6,
  2026: 0x0a4e0,
  2027: 0x0d260,
  2028: 0x0ea65,
  2029: 0x0d530,
  2030: 0x05aa0,
  2031: 0x076a3,
  2032: 0x096d0,
  2033: 0x04afb,
  2034: 0x04ad0,
  2035: 0x0a4d0,
  2036: 0x1d0b6,
  2037: 0x0d250,
  2038: 0x0d520,
  2039: 0x0dd45,
  2040: 0x0b5a0,
  2041: 0x056d0,
  2042: 0x055b2,
  2043: 0x049b0,
  2044: 0x0a577,
  2045: 0x0a4b0,
  2046: 0x0aa50,
  2047: 0x1b255,
  2048: 0x06d20,
  2049: 0x0ada0,
  2050: 0x14b63,
}

export const LUNAR_TABLE_RANGE = { from: LUNAR_EPOCH_YEAR, to: 2050 } as const

export type LunarDate = {
  year: number
  month: number
  day: number
  leap: boolean
}

function leapMonth(year: number): number {
  return (LUNAR_INFO[year] ?? 0) & 0xf
}

function leapMonthDays(year: number): number {
  if (!leapMonth(year)) return 0
  return LUNAR_INFO[year] & 0x10000 ? 30 : 29
}

function monthDays(year: number, month: number): number {
  const info = LUNAR_INFO[year]
  if (!info || month < 1 || month > 12) return 0
  return info & (0x8000 >> (month - 1)) ? 30 : 29
}

function lunarYearDays(year: number): number {
  const info = LUNAR_INFO[year]
  if (!info) return 0
  let sum = 348
  for (let bit = 0x8000; bit > 0x8; bit >>= 1) sum += info & bit ? 1 : 0
  return sum + leapMonthDays(year)
}

export function solarToLunar(taipeiDay: string): LunarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(taipeiDay)) return null
  const utc = Date.parse(`${taipeiDay}T00:00:00Z`)
  if (Number.isNaN(utc)) return null
  let offset = Math.round((utc - LUNAR_EPOCH_UTC) / 86400000)
  if (offset < 0) return null
  let year = LUNAR_EPOCH_YEAR
  while (offset >= lunarYearDays(year)) {
    const days = lunarYearDays(year)
    if (!days) return null
    offset -= days
    year += 1
  }
  if (!LUNAR_INFO[year]) return null
  const leap = leapMonth(year)
  let month = 1
  let isLeap = false
  while (month <= 12) {
    const days = isLeap ? leapMonthDays(year) : monthDays(year, month)
    if (offset < days) return { year, month, day: offset + 1, leap: isLeap }
    offset -= days
    if (leap === month && !isLeap) isLeap = true
    else {
      isLeap = false
      month += 1
    }
  }
  return null
}

export function lunarToSolar(year: number, month: number, day: number): string | null {
  if (!LUNAR_INFO[year] || month < 1 || month > 12 || day < 1 || day > monthDays(year, month)) return null
  let offset = 0
  for (let cursor = LUNAR_EPOCH_YEAR; cursor < year; cursor += 1) {
    const days = lunarYearDays(cursor)
    if (!days) return null
    offset += days
  }
  const leap = leapMonth(year)
  for (let cursor = 1; cursor < month; cursor += 1) {
    offset += monthDays(year, cursor)
    if (leap === cursor) offset += leapMonthDays(year)
  }
  offset += day - 1
  return new Date(LUNAR_EPOCH_UTC + offset * 86400000).toISOString().slice(0, 10)
}

function dateNumber(month: number, day: number): number {
  return month * 100 + day
}

function solarWindowActive(schedule: Extract<ThemeSchedule, { kind: 'solar' }>, taipeiDay: string): boolean {
  const [, monthText, dayText] = taipeiDay.split('-')
  const current = dateNumber(Number(monthText), Number(dayText))
  const start = dateNumber(schedule.startMonth, schedule.startDay)
  const end = dateNumber(schedule.endMonth, schedule.endDay)
  if (start <= end) return current >= start && current <= end
  return current >= start || current <= end
}

function dayIndex(taipeiDay: string): number {
  return Math.round(Date.parse(`${taipeiDay}T00:00:00Z`) / 86400000)
}

/** anchor 當天起算的區間：提前 leadDays 天開始，持續 durationDays 天（含 anchor 當天）。 */
function inAnchorWindow(taipeiDay: string, anchor: string | null, durationDays: number, leadDays = 0): boolean {
  if (!anchor) return false
  const diff = dayIndex(taipeiDay) - dayIndex(anchor)
  return diff >= -Math.max(0, leadDays) && diff < durationDays
}

function lunarWindowActive(schedule: Extract<ThemeSchedule, { kind: 'lunar' }>, taipeiDay: string): boolean {
  const lunar = solarToLunar(taipeiDay)
  if (!lunar) return false
  // 提前開始的日子可能還在上一個農曆年（例如除夕），所以前後一年都要看。
  return [lunar.year - 1, lunar.year, lunar.year + 1].some((year) =>
    inAnchorWindow(taipeiDay, lunarToSolar(year, schedule.month, schedule.day), schedule.durationDays, schedule.leadDays))
}

/** 某年某月第 nth 個星期 weekday 的國曆日期。 */
export function nthWeekdayOf(year: number, month: number, weekday: number, nth: number): string | null {
  if (month < 1 || month > 12 || weekday < 0 || weekday > 6 || nth < 1 || nth > 5) return null
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1) return null
  return date.toISOString().slice(0, 10)
}

function nthWeekdayActive(schedule: Extract<ThemeSchedule, { kind: 'nthWeekday' }>, taipeiDay: string): boolean {
  const year = Number(taipeiDay.slice(0, 4))
  return [year, year + 1].some((y) =>
    inAnchorWindow(taipeiDay, nthWeekdayOf(y, schedule.month, schedule.weekday, schedule.nth), schedule.durationDays, schedule.leadDays))
}

function solarTermActive(schedule: Extract<ThemeSchedule, { kind: 'solarTerm' }>, taipeiDay: string): boolean {
  const year = Number(taipeiDay.slice(0, 4))
  return [year, year + 1].some((y) =>
    inAnchorWindow(taipeiDay, solarTermTaipeiDay(y, schedule.term), schedule.durationDays, schedule.leadDays))
}

const TAIPEI_OFFSET_MS = 8 * 3600000

/** 台北時間的「月日時分」數字，例如 12-31 18:00 → 12311800。台灣沒有日光節約時間。 */
function taipeiStamp(instant: Date): number {
  const t = new Date(instant.getTime() + TAIPEI_OFFSET_MS)
  return (t.getUTCMonth() + 1) * 1000000 + t.getUTCDate() * 10000 + t.getUTCHours() * 100 + t.getUTCMinutes()
}

function parseStamp(text: string): number | null {
  const match = /^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text)
  if (!match) return null
  const [, mm, dd, hh, mi] = match.map(Number)
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59) return null
  return mm * 1000000 + dd * 10000 + hh * 100 + mi
}

function solarTimeActive(schedule: Extract<ThemeSchedule, { kind: 'solarTime' }>, instant: Date): boolean {
  const start = parseStamp(schedule.start)
  const end = parseStamp(schedule.end)
  if (start == null || end == null) return false
  const now = taipeiStamp(instant)
  if (start <= end) return now >= start && now < end
  return now >= start || now < end
}

function windowActive(schedule: Extract<ThemeSchedule, { kind: 'window' }>, instant: Date): boolean {
  const start = Date.parse(schedule.startAt)
  const end = Date.parse(schedule.endAt)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return false
  const now = instant.getTime()
  return now >= start && now < end
}

/** 日期類主題只看台北日曆日；有時間的主題需要傳入 instant。 */
export function themeActiveOn(theme: FestivalTheme, taipeiDay: string, instant?: Date): boolean {
  const schedule = theme.schedule
  if (schedule.kind === 'always') return true
  if (schedule.kind === 'solar') return solarWindowActive(schedule, taipeiDay)
  if (schedule.kind === 'lunar') return lunarWindowActive(schedule, taipeiDay)
  if (schedule.kind === 'nthWeekday') return nthWeekdayActive(schedule, taipeiDay)
  if (schedule.kind === 'solarTerm') return solarTermActive(schedule, taipeiDay)
  const at = instant ?? new Date(`${taipeiDay}T12:00:00+08:00`)
  if (schedule.kind === 'solarTime') return solarTimeActive(schedule, at)
  return windowActive(schedule, at)
}

export const BRAND_THEME: FestivalTheme = {
  id: 'brand',
  name: '買個 Pay 服',
  priority: 0,
  schedule: { kind: 'always' },
  eyebrow: '預設品牌',
  banner: '維持深色底與橘色，不改訂單、點數或遊戲進度。',
  motif: 'Pay',
  decor: 'none',
  palette: { accent: '#f97316', soft: '#fff1e2', glow: '#fdba74' },
}

/**
 * 台灣全年節慶與購物檔期。新增節日只要在這裡加一筆，不需要改畫面程式或每年改日期。
 * priority 越大越優先；同一天重疊時取最大者，同分依清單順序。
 */
export const FESTIVAL_THEMES: FestivalTheme[] = [
  BRAND_THEME,
  {
    id: 'lantern-festival',
    name: '元宵',
    priority: 60,
    schedule: { kind: 'lunar', month: 1, day: 15, durationDays: 1 },
    eyebrow: '農曆正月十五',
    banner: '元宵節快樂。提燈逛市集，天燈緩緩升起，猜燈謎、吃湯圓。',
    motif: '燈',
    decor: 'lantern',
    palette: { accent: '#e11d48', soft: '#ffe4e6', glow: '#fda4af' },
    shopSign: '花好月圓',
    scene: { mood: 'festive', particle: 'glow-orb', special: 'sky-lanterns' },
  },
  {
    id: 'qingming',
    name: '清明',
    priority: 55,
    schedule: { kind: 'solarTerm', term: 'qingming', durationDays: 1 },
    eyebrow: '節氣清明，依太陽黃經換算',
    banner: '清明時節，慎終追遠。今日畫面保持素雅，購物與會員功能照常。',
    motif: '清',
    decor: 'willow',
    palette: { accent: '#4d7c0f', soft: '#ecfccb', glow: '#bef264' },
    scene: { mood: 'solemn', particle: 'drizzle', special: null },
  },
  {
    id: 'lunar-new-year',
    name: '春節',
    priority: 50,
    schedule: { kind: 'lunar', month: 1, day: 1, durationDays: 15, leadDays: 1 },
    eyebrow: '除夕到正月十四',
    banner: '新春恭喜。春聯貼好、燈籠高掛，祝大家新年好采頭。',
    motif: '春',
    decor: 'lantern',
    palette: { accent: '#dc2626', soft: '#fee2e2', glow: '#fbbf24' },
    shopSign: '招財進寶',
    scene: { mood: 'festive', particle: 'red-envelope', special: 'fireworks-gold', topper: 'lanterns' },
  },
  {
    id: 'ghost-festival',
    name: '中元',
    priority: 50,
    schedule: { kind: 'lunar', month: 7, day: 15, durationDays: 1 },
    eyebrow: '農曆七月十五',
    banner: '中元普渡，祈求平安。水燈靜靜漂流，畫面保持莊重。',
    motif: '安',
    decor: 'lotus',
    palette: { accent: '#0f766e', soft: '#ccfbf1', glow: '#fde68a' },
    scene: { mood: 'solemn', particle: 'candle-mote', special: null },
  },
  {
    id: 'new-year-eve',
    name: '跨年',
    priority: 45,
    schedule: { kind: 'solarTime', start: '12-31 18:00', end: '01-02 00:00' },
    eyebrow: '12/31 傍晚到元旦',
    banner: '跨年倒數。一起迎接新的一年，煙火在畫面上放，不影響購物。',
    motif: '新',
    decor: 'firework',
    palette: { accent: '#a855f7', soft: '#f3e8ff', glow: '#fde047' },
    shopSign: '新年快樂',
    scene: { mood: 'festive', particle: 'star-glitter', special: 'fireworks' },
  },
  {
    id: 'qixi',
    name: '七夕',
    priority: 44,
    schedule: { kind: 'lunar', month: 7, day: 7, durationDays: 1, leadDays: 1 },
    eyebrow: '農曆七月初七',
    banner: '七夕情人節。喜鵲搭起鵲橋，銀河兩端的牛郎織女今晚相會。',
    motif: '鵲',
    decor: 'star',
    palette: { accent: '#6366f1', soft: '#e0e7ff', glow: '#c4b5fd' },
    shopSign: '七夕快樂',
    scene: { mood: 'romantic', particle: 'star-twinkle', special: 'magpie-bridge' },
  },
  {
    id: 'fathers-day',
    name: '父親節',
    priority: 42,
    schedule: { kind: 'solar', startMonth: 8, startDay: 6, endMonth: 8, endDay: 8 },
    eyebrow: '8 月 8 日',
    banner: '爸爸，謝謝您。挑一份心意，把感謝說出口。',
    motif: '爸',
    decor: 'tie',
    palette: { accent: '#1d4ed8', soft: '#dbeafe', glow: '#fbbf24' },
    shopSign: '謝謝爸爸',
    scene: { mood: 'warm', particle: 'gold-bokeh', special: 'light-sweep' },
  },
  {
    id: 'mothers-day',
    name: '母親節',
    priority: 40,
    schedule: { kind: 'nthWeekday', month: 5, weekday: 0, nth: 2, durationDays: 1, leadDays: 6 },
    eyebrow: '五月第二個星期日',
    banner: '媽媽，謝謝您。康乃馨獻給最溫柔的人。',
    motif: '母',
    decor: 'flower',
    palette: { accent: '#db2777', soft: '#fce7f3', glow: '#f9a8d4' },
    shopSign: '謝謝媽媽',
    scene: { mood: 'warm', particle: 'carnation-petal', special: 'heart-bloom' },
  },
  {
    id: 'retrocession',
    name: '台灣光復節',
    priority: 40,
    schedule: { kind: 'solar', startMonth: 10, startDay: 25, endMonth: 10, endDay: 25 },
    eyebrow: '國曆 10 月 25 日',
    banner: '台灣光復節。曙光照亮寶島，梅花迎風綻放。',
    motif: '光',
    decor: 'ray',
    palette: { accent: '#2563eb', soft: '#dbeafe', glow: '#fcd34d' },
    scene: { mood: 'warm', particle: 'sparkle-gold', special: 'sun-rays' },
  },
  {
    id: 'mid-autumn',
    name: '中秋',
    priority: 38,
    schedule: { kind: 'lunar', month: 8, day: 15, durationDays: 1, leadDays: 1 },
    eyebrow: '農曆八月十五',
    banner: '中秋快樂。明月高掛、玉兔相伴，祝闔家團圓。',
    motif: '月',
    decor: 'moon',
    palette: { accent: '#d97706', soft: '#fef3c7', glow: '#fde68a' },
    shopSign: '月圓人團圓',
    scene: { mood: 'warm', particle: 'osmanthus', special: 'cloud-drift' },
  },
  {
    id: 'double-ninth',
    name: '重陽',
    priority: 36,
    schedule: { kind: 'lunar', month: 9, day: 9, durationDays: 1 },
    eyebrow: '農曆九月初九',
    banner: '重陽敬老。登高賞菊，祝長輩安康長壽。',
    motif: '菊',
    decor: 'chrysanthemum',
    palette: { accent: '#ca8a04', soft: '#fef9c3', glow: '#fde047' },
    scene: { mood: 'warm', particle: 'chrysanthemum-petal', special: 'geese' },
  },
  {
    id: 'valentine',
    name: '西洋情人節',
    priority: 35,
    schedule: { kind: 'solar', startMonth: 2, startDay: 12, endMonth: 2, endDay: 14 },
    eyebrow: '2 月 14 日',
    banner: '情人節快樂。愛心飄起來，把心意送給重要的人。',
    motif: '愛',
    decor: 'heart',
    palette: { accent: '#e11d48', soft: '#ffe4e6', glow: '#fb7185' },
    shopSign: 'Happy Valentine',
    scene: { mood: 'romantic', particle: 'heart-rise', special: 'heart-balloons' },
  },
  {
    id: 'white-day',
    name: '白色情人節',
    priority: 35,
    schedule: { kind: 'solar', startMonth: 3, startDay: 13, endMonth: 3, endDay: 14 },
    eyebrow: '3 月 14 日',
    banner: '白色情人節。用一份白色小禮物，回應那份心意。',
    motif: '白',
    decor: 'gift',
    palette: { accent: '#60a5fa', soft: '#eff6ff', glow: '#e0f2fe' },
    scene: { mood: 'romantic', particle: 'heart-white', special: 'gift-rise' },
  },
  {
    id: 'day-520',
    name: '520',
    priority: 35,
    schedule: { kind: 'solar', startMonth: 5, startDay: 19, endMonth: 5, endDay: 20 },
    eyebrow: '5 月 20 日・我愛你',
    banner: '520 我愛你。寫一封情書，連同心意一起寄出。',
    motif: '♡',
    decor: 'heart',
    palette: { accent: '#8b5cf6', soft: '#ede9fe', glow: '#f9a8d4' },
    scene: { mood: 'romantic', particle: 'love-letter', special: 'envelope-plane' },
  },
  {
    id: 'national-day',
    name: '國慶日',
    priority: 35,
    schedule: { kind: 'solar', startMonth: 10, startDay: 10, endMonth: 10, endDay: 10 },
    eyebrow: '10 月 10 日',
    banner: '國慶日快樂。夜空煙火綻放，一起歡度雙十。',
    motif: '慶',
    decor: 'firework',
    palette: { accent: '#dc2626', soft: '#fee2e2', glow: '#93c5fd' },
    scene: { mood: 'festive', particle: 'sparkle-tricolor', special: 'fireworks', topper: 'bunting' },
  },
  {
    id: 'dongzhi',
    name: '冬至',
    priority: 35,
    schedule: { kind: 'solarTerm', term: 'dongzhi', durationDays: 1 },
    eyebrow: '節氣冬至，依太陽黃經換算',
    banner: '冬至吃湯圓，又長一歲。熱騰騰的一碗，暖心又團圓。',
    motif: '圓',
    decor: 'tangyuan',
    palette: { accent: '#fb7185', soft: '#fff1f2', glow: '#fde68a' },
    scene: { mood: 'warm', particle: 'steam', special: null },
  },
  {
    id: 'teachers-day',
    name: '教師節',
    priority: 32,
    schedule: { kind: 'solar', startMonth: 9, startDay: 28, endMonth: 9, endDay: 28 },
    eyebrow: '9 月 28 日・孔子誕辰',
    banner: '教師節快樂。杏壇花開，謝謝每一位傳道授業的老師。',
    motif: '師',
    decor: 'book',
    palette: { accent: '#b45309', soft: '#fef3c7', glow: '#fcd34d' },
    scene: { mood: 'warm', particle: 'apricot-petal', special: null },
  },
  {
    id: 'dragon-boat',
    name: '端午',
    priority: 30,
    schedule: { kind: 'lunar', month: 5, day: 5, durationDays: 1, leadDays: 1 },
    eyebrow: '農曆五月初五',
    banner: '端午安康。划龍舟、吃粽子，掛上香包保平安。',
    motif: '粽',
    decor: 'wave',
    palette: { accent: '#059669', soft: '#d1fae5', glow: '#fcd34d' },
    shopSign: '端午安康',
    scene: { mood: 'festive', particle: 'bamboo-leaf', special: 'dragon-boat' },
  },
  {
    id: 'childrens-day',
    name: '兒童節',
    priority: 30,
    schedule: { kind: 'solar', startMonth: 4, startDay: 1, endMonth: 4, endDay: 4 },
    eyebrow: '4 月 4 日',
    banner: '兒童節快樂。風車轉呀轉，泡泡飛呀飛，童心一起玩。',
    motif: '童',
    decor: 'balloon',
    palette: { accent: '#0ea5e9', soft: '#e0f2fe', glow: '#facc15' },
    scene: { mood: 'festive', particle: 'bubble', special: 'paper-plane' },
  },
  {
    id: 'labor-day',
    name: '勞動節',
    priority: 30,
    schedule: { kind: 'solar', startMonth: 5, startDay: 1, endMonth: 5, endDay: 1 },
    eyebrow: '5 月 1 日',
    banner: '勞動節快樂。辛苦了，每一雙努力的手。',
    motif: '勞',
    decor: 'gear',
    palette: { accent: '#ea580c', soft: '#ffedd5', glow: '#fbbf24' },
    scene: { mood: 'warm', particle: 'warm-mote', special: 'sun-rays' },
  },
  {
    id: 'halloween',
    name: '萬聖節',
    priority: 30,
    schedule: { kind: 'solar', startMonth: 10, startDay: 29, endMonth: 10, endDay: 31 },
    eyebrow: '10 月 31 日',
    banner: '萬聖節快樂。南瓜燈亮起，小幽靈出來逛市集。',
    motif: '南',
    decor: 'pumpkin',
    palette: { accent: '#f97316', soft: '#ffedd5', glow: '#c084fc' },
    shopSign: 'Happy Halloween',
    scene: { mood: 'festive', particle: 'bat', special: 'ghost-float', topper: 'spooky-bunting' },
  },
  {
    id: 'double-11',
    name: '雙 11 購物節',
    priority: 30,
    schedule: { kind: 'solar', startMonth: 11, startDay: 9, endMonth: 11, endDay: 11 },
    eyebrow: '11 月 11 日',
    banner: '雙 11 購物狂歡節。優惠以各賣場實際公告為準。',
    motif: '11',
    decor: 'bag',
    palette: { accent: '#ef4444', soft: '#fee2e2', glow: '#facc15' },
    shopSign: '11.11',
    scene: { mood: 'shopping', particle: 'confetti-hot', special: 'bag-rush', topper: 'pennants' },
  },
  {
    id: 'double-12',
    name: '雙 12 年終慶',
    priority: 30,
    schedule: { kind: 'solar', startMonth: 12, startDay: 10, endMonth: 12, endDay: 12 },
    eyebrow: '12 月 12 日',
    banner: '雙 12 年終慶。為這一年準備禮物，優惠以各賣場實際公告為準。',
    motif: '12',
    decor: 'gift',
    palette: { accent: '#f59e0b', soft: '#fef3c7', glow: '#fb7185' },
    shopSign: '12.12',
    scene: { mood: 'shopping', particle: 'ribbon-curl', special: 'gift-pop' },
  },
  {
    id: 'womens-day',
    name: '38 女王節',
    priority: 25,
    schedule: { kind: 'solar', startMonth: 3, startDay: 6, endMonth: 3, endDay: 8 },
    eyebrow: '3 月 8 日',
    banner: '38 女王節。今天妳最大，優惠以各賣場實際公告為準。',
    motif: '♛',
    decor: 'crown',
    palette: { accent: '#be185d', soft: '#fce7f3', glow: '#fcd34d' },
    scene: { mood: 'shopping', particle: 'diamond', special: 'glint-pop' },
  },
  {
    id: 'mid-year-618',
    name: '618 年中慶',
    priority: 25,
    schedule: { kind: 'solar', startMonth: 6, startDay: 16, endMonth: 6, endDay: 18 },
    eyebrow: '6 月 18 日',
    banner: '618 年中慶。年中補貨好時機，優惠以各賣場實際公告為準。',
    motif: '618',
    decor: 'bag',
    palette: { accent: '#06b6d4', soft: '#cffafe', glow: '#fb923c' },
    shopSign: '6.18',
    scene: { mood: 'shopping', particle: 'confetti-cool', special: 'cart-dash' },
  },
  {
    id: 'double-9',
    name: '99 購物節',
    priority: 25,
    schedule: { kind: 'solar', startMonth: 9, startDay: 7, endMonth: 9, endDay: 9 },
    eyebrow: '9 月 9 日',
    banner: '99 購物節。逛逛新上架，優惠以各賣場實際公告為準。',
    motif: '99',
    decor: 'bag',
    palette: { accent: '#10b981', soft: '#d1fae5', glow: '#fde047' },
    shopSign: '9.9',
    scene: { mood: 'shopping', particle: 'streamer', special: 'bag-bounce' },
  },
  {
    id: 'christmas',
    name: '聖誕',
    priority: 20,
    schedule: { kind: 'solar', startMonth: 12, startDay: 20, endMonth: 12, endDay: 25 },
    eyebrow: '12/20–12/25',
    banner: '聖誕快樂。雪花飄落、聖誕老人駕著雪橇飛過，購物、會員與訂單功能照常。',
    motif: '雪',
    decor: 'snow',
    palette: { accent: '#16a34a', soft: '#dcfce7', glow: '#fecaca' },
    shopSign: 'Merry Xmas',
    scene: { mood: 'festive', particle: 'snow', special: 'santa', topper: 'xmas-lights' },
  },
]

export function festivalThemeById(id: string, themes: FestivalTheme[] = FESTIVAL_THEMES): FestivalTheme | null {
  return themes.find((theme) => theme.id === id) ?? null
}

/** 取當下生效、優先順序最高的主題；全部結束時回到預設品牌外觀。同分時依清單順序。 */
export function resolveFestivalTheme(instant: Date, themes: FestivalTheme[] = FESTIVAL_THEMES): FestivalTheme {
  const taipeiDay = taipeiCalendarDate(instant)
  return themes
    .map((theme, index) => ({ theme, index }))
    .filter(({ theme }) => themeActiveOn(theme, taipeiDay, instant))
    .sort((a, b) => b.theme.priority - a.theme.priority || a.index - b.index)[0]?.theme ?? BRAND_THEME
}

export function upcomingFestival(instant: Date): { theme: FestivalTheme; taipeiDay: string } | null {
  const start = Date.parse(`${taipeiCalendarDate(instant)}T00:00:00Z`)
  const festivals = FESTIVAL_THEMES.filter((theme) => theme.id !== 'brand')
  for (let offset = 0; offset <= 370; offset += 1) {
    const taipeiDay = new Date(start + offset * 86400000).toISOString().slice(0, 10)
    const noon = new Date(`${taipeiDay}T20:00:00+08:00`)
    const matches = festivals.filter((theme) => themeActiveOn(theme, taipeiDay, noon)).sort((a, b) => b.priority - a.priority)
    if (matches[0]) return { theme: matches[0], taipeiDay }
  }
  return null
}

/**
 * 驗收用網址參數：?festival=<主題編號> 預覽主題、?festivalAt=<ISO 時間> 模擬某個時間點。
 * 只影響畫面外觀，不寫任何資料。
 */
export function readFestivalOverride(search: string): { previewId: string | null; at: Date | null; clearPreview: boolean; clearAt: boolean } {
  const params = new URLSearchParams(search)
  const id = params.get('festival')
  const atText = params.get('festivalAt')
  const at = atText && !Number.isNaN(Date.parse(atText)) ? new Date(atText) : null
  return { previewId: id && festivalThemeById(id) ? id : null, at, clearPreview: id === 'auto', clearAt: atText === 'now' }
}

/**
 * 當天無法可靠計算的排程：農曆超出曆表、節氣時刻太接近午夜。
 * 這些主題當天一律不生效（回到其他有效主題或預設外觀），並回傳可檢查的說明。
 */
export function festivalScheduleIssues(instant: Date, themes: FestivalTheme[] = FESTIVAL_THEMES): string[] {
  const taipeiDay = taipeiCalendarDate(instant)
  const year = Number(taipeiDay.slice(0, 4))
  const issues: string[] = []
  for (const theme of themes) {
    const schedule = theme.schedule
    if (schedule.kind === 'lunar' && !solarToLunar(taipeiDay)) {
      issues.push(`${theme.id}：農曆曆表只涵蓋 ${LUNAR_TABLE_RANGE.from}–${LUNAR_TABLE_RANGE.to}，${taipeiDay} 無法換算`)
    }
    if (schedule.kind === 'solarTerm' && !solarTermTaipeiDay(year, schedule.term)) {
      issues.push(`${theme.id}：${year} 年節氣日期無法可靠判定`)
    }
  }
  return issues
}

/** 跨年畫面用：12/31 顯示距離新年幾分鐘，1/1 顯示新年份。其他日子回傳 null，不顯示倒數。 */
export function newYearMoment(instant: Date): { kind: 'countdown'; year: number; minutesLeft: number } | { kind: 'celebrate'; year: number } | null {
  const taipeiDay = taipeiCalendarDate(instant)
  const year = Number(taipeiDay.slice(0, 4))
  const monthDay = taipeiDay.slice(5)
  if (monthDay === '01-01') return { kind: 'celebrate', year }
  if (monthDay !== '12-31') return null
  const midnight = Date.parse(`${year + 1}-01-01T00:00:00+08:00`)
  return { kind: 'countdown', year: year + 1, minutesLeft: Math.max(1, Math.ceil((midnight - instant.getTime()) / 60000)) }
}
