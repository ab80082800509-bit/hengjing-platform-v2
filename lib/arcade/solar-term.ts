/**
 * 二十四節氣的台北日期。
 * 春分、夏至、秋分、冬至用 Meeus《天文算法》第 27 章表 27.B 與週期修正，
 * 1951–2050 年的時刻誤差約 1 分鐘。
 * 其餘節氣先錨在同一季的分至點，再沿用低精度視黃經把這段誤差平移過去，
 * 避免低精度公式自己的 15 分鐘誤差把午夜附近的日期判錯。
 * 算出的時刻距台北午夜不到 10 分鐘時仍回傳 null，不猜日期。
 * 2038 清明對到台北 4 月 5 日 00:28，2042 清明對到 4 月 4 日 23:40，
 * 與香港天文台曆表及多家節氣時刻表同一天。
 */

export const SOLAR_TERMS = {
  lichun: { name: '立春', longitude: 315 },
  qingming: { name: '清明', longitude: 15 },
  xiazhi: { name: '夏至', longitude: 90 },
  liqiu: { name: '立秋', longitude: 135 },
  dongzhi: { name: '冬至', longitude: 270 },
} as const

export type SolarTermId = keyof typeof SOLAR_TERMS

const RAD = Math.PI / 180
const TAIPEI_OFFSET_MS = 8 * 3600000
const UNRELIABLE_MARGIN_MS = 10 * 60000

/** 表 27.B，年份 1000–3000。係數對應 (year-2000)/1000 的冪次。 */
const MARCH = [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057]
const JUNE = [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.0003]
const SEPTEMBER = [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078]
const DECEMBER = [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032]
const CARDINALS = [MARCH, JUNE, SEPTEMBER, DECEMBER]

/** 表 27.C。a 的單位是 0.00001 日。 */
const PERTURB: readonly (readonly [number, number, number])[] = [
  [485, 324.96, 1934.136],
  [203, 337.23, 32964.467],
  [199, 342.08, 20.186],
  [182, 27.85, 445267.112],
  [156, 73.14, 45036.886],
  [136, 171.52, 22518.443],
  [77, 222.54, 65928.934],
  [74, 296.72, 3034.906],
  [70, 243.58, 9037.513],
  [58, 119.81, 33718.147],
  [52, 297.17, 150.678],
  [50, 21.02, 2281.226],
  [45, 247.54, 29929.562],
  [44, 325.15, 31555.956],
  [29, 60.93, 4443.417],
  [18, 155.12, 67555.328],
  [17, 288.79, 4562.452],
  [16, 198.04, 62894.029],
  [14, 199.76, 31436.921],
  [12, 95.39, 14577.848],
  [12, 287.11, 31931.756],
  [12, 320.81, 34777.259],
  [9, 227.73, 1222.114],
  [8, 15.45, 16859.074],
]

function norm360(value: number): number {
  return ((value % 360) + 360) % 360
}

function signedDelta(longitude: number, target: number): number {
  return ((norm360(longitude - target) + 180) % 360) - 180
}

function horner(x: number, coeffs: readonly number[]): number {
  let value = 0
  for (let i = coeffs.length - 1; i >= 0; i -= 1) value = value * x + coeffs[i]
  return value
}

/** 低精度視黃經，只用來量與分至點的差距。 */
function apparentLongitude(jde: number): number {
  const t = (jde - 2451545) / 36525
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
  const m = (357.52911 + 35999.05029 * t - 0.0001537 * t * t) * RAD
  const c = (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(m)
    + (0.019993 - 0.000101 * t) * Math.sin(2 * m)
    + 0.000289 * Math.sin(3 * m)
  const omega = (125.04 - 1934.136 * t) * RAD
  return norm360(l0 + c - 0.00569 - 0.00478 * Math.sin(omega))
}

/** 春分、夏至、秋分、冬至的力學時儒略日。quarter：0 春分、1 夏至、2 秋分、3 冬至。 */
function cardinalJde(year: number, quarter: number): number {
  const mean = horner((year - 2000) / 1000, CARDINALS[quarter])
  const t = (mean - 2451545) / 36525
  const w = (35999.373 * t - 2.47) * RAD
  const deltaLambda = 1 + 0.0334 * Math.cos(w) + 0.0007 * Math.cos(2 * w)
  let correction = 0
  for (const [amplitude, phase, frequency] of PERTURB) {
    correction += amplitude * Math.cos((phase + frequency * t) * RAD)
  }
  return mean + (0.00001 * correction) / deltaLambda
}

function solarTermJde(year: number, longitude: number): number {
  const lon = norm360(longitude)
  const quarter = Math.floor(lon / 90)
  const base = quarter * 90
  if (Math.abs(lon - base) < 1e-9) return cardinalJde(year, quarter)
  // 立春在當年春分之前，錨到前一年冬至。
  const anchorYear = lon > 270 ? year - 1 : year
  const anchorQuarter = lon > 270 ? 3 : quarter
  const anchor = cardinalJde(anchorYear, anchorQuarter)
  const error = signedDelta(apparentLongitude(anchor), anchorQuarter * 90)
  const goal = norm360(lon + error)
  let jde = anchor + signedDelta(lon, anchorQuarter * 90) * (365.2422 / 360)
  for (let i = 0; i < 20; i += 1) {
    const diff = signedDelta(goal, apparentLongitude(jde))
    jde += diff * (365.2422 / 360)
    if (Math.abs(diff) < 1e-7) break
  }
  return jde
}

/** 節氣的 UTC 時刻。 */
export function solarTermInstant(year: number, longitude: number): Date | null {
  if (!Number.isInteger(year) || year < 1950 || year > 2100) return null
  if (!Number.isFinite(longitude)) return null
  const jde = solarTermJde(year, longitude)
  const deltaTSeconds = 69 + Math.max(0, year - 2020) * 0.6
  const unix = (jde - 2440587.5) * 86400000 - deltaTSeconds * 1000
  return Number.isFinite(unix) ? new Date(unix) : null
}

/** 節氣的台北日曆日（YYYY-MM-DD）。接近午夜無法可靠判定時回傳 null。 */
export function solarTermTaipeiDay(year: number, term: SolarTermId): string | null {
  const instant = solarTermInstant(year, SOLAR_TERMS[term].longitude)
  if (!instant) return null
  const local = instant.getTime() + TAIPEI_OFFSET_MS
  const dayStart = Math.floor(local / 86400000) * 86400000
  const fromMidnight = local - dayStart
  if (fromMidnight < UNRELIABLE_MARGIN_MS || 86400000 - fromMidnight < UNRELIABLE_MARGIN_MS) return null
  const day = new Date(dayStart).toISOString().slice(0, 10)
  return day.startsWith(String(year)) ? day : null
}
