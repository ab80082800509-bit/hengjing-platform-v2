'use client'

import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import type { StickerDef, StickerProp } from '@/lib/rewards/stickers'
import './perk-visuals.css'

/* ---------- 聊天氣泡 ---------- */

const BUBBLES = new Set(['bubble-milktea', 'bubble-memo', 'bubble-neon'])

export function bubbleClass(id?: string): string {
  return id && BUBBLES.has(id) ? `pv-bubble pv-${id}` : ''
}

/* ---------- 寵物夥伴 ---------- */

export function PetBuddy({ id, size = 28, title }: { id?: string; size?: number; title?: string }) {
  if (!id) return null
  const body: Record<string, ReactNode> = {
    'pet-cat': (
      <>
        <path className="pv-tail" d="M10 40 Q2 30 8 22" fill="none" stroke="#ea8a2e" strokeWidth="5" strokeLinecap="round" />
        <ellipse cx="32" cy="44" rx="17" ry="13" fill="#f6a04d" stroke="#7a3d0c" strokeWidth="2" />
        <path d="M17 22 L20 8 L28 17 M47 22 L44 8 L36 17" fill="#f6a04d" stroke="#7a3d0c" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="32" cy="26" r="14" fill="#f6a04d" stroke="#7a3d0c" strokeWidth="2" />
        <path d="M24 18 h4 M36 18 h4 M30 15 v4" stroke="#c96a1b" strokeWidth="2" strokeLinecap="round" />
        <ellipse className="pv-eye" cx="26.5" cy="26" rx="2" ry="2.6" fill="#2b1708" />
        <ellipse className="pv-eye" cx="37.5" cy="26" rx="2" ry="2.6" fill="#2b1708" />
        <path d="M30 31 Q32 33 34 31" fill="none" stroke="#2b1708" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M21 37 Q32 43 43 37 L40 44 Q32 47 24 44Z" fill="#ef4444" stroke="#7f1d1d" strokeWidth="1.5" />
      </>
    ),
    'pet-shiba': (
      <>
        <path className="pv-tail" d="M12 38 Q2 32 9 24 Q14 28 12 34" fill="#e9a35a" stroke="#6b3a10" strokeWidth="2" />
        <ellipse cx="32" cy="45" rx="16" ry="12" fill="#e9a35a" stroke="#6b3a10" strokeWidth="2" />
        <path d="M18 24 L19 10 L28 18 M46 24 L45 10 L36 18" fill="#e9a35a" stroke="#6b3a10" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="32" cy="27" r="14" fill="#e9a35a" stroke="#6b3a10" strokeWidth="2" />
        <ellipse cx="32" cy="32" rx="9" ry="7" fill="#fff4e3" />
        <ellipse className="pv-eye" cx="26" cy="25" rx="2" ry="2.4" fill="#2b1708" />
        <ellipse className="pv-eye" cx="38" cy="25" rx="2" ry="2.4" fill="#2b1708" />
        <ellipse cx="32" cy="29.5" rx="2.4" ry="1.7" fill="#2b1708" />
        <path d="M31 33 q1 4 3 0" fill="#f472b6" />
        <path d="M17 19 Q32 4 47 19 L45 21 Q32 12 19 21Z" fill="#facc15" stroke="#854d0e" strokeWidth="1.6" />
      </>
    ),
    'pet-penguin': (
      <>
        <ellipse cx="32" cy="36" rx="17" ry="21" fill="#1f2937" stroke="#0b0f17" strokeWidth="2" />
        <ellipse cx="32" cy="40" rx="11" ry="15" fill="#f8fafc" />
        <path className="pv-flip" d="M48 32 Q57 38 51 46" fill="#1f2937" stroke="#0b0f17" strokeWidth="2" />
        <path d="M16 32 Q7 38 13 46" fill="#1f2937" stroke="#0b0f17" strokeWidth="2" />
        <ellipse className="pv-eye" cx="27" cy="25" rx="2" ry="2.5" fill="#f8fafc" />
        <ellipse className="pv-eye" cx="37" cy="25" rx="2" ry="2.5" fill="#f8fafc" />
        <circle cx="27.4" cy="25.4" r="1.1" fill="#0b0f17" />
        <circle cx="37.4" cy="25.4" r="1.1" fill="#0b0f17" />
        <path d="M29 30 L32 33 L35 30Z" fill="#f59e0b" />
        <path d="M27 37 L32 39.5 L37 37 L37 41 L32 39.5 L27 41Z" fill="#dc2626" stroke="#7f1d1d" strokeWidth="1" />
        <ellipse cx="26" cy="57" rx="5" ry="2" fill="#f59e0b" />
        <ellipse cx="38" cy="57" rx="5" ry="2" fill="#f59e0b" />
      </>
    ),
  }
  if (!body[id]) return null
  return (
    <svg viewBox="0 0 64 60" width={size} height={size * 0.94} className={`pv-pet pv-${id}`} role="img" aria-label={title ?? '寵物夥伴'}>
      {body[id]}
    </svg>
  )
}

/* ---------- 遊戲場景 ---------- */

function seeded(n: number, seed: number) {
  return Array.from({ length: n }, (_, i) => {
    const x = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453
    return x - Math.floor(x)
  })
}

export function SceneBackdrop({ id, dim = false }: { id?: string; dim?: boolean }) {
  const r = useMemo(() => seeded(14, id?.length ?? 1), [id])
  const d = dim ? ' is-dim' : ''
  if (id === 'scene-sakura') {
    return (
      <div className={`pv-scene pv-scene-sakura${d}`} aria-hidden="true">
        <svg viewBox="0 0 400 120" preserveAspectRatio="none">
          <path d="M0 80 Q100 60 200 78 T400 70 V120 H0Z" fill="#f9a8d4" opacity=".7" />
          <path d="M0 100 Q120 86 220 98 T400 92 V120 H0Z" fill="#a3e635" opacity=".55" />
          {[40, 130, 260, 350].map((x) => (
            <g key={x}>
              <rect x={x - 3} y="52" width="6" height="40" fill="#7c2d12" />
              <circle cx={x} cy="48" r="22" fill="#fbcfe8" />
              <circle cx={x - 12} cy="56" r="14" fill="#f9a8d4" />
              <circle cx={x + 13} cy="55" r="15" fill="#fbcfe8" />
            </g>
          ))}
        </svg>
        {r.map((v, i) => (
          <span key={i} className="pv-fall" style={{ left: `${v * 100}%`, animationDuration: `${6 + v * 5}s`, animationDelay: `${-i * 0.7}s`, '--pv-dx': `${30 + v * 50}px` } as CSSProperties}>
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 0 Q9 4 5 10 Q1 4 5 0Z" fill="#f472b6" /></svg>
          </span>
        ))}
      </div>
    )
  }
  if (id === 'scene-harbor') {
    return (
      <div className={`pv-scene pv-scene-harbor${d}`} aria-hidden="true">
        <span style={{ position: 'absolute', left: '62%', top: '30%', width: 70, height: 70, borderRadius: 999, background: '#fde68a', boxShadow: '0 0 40px #fbbf24' }} />
        <svg viewBox="0 0 400 120" preserveAspectRatio="none">
          <rect x="40" y="20" width="14" height="52" fill="#f8fafc" />
          <rect x="40" y="34" width="14" height="8" fill="#ef4444" />
          <path d="M36 20 L47 6 L58 20Z" fill="#ef4444" />
          <g className="pv-wave-line"><path d="M-20 80 Q10 74 40 80 T100 80 T160 80 T220 80 T280 80 T340 80 T420 80" fill="none" stroke="#bfdbfe" strokeWidth="3" opacity=".7" /></g>
          <g className="pv-wave-line" style={{ animationDelay: '-2s' }}><path d="M-20 96 Q10 90 40 96 T100 96 T160 96 T220 96 T280 96 T340 96 T420 96" fill="none" stroke="#93c5fd" strokeWidth="3" opacity=".6" /></g>
          <path d="M250 70 h60 l-8 10 h-44z" fill="#7c2d12" /><path d="M278 70 V40 L300 66Z" fill="#f8fafc" />
        </svg>
      </div>
    )
  }
  if (id === 'scene-night') {
    return (
      <div className={`pv-scene pv-scene-night${d}`} aria-hidden="true">
        {r.map((v, i) => (
          <span key={i} className="pv-twinkle" style={{ position: 'absolute', left: `${v * 100}%`, top: `${(r[(i + 5) % r.length] ?? 0.3) * 45}%`, width: 3, height: 3, borderRadius: 9, background: '#fef9c3', animationDelay: `${-i * 0.37}s` }} />
        ))}
        <svg viewBox="0 0 400 120" preserveAspectRatio="none">
          {[20, 110, 200, 290].map((x, i) => (
            <g key={x}>
              <rect x={x} y="70" width="70" height="50" fill="#111827" />
              <path d={`M${x - 6} 70 h82 l-8 -14 h-66z`} fill={['#dc2626', '#f59e0b', '#16a34a', '#2563eb'][i]} />
              <circle cx={x + 18} cy="84" r="4" fill="#fde047" className="pv-twinkle" />
              <circle cx={x + 52} cy="84" r="4" fill="#fb923c" className="pv-twinkle" style={{ animationDelay: '-1s' }} />
            </g>
          ))}
        </svg>
      </div>
    )
  }
  return null
}

/* ---------- 方塊棋盤 ---------- */

const BOARDS = new Set(['board-wood', 'board-arcade', 'board-jade'])

export function boardClass(id?: string): string {
  return id && BOARDS.has(id) ? `pv-board pv-${id}` : ''
}

/* ---------- 個人頁特效 ---------- */

const EFFECT_PARTICLE: Record<string, (i: number) => ReactNode> = {
  'effect-snow': () => <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 0v12M0 6h12M2 2l8 8M10 2l-8 8" stroke="#e0f2fe" strokeWidth="1.4" strokeLinecap="round" /></svg>,
  'effect-hearts': (i) => <svg width="14" height="13" viewBox="0 0 14 13"><path d="M7 12 C-4 4 3 -3 7 3 C11 -3 18 4 7 12Z" fill={i % 2 ? '#fb7185' : '#f472b6'} opacity=".85" /></svg>,
  'effect-coins': () => <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="#fbbf24" stroke="#a16207" strokeWidth="1.4" /><text x="7" y="10" textAnchor="middle" fontSize="7" fontWeight="900" fill="#92400e">P</text></svg>,
}

export function ProfileEffect({ id, interactive = false }: { id?: string; interactive?: boolean }) {
  const [bursts, setBursts] = useState<{ key: number; x: number; y: number }[]>([])
  const r = useMemo(() => seeded(12, 7), [])
  const particle = id ? EFFECT_PARTICLE[id] : undefined
  if (!id || !particle) return null
  const rising = id === 'effect-hearts'
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const key = Date.now()
    setBursts((list) => [...list.slice(-2), { key, x: event.clientX - rect.left, y: event.clientY - rect.top }])
    window.setTimeout(() => setBursts((list) => list.filter((b) => b.key !== key)), 1000)
  }
  const layer = (
    <>
      {r.map((v, i) => (
        <span
          key={i}
          className={rising ? 'pv-rise' : 'pv-fall'}
          style={{ left: `${v * 100}%`, animationDuration: `${5 + v * 4}s`, animationDelay: `${-i * 0.6}s`, '--pv-dx': `${(v - 0.5) * 40}px` } as CSSProperties}
        >
          {particle(i)}
        </span>
      ))}
      {bursts.map((b) =>
        Array.from({ length: 8 }, (_, i) => (
          <span key={`${b.key}-${i}`} className="pv-burst" style={{ left: b.x, top: b.y, '--pv-bx': `${Math.cos((i / 8) * Math.PI * 2) * 46}px`, '--pv-by': `${Math.sin((i / 8) * Math.PI * 2) * 46}px` } as CSSProperties}>
            {particle(i)}
          </span>
        )),
      )}
    </>
  )
  if (!interactive) return <div className="pv-effect" aria-hidden="true">{layer}</div>
  return (
    <button type="button" className="pv-effect pv-effect-click" aria-label="點一下播放個人頁特效" onClick={onClick}>
      {layer}
    </button>
  )
}

/* ---------- 節慶收藏徽章 ---------- */

export function CollectionEmblem({ id, size = 22 }: { id?: string; size?: number }) {
  if (!id) return null
  const art: Record<string, { label: string; node: ReactNode }> = {
    'collect-newyear': {
      label: '金馬迎春',
      node: (
        <>
          <circle cx="16" cy="16" r="15" fill="#dc2626" stroke="#fbbf24" strokeWidth="2" />
          <g className="pv-sway">
            <path d="M9 22 Q9 13 15 11 L18 7 L19 11 Q24 12 23 18 L21 17 L20 22Z" fill="#fbbf24" stroke="#92400e" strokeWidth="1.2" strokeLinejoin="round" />
            <circle cx="18" cy="12.5" r="0.9" fill="#7c2d12" />
          </g>
          <path className="pv-shine" d="M25 7 l1 2 2 1 -2 1 -1 2 -1 -2 -2 -1 2 -1z" fill="#fef3c7" />
        </>
      ),
    },
    'collect-moon': {
      label: '玉兔賞月',
      node: (
        <>
          <circle cx="16" cy="16" r="15" fill="#1e1b4b" stroke="#fde68a" strokeWidth="2" />
          <circle cx="19" cy="12" r="7" fill="#fde68a" className="pv-shine" />
          <g className="pv-sway">
            <ellipse cx="12" cy="22" rx="5" ry="4" fill="#f8fafc" />
            <ellipse cx="10.5" cy="15" rx="1.4" ry="4" fill="#f8fafc" />
            <ellipse cx="13.5" cy="15" rx="1.4" ry="4" fill="#f8fafc" />
            <circle cx="11" cy="21" r="0.7" fill="#be185d" />
          </g>
        </>
      ),
    },
    'collect-snowman': {
      label: '雪人派對',
      node: (
        <>
          <circle cx="16" cy="16" r="15" fill="#0f766e" stroke="#f8fafc" strokeWidth="2" />
          <circle cx="16" cy="22" r="6" fill="#f8fafc" />
          <circle cx="16" cy="13" r="4.4" fill="#f8fafc" />
          <path d="M11 9 h10 l-2 -4 h-6z" fill="#dc2626" />
          <circle cx="14.5" cy="12.5" r="0.7" fill="#0f172a" /><circle cx="17.5" cy="12.5" r="0.7" fill="#0f172a" />
          <path d="M16 14 l3 1 -3 0.6z" fill="#f97316" />
          <path className="pv-sway" d="M22 20 L27 15" stroke="#7c2d12" strokeWidth="1.4" strokeLinecap="round" />
        </>
      ),
    },
  }
  const item = art[id]
  if (!item) return null
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className="pv-emblem" role="img" aria-label={`節慶收藏：${item.label}`}>
      {item.node}
    </svg>
  )
}

/* ---------- 夢想商店街裝潢（畫在街景上） ---------- */

/** 在夢想商店街 SVG 座標（1200×640）裡的擺放位置；主店門口、街口上方與東側廣場。 */
export const STREET_PERK_BOX: Record<string, { x: number; y: number; width: number; height: number }> = {
  'decor-balloon': { x: 452, y: 268, width: 150, height: 112 },
  'decor-neon': { x: 760, y: 70, width: 220, height: 64 },
  'decor-fountain': { x: 960, y: 420, width: 150, height: 120 },
}

export function StreetPerkDecor({
  id,
  className = '',
  style,
  box,
}: {
  id?: string
  className?: string
  style?: CSSProperties
  box?: { x: number; y: number; width: number; height: number }
}) {
  if (box && id) {
    return (
      <svg {...box} overflow="visible" pointerEvents="none">
        <StreetPerkDecor id={id} className={className} style={{ width: '100%', height: '100%' }} />
      </svg>
    )
  }
  if (id === 'decor-balloon') {
    const colors = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899']
    return (
      <svg viewBox="0 0 120 90" className={`pv-decor-balloon ${className}`} style={style} role="img" aria-label="彩虹氣球拱門">
        {colors.concat(colors.slice(0, 6).reverse()).map((color, i, all) => {
          const t = i / (all.length - 1)
          const angle = Math.PI * (1 - t)
          return <circle key={i} className="pv-float" cx={60 + Math.cos(angle) * 48} cy={82 - Math.sin(angle) * 68} r="8" fill={color} stroke="rgb(0 0 0 / .25)" strokeWidth="1" />
        })}
      </svg>
    )
  }
  if (id === 'decor-neon') {
    return (
      <svg viewBox="0 0 160 46" className={`pv-decor-neon ${className}`} style={style} role="img" aria-label="買 Pay 夜市霓虹招牌">
        <rect x="3" y="3" width="154" height="40" rx="10" fill="#1e1b4b" stroke="#f472b6" strokeWidth="3" />
        <text className="pv-neon-text" x="80" y="31" textAnchor="middle" fontSize="20" fontWeight="900" fill="#fde047" stroke="#f97316" strokeWidth=".8" style={{ filter: 'drop-shadow(0 0 4px #f472b6)' }}>
          買 Pay 夜市
        </text>
      </svg>
    )
  }
  if (id === 'decor-fountain') {
    return (
      <svg viewBox="0 0 100 80" className={`pv-decor-fountain ${className}`} style={style} role="img" aria-label="星光噴水池">
        <g>
          <path className="pv-spray" d="M50 44 Q46 20 50 8 Q54 20 50 44" fill="#7dd3fc" opacity=".85" />
          <path className="pv-spray" d="M50 44 Q36 30 30 34" fill="none" stroke="#bae6fd" strokeWidth="3" strokeLinecap="round" />
          <path className="pv-spray" d="M50 44 Q64 30 70 34" fill="none" stroke="#bae6fd" strokeWidth="3" strokeLinecap="round" />
        </g>
        <ellipse cx="50" cy="62" rx="40" ry="12" fill="#94a3b8" stroke="#475569" strokeWidth="2" />
        <ellipse cx="50" cy="58" rx="34" ry="8" fill="#38bdf8" />
        <rect x="45" y="42" width="10" height="16" fill="#cbd5e1" stroke="#475569" strokeWidth="1.5" />
        {[22, 50, 78].map((x, i) => (
          <path key={x} className="pv-twinkle" style={{ animationDelay: `${-i * 0.6}s` }} d={`M${x} ${14 + i * 4} l1.5 3 3 1.5 -3 1.5 -1.5 3 -1.5 -3 -3 -1.5 3 -1.5z`} fill="#fef08a" />
        ))}
      </svg>
    )
  }
  return null
}

/* ---------- 動態貼圖 ---------- */

const PROP_ART: Record<StickerProp, ReactNode> = {
  heart: <path d="M16 28 C-6 12 6 -2 16 8 C26 -2 38 12 16 28Z" fill="#fb7185" stroke="#9f1239" strokeWidth="2" />,
  check: <><circle cx="16" cy="16" r="14" fill="#22c55e" stroke="#14532d" strokeWidth="2" /><path d="M9 16 l5 5 9 -10" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></>,
  star: <path d="M16 2 L20 11 L30 12 L22.5 19 L25 29 L16 24 L7 29 L9.5 19 L2 12 L12 11Z" fill="#facc15" stroke="#a16207" strokeWidth="2" strokeLinejoin="round" />,
  clock: <><circle cx="16" cy="16" r="13" fill="#fff" stroke="#334155" strokeWidth="2.4" /><path d="M16 8 V16 L22 19" stroke="#334155" strokeWidth="2.4" strokeLinecap="round" fill="none" /></>,
  coin: <><circle cx="16" cy="16" r="13" fill="#fbbf24" stroke="#92400e" strokeWidth="2.4" /><text x="16" y="21" textAnchor="middle" fontSize="13" fontWeight="900" fill="#92400e">P</text></>,
  moon: <path d="M22 4 A13 13 0 1 0 28 22 A10 10 0 1 1 22 4Z" fill="#fde68a" stroke="#a16207" strokeWidth="2" />,
  cake: <><rect x="5" y="15" width="22" height="13" rx="2" fill="#f9a8d4" stroke="#9d174d" strokeWidth="2" /><path d="M5 19 q5.5 4 11 0 t11 0" fill="none" stroke="#fff" strokeWidth="2" /><rect x="15" y="7" width="2.5" height="8" fill="#60a5fa" /><path d="M16.2 2 q3 3 0 5 q-3 -2 0 -5" fill="#f97316" /></>,
  cheers: <><path d="M5 6 h10 l-2 14 h-6z" fill="#fde68a" stroke="#92400e" strokeWidth="2" transform="rotate(-14 10 14)" /><path d="M17 6 h10 l-2 14 h-6z" fill="#fde68a" stroke="#92400e" strokeWidth="2" transform="rotate(14 22 14)" /><circle cx="16" cy="4" r="2" fill="#fff" /></>,
  confetti: <>{['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#f97316'].map((c, i) => <rect key={c} x={3 + i * 4.6} y={4 + (i % 3) * 8} width="4" height="7" rx="1" fill={c} transform={`rotate(${i * 35} ${5 + i * 4.6} ${8 + (i % 3) * 8})`} />)}</>,
  flag: <><rect x="6" y="3" width="2.6" height="27" fill="#7c2d12" /><path d="M8.6 4 H28 L23 11 L28 18 H8.6Z" fill="#ef4444" stroke="#7f1d1d" strokeWidth="1.6" /></>,
  gift: <><rect x="4" y="12" width="24" height="17" rx="2" fill="#a855f7" stroke="#581c87" strokeWidth="2" /><rect x="14" y="12" width="4" height="17" fill="#facc15" /><path d="M16 12 C10 2 4 8 16 12 C28 8 22 2 16 12Z" fill="#facc15" stroke="#a16207" strokeWidth="1.5" /></>,
  coins: <>{[0, 1, 2].map((i) => <g key={i}><circle cx={8 + i * 8} cy={12 + (i % 2) * 8} r="7" fill="#fbbf24" stroke="#92400e" strokeWidth="1.8" /><text x={8 + i * 8} y={15.5 + (i % 2) * 8} textAnchor="middle" fontSize="8" fontWeight="900" fill="#92400e">P</text></g>)}</>,
}

export function AnimatedSticker({ sticker, small = false }: { sticker: StickerDef; small?: boolean }) {
  if (sticker.kind === 'pay-bag') {
    return (
      <span
        className={`pv-pay-frame ${small ? 'sm' : ''}`}
        role="img"
        aria-label={`動態貼圖：${sticker.caption}`}
        style={{ backgroundImage: `url(${sticker.sheet})` }}
      />
    )
  }
  const cast = `/arcade/street/art/cast/c${sticker.cast}`
  return (
    <span className={`pv-sticker ${small ? 'sm' : ''}`} role="img" aria-label={`動態貼圖：${sticker.caption}`}>
      <span className={`pv-sticker-body pv-m-${sticker.motion}`}>
        <img src={`${cast}-idle.png`} alt="" draggable={false} />
        <img src={`${cast}-a.png`} alt="" draggable={false} />
      </span>
      <svg className="pv-sticker-prop" viewBox="0 0 32 32" aria-hidden="true">{PROP_ART[sticker.prop]}</svg>
      <span className="pv-sticker-cap">{sticker.caption}</span>
    </span>
  )
}
