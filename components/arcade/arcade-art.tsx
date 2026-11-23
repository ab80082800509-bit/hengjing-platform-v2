'use client'

import { useId } from 'react'
import type { AchievementTier } from '@/lib/arcade/achievement-snapshot'
import { TIER_META } from '@/lib/arcade/game-catalog'

/** 使用合成小舖原創素材的 symbol。頁面上需先放一份 MERGE_ART_SVG。 */
export function ArtUse({ id, size = 100, className, viewBox }: { id: string; size?: number; className?: string; viewBox?: string }) {
  const box = viewBox ?? (id.startsWith('cu-') ? '0 0 120 130' : id === 'ic-check' ? '0 0 24 24' : '0 0 100 100')
  const [, , w, h] = box.split(' ').map(Number)
  return (
    <svg className={className ?? 'pa-art'} viewBox={box} width={size} height={(size * h) / w} aria-hidden="true">
      <use href={`#${id}`} width={w} height={h} />
    </svg>
  )
}

export function PayCoin({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="#f97316" stroke="#7c2d12" strokeWidth="2" />
      <circle cx="16" cy="16" r="10" fill="#fdba74" />
      <text x="16" y="20.5" textAnchor="middle" fontSize="11" fontWeight="900" fill="#7c2d12">P</text>
    </svg>
  )
}

export function GameCover({ cover }: { cover: 'merge' | 'blocks' | 'street' | 'scratch' }) {
  const uid = useId().replace(/:/g, '')
  if (cover === 'merge') {
    return (
      <svg className="pa-cover-art" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <svg x="-40" y="0" width="400" height="150" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMin slice"><use href="#scene-shop" width="1200" height="300" /></svg>
        <svg x="196" y="26" width="104" height="112" viewBox="0 0 120 130"><use href="#cu-atao" width="120" height="130" /></svg>
        <g className="fx-bob"><svg x="22" y="64" width="62" height="62" viewBox="0 0 100 100"><use href="#it-tea-5" width="100" height="100" /></svg></g>
        <g className="fx-bob" style={{ animationDelay: '-.8s' }}><svg x="84" y="80" width="54" height="54" viewBox="0 0 100 100"><use href="#it-snack-3" width="100" height="100" /></svg></g>
        <g className="fx-bob" style={{ animationDelay: '-1.6s' }}><svg x="140" y="70" width="58" height="58" viewBox="0 0 100 100"><use href="#it-gift-4" width="100" height="100" /></svg></g>
        <svg x="8" y="10" width="28" height="28" viewBox="0 0 20 20" className="fx-twinkle"><use href="#fx-spark" width="20" height="20" /></svg>
      </svg>
    )
  }
  if (cover === 'blocks') {
    const cells: Array<[number, number, string]> = [
      [0, 3, '#f97316'], [1, 3, '#f97316'], [2, 3, '#f97316'], [1, 2, '#f97316'],
      [4, 3, '#14b8a6'], [5, 3, '#14b8a6'], [5, 2, '#14b8a6'], [6, 2, '#14b8a6'],
      [8, 3, '#facc15'], [9, 3, '#facc15'], [8, 2, '#facc15'], [9, 2, '#facc15'],
      [3, 1, '#a855f7'], [3, 2, '#a855f7'], [3, 3, '#a855f7'], [7, 0, '#ef4444'], [7, 1, '#ef4444'],
    ]
    return (
      <svg className="pa-cover-art" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1e1b4b" /><stop offset="1" stopColor="#312e81" /></linearGradient>
        </defs>
        <rect width="320" height="150" fill={`url(#bg${uid})`} />
        {Array.from({ length: 11 }, (_, i) => <line key={i} x1={20 + i * 28} y1="0" x2={20 + i * 28} y2="150" stroke="#fff" strokeOpacity=".05" />)}
        <g transform="translate(20 22)">
          {cells.map(([x, y, color], i) => (
            <g key={i} transform={`translate(${x * 28} ${y * 28})`}>
              <rect width="26" height="26" rx="5" fill={color} stroke="#0f0a2e" strokeWidth="2" />
              <rect x="3" y="3" width="20" height="6" rx="3" fill="#fff" opacity=".35" />
            </g>
          ))}
        </g>
        <text x="300" y="34" textAnchor="end" fontSize="22" fontWeight="900" fill="#fde68a" opacity=".9">×4</text>
      </svg>
    )
  }
  if (cover === 'street') {
    const shops = [
      { x: 6, color: '#f97316', sign: '茶' },
      { x: 84, color: '#16a34a', sign: '餅' },
      { x: 162, color: '#2563eb', sign: '書' },
      { x: 240, color: '#db2777', sign: '花' },
    ]
    return (
      <svg className="pa-cover-art" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="320" height="150" fill="#fde7c7" />
        <circle cx="270" cy="28" r="16" fill="#fff7d6" />
        {shops.map((shop) => (
          <g key={shop.x} transform={`translate(${shop.x} 40)`}>
            <rect x="0" y="12" width="74" height="86" fill="#fff7ea" stroke="#4a2c1a" strokeWidth="2.5" />
            <path d="M-2 14 L76 14 L72 32 L2 32 Z" fill={shop.color} stroke="#4a2c1a" strokeWidth="2.5" />
            {[0, 1, 2, 3].map((s) => <path key={s} d={`M${4 + s * 18} 14 l9 0 l-1 18 l-9 0 z`} fill="#fff" opacity=".55" />)}
            <rect x="22" y="-2" width="30" height="16" rx="3" fill="#4a2c1a" />
            <text x="37" y="11" textAnchor="middle" fontSize="11" fontWeight="900" fill="#fde68a">{shop.sign}</text>
            <rect x="10" y="42" width="24" height="22" fill="#bae6fd" stroke="#4a2c1a" strokeWidth="2" />
            <rect x="42" y="50" width="22" height="48" fill="#a16207" stroke="#4a2c1a" strokeWidth="2" />
          </g>
        ))}
        <rect y="136" width="320" height="14" fill="#a8a29e" />
      </svg>
    )
  }
  return (
    <svg className="pa-cover-art" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`tk${uid}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fde68a" /><stop offset="1" stopColor="#f59e0b" /></linearGradient>
        <linearGradient id={`sv${uid}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#d4d4d8" /><stop offset=".5" stopColor="#f4f4f5" /><stop offset="1" stopColor="#a1a1aa" /></linearGradient>
      </defs>
      <rect width="320" height="150" fill="#3a2c20" />
      {Array.from({ length: 14 }, (_, i) => <circle key={i} cx={(i * 47) % 320} cy={(i * 29) % 150} r="1.6" fill="#fde68a" opacity=".5" />)}
      <g transform="translate(48 22) rotate(-4)">
        <rect width="224" height="104" rx="14" fill={`url(#tk${uid})`} stroke="#7c2d12" strokeWidth="3" />
        <circle cx="0" cy="52" r="10" fill="#3a2c20" />
        <circle cx="224" cy="52" r="10" fill="#3a2c20" />
        <text x="18" y="30" fontSize="14" fontWeight="900" fill="#7c2d12">每日幸運刮刮卡</text>
        <rect x="18" y="42" width="188" height="46" rx="10" fill={`url(#sv${uid})`} stroke="#71717a" strokeWidth="2" />
        <path d="M30 70 q20 -22 40 0 t40 0" stroke="#fde68a" strokeWidth="14" strokeLinecap="round" fill="none" opacity=".95" />
        <circle cx="160" cy="65" r="15" fill="#f97316" stroke="#7c2d12" strokeWidth="2.5" />
        <text x="160" y="70" textAnchor="middle" fontSize="13" fontWeight="900" fill="#fff">P</text>
      </g>
    </svg>
  )
}

export function MedalArt({ tier, art, locked = false, className = 'pa-medal-art' }: { tier: AchievementTier; art: string; locked?: boolean; className?: string }) {
  const uid = useId().replace(/:/g, '')
  const meta = TIER_META[tier]
  return (
    <svg className={className} viewBox="0 0 80 96" aria-hidden="true">
      <defs>
        <clipPath id={`m${uid}`}><circle cx="40" cy="58" r="22" /></clipPath>
        <radialGradient id={`f${uid}`} cx=".35" cy=".3" r=".9"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor={meta.face} /></radialGradient>
      </defs>
      <path d="M22 0 L38 0 L44 30 L30 34 Z" fill={meta.ribbon} />
      <path d="M58 0 L42 0 L36 30 L50 34 Z" fill={meta.ribbon} opacity=".85" />
      <path d="M26 0 L34 0 L38 28 L32 30 Z" fill="#fff" opacity=".25" />
      {tier === 'legend' ? (
        <g transform="translate(40 58)">
          {Array.from({ length: 12 }, (_, i) => <path key={i} d="M-4 -28 L0 -37 L4 -28 Z" fill="#fbbf24" transform={`rotate(${i * 30})`} />)}
        </g>
      ) : null}
      <circle cx="40" cy="58" r="29" fill={meta.ring} stroke="#4a2c1a" strokeWidth="2.5" />
      <circle cx="40" cy="58" r="24.5" fill={`url(#f${uid})`} stroke="#4a2c1a" strokeWidth="1.5" />
      <g clipPath={`url(#m${uid})`}>
        {locked ? (
          <text x="40" y="66" textAnchor="middle" fontSize="22" fontWeight="900" fill="#71717a">?</text>
        ) : (
          <svg x="18" y={art.startsWith('cu-') ? 34 : 36} width="44" height={art.startsWith('cu-') ? 48 : 44} viewBox={art.startsWith('cu-') ? '22 16 76 76' : '0 0 100 100'}>
            <use href={`#${art}`} width={art.startsWith('cu-') ? 120 : 100} height={art.startsWith('cu-') ? 130 : 100} />
          </svg>
        )}
      </g>
      <path d="M22 44 a24 24 0 0 1 20 -10" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" opacity=".6" />
    </svg>
  )
}

export function ZoneIcon({ zone }: { zone: 'collection' | 'coupon' | 'benefit' }) {
  if (zone === 'collection') {
    return (
      <svg viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="28" r="18" fill="#fdba74" stroke="#7c2d12" strokeWidth="2.5" />
        <path d="M26 16 l3.5 7 7.5 1 -5.5 5 1.3 7.5 -6.8 -3.6 -6.8 3.6 1.3 -7.5 -5.5 -5 7.5 -1z" fill="#fff7d6" stroke="#7c2d12" strokeWidth="1.5" />
      </svg>
    )
  }
  if (zone === 'coupon') {
    return (
      <svg viewBox="0 0 52 52" aria-hidden="true">
        <path d="M6 16 h40 v6 a4 4 0 0 0 0 8 v6 h-40 v-6 a4 4 0 0 0 0 -8 z" fill="#86efac" stroke="#14532d" strokeWidth="2.5" />
        <path d="M30 18 v16" stroke="#14532d" strokeWidth="2" strokeDasharray="3 3" />
        <text x="18" y="31" textAnchor="middle" fontSize="11" fontWeight="900" fill="#14532d">券</text>
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 52 52" aria-hidden="true">
      <rect x="10" y="22" width="32" height="22" rx="3" fill="#c4b5fd" stroke="#3b0764" strokeWidth="2.5" />
      <rect x="7" y="16" width="38" height="9" rx="3" fill="#a78bfa" stroke="#3b0764" strokeWidth="2.5" />
      <path d="M26 16 v28" stroke="#3b0764" strokeWidth="2.5" />
      <path d="M26 16 q-10 -12 -12 -2 q2 4 12 2 q10 2 12 -2 q-2 -10 -12 2" fill="#fde68a" stroke="#3b0764" strokeWidth="2" />
    </svg>
  )
}
