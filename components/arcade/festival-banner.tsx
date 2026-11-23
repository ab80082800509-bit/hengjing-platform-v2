'use client'

import './arcade.css'
import type { CSSProperties } from 'react'
import {
  festivalThemeById,
  newYearMoment,
  resolveFestivalTheme,
  type FestivalDecor,
  type FestivalTheme,
} from '@/lib/arcade/festival-theme'
import { festivalYear, useFestivalSnapshot } from '@/components/festival/festival-store'
import { EdgeArt } from '@/components/festival/festival-edges'

export function activeFestivalTheme(previewId?: string | null, instant = new Date()): { theme: FestivalTheme; preview: boolean } {
  const resolved = resolveFestivalTheme(instant)
  if (previewId) {
    const theme = festivalThemeById(previewId)
    if (theme) return { theme, preview: theme.id !== resolved.id }
  }
  return { theme: resolved, preview: false }
}

/** 全站共用同一份主題狀態（festival-store），每分鐘自動重算，主題結束時回到預設外觀。 */
export function useFestivalTheme(previewId?: string | null): { theme: FestivalTheme; preview: boolean } {
  const snap = useFestivalSnapshot()
  const forced = previewId ? festivalThemeById(previewId) : null
  if (forced && forced.id !== snap.theme.id) return { theme: forced, preview: forced.id !== snap.resolved.id }
  return { theme: snap.theme, preview: snap.preview }
}

const ORIGINAL_DECORS = new Set<FestivalDecor>(['none', 'lantern', 'moon', 'chrysanthemum', 'firework', 'snow', 'wave', 'ray'])

export function festivalStyle(theme: FestivalTheme): CSSProperties {
  return {
    '--fx-accent': theme.palette.accent,
    '--fx-soft': theme.palette.soft,
    '--fx-glow': theme.palette.glow,
  } as CSSProperties
}

export function FestivalArt({ decor, themeId, className = '' }: { decor: FestivalDecor; themeId?: string; className?: string }) {
  const snap = useFestivalSnapshot()
  if (themeId && !ORIGINAL_DECORS.has(decor)) {
    return <EdgeArt id={themeId} side="left" year={festivalYear(snap.now || Date.now())} className={`fx-art ${className}`} preserve="xMaxYMid meet" />
  }
  if (decor === 'none') {
    return (
      <svg className={`fx-art ${className}`} viewBox="0 0 160 100" aria-hidden="true">
        <circle cx="118" cy="50" r="30" fill="var(--fx-accent)" opacity=".18" />
        <circle cx="118" cy="50" r="18" fill="var(--fx-accent)" opacity=".35" />
        <text x="118" y="57" textAnchor="middle" fontSize="18" fontWeight="900" fill="var(--fx-accent)">Pay</text>
      </svg>
    )
  }
  if (decor === 'lantern') {
    return (
      <svg className={`fx-art ${className}`} viewBox="0 0 160 100" aria-hidden="true">
        <path d="M0 6 Q80 26 160 6" stroke="#7c2d12" strokeWidth="2" fill="none" />
        {[30, 80, 130].map((x, i) => (
          <g key={x} className="fx-sway" style={{ transformOrigin: `${x}px ${12 + (i === 1 ? 6 : 0)}px`, animationDelay: `${i * -0.7}s` }}>
            <line x1={x} y1={i === 1 ? 16 : 11} x2={x} y2={i === 1 ? 26 : 21} stroke="#7c2d12" strokeWidth="1.5" />
            <rect x={x - 9} y={i === 1 ? 24 : 19} width="18" height="5" rx="2" fill="#f59e0b" />
            <ellipse cx={x} cy={i === 1 ? 46 : 41} rx="17" ry="20" fill="var(--fx-accent)" />
            <path d={`M${x - 10} ${i === 1 ? 32 : 27} Q${x} ${i === 1 ? 46 : 41} ${x - 10} ${i === 1 ? 60 : 55} M${x + 10} ${i === 1 ? 32 : 27} Q${x} ${i === 1 ? 46 : 41} ${x + 10} ${i === 1 ? 60 : 55}`} stroke="#fff" strokeOpacity=".35" fill="none" />
            <text x={x} y={i === 1 ? 51 : 46} textAnchor="middle" fontSize="13" fontWeight="900" fill="#fde68a">福</text>
            <rect x={x - 9} y={i === 1 ? 64 : 59} width="18" height="5" rx="2" fill="#f59e0b" />
            <path d={`M${x - 3} ${i === 1 ? 69 : 64} v10 M${x} ${i === 1 ? 69 : 64} v13 M${x + 3} ${i === 1 ? 69 : 64} v10`} stroke="#f59e0b" strokeWidth="1.5" />
          </g>
        ))}
      </svg>
    )
  }
  if (decor === 'moon') {
    return (
      <svg className={`fx-art ${className}`} viewBox="0 0 160 100" aria-hidden="true">
        <circle cx="110" cy="44" r="34" fill="var(--fx-glow)" opacity=".35" className="fx-pulse" />
        <circle cx="110" cy="44" r="26" fill="#fef3c7" />
        <circle cx="100" cy="36" r="4" fill="#fde68a" />
        <circle cx="118" cy="52" r="6" fill="#fde68a" />
        <circle cx="114" cy="32" r="2.5" fill="#fde68a" />
        <path d="M40 78 q12 -14 26 -4 q10 -10 22 0 q14 -6 20 6 z" fill="#fff" opacity=".85" />
        <path d="M18 60 q8 -9 18 -3 q8 -6 16 2 z" fill="#fff" opacity=".6" />
        {[[34, 24], [58, 14], [148, 20], [146, 78]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.8" fill="#fff" className="fx-twinkle" style={{ animationDelay: `${i * 0.4}s` }} />
        ))}
      </svg>
    )
  }
  if (decor === 'chrysanthemum') {
    return (
      <svg className={`fx-art ${className}`} viewBox="0 0 160 100" aria-hidden="true">
        {[[112, 46, 1], [62, 64, 0.62]].map(([cx, cy, s], f) => (
          <g key={f} transform={`translate(${cx} ${cy}) scale(${s})`} className="fx-spin-slow">
            {Array.from({ length: 16 }, (_, i) => (
              <ellipse key={i} cx="0" cy="-20" rx="5" ry="15" fill={i % 2 ? 'var(--fx-accent)' : 'var(--fx-glow)'} transform={`rotate(${i * 22.5})`} />
            ))}
            <circle r="9" fill="#a16207" />
          </g>
        ))}
        <path d="M112 74 q-6 14 -2 24 M62 80 q4 10 0 18" stroke="#4d7c0f" strokeWidth="3" fill="none" />
      </svg>
    )
  }
  if (decor === 'firework') {
    return (
      <svg className={`fx-art ${className}`} viewBox="0 0 160 100" aria-hidden="true">
        {[[110, 40, 'var(--fx-glow)', 0], [56, 30, 'var(--fx-accent)', 0.6], [140, 70, '#fb7185', 1.1]].map(([cx, cy, color, delay], b) => (
          <g key={b} transform={`translate(${cx} ${cy})`}>
            <g className="fx-burst" style={{ animationDelay: `${delay}s` }}>
              {Array.from({ length: 12 }, (_, i) => (
                <line key={i} x1="0" y1="-6" x2="0" y2="-22" stroke={color as string} strokeWidth="3" strokeLinecap="round" transform={`rotate(${i * 30})`} />
              ))}
              <circle r="3" fill="#fff" />
            </g>
          </g>
        ))}
      </svg>
    )
  }
  if (decor === 'snow') {
    return (
      <svg className={`fx-art ${className}`} viewBox="0 0 160 100" aria-hidden="true">
        <path d="M100 92 L120 30 L140 92 Z" fill="var(--fx-accent)" />
        <path d="M106 70 L120 40 L134 70 Z" fill="#22c55e" opacity=".7" />
        <rect x="116" y="92" width="8" height="8" fill="#7c2d12" />
        <path d="M120 22 l3 6 6 1 -5 4 1 6 -5 -3 -5 3 1 -6 -5 -4 6 -1z" fill="var(--fx-glow)" />
        {[[30, 0], [54, 0.8], [76, 1.6], [150, 0.4], [92, 2.2]].map(([x, delay], i) => (
          <circle key={i} cx={x} cy="10" r={i % 2 ? 2.5 : 3.5} fill="#fff" className="fx-fall" style={{ animationDelay: `${delay}s` }} />
        ))}
      </svg>
    )
  }
  if (decor === 'wave') {
    return (
      <svg className={`fx-art ${className}`} viewBox="0 0 160 100" aria-hidden="true">
        <g className="fx-bob">
          <path d="M44 62 L140 62 Q132 76 112 76 L62 76 Q48 76 44 62 Z" fill="#b45309" />
          <path d="M140 62 q10 -4 12 -16 q-8 2 -12 -4 q-2 10 -8 14 z" fill="var(--fx-accent)" />
          <circle cx="146" cy="48" r="1.8" fill="#fff" />
          {[66, 86, 106, 124].map((x) => (
            <line key={x} x1={x} y1="56" x2={x - 8} y2="78" stroke="#7c2d12" strokeWidth="2" />
          ))}
        </g>
        <path d="M0 82 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V100 H0 Z" fill="var(--fx-accent)" opacity=".75" />
        <path d="M22 30 L38 30 L30 14 Z" fill="#65a30d" stroke="#365314" strokeWidth="1.5" />
        <path d="M24 30 L36 30" stroke="#fde68a" strokeWidth="2" />
      </svg>
    )
  }
  return (
    <svg className={`fx-art ${className}`} viewBox="0 0 160 100" aria-hidden="true">
      <g transform="translate(112 50)" className="fx-spin-slow">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M-4 -24 L0 -44 L4 -24 Z" fill="var(--fx-glow)" transform={`rotate(${i * 30})`} />
        ))}
      </g>
      <circle cx="112" cy="50" r="22" fill="var(--fx-accent)" />
      <text x="112" y="58" textAnchor="middle" fontSize="22" fontWeight="900" fill="#fff">光</text>
    </svg>
  )
}

function newYearLine(theme: FestivalTheme, now: number): string | null {
  if (theme.id !== 'new-year-eve' || !now) return null
  const moment = newYearMoment(new Date(now))
  if (!moment) return null
  if (moment.kind === 'celebrate') return `${moment.year} 新年快樂！`
  const hours = Math.floor(moment.minutesLeft / 60)
  const minutes = moment.minutesLeft % 60
  return `距離 ${moment.year} 年還有 ${hours ? `${hours} 小時 ` : ''}${minutes} 分鐘（台北時間）`
}

export function FestivalBanner({ previewId, compact = false }: { previewId?: string | null; compact?: boolean }) {
  const { theme, preview } = useFestivalTheme(previewId)
  const snap = useFestivalSnapshot()
  if (compact && theme.id === 'brand') return null
  const live = newYearLine(theme, snap.now)
  return (
    <aside
      aria-label={`節慶主題：${theme.name}`}
      data-festival={theme.id}
      className={`fx-banner${compact ? ' fx-compact mt-4 md:mt-6' : ''}`}
      style={festivalStyle(theme)}
    >
      <div className="fx-copy">
        <p className="fx-eyebrow">{preview ? '主題預覽' : theme.eyebrow}</p>
        <p className="fx-title"><span className="fx-motif">{theme.motif}</span>{theme.name}</p>
        <p className="fx-text">{theme.banner}</p>
        {live ? <p className="fx-text font-bold text-[var(--fx-glow)]">{live}</p> : null}
      </div>
      <FestivalArt decor={theme.decor} themeId={theme.id} />
    </aside>
  )
}

/** 合成小舖店面的節慶掛飾。只是畫面，不擋點擊、不碰遊戲進度。 */
export function FestivalShopDecor({ previewId }: { previewId?: string | null }) {
  const { theme } = useFestivalTheme(previewId)
  if (theme.id === 'brand') return null
  return (
    <div className="ms-fest" data-festival={theme.id} style={festivalStyle(theme)} aria-hidden="true">
      <svg className="ms-fest-garland" viewBox="0 0 1200 60" preserveAspectRatio="none">
        <path d="M0 6 Q150 40 300 8 T600 8 T900 8 T1200 6" stroke="#4a2c1a" strokeWidth="3" fill="none" />
        {Array.from({ length: 13 }, (_, i) => {
          const x = 40 + i * 93
          const y = 14 + Math.abs(Math.sin((i / 12) * Math.PI * 4)) * 14
          return theme.decor === 'lantern' || theme.decor === 'moon'
            ? <g key={i} className="fx-sway" style={{ transformOrigin: `${x}px ${y - 6}px`, animationDelay: `${(i % 4) * -0.5}s` }}>
                <ellipse cx={x} cy={y + 10} rx="11" ry="13" fill={i % 2 ? 'var(--fx-accent)' : 'var(--fx-glow)'} stroke="#4a2c1a" strokeWidth="2" />
                <rect x={x - 6} y={y - 5} width="12" height="4" fill="#4a2c1a" />
              </g>
            : <path key={i} d={`M${x - 16} ${y - 4} L${x + 16} ${y - 4} L${x} ${y + 22} Z`} fill={i % 2 ? 'var(--fx-accent)' : 'var(--fx-glow)'} stroke="#4a2c1a" strokeWidth="2" />
        })}
      </svg>
      {theme.shopSign ? <span className="ms-fest-sign">{theme.shopSign}</span> : null}
      {theme.decor === 'snow' ? Array.from({ length: 10 }, (_, i) => <i key={i} className="ms-fest-flake" style={{ left: `${6 + i * 9.5}%`, animationDelay: `${i * 0.55}s` }} />) : null}
    </div>
  )
}
