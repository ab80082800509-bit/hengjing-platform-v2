'use client'

import { memo, type CSSProperties, type ReactNode } from 'react'
import { customerDoor, customerLane, productSpec, type BuildingId, type Customer, type DecorId, type ProductId, type ShopId, type StreetLane } from '@/lib/arcade/street-rules'

/* 夢想商店街斜俯視場景。
 * 地面在「平面座標」(a 沿主街往右上、b 往鏡頭右下) 繪製，再以同一個投影矩陣變形，
 * 建築、道具、車輛都是獨立透明素材，依底座落點貼回同一個平面。 */

export const SCENE_W = 1200
export const SCENE_H = 640
const K = 0.58
const OX = 626
const OY = 320
const PLAN = `matrix(1 ${-K} 1 ${K} ${OX} ${OY})`

export function iso(a: number, b: number): [number, number] {
  return [OX + a + b, OY + (b - a) * K]
}

/* 主街：北側人行道 0..62，車道 70..160，南側人行道 168..212。側街在 a = -140..-60 往南，東側人行道 -60..-44。 */
const GUEST_B = 34
const PASSER_B = 189
const SIDE_A = -56
const DOOR_A = -104
const LANE_IN = 94
const LANE_OUT = 138

/** 規則層沿人行道的位置換算成街景落腳點。 */
export function lanePoint(lane: StreetLane, x: number): [number, number] {
  if (lane === 'side') return iso(SIDE_A, x)
  return iso(x, lane === 'north' ? GUEST_B : PASSER_B)
}

export const customerPoint = (c: Customer, x: number) => lanePoint(customerLane(c), x)

/** 甜點店櫥窗前方，用來放「做好了」之類的提示。 */
export const SHOP_FX: [number, number] = (() => {
  const [x, y] = iso(DOOR_A, 0)
  return [x, y - 150]
})()

const ART = '/arcade/street/iso/'
const SPRITES = {
  'shop-dessert': { w: 662, h: 720, fx: 313, fy: 714 },
  'shop-tea': { w: 636, h: 720, fx: 304, fy: 715 },
  'shop-gift': { w: 636, h: 720, fx: 301, fy: 715 },
  'shop-closed': { w: 658, h: 720, fx: 309, fy: 714 },
  'house-teal': { w: 380, h: 488, fx: 189, fy: 482 },
  'house-yellow': { w: 368, h: 456, fx: 177, fy: 450 },
  grove: { w: 360, h: 416, fx: 168, fy: 410 },
  'tree-green': { w: 228, h: 316, fx: 118, fy: 309 },
  'tree-sakura': { w: 252, h: 320, fx: 125, fy: 313 },
  lamp: { w: 72, h: 312, fx: 37, fy: 305 },
  bench: { w: 224, h: 232, fx: 146, fy: 224 },
  hedge: { w: 236, h: 184, fx: 97, fy: 179 },
  flowerbed: { w: 248, h: 188, fx: 89, fy: 181 },
  bikes: { w: 248, h: 224, fx: 104, fy: 215 },
  mailbox: { w: 96, h: 224, fx: 50, fy: 216 },
  'car-mint': { w: 340, h: 284, fx: 142, fy: 276 },
  'car-peach': { w: 336, h: 268, fx: 157, fy: 262 },
  scooter: { w: 264, h: 276, fx: 38, fy: 268 },
  mat: { w: 348, h: 224, fx: 130, fy: 216 },
  lantern: { w: 169, h: 360, fx: 80, fy: 353 },
  planter: { w: 360, h: 321, fx: 72, fy: 315 },
} as const
type SpriteName = keyof typeof SPRITES

/** 建築正面固定 160 單位寬，四張店面素材各自換算比例，避免拉伸。 */
const SHOP_FRONT = 160
const SHOP_DEPTH = 143
const SHOP_SCALE: Record<'shop-dessert' | 'shop-tea' | 'shop-gift' | 'shop-closed', number> = {
  'shop-dessert': SHOP_FRONT / 342,
  'shop-tea': SHOP_FRONT / 326,
  'shop-gift': SHOP_FRONT / 330,
  'shop-closed': SHOP_FRONT / 342,
}
/** 店招與煙囪在素材上的位置（相對底座角，素材像素）。 */
const SIGN_PX: [number, number] = [107, -464]
const CHIMNEY_PX: [number, number] = [81, -685]
/** 甜點店雨棚荷葉邊左右兩端（相對底座角，素材像素）。 */
const AWNING_ENDS: [[number, number], [number, number]] = [[-31, -308], [280, -418]]
/** 燈籠素材上壁掛座的位置。 */
const LANTERN_PLATE: [number, number] = [152, 45]
/** 花環素材橫桿：起點 x、長度、高度 y。 */
const GARLAND_BAR: [number, number, number] = [50, 935, 40]

export const artFile = (name: string) => `${ART}${name}.webp`

/** 以素材底座落在平面座標 (a, b)；flip 時沿垂直軸鏡射，底座仍對齊。 */
function Sprite({ name, a, b, s, flip = false, className, children }: { name: SpriteName; a: number; b: number; s: number; flip?: boolean; className?: string; children?: ReactNode }) {
  const art = SPRITES[name]
  const [x, y] = iso(a, b)
  return (
    <g className={className} transform={`translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${flip ? -s : s},${s})`}>
      <image href={artFile(name)} x={-art.fx} y={-art.fy} width={art.w} height={art.h} />
      {children}
    </g>
  )
}

export function castFile(look: number, frame: 'a' | 'b' | 'idle') {
  const index = ((look % CUSTOMER_NAMES.length) + CUSTOMER_NAMES.length) % CUSTOMER_NAMES.length
  return `/arcade/street/art/cast/c${index}-${frame}.png`
}

export function CustomerFace({ look }: { look: number }) {
  return (
    <svg className="ds-face" viewBox="0 0 64 52" aria-hidden="true">
      <image href={castFile(look, 'idle')} x="2" y="-2" width="60" height="108" preserveAspectRatio="xMidYMin meet" />
    </svg>
  )
}

export const CUSTOMER_NAMES = ['小芸', '阿哲', '美玲', '小凱', '佳佳', '老王', '小雨', '阿明', '朵朵', '阿輝', '小安', '阿姨']

/* ---------- 共用定義：商品圖示、地面材質 ---------- */

export const StreetDefs = memo(function StreetDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <pattern id="ds-tile" width="31" height="31" patternUnits="userSpaceOnUse">
          <rect width="31" height="31" fill="#f4e3cc" />
          <rect x="1.5" y="1.5" width="28" height="28" rx="3" fill="#f9ecd9" />
          <path d="M5 6 H14" stroke="#fff" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" />
        </pattern>
        <pattern id="ds-plaza" width="44" height="44" patternUnits="userSpaceOnUse">
          <rect width="44" height="44" fill="#f2d6c4" />
          <rect x="1.5" y="1.5" width="19" height="19" rx="3" fill="#f8e4d6" />
          <rect x="23.5" y="23.5" width="19" height="19" rx="3" fill="#f8e4d6" />
          <rect x="23.5" y="1.5" width="19" height="19" rx="3" fill="#f6ddcc" />
          <rect x="1.5" y="23.5" width="19" height="19" rx="3" fill="#f6ddcc" />
        </pattern>
        <pattern id="ds-lawn" width="60" height="60" patternUnits="userSpaceOnUse">
          <rect width="60" height="60" fill="#a9d68a" />
          <path d="M8 14 l3 -6 l3 6 M38 40 l3 -6 l3 6 M24 52 l2 -5 l2 5" fill="none" stroke="#86bf6b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="48" cy="12" r="2.2" fill="#fff6d6" />
          <circle cx="16" cy="38" r="2" fill="#ffd0dc" />
        </pattern>
        <pattern id="ds-gravel" width="26" height="26" patternUnits="userSpaceOnUse">
          <rect width="26" height="26" fill="#e9dcc6" />
          <ellipse cx="7" cy="8" rx="5" ry="3.5" fill="#f5ecdc" />
          <ellipse cx="19" cy="18" rx="5.5" ry="3.6" fill="#f3e8d6" />
        </pattern>
        <linearGradient id="ds-ao" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b4a32" stopOpacity="0.32" />
          <stop offset="1" stopColor="#6b4a32" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="ds-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6ea" stopOpacity="0.7" />
          <stop offset="1" stopColor="#fff6ea" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="ds-spill" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe6a6" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffe6a6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ds-bulb-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff6c2" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#ffd166" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ffd166" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ds-shadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#3b2a20" stopOpacity="0.32" />
          <stop offset="1" stopColor="#3b2a20" stopOpacity="0" />
        </radialGradient>

        <symbol id="ds-p-croissant" viewBox="0 0 40 40">
          <path d="M5 26 Q6 12 20 10 Q34 12 35 26 Q30 22 27 26 Q24 20 20 20 Q16 20 13 26 Q10 22 5 26Z" fill="#e9a23b" stroke="#8a4b12" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M13 25 Q15 16 20 15 M27 25 Q25 16 20 15" fill="none" stroke="#8a4b12" strokeWidth="1.2" strokeOpacity="0.6" />
          <path d="M12 15 Q16 12 20 12" fill="none" stroke="#ffe0a3" strokeWidth="2" strokeLinecap="round" />
        </symbol>
        <symbol id="ds-p-milktea" viewBox="0 0 40 40">
          <path d="M23 3 L19 14" stroke="#ff6f91" strokeWidth="3" strokeLinecap="round" />
          <path d="M10 12 H30 L27 36 Q20 38 13 36Z" fill="#e7c39a" stroke="#6b3f22" strokeWidth="1.6" strokeLinejoin="round" />
          <rect x="9" y="10" width="22" height="4" rx="2" fill="#fff" stroke="#6b3f22" strokeWidth="1.4" />
          <circle cx="16" cy="31" r="2" fill="#3b2418" /><circle cx="21" cy="32" r="2" fill="#3b2418" /><circle cx="25" cy="30" r="1.8" fill="#3b2418" /><circle cx="19" cy="28" r="1.6" fill="#3b2418" />
          <path d="M14 18 L15 26" stroke="#fff" strokeOpacity="0.6" strokeWidth="2" strokeLinecap="round" />
        </symbol>
        <symbol id="ds-p-cake" viewBox="0 0 40 40">
          <path d="M5 30 L33 30 L33 20 L5 14Z" fill="#fff4e6" stroke="#8a4b2e" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M5 22 L33 25" stroke="#ff8fab" strokeWidth="3" />
          <path d="M5 14 L33 20 L33 17 Q20 9 5 11Z" fill="#ffc2d4" stroke="#8a4b2e" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M22 9 Q26 4 30 8 Q30 13 26 14 Q22 13 22 9Z" fill="#ff4d6d" stroke="#8a1c2b" strokeWidth="1.2" />
          <path d="M25 5 L27 2" stroke="#3a7d44" strokeWidth="1.6" strokeLinecap="round" />
        </symbol>
        <symbol id="ds-p-roll" viewBox="0 0 40 40">
          <ellipse cx="20" cy="22" rx="15" ry="12" fill="#a7d58a" stroke="#3f6b2a" strokeWidth="1.6" />
          <path d="M20 22 m0 -6 a6 6 0 1 1 -6 6 a9 9 0 0 1 9 -9 a11 11 0 0 1 10 10" fill="none" stroke="#fff8e8" strokeWidth="3" strokeLinecap="round" />
          <circle cx="19" cy="22" r="2.2" fill="#8a3a3a" />
          <circle cx="13" cy="14" r="1.2" fill="#fff" fillOpacity="0.6" />
        </symbol>
        <symbol id="ds-p-giftbox" viewBox="0 0 40 40">
          <rect x="6" y="16" width="28" height="20" rx="2" fill="#ffb3c7" stroke="#8a2d4a" strokeWidth="1.6" />
          <rect x="4" y="11" width="32" height="7" rx="2" fill="#ff8fab" stroke="#8a2d4a" strokeWidth="1.6" />
          <rect x="17.5" y="11" width="5" height="25" fill="#ffd166" stroke="#8a5a12" strokeWidth="1" />
          <path d="M20 11 Q12 2 10 8 Q10 12 20 11 Q28 12 30 8 Q28 2 20 11Z" fill="#ffd166" stroke="#8a5a12" strokeWidth="1.3" />
          <path d="M25 22 l1.2 2.4 2.6 .4 -1.9 1.8 .5 2.6 -2.4 -1.3 -2.4 1.3 .5 -2.6 -1.9 -1.8 2.6 -.4Z" fill="#fff" />
        </symbol>
        <symbol id="ds-p-cookie" viewBox="0 0 40 40">
          <circle cx="20" cy="21" r="14" fill="#e7b15a" stroke="#8a5a12" strokeWidth="1.6" />
          <circle cx="14" cy="16" r="2" fill="#6b3a16" /><circle cx="23" cy="15" r="1.7" fill="#6b3a16" /><circle cx="18" cy="23" r="2.1" fill="#6b3a16" /><circle cx="26" cy="24" r="1.6" fill="#6b3a16" />
          <path d="M12 14 Q16 10 20 12" fill="none" stroke="#fff1cc" strokeWidth="2" strokeLinecap="round" />
        </symbol>
        <symbol id="ds-p-cocoa" viewBox="0 0 40 40">
          <path d="M14 8 Q16 4 18 8 M20 7 Q22 3 24 8" fill="none" stroke="#c4b8ae" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M9 16 H29 Q31 16 31 19 V28 Q31 35 20 35 Q9 35 9 28 V19 Q9 16 9 16Z" fill="#8a4b2e" stroke="#4a2616" strokeWidth="1.6" />
          <ellipse cx="20" cy="17" rx="11" ry="4" fill="#fff" />
          <ellipse cx="20" cy="16" rx="8" ry="3" fill="#fff6ea" />
          <path d="M29 20 H33 Q36 20 36 24 Q36 28 32 28 H29" fill="none" stroke="#4a2616" strokeWidth="2" />
          <rect x="12" y="22" width="3" height="7" rx="1.5" fill="#c9845a" />
        </symbol>
        <symbol id="ds-p-macaron" viewBox="0 0 40 40">
          <ellipse cx="20" cy="24" rx="13" ry="7" fill="#ffb3d9" stroke="#a33b6b" strokeWidth="1.5" />
          <rect x="8" y="20" width="24" height="5" rx="2" fill="#fff0c9" stroke="#c9845a" strokeWidth="1" />
          <ellipse cx="20" cy="16" rx="13" ry="7" fill="#ff8fc7" stroke="#a33b6b" strokeWidth="1.5" />
          <ellipse cx="15" cy="14" rx="4" ry="2" fill="#fff" opacity="0.55" />
        </symbol>
        <symbol id="ds-p-lemonade" viewBox="0 0 40 40">
          <path d="M12 10 H28 L25 32 Q20 36 15 32Z" fill="#fff4b0" stroke="#c98412" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M14 16 H26" stroke="#ffe27a" strokeWidth="3" strokeLinecap="round" />
          <circle cx="17" cy="24" r="1.3" fill="#fff" /><circle cx="22" cy="27" r="1.2" fill="#fff" /><circle cx="19" cy="29" r="1" fill="#fff" />
          <circle cx="27" cy="14" r="5" fill="#f4d35e" stroke="#c98412" strokeWidth="1.3" />
          <path d="M27 11 V17 M24 14 H30" stroke="#fff" strokeWidth="1.2" />
          <rect x="18" y="6" width="3" height="8" rx="1" fill="#7bc47f" />
        </symbol>
        <symbol id="ds-p-tart" viewBox="0 0 40 40">
          <path d="M6 22 L20 12 L34 22 V30 Q20 36 6 30Z" fill="#f2c078" stroke="#8a5a12" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8 23 L32 23" stroke="#e7a04a" strokeWidth="2" />
          <circle cx="15" cy="20" r="3.2" fill="#ff5d8f" /><circle cx="22" cy="18" r="3.4" fill="#7cc6fe" /><circle cx="27" cy="22" r="3" fill="#80ed99" />
          <circle cx="19" cy="23" r="2.4" fill="#ffd166" />
        </symbol>
        <symbol id="ds-p-coffee" viewBox="0 0 40 40">
          <path d="M8 14 H28 V28 Q28 36 18 36 Q8 36 8 28Z" fill="#f7efe4" stroke="#6b4a32" strokeWidth="1.6" />
          <path d="M28 18 H33 Q37 18 37 23 Q37 28 32 28 H28" fill="none" stroke="#6b4a32" strokeWidth="2" />
          <ellipse cx="18" cy="16" rx="8" ry="3" fill="#6b3a22" />
          <path d="M14 22 Q18 18 22 22 Q18 24 14 22Z" fill="#f3d2b0" />
          <path d="M16 8 Q18 4 18 8 M21 7 Q23 4 23 8" fill="none" stroke="#c4b8ae" strokeWidth="1.5" strokeLinecap="round" />
        </symbol>
        <symbol id="ds-p-parfait" viewBox="0 0 40 40">
          <path d="M14 12 H26 L24 34 Q20 37 16 34Z" fill="#fff" stroke="#d07aa0" strokeWidth="1.5" />
          <path d="M15 20 H25 L24.4 24 H15.6Z" fill="#ff8fab" />
          <path d="M15.4 24 H24.6 L24 28 H16Z" fill="#fff4c2" />
          <path d="M16 28 H24 L23.2 33 Q20 35 16.8 33Z" fill="#c9a0ff" />
          <circle cx="20" cy="10" r="4" fill="#fff" stroke="#d07aa0" strokeWidth="1.2" />
          <circle cx="20" cy="9" r="2.2" fill="#ff5d8f" />
          <rect x="19" y="4" width="2" height="4" fill="#7bc47f" />
        </symbol>
        <symbol id="ds-p-sandwich" viewBox="0 0 40 40">
          <path d="M7 18 L20 8 L33 18 V22 H7Z" fill="#f6d48a" stroke="#a86b22" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M8 22 H32 V26 H8Z" fill="#8fd18a" stroke="#3f6b2a" strokeWidth="1.2" />
          <path d="M8 26 H32 V30 H8Z" fill="#ffb4a2" stroke="#a33b3b" strokeWidth="1.2" />
          <path d="M7 30 L20 36 L33 30 V32 L20 38 L7 32Z" fill="#e7b15a" stroke="#a86b22" strokeWidth="1.5" strokeLinejoin="round" />
        </symbol>
        <symbol id="ds-p-choco" viewBox="0 0 40 40">
          <rect x="8" y="18" width="24" height="16" rx="3" fill="#6b3a22" stroke="#3b2114" strokeWidth="1.5" />
          <rect x="12" y="12" width="16" height="8" rx="2" fill="#8a4b2e" stroke="#3b2114" strokeWidth="1.4" />
          <rect x="17" y="8" width="6" height="6" rx="1" fill="#ffd166" stroke="#8a5a12" strokeWidth="1" />
          <path d="M14 24 H18 M22 24 H26 M14 29 H26" stroke="#c9845a" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M20 8 Q16 2 14 6 Q16 8 20 8 Q24 8 26 6 Q24 2 20 8Z" fill="#ff8fab" />
        </symbol>
        <symbol id="ds-p-wedding" viewBox="0 0 40 40">
          <path d="M6 30 H34 V34 H6Z" fill="#fff4ea" stroke="#c98497" strokeWidth="1.4" />
          <path d="M10 22 H30 V30 H10Z" fill="#fff" stroke="#d07aa0" strokeWidth="1.4" />
          <path d="M14 14 H26 V22 H14Z" fill="#fff" stroke="#d07aa0" strokeWidth="1.4" />
          <circle cx="20" cy="10" r="3" fill="#ff8fab" />
          <path d="M20 6 V4" stroke="#7bc47f" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M12 26 H28 M16 18 H24" stroke="#ffd0e0" strokeWidth="1.5" />
        </symbol>
        <symbol id="ds-p-taro" viewBox="0 0 40 40">
          <path d="M23 3 L19 14" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" />
          <path d="M10 12 H30 L27 36 Q20 38 13 36Z" fill="#d8c4f0" stroke="#5b3f7a" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M11 22 Q20 18 29 22 L28 28 Q20 25 12 28Z" fill="#b48ad8" />
          <rect x="9" y="10" width="22" height="4" rx="2" fill="#fff" stroke="#5b3f7a" strokeWidth="1.4" />
          <circle cx="16" cy="32" r="2" fill="#3b2418" /><circle cx="21" cy="33" r="2" fill="#3b2418" /><circle cx="25" cy="31" r="1.7" fill="#3b2418" />
          <path d="M14 17 L15 21" stroke="#fff" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" />
        </symbol>
        <symbol id="ds-p-pineapple" viewBox="0 0 40 40">
          <rect x="6" y="14" width="28" height="20" rx="4" fill="#f2c078" stroke="#8a5a12" strokeWidth="1.6" />
          <rect x="9" y="17" width="22" height="14" rx="3" fill="#e9a23b" />
          <path d="M11 21 H29 M11 25 H29 M11 29 H29" stroke="#c9842a" strokeWidth="1.1" />
          <path d="M20 14 Q17 8 13 7 Q17 6 20 10 Q23 6 27 7 Q23 8 20 14Z" fill="#7bc47f" stroke="#3f6b2a" strokeWidth="1.1" />
          <path d="M10 18 Q12 16 15 16" fill="none" stroke="#fff1cc" strokeWidth="1.8" strokeLinecap="round" />
        </symbol>
        <symbol id="ds-p-yolkcake" viewBox="0 0 40 40">
          <rect x="4" y="18" width="32" height="18" rx="3" fill="#c0392b" stroke="#6b1a12" strokeWidth="1.6" />
          <rect x="4" y="18" width="32" height="5" fill="#e0574a" stroke="#6b1a12" strokeWidth="1.2" />
          <circle cx="13" cy="15" r="6" fill="#f2c078" stroke="#8a5a12" strokeWidth="1.4" />
          <circle cx="27" cy="15" r="6" fill="#f2c078" stroke="#8a5a12" strokeWidth="1.4" />
          <circle cx="13" cy="13" r="1.4" fill="#2b1a10" /><circle cx="27" cy="13" r="1.4" fill="#2b1a10" />
          <rect x="15" y="25" width="10" height="8" rx="1.5" fill="#ffd166" stroke="#8a5a12" strokeWidth="1" />
          <path d="M8 16 Q10 12 13 11" fill="none" stroke="#fff1cc" strokeWidth="1.6" strokeLinecap="round" />
        </symbol>
        <symbol id="ds-coin" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="14" fill="#ffc83d" stroke="#9a5b00" strokeWidth="2" />
          <circle cx="16" cy="16" r="10" fill="#ffe08a" stroke="#e0a21b" strokeWidth="1.2" />
          <path d="M16 9 l2 4.4 4.8 .6 -3.5 3.3 .9 4.8 -4.2 -2.4 -4.2 2.4 .9 -4.8 -3.5 -3.3 4.8 -.6Z" fill="#f59e0b" />
        </symbol>
        <symbol id="ds-xp" viewBox="0 0 32 32">
          <path d="M16 2 L20 11 L30 12 L22.5 19 L25 29 L16 24 L7 29 L9.5 19 L2 12 L12 11Z" fill="#ffd23f" stroke="#a15c00" strokeWidth="2" strokeLinejoin="round" />
          <path d="M12 12 L16 5 L18 11" fill="none" stroke="#fff7cc" strokeWidth="2" strokeLinecap="round" />
        </symbol>
        <symbol id="ds-heart" viewBox="0 0 24 24">
          <path d="M12 21 C5 15 2 12 2 8 A5 5 0 0 1 12 6 A5 5 0 0 1 22 8 C22 12 19 15 12 21Z" fill="#ff5d8f" stroke="#9d174d" strokeWidth="1.5" />
        </symbol>
      </defs>
    </svg>
  )
})

export function ProductIcon({ id, size = 28, className }: { id: ProductId; size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <use href={`#ds-p-${id}`} width="40" height="40" />
    </svg>
  )
}

/* ---------- 靜態地面層：獨立的 SVG，不隨遊戲狀態重畫 ---------- */

function curbFace(b: number, a0: number, a1: number, drop: number) {
  const [x0, y0] = iso(a0, b)
  const [x1, y1] = iso(a1, b)
  return `M${x0} ${y0} L${x1} ${y1} L${x1} ${y1 + drop} L${x0} ${y0 + drop}Z`
}

function sideFace(a: number, b0: number, b1: number, drop: number) {
  const [x0, y0] = iso(a, b0)
  const [x1, y1] = iso(a, b1)
  return `M${x0} ${y0} L${x1} ${y1} L${x1} ${y1 + drop} L${x0} ${y0 + drop}Z`
}

export const StreetGround = memo(function StreetGround() {
  const dashes = Array.from({ length: 40 }, (_, i) => -1200 + i * 64)
  return (
    <svg className="ds-ground" viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g transform={PLAN}>
        <rect x="-1800" y="-1800" width="3600" height="3600" fill="url(#ds-lawn)" />
        {/* 後巷碎石路與後院花圃 */}
        <rect x="-1800" y="-236" width="3600" height="40" fill="url(#ds-gravel)" />
        <rect x="-1800" y="-238" width="3600" height="3" fill="#d8c4a6" />
        <rect x="-1800" y="-197" width="3600" height="3" fill="#d8c4a6" />
        <ellipse cx="-300" cy="-320" rx="70" ry="38" fill="#97cc78" />
        <ellipse cx="80" cy="-300" rx="60" ry="30" fill="#97cc78" />
        {/* 北側人行道 */}
        <rect x="-1800" y="0" width="3600" height="62" fill="url(#ds-tile)" />
        <rect x="-1800" y="0" width="3600" height="16" fill="url(#ds-ao)" />
        <rect x="-1800" y="60" width="3600" height="10" fill="#fbf5ec" />
        {/* 主街車道 */}
        <rect x="-1800" y="70" width="3600" height="90" fill="#8c8798" />
        <rect x="-1800" y="70" width="3600" height="10" fill="#7a7586" />
        <rect x="-1800" y="76" width="3600" height="2.5" fill="#f4efe6" opacity="0.75" />
        <rect x="-1800" y="152" width="3600" height="2.5" fill="#f4efe6" opacity="0.75" />
        {dashes.map((x) => <rect key={x} x={x} y="114" width="34" height="4" rx="2" fill="#ffe7a8" />)}
        {/* 南側人行道與廣場 */}
        <rect x="-1800" y="160" width="3600" height="8" fill="#fbf5ec" />
        <rect x="-1800" y="168" width="3600" height="44" fill="url(#ds-tile)" />
        <rect x="-1800" y="212" width="1660" height="1600" fill="url(#ds-plaza)" />
        <rect x="-1800" y="212" width="1660" height="6" fill="#e9c6b0" />
        {/* 往南的側街 */}
        <rect x="-140" y="160" width="80" height="1700" fill="#8c8798" />
        <rect x="-60" y="168" width="16" height="1700" fill="#fbf5ec" />
        <rect x="-148" y="212" width="8" height="1700" fill="#fbf5ec" />
        {Array.from({ length: 22 }, (_, i) => <rect key={i} x="-102" y={240 + i * 64} width="4" height="34" rx="2" fill="#ffe7a8" />)}
        {/* 斑馬線：主街一道、側街一道 */}
        {Array.from({ length: 6 }, (_, i) => <rect key={`m${i}`} x="-182" y={80 + i * 13} width="30" height="8" rx="1.5" fill="#fbf7f0" />)}
        {Array.from({ length: 5 }, (_, i) => <rect key={`s${i}`} x={-134 + i * 15} y="172" width="9" height="34" rx="1.5" fill="#fbf7f0" />)}
        {/* 店門口的暖光 */}
        <ellipse cx={DOOR_A} cy="24" rx="96" ry="30" fill="url(#ds-spill)" opacity="0.65" />
        {/* 東南草地小徑 */}
        <rect x="-44" y="420" width="520" height="34" fill="url(#ds-gravel)" />
        <ellipse cx="260" cy="560" rx="90" ry="50" fill="#97cc78" />
      </g>
      <path d={curbFace(70, -1800, 1800, 6)} fill="#cbb8a0" />
      <path d={curbFace(212, -1800, -148, 5)} fill="#dcb9a2" />
      <path d={sideFace(-60, 168, 1800, 6)} fill="#cbb8a0" />
      {/* 後排住宅與樹叢，永遠在三間店後方 */}
      <Sprite name="tree-green" a={-470} b={-300} s={0.62} />
      <Sprite name="house-yellow" a={-330} b={-268} s={0.78} />
      <Sprite name="grove" a={-140} b={-262} s={0.72} />
      <Sprite name="house-teal" a={60} b={-262} s={0.74} />
      <Sprite name="tree-sakura" a={-30} b={-250} s={0.56} />
      <Sprite name="hedge" a={-260} b={-176} s={0.42} />
      <rect width={SCENE_W} height="170" fill="url(#ds-haze)" />
    </svg>
  )
})

/* ---------- 建築 ---------- */

export type ShopVisual = {
  level: number
  name: string
  open: boolean
  baking: boolean
  canUpgrade: boolean
  upgrading: boolean
  tea: boolean
  gift: boolean
  opening: BuildingId | null
  badges: Partial<Record<ShopId, ShopBadge>>
  onOpen?: () => void
  onLot?: () => void
  onShop?: (shop: ShopId) => void
}

const DESSERT = { a0: -184, b1: 0 }
const TEA = { a0: -384, b1: 0 }
/** 禮盒工坊位於側街東側，店面朝西（鏡射素材），底座角是西南角。 */
const GIFT = { a0: -50, b1: 382 }

type FrontSprite = 'shop-dessert' | 'shop-tea' | 'shop-gift'
type ShopFront = {
  sprite: FrontSprite
  a0: number
  b1: number
  flip: boolean
  /** 雨棚荷葉邊左右兩端（相對底座角，素材像素，未鏡射）。三張店面素材的雨棚形狀相同、位置略有差異。 */
  awning: [[number, number], [number, number]]
  /** 腳踏墊落點（平面座標），對齊各店實際的店門。 */
  mat: [number, number]
}

/** 每間店的裝潢錨點。新增店家時在這裡補一筆，並在規則層的 fits 加入店家 id。 */
const SHOP_FRONTS: Record<ShopId, ShopFront> = {
  main: { sprite: 'shop-dessert', a0: DESSERT.a0, b1: DESSERT.b1, flip: false, awning: AWNING_ENDS, mat: [DESSERT.a0 + 6, GUEST_B] },
  tea: { sprite: 'shop-tea', a0: TEA.a0, b1: TEA.b1, flip: false, awning: [[-32, -320], [274, -410]], mat: [TEA.a0 + 82, GUEST_B] },
  gift: { sprite: 'shop-gift', a0: GIFT.a0, b1: GIFT.b1, flip: true, awning: [[-28, -317], [275, -413]], mat: [SIDE_A, GIFT.b1 - 84] },
}

export type ShopBadge = { text: string; tone: 'open' | 'busy' | 'short' | 'closed' }
const BADGE_FILL: Record<ShopBadge['tone'], string> = { open: '#2f9e44', busy: '#e8590c', short: '#e03131', closed: '#868e96' }

function ShopBadgeTag({ x, y, badge }: { x: number; y: number; badge: ShopBadge | undefined }) {
  if (!badge) return null
  const w = badge.text.length * 11 + 18
  return (
    <g className={`ds-shop-badge is-${badge.tone}`} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} pointerEvents="none">
      <rect x={-w / 2} y="-9.5" width={w} height="19" rx="9.5" fill={BADGE_FILL[badge.tone]} stroke="#fff" strokeWidth="2" />
      <text y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff">{badge.text}</text>
    </g>
  )
}

function footprint(a0: number, b1: number, alongA: number, alongB: number, height: number) {
  const pts = [iso(a0, b1), iso(a0 + alongA, b1), iso(a0 + alongA, b1 - alongB), iso(a0, b1 - alongB)]
  const [p0, p1, p2, p3] = pts
  return [
    p0, p1, [p1[0], p1[1] - height], [p2[0], p2[1] - height], [p3[0], p3[1] - height], p3,
  ].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

function NamePlate({ x, y, text, tone, sub }: { x: number; y: number; text: string; tone: string; sub?: string }) {
  const w = Math.max(70, text.length * 14 + (sub ? 40 : 24))
  return (
    <g className="ds-plate" transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} pointerEvents="none">
      <rect x={-w / 2} y="-12" width={w} height="25" rx="12.5" fill="#5a3422" opacity="0.25" transform="translate(0,2)" />
      <rect x={-w / 2} y="-12" width={w} height="24" rx="12" fill="#fff8ec" stroke={tone} strokeWidth="2.5" />
      <text x={sub ? -10 : 0} y="5" textAnchor="middle" fontSize="13" fontWeight="900" fill="#5a3422">{text}</text>
      {sub ? (
        <g transform={`translate(${w / 2 - 15},0)`}>
          <circle r="10" fill={tone} stroke="#fff" strokeWidth="2" />
          <text y="4" textAnchor="middle" fontSize="10" fontWeight="900" fill="#fff">{sub}</text>
        </g>
      ) : null}
    </g>
  )
}

function signPoint(a0: number, b1: number, s: number, flip = false): [number, number] {
  const [x, y] = iso(a0, b1)
  return [x + (flip ? -SIGN_PX[0] : SIGN_PX[0]) * s, y + SIGN_PX[1] * s]
}

export const NorthRow = memo(function NorthRow({ level, name, open, baking, canUpgrade, upgrading, tea, opening, badges, onOpen, onLot, onShop }: Omit<ShopVisual, 'gift'>) {
  const ds = SHOP_SCALE['shop-dessert']
  const ts = SHOP_SCALE[tea ? 'shop-tea' : 'shop-closed']
  const [foot] = [iso(DESSERT.a0, DESSERT.b1)]
  const [sx, sy] = signPoint(DESSERT.a0, DESSERT.b1, ds)
  const [tx, ty] = signPoint(TEA.a0, TEA.b1, ts)
  const chimney: [number, number] = [foot[0] + CHIMNEY_PX[0] * ds, foot[1] + CHIMNEY_PX[1] * ds]
  const doorSign = iso(DESSERT.a0 + 6, 0)
  return (
    <g>
      {/* 街角延續：右上兩棟、左下一片樹叢，讓街道往畫面外延伸 */}
      <Sprite name="house-yellow" a={200} b={0} s={0.8} />
      <Sprite name="house-teal" a={20} b={0} s={0.8} />
      <g className={`ds-shop ${upgrading ? 'is-upgrading' : ''}`} data-level={level} data-open={open}>
        <Sprite name="shop-dessert" a={DESSERT.a0} b={DESSERT.b1} s={ds} />
        {baking ? (
          <g className="ds-smoke" fill="#fff" pointerEvents="none">
            <circle cx={chimney[0]} cy={chimney[1]} r="7" />
            <circle cx={chimney[0] + 6} cy={chimney[1] - 12} r="9" />
            <circle cx={chimney[0] - 2} cy={chimney[1] - 26} r="8" />
          </g>
        ) : null}
        {open ? null : <polygon points={footprint(DESSERT.a0 + 30, -2, 130, 4, 120)} fill="#2b2140" opacity="0.18" pointerEvents="none" />}
        <NamePlate x={sx} y={sy} text={name} sub={`${level}`} tone="#ff8fab" />
        <ShopBadgeTag x={sx} y={sy + 25} badge={badges.main} />
        <g className="ds-doorsign" transform={`translate(${doorSign[0].toFixed(1)},${(doorSign[1] - 108).toFixed(1)})`} pointerEvents="none">
          <path d="M-2 -10 V0 M22 -16 V-6" stroke="#6b4a32" strokeWidth="1.6" />
          <g transform="matrix(1 -0.58 0 1 0 0)">
            <rect x="-6" y="0" width="34" height="15" rx="4" fill={open ? '#2f9e44' : '#c92a2a'} stroke="#fff" strokeWidth="1.6" />
            <text x="11" y="11" textAnchor="middle" fontSize="9" fontWeight="900" fill="#fff">{open ? '營業' : '休息'}</text>
          </g>
        </g>
        {canUpgrade ? (
          <g className="ds-upbadge" transform={`translate(${sx.toFixed(1)},${(sy - 118).toFixed(1)})`} pointerEvents="none">
            <rect x="-44" y="-16" width="88" height="30" rx="15" fill="#22c55e" stroke="#fff" strokeWidth="3" />
            <path d="M-31 5 L-25 -7 L-19 5 H-22 V10 H-28 V5Z" fill="#fff" />
            <text x="8" y="5" textAnchor="middle" fontSize="14" fontWeight="900" fill="#fff">可升級</text>
          </g>
        ) : null}
        {upgrading ? (
          <g className="ds-upburst" pointerEvents="none">
            {Array.from({ length: 14 }, (_, i) => {
              const r = (i / 14) * Math.PI * 2
              return <circle key={i} cx={sx + Math.cos(r) * 120} cy={sy + 40 + Math.sin(r) * 90} r={5 + (i % 3) * 3} fill={['#ffd166', '#ff8fab', '#7cc6fe', '#fff'][i % 4]} style={{ animationDelay: `${(i % 5) * 0.06}s` }} />
            })}
          </g>
        ) : null}
        <polygon className="ds-shop-hit" points={footprint(DESSERT.a0, DESSERT.b1, SHOP_FRONT, SHOP_DEPTH, 210)} fill="transparent" role="button" aria-label={`${name}，開啟備貨`} onClick={onOpen} />
      </g>
      <g className={opening === 'tea' ? 'ds-lot-pop' : undefined}>
        <Sprite name={tea ? 'shop-tea' : 'shop-closed'} a={TEA.a0} b={TEA.b1} s={ts} />
        <NamePlate x={tx} y={ty} text={tea ? '暖暖茶飲館' : '店面招租中'} tone={tea ? '#6fbf9a' : '#a5afc2'} />
        {tea ? <ShopBadgeTag x={tx} y={ty + 25} badge={badges.tea} /> : null}
        <polygon className="ds-shop-hit" points={footprint(TEA.a0, TEA.b1, SHOP_FRONT, SHOP_DEPTH, 210)} fill="transparent" role="button" aria-label={tea ? '暖暖茶飲館，開啟備貨' : '空店面，查看開幕條件'} onClick={tea ? () => onShop?.('tea') : onLot} />
      </g>
      <Sprite name="grove" a={-590} b={-6} s={0.78} />
    </g>
  )
})

export const GiftCorner = memo(function GiftCorner({ gift, opening, badge, onLot, onShop }: { gift: boolean; opening: BuildingId | null; badge?: ShopBadge; onLot?: () => void; onShop?: (shop: ShopId) => void }) {
  const name = gift ? 'shop-gift' : 'shop-closed'
  const s = SHOP_SCALE[name]
  const [x, y] = signPoint(GIFT.a0, GIFT.b1, s, true)
  return (
    <g className={opening === 'gift' ? 'ds-lot-pop' : undefined}>
      <Sprite name={name} a={GIFT.a0} b={GIFT.b1} s={s} flip />
      <NamePlate x={x} y={y} text={gift ? '禮盒工坊' : '即將開幕'} tone={gift ? '#b79be8' : '#a5afc2'} />
      {gift ? <ShopBadgeTag x={x} y={y + 25} badge={badge} /> : null}
      <polygon className="ds-shop-hit" points={footprint(GIFT.a0, GIFT.b1, SHOP_DEPTH, SHOP_FRONT, 210)} fill="transparent" role="button" aria-label={gift ? '禮盒工坊，開啟備貨' : '空店面，查看開幕條件'} onClick={gift ? () => onShop?.('gift') : onLot} />
    </g>
  )
})

/* ---------- 街道家具與前景 ---------- */

/** 北側路緣：兩盞路燈與郵筒，畫在顧客之後，擋在他們前方。 */
export const CurbProps = memo(function CurbProps() {
  return (
    <g pointerEvents="none">
      <Sprite name="lamp" a={-452} b={60} s={0.5} />
      <Sprite name="lamp" a={78} b={60} s={0.5} />
      <Sprite name="mailbox" a={-420} b={56} s={0.36} />
    </g>
  )
})

/** 南側人行道、廣場與東南草地。 */
export const Foreground = memo(function Foreground() {
  return (
    <g pointerEvents="none">
      <Sprite name="lamp" a={-250} b={200} s={0.5} />
      <Sprite name="flowerbed" a={-232} b={214} s={0.34} />
      <Sprite name="hedge" a={130} b={236} s={0.4} />
      <Sprite name="tree-green" a={150} b={300} s={0.56} />
      <Sprite name="bikes" a={-30} b={440} s={0.36} />
      <Sprite name="tree-sakura" a={-210} b={300} s={0.62} />
      <Sprite name="bench" a={-300} b={262} s={0.4} />
      <Sprite name="flowerbed" a={200} b={430} s={0.4} />
      <Sprite name="tree-green" a={330} b={330} s={0.6} />
    </g>
  )
})

function laneMotion(name: SpriteName, s: number, lane: number, fromA: number, toA: number, flip = false) {
  const [x0, y0] = iso(fromA, lane)
  const [x1, y1] = iso(toA, lane)
  const art = SPRITES[name]
  return {
    style: { '--x0': `${x0.toFixed(1)}px`, '--y0': `${y0.toFixed(1)}px`, '--x1': `${x1.toFixed(1)}px`, '--y1': `${y1.toFixed(1)}px` } as CSSProperties,
    image: <image href={artFile(name)} x={-art.fx} y={-art.fy} width={art.w} height={art.h} transform={`scale(${flip ? -s : s},${s})`} />,
  }
}

export const Traffic = memo(function Traffic() {
  const down = laneMotion('car-mint', 0.31, LANE_IN, 760, -820)
  const up = laneMotion('car-peach', 0.31, LANE_OUT, -820, 760)
  const scoot = laneMotion('scooter', 0.27, LANE_OUT, -820, 760, true)
  return (
    <g pointerEvents="none">
      <g className="ds-drive" style={{ ...down.style, animationDuration: '15s', animationDelay: '-4s' }}>
        <ellipse cx="0" cy="-6" rx="46" ry="13" fill="url(#ds-shadow)" transform="rotate(-30)" />
        {down.image}
      </g>
      <g className="ds-drive" style={{ ...up.style, animationDuration: '17s', animationDelay: '-11s' }}>
        <ellipse cx="0" cy="-6" rx="46" ry="13" fill="url(#ds-shadow)" transform="rotate(-30)" />
        {up.image}
      </g>
      {/* 與桃色汽車同車道：同速、相差半個週期，才不會互相穿過。 */}
      <g className="ds-drive" style={{ ...scoot.style, animationDuration: '17s', animationDelay: '-2.5s' }}>
        <ellipse cx="10" cy="-4" rx="30" ry="9" fill="url(#ds-shadow)" transform="rotate(-30)" />
        {scoot.image}
      </g>
    </g>
  )
})

/* ---------- 顧客與特效 ---------- */

type Mood = 'normal' | 'happy' | 'sad' | 'wait' | 'impatient' | 'shop'

const GUEST_H = 80
const GUEST_W = 58

function ArtGuest({ look, walking, mood, flip }: { look: number; walking: boolean; mood: Mood; flip: boolean }) {
  const happy = mood === 'happy' || mood === 'shop'
  const motion = walking
    ? 'ds-art-walk'
    : happy
      ? 'ds-hop ds-art-motion'
      : mood === 'impatient'
        ? 'ds-fidget ds-art-motion'
        : mood === 'wait'
          ? 'ds-sway-wait ds-art-motion'
          : mood === 'sad'
            ? 'ds-sadbody ds-art-motion'
            : 'ds-art-idle ds-art-motion'
  return (
    <g transform={flip ? 'scale(-1,1)' : undefined}>
      <ellipse cx="0" cy="1" rx="17" ry="6" fill="url(#ds-shadow)" />
      <g className={motion}>
        {walking ? (
          <>
            <image href={castFile(look, 'a')} x={-GUEST_W / 2} y={-GUEST_H} width={GUEST_W} height={GUEST_H} preserveAspectRatio="xMidYMax meet" />
            <image className="ds-art-frame-b" href={castFile(look, 'b')} x={-GUEST_W / 2} y={-GUEST_H} width={GUEST_W} height={GUEST_H} preserveAspectRatio="xMidYMax meet" />
          </>
        ) : (
          <image href={castFile(look, 'idle')} x={-GUEST_W / 2} y={-GUEST_H} width={GUEST_W} height={GUEST_H} preserveAspectRatio="xMidYMax meet" />
        )}
      </g>
    </g>
  )
}

export type CustomerView = {
  c: Customer
  x: number
  servable: boolean
  patience: number
}

export function CustomerSprite({ view, onServe }: { view: CustomerView; onServe: (id: number) => void }) {
  const { c, x, servable, patience } = view
  const walking = c.phase === 'walk' || c.phase === 'leave'
  const flip = walking ? c.x1 < c.x0 : x > customerDoor(c)
  const impatient = c.phase === 'wait' && patience <= 0.28
  const mood: Mood = c.phase === 'happy' || c.mood === 'happy'
    ? (c.phase === 'leave' ? 'shop' : 'happy')
    : c.phase === 'sad' || c.mood === 'sad'
      ? 'sad'
      : impatient
        ? 'impatient'
        : c.phase === 'wait'
          ? 'wait'
          : 'normal'
  const [px, py] = customerPoint(c, x)
  if (c.kind === 'passer') {
    return (
      <g data-cid={c.id} data-scale="0.94" transform={`translate(${px.toFixed(1)},${py.toFixed(1)}) scale(0.94)`} className="ds-passer">
        <ArtGuest look={c.look} walking flip={flip} mood="normal" />
      </g>
    )
  }
  const waiting = c.phase === 'wait'
  const name = CUSTOMER_NAMES[c.look % CUSTOMER_NAMES.length]
  return (
    <g
      data-cid={c.id}
      data-shop={c.shop ?? undefined}
      data-scale="1"
      transform={`translate(${px.toFixed(1)},${py.toFixed(1)})`}
      className={`ds-guest ${waiting ? 'is-waiting' : ''}`}
      onClick={waiting ? () => onServe(c.id) : undefined}
      role={waiting ? 'button' : undefined}
      aria-label={waiting ? `服務${name}` : undefined}
    >
      {waiting ? <rect x="-34" y={-GUEST_H - 4} width="68" height={GUEST_H + 12} fill="transparent" /> : null}
      {waiting && servable ? <ellipse className="ds-ready-ring" cx="0" cy="1" rx="26" ry="9" fill="none" stroke="#4ade80" strokeWidth="3" /> : null}
      <ArtGuest look={c.look} walking={walking} mood={mood} flip={flip} />
      {c.phase === 'happy' ? (
        <g className="ds-hearts">
          <svg x="-26" y={-GUEST_H - 10} width="16" height="16" viewBox="0 0 24 24"><use href="#ds-heart" width="24" height="24" /></svg>
          <svg x="10" y={-GUEST_H - 22} width="18" height="18" viewBox="0 0 24 24"><use href="#ds-heart" width="24" height="24" /></svg>
        </g>
      ) : null}
      {c.phase === 'sad' ? (
        <g className="ds-sadcloud" transform={`translate(26,${-GUEST_H + 6})`}>
          <ellipse cx="0" cy="0" rx="13" ry="8.5" fill="#94a3b8" /><ellipse cx="8" cy="-5" rx="8" ry="7" fill="#94a3b8" />
          <path d="M-5 8 l-2 6 M2 8 l-2 6 M8 6 l-2 6" stroke="#60a5fa" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      ) : null}
    </g>
  )
}

/** 訂單泡泡獨立成最上層，不被彩旗、串燈或前景擋住；等待中的顧客不會移動，位置固定。 */
export function CustomerBubble({ view, onServe, onWant }: { view: CustomerView; onServe: (id: number) => void; onWant: (id: ProductId) => void }) {
  const { c, x, servable, patience } = view
  const impatient = patience <= 0.28
  const bubbleW = 18 + c.order.length * 32
  const color = patience > 0.5 ? '#22c55e' : patience > 0.25 ? '#f59e0b' : '#ef4444'
  const fill = servable ? '#f0fff4' : '#fffaf2'
  const line = servable ? '#22c55e' : '#c79a76'
  const [px, py] = customerPoint(c, x)
  return (
    <g
      data-bubble={c.id}
      data-shop={c.shop ?? undefined}
      transform={`translate(${px.toFixed(1)},${(py - GUEST_H - 8).toFixed(1)})`}
      className={`ds-guest-ui ${servable ? 'is-ready' : ''} ${impatient ? 'is-impatient' : ''}`}
      onClick={() => onServe(c.id)}
    >
      <g className="ds-bubble">
        <rect x={-bubbleW / 2} y="-42" width={bubbleW} height="38" rx="14" fill={fill} stroke={line} strokeWidth="2.5" />
        <path d="M-7 -5.5 L0 5 L7 -5.5Z" fill={fill} stroke={line} strokeWidth="2.5" strokeLinejoin="round" />
        <rect x="-8.5" y="-8" width="17" height="4.5" fill={fill} />
        {c.order.map((id, i) => (
          <svg
            key={i}
            className="ds-want"
            x={-bubbleW / 2 + 9 + i * 32}
            y="-39"
            width="31"
            height="31"
            viewBox="0 0 40 40"
            role="button"
            aria-label={`查看${productSpec(id).name}`}
            onClick={(event) => {
              event.stopPropagation()
              onWant(id)
            }}
          >
            <rect width="40" height="40" fill="transparent" pointerEvents="all" />
            <use href={`#ds-p-${id}`} width="40" height="40" />
          </svg>
        ))}
        <rect x={-bubbleW / 2 + 8} y="-50" width={bubbleW - 16} height="6" rx="3" fill="#5a3422" opacity="0.18" />
        <rect data-patience="1" data-full={bubbleW - 16} x={-bubbleW / 2 + 8} y="-50" width={Math.max(0, (bubbleW - 16) * patience)} height="6" rx="3" fill={color} />
        {servable ? (
          <g transform={`translate(${bubbleW / 2 - 2},-42)`}>
            <circle r="9" fill="#22c55e" stroke="#fff" strokeWidth="2" />
            <path d="M-4 0 L-1 3 L4 -3" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : null}
      </g>
    </g>
  )
}

export type FloatFx = { id: number; x: number; y: number; text: string; tone: 'coin' | 'xp' | 'tip' | 'make' | 'miss' | 'rank' | 'spark' }

const SPARK_COLORS = ['#ffd166', '#ff8fab', '#7cc6fe', '#fff', '#b5f5a0']

export function FloatLayer({ items }: { items: FloatFx[] }) {
  return (
    <g pointerEvents="none">
      {items.map((fx) => (
        <g key={fx.id} className={`ds-float is-${fx.tone}`} transform={`translate(${fx.x.toFixed(1)},${fx.y.toFixed(1)})`}>
          {fx.tone === 'spark' ? (
            <g className="ds-sparks">
              {Array.from({ length: 12 }, (_, i) => {
                const r = (i / 12) * Math.PI * 2
                return (
                  <path
                    key={i}
                    d="M0 -7 L2 -2 L7 0 L2 2 L0 7 L-2 2 L-7 0 L-2 -2Z"
                    fill={SPARK_COLORS[i % SPARK_COLORS.length]}
                    stroke="#fff"
                    strokeWidth="0.8"
                    style={{ '--sx': `${(Math.cos(r) * 70).toFixed(1)}px`, '--sy': `${(Math.sin(r) * 48).toFixed(1)}px`, animationDelay: `${(i % 4) * 0.05}s` } as CSSProperties}
                  />
                )
              })}
            </g>
          ) : null}
          <g className="ds-float-in">
            {fx.tone === 'coin' ? <svg x="-34" y="-17" width="22" height="22" viewBox="0 0 32 32"><use href="#ds-coin" width="32" height="32" /></svg> : null}
            {fx.tone === 'xp' ? <svg x="-34" y="-17" width="20" height="20" viewBox="0 0 32 32"><use href="#ds-xp" width="32" height="32" /></svg> : null}
            <text x={fx.tone === 'coin' || fx.tone === 'xp' ? -8 : 0} y="0" textAnchor={fx.tone === 'coin' || fx.tone === 'xp' ? 'start' : 'middle'} fontSize={fx.tone === 'rank' || fx.tone === 'spark' ? 22 : 19} fontWeight="900">{fx.text}</text>
          </g>
        </g>
      ))}
    </g>
  )
}

/* ---------- 裝潢：店面欄位與街道欄位，位置都落在同一個斜俯視平面 ---------- */

const FLAG_COLORS = ['#fb7185', '#fbbf24', '#38bdf8', '#4ade80', '#c084fc', '#fb923c']

function drape(t: number, from: [number, number], to: [number, number], sag: number): [number, number] {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + Math.sin(t * Math.PI) * sag]
}

function lift([x, y]: [number, number], h: number): [number, number] {
  return [x, y - h]
}

/** 門口地墊、雨棚燈籠、雨棚花環：依各店的錨點貼在該店上，畫在該店顧客之前。 */
export function DecorShop({ shop, decor, preview }: { shop: ShopId; decor: DecorId | null; preview: boolean }) {
  const front = SHOP_FRONTS[shop]
  const mark = preview ? 'ds-decor-in' : undefined
  const s = SHOP_SCALE[front.sprite]
  const dir = front.flip ? -1 : 1
  const [fx, fy] = iso(front.a0, front.b1)
  return (
    <g className="ds-decor" data-shop={shop} data-decor={decor ?? undefined} pointerEvents="none">
      {decor === 'mat' ? <Sprite className={mark} name="mat" a={front.mat[0]} b={front.mat[1]} s={0.2} flip={front.flip} /> : null}
      {decor === 'lantern' ? (
        <g className={mark}>
          {front.awning.map(([dx, dy], i) => {
            const flip = (i === 1) !== front.flip
            const x = fx + dx * s * dir
            const y = fy + dy * s
            const art = SPRITES.lantern
            const ls = 0.24
            return (
              <g key={i} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
                <circle className="ds-glow" cx={flip ? 16 : -16} cy="35" r="30" fill="url(#ds-bulb-glow)" />
                <g transform={`scale(${flip ? -ls : ls},${ls})`}>
                  <image className="ds-lantern" href={artFile('lantern')} x={-LANTERN_PLATE[0]} y={-LANTERN_PLATE[1]} width={art.w} height={art.h} />
                </g>
              </g>
            )
          })}
        </g>
      ) : null}
      {decor === 'flower' ? (() => {
        const [[lx, ly], [rx, ry]] = front.awning
        const k = ((rx - lx) * s) / GARLAND_BAR[1]
        const tilt = ((ry - ly) * s) / GARLAND_BAR[1]
        return (
          <g className={mark} transform={`translate(${(fx + lx * s * dir).toFixed(1)},${(fy + ly * s).toFixed(1)}) matrix(${(k * dir).toFixed(4)} ${tilt.toFixed(4)} 0 ${k.toFixed(4)} 0 0)`}>
            <image href="/arcade/street/art/decor-flower.png" x={-GARLAND_BAR[0]} y={-GARLAND_BAR[2]} width="1040" height="264" />
          </g>
        )
      })() : null}
    </g>
  )
}

/** 行道花圃與沿街串燈：在顧客前方的路緣上。 */
export function DecorCurb({ street, preview }: { street: DecorId | null; preview: DecorId | null }) {
  const mark = (id: DecorId) => (preview === id ? 'ds-decor-in' : undefined)
  if (street === 'planters') {
    return (
      <g className={mark('planters')} pointerEvents="none">
        <Sprite name="planter" a={-360} b={58} s={0.27} />
        <Sprite name="planter" a={18} b={58} s={0.27} />
      </g>
    )
  }
  if (street === 'lights') {
    const posts: [number, number][] = [iso(-430, 62), iso(-250, 62), iso(-70, 62), iso(110, 62)]
    const H = 96
    return (
      <g className={mark('lights')} pointerEvents="none">
        {posts.map(([x, y], i) => (
          <g key={i}>
            <ellipse cx={x} cy={y} rx="7" ry="3" fill="#3b2a20" opacity="0.25" />
            <path d={`M${x} ${y} V${y - H}`} stroke="#5b3f2c" strokeWidth="4.5" strokeLinecap="round" />
            <circle cx={x} cy={y - H} r="4" fill="#ffd166" stroke="#5b3f2c" strokeWidth="1.6" />
          </g>
        ))}
        {posts.slice(0, -1).map((p, i) => {
          const from = lift(p, H)
          const to = lift(posts[i + 1], H)
          const mid = drape(0.5, from, to, 16)
          return (
            <g key={i}>
              <path d={`M${from[0]} ${from[1]} Q${mid[0]} ${mid[1] + 16} ${to[0]} ${to[1]}`} fill="none" stroke="#5b4636" strokeWidth="1.8" />
              {Array.from({ length: 6 }, (_, j) => {
                const [x, y] = drape((j + 0.5) / 6, from, to, 16)
                return (
                  <g key={j} transform={`translate(${x.toFixed(1)},${(y + 5).toFixed(1)})`}>
                    <circle r="15" fill="url(#ds-bulb-glow)" className="ds-glow" style={{ animationDelay: `${((i * 6 + j) % 5) * 0.2}s` }} />
                    <circle r="5.6" fill={['#fff7c2', '#fb7185', '#7dd3fc', '#fbbf24'][(i + j) % 4]} stroke="#fff" strokeWidth="1" className="ds-bulb" style={{ animationDelay: `${((i + j) % 4) * 0.25}s` }} />
                  </g>
                )
              })}
            </g>
          )
        })}
      </g>
    )
  }
  if (street === 'parasols') {
    const spots: [number, number][] = [iso(-400, 70), iso(-190, 70), iso(20, 70)]
    const tops = [['#fb7185', '#fff'], ['#38bdf8', '#fff'], ['#fbbf24', '#fff']]
    return (
      <g className={mark('parasols')} pointerEvents="none">
        {spots.map(([x, y], i) => (
          <g key={i} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
            <ellipse cx="0" cy="2" rx="34" ry="9" fill="#3b2a20" opacity="0.2" />
            <ellipse cx="0" cy="-22" rx="15" ry="5" fill="#fff4e6" stroke="#5b3f2c" strokeWidth="1.6" />
            <path d="M-2 -22 V0 M2 -22 V0" stroke="#5b3f2c" strokeWidth="1.6" />
            <path d="M0 -84 V-22" stroke="#5b3f2c" strokeWidth="3" strokeLinecap="round" />
            <g className="ds-flag" style={{ animationDelay: `${i * 0.3}s` }}>
              {Array.from({ length: 6 }, (_, k) => {
                const a0 = Math.PI + (k / 6) * Math.PI
                const a1 = Math.PI + ((k + 1) / 6) * Math.PI
                return (
                  <path
                    key={k}
                    d={`M0 -88 L${(Math.cos(a0) * 46).toFixed(1)} ${(-60 + Math.sin(a0) * -2).toFixed(1)} Q${(Math.cos((a0 + a1) / 2) * 44).toFixed(1)} -54 ${(Math.cos(a1) * 46).toFixed(1)} ${(-60 + Math.sin(a1) * -2).toFixed(1)}Z`}
                    fill={tops[i][k % 2]}
                    stroke="#5b3f2c"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                )
              })}
            </g>
          </g>
        ))}
      </g>
    )
  }
  if (street === 'stalls') {
    const carts: [number, number, string][] = [[...iso(-430, 74), '#ef4444'], [...iso(70, 74), '#f59e0b']] as [number, number, string][]
    return (
      <g className={mark('stalls')} pointerEvents="none">
        {carts.map(([x, y, tone], i) => (
          <g key={i} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
            <ellipse cx="0" cy="4" rx="46" ry="10" fill="#3b2a20" opacity="0.22" />
            <circle cx="-26" cy="-4" r="9" fill="#4a3426" stroke="#2b1d14" strokeWidth="2" />
            <circle cx="26" cy="-4" r="9" fill="#4a3426" stroke="#2b1d14" strokeWidth="2" />
            <rect x="-40" y="-44" width="80" height="34" rx="4" fill="#fff4e6" stroke="#5b3f2c" strokeWidth="2" />
            <rect x="-36" y="-38" width="72" height="10" rx="2" fill="#fde68a" />
            <path d="M-38 -44 V-88 M38 -44 V-88" stroke="#5b3f2c" strokeWidth="3" />
            <path d="M-46 -88 H46 L40 -74 Q30 -66 20 -74 Q10 -66 0 -74 Q-10 -66 -20 -74 Q-30 -66 -40 -74Z" fill={tone} stroke="#5b3f2c" strokeWidth="1.6" strokeLinejoin="round" />
            {[-30, -10, 10, 30].map((lx, k) => (
              <g key={k} transform={`translate(${lx},-68)`}>
                <circle r="11" fill="url(#ds-bulb-glow)" className="ds-glow" style={{ animationDelay: `${((i + k) % 4) * 0.25}s` }} />
                <circle r="3.6" fill="#fff7c2" stroke="#fff" strokeWidth="0.8" className="ds-bulb" style={{ animationDelay: `${((i + k) % 4) * 0.25}s` }} />
              </g>
            ))}
            <text x="0" y="-18" textAnchor="middle" fontSize="11" fontWeight="900" fill="#7c2d12">{i === 0 ? '古早味' : '夜市小吃'}</text>
          </g>
        ))}
      </g>
    )
  }
  return null
}

/** 街口彩旗橫過主街上空，最後畫。 */
export function DecorOverhead({ street, preview }: { street: DecorId | null; preview: DecorId | null }) {
  if (street !== 'bunting') return null
  const H = 176
  const lines: [[number, number], [number, number]][] = [
    [lift(iso(-300, 62), H), lift(iso(-300, 166), H)],
    [lift(iso(-60, 62), H), lift(iso(-60, 166), H)],
    [lift(iso(-420, 6), H - 12), lift(iso(60, 6), H - 12)],
  ]
  return (
    <g className={preview === 'bunting' ? 'ds-decor-in' : undefined} pointerEvents="none">
      {lines.map(([from, to], k) => {
        const n = k === 2 ? 14 : 6
        const sag = k === 2 ? 26 : 14
        const mid = drape(0.5, from, to, sag)
        return (
          <g key={k}>
            <path d={`M${from[0]} ${from[1]} Q${mid[0]} ${mid[1] + sag} ${to[0]} ${to[1]}`} fill="none" stroke="#7c2d12" strokeWidth="2" />
            {Array.from({ length: n }, (_, i) => {
              const [x, y] = drape((i + 0.5) / n, from, to, sag)
              return (
                <g key={i} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
                  <g className="ds-flag" style={{ animationDelay: `${(i % 6) * 0.18}s` }}>
                    <path d="M-8 0 Q0 4 8 0 Q5 15 0 20 Q-5 15 -8 0Z" fill={FLAG_COLORS[(i + k) % FLAG_COLORS.length]} stroke="#7c2d12" strokeWidth="0.9" />
                  </g>
                </g>
              )
            })}
          </g>
        )
      })}
    </g>
  )
}

/** 裝潢套用時火花的落點（場景座標）。 */
export function decorSpot(id: DecorId, shop: ShopId = 'main'): [number, number] {
  if (id === 'bunting') return lift(iso(-180, 110), 170)
  if (id === 'planters' || id === 'lights' || id === 'parasols' || id === 'stalls') return lift(iso(-160, 60), 60)
  const front = SHOP_FRONTS[shop]
  if (id === 'mat') return iso(front.mat[0], front.mat[1])
  const [x, y] = iso(front.a0, front.b1)
  return [x + (front.flip ? -1 : 1) * 80, y - 150]
}

export function lotSpot(id: BuildingId): [number, number] {
  return id === 'tea' ? lift(iso(TEA.a0 + 80, -40), 150) : lift(iso(GIFT.a0 + 40, GIFT.b1 - 80), 150)
}