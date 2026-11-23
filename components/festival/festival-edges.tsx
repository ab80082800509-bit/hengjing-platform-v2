/**
 * 全站節慶的畫面邊緣大型裝飾。每個節慶左右各一組專屬插畫，viewBox 皆為 220×340，底部對齊。
 * 漸層定義集中在 FestivalSprite，避免同一份 id 在隱藏區塊裡失效。
 */
import type { ReactNode } from 'react'

type Side = 'left' | 'right'

const VB = '0 0 220 340'

function sway(x: number, y: number, delay = 0, slow = false) {
  return { className: slow ? 'fa-sway-slow' : 'fa-sway', style: { transformOrigin: `${x}px ${y}px`, animationDelay: `${delay}s` } }
}

function Lantern({ x, y, r = 22, body = '#dc2626', trim = '#f59e0b', text, delay = 0, cord = 26 }: { x: number; y: number; r?: number; body?: string; trim?: string; text?: string; delay?: number; cord?: number }) {
  const top = y - r * 1.1
  return (
    <g {...sway(x, top - cord, delay)}>
      <line x1={x} y1={top - cord} x2={x} y2={top - 6} stroke="#5b2a12" strokeWidth="2" />
      <circle cx={x} cy={y} r={r * 1.9} fill="url(#fa-g-lampglow)" className="fa-glow" style={{ animationDelay: `${delay}s` }} />
      <rect x={x - r * 0.5} y={top - 7} width={r} height="7" rx="2" fill={trim} />
      <ellipse cx={x} cy={y} rx={r} ry={r * 1.1} fill={body} />
      <ellipse cx={x} cy={y} rx={r * 0.55} ry={r * 1.1} fill="none" stroke="#000" strokeOpacity=".18" strokeWidth="1.5" />
      <path d={`M${x} ${top} V${y + r * 1.1}`} stroke="#000" strokeOpacity=".15" strokeWidth="1.5" />
      <ellipse cx={x - r * 0.42} cy={y - r * 0.3} rx={r * 0.22} ry={r * 0.5} fill="#fff" opacity=".22" />
      {text ? <text x={x} y={y + r * 0.32} textAnchor="middle" fontSize={r * 0.9} fontWeight="900" fill="#fde68a">{text}</text> : null}
      <rect x={x - r * 0.5} y={y + r * 1.1} width={r} height="7" rx="2" fill={trim} />
      <path d={`M${x - 4} ${y + r * 1.1 + 7} v${r * 0.8} M${x} ${y + r * 1.1 + 7} v${r} M${x + 4} ${y + r * 1.1 + 7} v${r * 0.8}`} stroke={trim} strokeWidth="2" strokeLinecap="round" />
    </g>
  )
}

function Gift({ x, y, w, h, box, ribbon, lid }: { x: number; y: number; w: number; h: number; box: string; ribbon: string; lid?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="4" fill={box} />
      <rect x={x} y={y} width={w} height={h} rx="4" fill="url(#fa-g-shade)" />
      <rect x={x - 4} y={y - 10} width={w + 8} height="14" rx="3" fill={lid ?? box} />
      <rect x={x + w / 2 - 5} y={y - 10} width="10" height={h + 10} fill={ribbon} />
      <path d={`M${x + w / 2} ${y - 10} c-18 -18 -30 -2 -14 6 z M${x + w / 2} ${y - 10} c18 -18 30 -2 14 6 z`} fill={ribbon} stroke="#000" strokeOpacity=".15" />
      <circle cx={x + w / 2} cy={y - 10} r="5" fill={ribbon} stroke="#000" strokeOpacity=".2" />
    </g>
  )
}

function Bag({ x, y, w, h, color, handle = '#18181b', label, labelColor = '#fff' }: { x: number; y: number; w: number; h: number; color: string; handle?: string; label?: string; labelColor?: string }) {
  return (
    <g>
      <path d={`M${x + w * 0.28} ${y} v-14 a${w * 0.22} ${w * 0.22} 0 0 1 ${w * 0.44} 0 v14`} fill="none" stroke={handle} strokeWidth="5" strokeLinecap="round" />
      <path d={`M${x} ${y} H${x + w} L${x + w - 4} ${y + h} H${x + 4} Z`} fill={color} />
      <path d={`M${x} ${y} H${x + w} L${x + w - 4} ${y + h} H${x + 4} Z`} fill="url(#fa-g-shade)" />
      <path d={`M${x} ${y} H${x + w} v8 H${x} Z`} fill="#000" opacity=".12" />
      {label ? <text x={x + w / 2} y={y + h * 0.6} textAnchor="middle" fontSize={Math.min(w * 0.3, 26)} fontWeight="900" fill={labelColor}>{label}</text> : null}
    </g>
  )
}

function Balloon({ x, y, r, color, len = 70, delay = 0 }: { x: number; y: number; r: number; color: string; len?: number; delay?: number }) {
  return (
    <g className="fa-bob" style={{ animationDelay: `${delay}s` }}>
      <path d={`M${x} ${y + r * 1.15} q-8 ${len * 0.35} 4 ${len * 0.6} t-2 ${len * 0.4}`} stroke="#e5e7eb" strokeWidth="1.5" fill="none" />
      <ellipse cx={x} cy={y} rx={r} ry={r * 1.15} fill={color} />
      <ellipse cx={x - r * 0.35} cy={y - r * 0.4} rx={r * 0.22} ry={r * 0.35} fill="#fff" opacity=".45" />
      <path d={`M${x - 4} ${y + r * 1.2} h8 l-4 -6 z`} fill={color} />
    </g>
  )
}

function Heart({ x, y, s, color, className, delay = 0 }: { x: number; y: number; s: number; color: string; className?: string; delay?: number }) {
  return (
    <path
      className={className}
      style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px` }}
      d={`M${x} ${y + s * 0.9} C${x - s * 1.4} ${y - s * 0.1} ${x - s * 0.8} ${y - s * 1.1} ${x} ${y - s * 0.45} C${x + s * 0.8} ${y - s * 1.1} ${x + s * 1.4} ${y - s * 0.1} ${x} ${y + s * 0.9} Z`}
      fill={color}
    />
  )
}

function Star({ x, y, r, color, className, delay = 0 }: { x: number; y: number; r: number; color: string; className?: string; delay?: number }) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 ? r * 0.45 : r
    return `${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`
  }).join(' ')
  return <polygon className={className} style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px` }} points={pts} fill={color} />
}

function Sparkle({ x, y, r, color = '#fff', delay = 0 }: { x: number; y: number; r: number; color?: string; delay?: number }) {
  return (
    <path className="fa-twinkle" style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px` }}
      d={`M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z`}
      fill={color} />
  )
}

function Carnation({ x, y, r, color, dark }: { x: number; y: number; r: number; color: string; dark: string }) {
  return (
    <g>
      {Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2
        return <circle key={i} cx={x + Math.cos(a) * r * 0.55} cy={y + Math.sin(a) * r * 0.45} r={r * 0.55} fill={i % 2 ? color : dark} />
      })}
      <circle cx={x} cy={y - r * 0.1} r={r * 0.55} fill={color} />
      <path d={`M${x - r * 0.5} ${y - r * 0.2} q${r * 0.25} -${r * 0.25} ${r * 0.5} 0 t${r * 0.5} 0`} stroke={dark} strokeWidth="1.6" fill="none" />
      <path d={`M${x - r * 0.4} ${y + r * 0.25} q${r * 0.2} -${r * 0.2} ${r * 0.4} 0 t${r * 0.4} 0`} stroke={dark} strokeWidth="1.4" fill="none" />
    </g>
  )
}

function Rose({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={color} />
      <circle cx={x} cy={y} r={r} fill="url(#fa-g-shade)" />
      <path d={`M${x - r * 0.6} ${y} a${r * 0.6} ${r * 0.6} 0 1 1 ${r * 0.9} ${r * 0.45} M${x - r * 0.25} ${y - r * 0.1} a${r * 0.3} ${r * 0.3} 0 1 1 ${r * 0.45} ${r * 0.25}`} stroke="#000" strokeOpacity=".28" strokeWidth="1.6" fill="none" />
    </g>
  )
}

function Tree({ x, s, deco }: { x: number; s: number; deco: 'classic' | 'candy' }) {
  const t = (px: number, py: number) => `${x + (px - 110) * s},${340 - (340 - py) * s}`
  const tiers = [[60, 150, 52], [110, 215, 68], [170, 295, 84]]
  const ornaments = deco === 'classic'
    ? [[92, 138, '#dc2626'], [130, 132, '#fbbf24'], [78, 196, '#60a5fa'], [140, 190, '#dc2626'], [108, 172, '#fbbf24'], [64, 268, '#fbbf24'], [100, 250, '#dc2626'], [150, 262, '#60a5fa'], [124, 228, '#f472b6']]
    : [[96, 134, '#fff'], [126, 140, '#ef4444'], [84, 190, '#ef4444'], [134, 198, '#fff'], [70, 262, '#fff'], [112, 246, '#ef4444'], [152, 270, '#fff']]
  const lights = [[76, 150], [104, 146], [140, 152], [62, 212], [92, 206], [128, 210], [160, 214], [46, 292], [80, 286], [118, 284], [156, 290], [182, 293]]
  return (
    <g>
      <ellipse cx={x} cy={334} rx={100 * s} ry={9 * s} fill="#f8fafc" opacity=".9" />
      <rect x={x - 12 * s} y={340 - 52 * s} width={24 * s} height={46 * s} rx="3" fill="#7c4a2d" />
      {tiers.map(([top, bottom, half], i) => (
        <g key={i}>
          <path d={`M${t(110, top)} L${t(110 - half, bottom)} Q${t(110, bottom - 14)} ${t(110 + half, bottom)} Z`} fill="url(#fa-g-pine)" />
          <path d={`M${t(110 - half, bottom)} Q${t(110 - half / 2, bottom - 16)} ${t(110, bottom - 12)} T${t(110 + half, bottom)}`} stroke="#f8fafc" strokeWidth={5 * s} strokeLinecap="round" fill="none" opacity=".92" />
        </g>
      ))}
      {deco === 'classic'
        ? <path d={`M${t(80, 120)} Q${t(110, 150)} ${t(142, 130)} M${t(64, 182)} Q${t(110, 214)} ${t(160, 188)} M${t(48, 252)} Q${t(110, 290)} ${t(176, 256)}`} stroke="#fbbf24" strokeWidth={3 * s} fill="none" strokeDasharray={`${2 * s} ${5 * s}`} strokeLinecap="round" />
        : <path d={`M${t(84, 118)} L${t(140, 140)} M${t(66, 178)} L${t(162, 206)} M${t(46, 244)} L${t(180, 280)}`} stroke="#ef4444" strokeWidth={5 * s} strokeLinecap="round" opacity=".9" />}
      {ornaments.map(([ox, oy, c], i) => (
        <g key={i}>
          <circle cx={x + ((ox as number) - 110) * s} cy={340 - (340 - (oy as number)) * s} r={6.5 * s} fill={c as string} />
          <circle cx={x + ((ox as number) - 112) * s} cy={340 - (340 - (oy as number) + 2) * s} r={2 * s} fill="#fff" opacity=".7" />
        </g>
      ))}
      {lights.map(([lx, ly], i) => (
        <circle key={i} className="fa-twinkle" style={{ animationDelay: `${(i % 5) * 0.35}s` }} cx={x + (lx - 110) * s} cy={340 - (340 - ly) * s} r={3 * s}
          fill={['#fde047', '#f9a8d4', '#67e8f9', '#fef9c3'][i % 4]} />
      ))}
      <circle cx={x} cy={340 - 280 * s} r={22 * s} fill="url(#fa-g-lampglow)" className="fa-glow" />
      <Star x={x} y={340 - 282 * s} r={15 * s} color="#fde047" className="fa-pulse" />
    </g>
  )
}

function Candle({ x, y, h = 30 }: { x: number; y: number; h?: number }) {
  return (
    <g>
      <rect x={x - 4} y={y - h} width="8" height={h} rx="2" fill="#fef3c7" />
      <ellipse cx={x} cy={y - h - 8} rx="4" ry="8" fill="#fbbf24" className="fa-flicker" style={{ transformOrigin: `${x}px ${y - h}px` }} />
      <ellipse cx={x} cy={y - h - 6} rx="2" ry="4" fill="#fff7d6" />
      <circle cx={x} cy={y - h - 8} r="18" fill="url(#fa-g-lampglow)" className="fa-glow" />
    </g>
  )
}

function WaterLantern({ x, y, s = 1, delay = 0 }: { x: number; y: number; s?: number; delay?: number }) {
  return (
    <g className="fa-bob" style={{ animationDelay: `${delay}s` }}>
      <ellipse cx={x} cy={y + 6 * s} rx={46 * s} ry={7 * s} fill="#0f766e" opacity=".5" />
      {[-34, -18, 0, 18, 34].map((dx, i) => (
        <path key={i} d={`M${x + dx * s} ${y} q${-10 * s} ${-22 * s} 0 ${-42 * s + Math.abs(dx) * 0.5 * s} q${10 * s} ${22 * s} 0 ${42 * s - Math.abs(dx) * 0.5 * s}`} fill={i % 2 ? '#fbcfe8' : '#f9a8d4'} stroke="#be185d" strokeOpacity=".35" />
      ))}
      <Candle x={x} y={y - 8 * s} h={18 * s} />
    </g>
  )
}

function Pinwheel({ x, y, r, colors, delay = 0 }: { x: number; y: number; r: number; colors: string[]; delay?: number }) {
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={340} stroke="#a16207" strokeWidth="4" />
      <g className="fa-spin" style={{ transformOrigin: `${x}px ${y}px`, animationDelay: `${delay}s` }}>
        {colors.map((c, i) => (
          <path key={i} d={`M${x} ${y} L${x} ${y - r} Q${x + r * 0.9} ${y - r * 0.9} ${x + r * 0.2} ${y - r * 0.05} Z`} fill={c} transform={`rotate(${i * 90} ${x} ${y})`} />
        ))}
        <circle cx={x} cy={y} r="4" fill="#fff" />
      </g>
    </g>
  )
}

function Gear({ x, y, r, color, reverse = false }: { x: number; y: number; r: number; color: string; reverse?: boolean }) {
  return (
    <g className={reverse ? 'fa-spin-rev' : 'fa-spin'} style={{ transformOrigin: `${x}px ${y}px` }}>
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={x - r * 0.16} y={y - r * 1.18} width={r * 0.32} height={r * 0.4} rx="2" fill={color} transform={`rotate(${i * 36} ${x} ${y})`} />
      ))}
      <circle cx={x} cy={y} r={r} fill={color} />
      <circle cx={x} cy={y} r={r * 0.42} fill="#1c1917" />
      <circle cx={x} cy={y} r={r} fill="url(#fa-g-shade)" />
    </g>
  )
}

function Pumpkin({ x, y, r, face = true, delay = 0 }: { x: number; y: number; r: number; face?: boolean; delay?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r * 1.8} fill="url(#fa-g-pumpkinglow)" className="fa-glow" style={{ animationDelay: `${delay}s` }} />
      <path d={`M${x} ${y - r * 0.9} q2 -14 10 -16`} stroke="#4d7c0f" strokeWidth="5" strokeLinecap="round" fill="none" />
      <ellipse cx={x - r * 0.45} cy={y} rx={r * 0.65} ry={r * 0.85} fill="#ea580c" />
      <ellipse cx={x + r * 0.45} cy={y} rx={r * 0.65} ry={r * 0.85} fill="#ea580c" />
      <ellipse cx={x} cy={y} rx={r * 0.6} ry={r * 0.9} fill="#f97316" />
      <ellipse cx={x} cy={y} rx={r * 1.1} ry={r * 0.9} fill="url(#fa-g-shade)" />
      {face ? (
        <g className="fa-flicker-soft" style={{ animationDelay: `${delay}s` }}>
          <path d={`M${x - r * 0.55} ${y - r * 0.15} l${r * 0.18} ${-r * 0.3} l${r * 0.18} ${r * 0.3} z M${x + r * 0.2} ${y - r * 0.15} l${r * 0.18} ${-r * 0.3} l${r * 0.18} ${r * 0.3} z`} fill="#fde047" />
          <path d={`M${x - r * 0.6} ${y + r * 0.2} q${r * 0.6} ${r * 0.5} ${r * 1.2} 0 l-${r * 0.2} ${r * 0.1} l-${r * 0.15} -${r * 0.12} l-${r * 0.2} ${r * 0.14} l-${r * 0.2} -${r * 0.14} l-${r * 0.15} ${r * 0.12} z`} fill="#fde047" />
        </g>
      ) : null}
    </g>
  )
}

function Zongzi({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g>
      <path d={`M${x} ${y - 26 * s} L${x + 24 * s} ${y + 14 * s} L${x - 24 * s} ${y + 14 * s} Z`} fill="#4d7c0f" stroke="#365314" strokeWidth="2" strokeLinejoin="round" />
      <path d={`M${x} ${y - 26 * s} L${x + 6 * s} ${y + 14 * s} M${x} ${y - 26 * s} L${x - 10 * s} ${y + 14 * s}`} stroke="#65a30d" strokeWidth="2" />
      <path d={`M${x - 16 * s} ${y} H${x + 16 * s}`} stroke="#fde68a" strokeWidth={3 * s} />
    </g>
  )
}

function Sachet({ x, y, color, delay = 0 }: { x: number; y: number; color: string; delay?: number }) {
  return (
    <g {...sway(x, y - 30, delay)}>
      <line x1={x} y1={y - 30} x2={x} y2={y - 14} stroke="#b91c1c" strokeWidth="2" />
      <path d={`M${x} ${y + 16} C${x - 22} ${y} ${x - 18} ${y - 18} ${x} ${y - 10} C${x + 18} ${y - 18} ${x + 22} ${y} ${x} ${y + 16} Z`} fill={color} stroke="#fde68a" strokeWidth="2" />
      <circle cx={x} cy={y} r="4" fill="#fde68a" />
      <path d={`M${x - 3} ${y + 16} v16 M${x} ${y + 16} v20 M${x + 3} ${y + 16} v16`} stroke="#dc2626" strokeWidth="2" strokeLinecap="round" />
    </g>
  )
}

function Magpie({ x, y, s = 1, flip = false }: { x: number; y: number; s?: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <path d="M-26 6 L-46 14 L-40 4 Z" fill="#1e1b4b" />
      <ellipse cx="0" cy="0" rx="22" ry="12" fill="#1e1b4b" />
      <path d="M-6 -2 q10 12 22 4 q-6 10 -22 4 z" fill="#f8fafc" />
      <path d="M-12 -6 q14 -14 26 -4 q-10 2 -26 4 z" fill="#3730a3" />
      <circle cx="16" cy="-8" r="9" fill="#1e1b4b" />
      <circle cx="19" cy="-10" r="1.8" fill="#fff" />
      <path d="M24 -8 l9 2 l-9 2 z" fill="#facc15" />
      <path d="M2 12 l-2 8 M8 12 l2 8" stroke="#1e1b4b" strokeWidth="2" />
    </g>
  )
}

function Rabbit({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="0" rx="30" ry="24" fill="#f8fafc" />
      <circle cx="26" cy="12" r="8" fill="#f8fafc" />
      <circle cx="-14" cy="-26" r="17" fill="#f8fafc" />
      <g className="fa-ear" style={{ transformOrigin: '-18px -40px' }}>
        <ellipse cx="-24" cy="-60" rx="6" ry="20" fill="#f8fafc" transform="rotate(-12 -24 -60)" />
        <ellipse cx="-24" cy="-58" rx="3" ry="14" fill="#fbcfe8" transform="rotate(-12 -24 -58)" />
      </g>
      <ellipse cx="-8" cy="-60" rx="6" ry="20" fill="#f8fafc" transform="rotate(10 -8 -60)" />
      <ellipse cx="-8" cy="-58" rx="3" ry="14" fill="#fbcfe8" transform="rotate(10 -8 -58)" />
      <circle cx="-22" cy="-28" r="2.6" fill="#e11d48" />
      <circle cx="-30" cy="-22" r="2" fill="#fda4af" />
      <ellipse cx="-4" cy="20" rx="10" ry="5" fill="#e2e8f0" />
    </g>
  )
}

function Couplet({ x, y, chars }: { x: number; y: number; chars: string }) {
  return (
    <g>
      <rect x={x} y={y} width="38" height={chars.length * 40 + 16} rx="3" fill="url(#fa-g-red)" stroke="#fbbf24" strokeWidth="2.5" />
      <rect x={x + 4} y={y + 4} width="30" height={chars.length * 40 + 8} rx="2" fill="none" stroke="#fbbf24" strokeOpacity=".5" />
      {[...chars].map((ch, i) => (
        <text key={i} x={x + 19} y={y + 40 + i * 40} textAnchor="middle" fontSize="27" fontWeight="900" fill="#fde047" fontFamily="serif">{ch}</text>
      ))}
    </g>
  )
}

function Firecrackers({ x, y, n = 8, delay = 0 }: { x: number; y: number; n?: number; delay?: number }) {
  return (
    <g {...sway(x, y, delay)}>
      <line x1={x} y1={y} x2={x} y2={y + n * 14 + 6} stroke="#7c2d12" strokeWidth="2" />
      {Array.from({ length: n }, (_, i) => (
        <g key={i} transform={`rotate(${i % 2 ? 32 : -32} ${x} ${y + 12 + i * 14})`}>
          <rect x={x - 5} y={y + 4 + i * 14} width="10" height="18" rx="2" fill="#dc2626" />
          <rect x={x - 5} y={y + 4 + i * 14} width="10" height="3" fill="#fbbf24" />
        </g>
      ))}
    </g>
  )
}

function Book({ x, y, w, h, color }: { x: number; y: number; w: number; h: number; color: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="2" fill={color} />
      <rect x={x + 3} y={y + h - 4} width={w - 6} height="3" fill="#fef3c7" />
      <rect x={x} y={y} width={w} height={h} rx="2" fill="url(#fa-g-shade)" />
      <rect x={x + w * 0.35} y={y + 4} width={w * 0.3} height={h - 10} fill="#fde68a" opacity=".5" />
    </g>
  )
}

function Bowl({ x, y, s = 1, steam = true }: { x: number; y: number; s?: number; steam?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {steam ? [-20, 0, 20].map((dx, i) => (
        <path key={i} className="fa-steam" style={{ animationDelay: `${i * 0.9}s` }} d={`M${dx} -40 q-10 -16 0 -32 t0 -32`} stroke="#fff" strokeOpacity=".6" strokeWidth="5" strokeLinecap="round" fill="none" />
      )) : null}
      <ellipse cx="0" cy="-30" rx="60" ry="14" fill="#fde68a" />
      {[[-28, -32, '#fbcfe8'], [-6, -36, '#fff'], [16, -32, '#fda4af'], [34, -30, '#fff'], [-14, -26, '#fff'], [8, -25, '#fbcfe8']].map(([cx, cy, c], i) => (
        <circle key={i} cx={cx as number} cy={cy as number} r="9" fill={c as string} stroke="#000" strokeOpacity=".08" />
      ))}
      <path d="M-62 -30 Q-58 18 0 20 Q58 18 62 -30 Z" fill="#f8fafc" />
      <path d="M-62 -30 Q-58 18 0 20 Q58 18 62 -30 Z" fill="url(#fa-g-shade)" />
      <path d="M-50 -10 Q0 4 50 -10" stroke="#3b82f6" strokeWidth="4" fill="none" />
      <rect x="-22" y="18" width="44" height="8" rx="3" fill="#e2e8f0" />
    </g>
  )
}

function Mooncake({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      <ellipse cx={x} cy={y + r * 0.35} rx={r} ry={r * 0.45} fill="#92400e" />
      <ellipse cx={x} cy={y} rx={r} ry={r * 0.45} fill="#d97706" />
      <ellipse cx={x} cy={y} rx={r * 0.62} ry={r * 0.26} fill="none" stroke="#fde68a" strokeWidth="2" />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={r * 0.5} fontWeight="900" fill="#fde68a">福</text>
    </g>
  )
}

function Chrysanthemum({ x, y, r, color, center = '#a16207' }: { x: number; y: number; r: number; color: string; center?: string }) {
  return (
    <g>
      {Array.from({ length: 18 }, (_, i) => (
        <ellipse key={i} cx={x} cy={y - r * 0.55} rx={r * 0.17} ry={r * 0.55} fill={color} transform={`rotate(${i * 20} ${x} ${y})`} stroke="#000" strokeOpacity=".08" />
      ))}
      {Array.from({ length: 12 }, (_, i) => (
        <ellipse key={i} cx={x} cy={y - r * 0.32} rx={r * 0.13} ry={r * 0.34} fill={color} transform={`rotate(${i * 30 + 15} ${x} ${y})`} opacity=".9" />
      ))}
      <circle cx={x} cy={y} r={r * 0.2} fill={center} />
    </g>
  )
}

function Blossom({ x, y, r, color = '#fce7f3', center = '#be185d' }: { x: number; y: number; r: number; color?: string; center?: string }) {
  return (
    <g>
      {Array.from({ length: 5 }, (_, i) => (
        <circle key={i} cx={x + Math.cos((i / 5) * Math.PI * 2 - Math.PI / 2) * r * 0.62} cy={y + Math.sin((i / 5) * Math.PI * 2 - Math.PI / 2) * r * 0.62} r={r * 0.52} fill={color} />
      ))}
      <circle cx={x} cy={y} r={r * 0.28} fill={center} />
    </g>
  )
}

function NeonText({ x, y, text, size, color, className = 'fa-neon' }: { x: number; y: number; text: string; size: number; color: string; className?: string }) {
  return (
    <g className={className}>
      <text x={x} y={y} textAnchor="middle" fontSize={size} fontWeight="900" fill="none" stroke={color} strokeWidth="7" opacity=".35">{text}</text>
      <text x={x} y={y} textAnchor="middle" fontSize={size} fontWeight="900" fill="#fff" stroke={color} strokeWidth="2.5">{text}</text>
    </g>
  )
}

function Bulbs({ x, y, w, h, color = '#fde047', step = 16 }: { x: number; y: number; w: number; h: number; color?: string; step?: number }) {
  const dots: [number, number][] = []
  for (let px = x; px <= x + w; px += step) { dots.push([px, y]); dots.push([px, y + h]) }
  for (let py = y + step; py < y + h; py += step) { dots.push([x, py]); dots.push([x + w, py]) }
  return <g>{dots.map(([dx, dy], i) => <circle key={i} cx={dx} cy={dy} r="3.2" fill={color} className="fa-chase" style={{ animationDelay: `${(i % 3) * 0.3}s` }} />)}</g>
}

function WillowTree({ x, flip = false }: { x: number; flip?: boolean }) {
  const dir = flip ? -1 : 1
  return (
    <g>
      <path d={`M${x} 340 C${x + 6 * dir} 280 ${x - 8 * dir} 220 ${x + 20 * dir} 140 C${x + 30 * dir} 110 ${x + 50 * dir} 90 ${x + 80 * dir} 80`} stroke="#57534e" strokeWidth="14" fill="none" strokeLinecap="round" />
      <path d={`M${x + 16 * dir} 170 C${x + 40 * dir} 150 ${x + 60 * dir} 150 ${x + 90 * dir} 160`} stroke="#57534e" strokeWidth="7" fill="none" strokeLinecap="round" />
      {Array.from({ length: 11 }, (_, i) => {
        const bx = x + (20 + i * 9) * dir
        const by = 80 + (i % 3) * 18
        return (
          <g key={i} {...sway(bx, by, i * 0.4, true)}>
            <path d={`M${bx} ${by} q${6 * dir} 60 ${-4 * dir} ${110 + (i % 4) * 22}`} stroke="#65a30d" strokeWidth="2" fill="none" />
            {Array.from({ length: 6 }, (_, j) => (
              <ellipse key={j} cx={bx + (j % 2 ? 3 : -3) * dir} cy={by + 18 + j * 18} rx="2.6" ry="8" fill={j % 2 ? '#84cc16' : '#a3e635'} transform={`rotate(${j % 2 ? 24 : -24} ${bx} ${by + 18 + j * 18})`} opacity=".9" />
            ))}
          </g>
        )
      })}
    </g>
  )
}

function Tie({ x, y }: { x: number; y: number }) {
  return (
    <g {...sway(x, y - 30, 0, true)}>
      <path d={`M${x} ${y - 30} l-34 26 h68 z`} fill="none" stroke="#cbd5e1" strokeWidth="4" strokeLinejoin="round" />
      <path d={`M${x} ${y - 46} q10 0 6 10 l-6 6`} fill="none" stroke="#cbd5e1" strokeWidth="4" strokeLinecap="round" />
      <path d={`M${x - 10} ${y - 4} h20 l-4 12 h-12 z`} fill="#1e3a8a" />
      <path d={`M${x - 8} ${y + 8} h16 l10 96 l-18 22 l-18 -22 z`} fill="#1d4ed8" />
      {[24, 46, 68, 90].map((dy) => <path key={dy} d={`M${x - 10} ${y + dy} l20 -10`} stroke="#fbbf24" strokeWidth="4" />)}
      <path d={`M${x - 8} ${y + 8} h16 l10 96 l-18 22 l-18 -22 z`} fill="url(#fa-g-shade)" />
    </g>
  )
}

function Mug({ x, y }: { x: number; y: number }) {
  return (
    <g>
      {[0, 1].map((i) => <path key={i} className="fa-steam" style={{ animationDelay: `${i * 1.1}s` }} d={`M${x - 8 + i * 16} ${y - 8} q-8 -14 0 -28 t0 -26`} stroke="#fff" strokeOpacity=".55" strokeWidth="4" strokeLinecap="round" fill="none" />)}
      <path d={`M${x + 22} ${y + 8} a12 12 0 1 1 0 24`} stroke="#e2e8f0" strokeWidth="6" fill="none" />
      <rect x={x - 24} y={y} width="48" height="50" rx="8" fill="#f8fafc" />
      <rect x={x - 24} y={y} width="48" height="50" rx="8" fill="url(#fa-g-shade)" />
      <text x={x} y={y + 32} textAnchor="middle" fontSize="13" fontWeight="900" fill="#1d4ed8">DAD</text>
    </g>
  )
}

type EdgeSet = { left: ReactNode; right: ReactNode }

function edges(year: number): Record<string, EdgeSet> {
  return {
    christmas: {
      left: <Tree x={110} s={1} deco="classic" />,
      right: (
        <g>
          <Tree x={118} s={0.92} deco="candy" />
          <Gift x={20} y={300} w={40} h={32} box="#dc2626" ribbon="#fde047" />
          <Gift x={170} y={306} w={34} h={26} box="#16a34a" ribbon="#fecaca" />
        </g>
      ),
    },
    'lunar-new-year': {
      left: (
        <g>
          <Couplet x={22} y={96} chars="新春大吉" />
          <Lantern x={130} y={80} r={30} text="福" cord={60} />
          <g transform="rotate(45 140 250)"><rect x={104} y={214} width="72" height="72" rx="4" fill="url(#fa-g-red)" stroke="#fbbf24" strokeWidth="3" /></g>
          <text x={140} y={264} textAnchor="middle" fontSize="40" fontWeight="900" fill="#fde047" fontFamily="serif">春</text>
        </g>
      ),
      right: (
        <g>
          <Couplet x={160} y={96} chars="萬事如意" />
          <Lantern x={90} y={70} r={26} text="喜" cord={50} delay={-1.2} />
          <Firecrackers x={96} y={140} n={10} delay={-0.6} />
        </g>
      ),
    },
    'lantern-festival': {
      left: (
        <g>
          <circle cx={90} cy={250} r={80} fill="url(#fa-g-lampglow)" className="fa-glow" />
          {Array.from({ length: 8 }, (_, i) => (
            <path key={i} d="M90 260 q-18 -40 0 -76 q18 36 0 76" fill={i % 2 ? '#fbcfe8' : '#f472b6'} stroke="#be185d" strokeOpacity=".4" transform={`rotate(${(i - 3.5) * 20} 90 262)`} />
          ))}
          <ellipse cx={90} cy={266} rx={56} ry={12} fill="#4d7c0f" />
          <Candle x={90} y={250} h={16} />
          <g className="fa-bob" style={{ animationDelay: '-1s' }}>
            <ellipse cx={170} cy={300} rx={34} ry={22} fill="#f8fafc" />
            <circle cx={196} cy={286} r={14} fill="#f8fafc" />
            <ellipse cx={192} cy={262} rx={5} ry={16} fill="#f8fafc" />
            <ellipse cx={202} cy={264} rx={5} ry={16} fill="#f8fafc" />
            <circle cx={200} cy={284} r={2.5} fill="#e11d48" />
            <path d="M150 296 q20 -10 40 0" stroke="#f472b6" strokeWidth="3" fill="none" />
            <circle cx={150} cy={324} r={8} fill="#dc2626" /><circle cx={190} cy={324} r={8} fill="#dc2626" />
            <circle cx={170} cy={300} r={44} fill="url(#fa-g-lampglow)" opacity=".7" />
          </g>
        </g>
      ),
      right: (
        <g>
          <g {...sway(130, 20, -0.5, true)}>
            <line x1={130} y1={20} x2={130} y2={60} stroke="#5b2a12" strokeWidth="2" />
            <circle cx={130} cy={130} r={90} fill="url(#fa-g-lampglow)" className="fa-glow" />
            <path d="M96 64 h68 l14 22 v80 l-14 22 h-68 l-14 -22 v-80 z" fill="url(#fa-g-red)" stroke="#fbbf24" strokeWidth="3" />
            <path d="M110 64 v124 M150 64 v124" stroke="#fbbf24" strokeWidth="2" opacity=".7" />
            <rect x={100} y={96} width="60" height="54" rx="4" fill="#fde68a" opacity=".85" />
            <text x={130} y={133} textAnchor="middle" fontSize="28" fontWeight="900" fill="#b91c1c" fontFamily="serif">元宵</text>
            {[100, 115, 130, 145, 160].map((tx) => <path key={tx} d={`M${tx} 188 v26`} stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />)}
          </g>
          <Lantern x={60} y={250} r={22} body="#f97316" delay={-1.4} cord={40} />
          <Lantern x={170} y={280} r={18} body="#e11d48" delay={-0.3} cord={30} />
        </g>
      ),
    },
    valentine: {
      left: (
        <g>
          {[[78, 170, '#e11d48'], [112, 150, '#be123c'], [146, 172, '#f43f5e'], [96, 200, '#fb7185'], [132, 202, '#e11d48']].map(([x, y, c], i) => (
            <g key={i}>
              <path d={`M${x} ${(y as number) + 14} L110 300`} stroke="#15803d" strokeWidth="4" />
              <Rose x={x as number} y={y as number} r={18} color={c as string} />
            </g>
          ))}
          {[[70, 220], [150, 226], [90, 250]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="16" ry="7" fill="#22c55e" transform={`rotate(${i % 2 ? 30 : -30} ${x} ${y})`} />)}
          <path d="M58 220 L110 340 L162 220 Z" fill="#fbcfe8" />
          <path d="M58 220 L110 340 L162 220 Z" fill="url(#fa-g-shade)" />
          <path d="M84 270 q26 14 52 0 l-8 18 q-18 -8 -36 0 z" fill="#e11d48" />
          <Heart x={110} y={280} s={9} color="#fde047" />
        </g>
      ),
      right: (
        <g>
          {[[96, 70, '#e11d48', 0], [150, 110, '#fb7185', -1], [70, 140, '#f43f5e', -2]].map(([x, y, c, d], i) => (
            <g key={i} className="fa-bob" style={{ animationDelay: `${d}s` }}>
              <path d={`M${x} ${(y as number) + 26} q-10 60 ${30 - i * 10} ${240 - (y as number)}`} stroke="#fecdd3" strokeWidth="1.5" fill="none" />
              <Heart x={x as number} y={y as number} s={30} color={c as string} />
              <ellipse cx={(x as number) - 14} cy={(y as number) - 10} rx="5" ry="9" fill="#fff" opacity=".4" />
            </g>
          ))}
          <Gift x={110} y={290} w={56} h={42} box="#fda4af" ribbon="#e11d48" />
        </g>
      ),
    },
    'white-day': {
      left: (
        <g>
          <Gift x={30} y={260} w={110} h={72} box="#f8fafc" ribbon="#93c5fd" />
          <Gift x={52} y={196} w={70} h={50} box="#e0f2fe" ribbon="#60a5fa" />
          <Gift x={66} y={148} w={42} h={36} box="#f8fafc" ribbon="#bfdbfe" />
          <Sparkle x={160} y={170} r={12} delay={-0.4} />
          <Sparkle x={30} y={180} r={8} delay={-1.1} />
        </g>
      ),
      right: (
        <g>
          <path d="M80 200 h90 v120 q0 16 -16 16 h-58 q-16 0 -16 -16 z" fill="#e0f2fe" opacity=".35" stroke="#e0f2fe" strokeWidth="3" />
          <rect x={76} y={186} width="98" height="16" rx="6" fill="#bfdbfe" />
          {[[100, 300, '#fbcfe8'], [130, 312, '#fff'], [152, 296, '#bfdbfe'], [114, 276, '#fde68a'], [144, 268, '#fff'], [102, 250, '#c4b5fd'], [134, 240, '#fbcfe8']].map(([x, y, c], i) => (
            <ellipse key={i} cx={x as number} cy={y as number} rx="13" ry="9" fill={c as string} stroke="#000" strokeOpacity=".08" />
          ))}
          <path d="M60 340 q-4 -80 20 -150" stroke="#15803d" strokeWidth="4" fill="none" />
          <Rose x={80} y={180} r={16} color="#f8fafc" />
          <Sparkle x={190} y={170} r={10} delay={-0.7} />
        </g>
      ),
    },
    'womens-day': {
      left: (
        <g>
          <ellipse cx={100} cy={300} rx={84} ry={24} fill="#831843" />
          <ellipse cx={100} cy={292} rx={84} ry={24} fill="#be185d" />
          <circle cx={30} cy={300} r="6" fill="#fcd34d" /><circle cx={170} cy={300} r="6" fill="#fcd34d" />
          <g className="fa-bob">
            <path d="M44 270 L36 186 L74 222 L100 168 L126 222 L164 186 L156 270 Z" fill="url(#fa-g-gold)" stroke="#92400e" strokeWidth="2" />
            <rect x={44} y={258} width="112" height="16" rx="4" fill="#f59e0b" />
            {[[36, 186], [100, 168], [164, 186]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="7" fill="#fde68a" />)}
            <path d="M100 214 l12 16 l-12 16 l-12 -16 z" fill="#ec4899" />
            <circle cx={70} cy={246} r="6" fill="#60a5fa" /><circle cx={130} cy={246} r="6" fill="#34d399" />
          </g>
          <Sparkle x={168} y={150} r={14} color="#fde68a" />
          <Sparkle x={28} y={160} r={9} delay={-0.8} />
        </g>
      ),
      right: (
        <g>
          <Bag x={90} y={210} w={90} h={120} color="#be185d" label="♛" labelColor="#fcd34d" />
          <Bag x={40} y={250} w={70} h={82} color="#f9a8d4" handle="#831843" />
          <g>
            <rect x={150} y={276} width="40" height="56" rx="10" fill="#fce7f3" opacity=".7" stroke="#f9a8d4" strokeWidth="2" />
            <rect x={160} y={262} width="20" height="16" rx="3" fill="#fcd34d" />
            <circle cx={170} cy={304} r="10" fill="#f472b6" opacity=".6" />
          </g>
          <Sparkle x={70} y={200} r={10} color="#fde68a" delay={-1.3} />
        </g>
      ),
    },
    'childrens-day': {
      left: (
        <g>
          <Pinwheel x={60} y={170} r={34} colors={['#f43f5e', '#facc15', '#22c55e', '#3b82f6']} />
          <Pinwheel x={130} y={210} r={28} colors={['#a855f7', '#f97316', '#06b6d4', '#facc15']} delay={-0.7} />
          <Pinwheel x={180} y={250} r={22} colors={['#22c55e', '#f43f5e', '#facc15', '#3b82f6']} delay={-1.3} />
          <path d="M20 310 h180 l-14 30 h-152 z" fill="#c2410c" />
          <path d="M20 310 h180 v8 h-180 z" fill="#ea580c" />
        </g>
      ),
      right: (
        <g>
          <Balloon x={80} y={80} r={24} color="#f43f5e" len={200} />
          <Balloon x={130} y={60} r={26} color="#3b82f6" len={220} delay={-1} />
          <Balloon x={170} y={100} r={22} color="#facc15" len={180} delay={-2} />
          <Balloon x={110} y={120} r={20} color="#22c55e" len={160} delay={-1.5} />
          {[[70, 290, '#ef4444', 'A'], [116, 290, '#3b82f6', 'B'], [93, 246, '#facc15', 'C']].map(([x, y, c, t]) => (
            <g key={t as string}>
              <rect x={x as number} y={y as number} width="44" height="44" rx="6" fill={c as string} />
              <rect x={x as number} y={y as number} width="44" height="44" rx="6" fill="url(#fa-g-shade)" />
              <text x={(x as number) + 22} y={(y as number) + 31} textAnchor="middle" fontSize="24" fontWeight="900" fill="#fff">{t}</text>
            </g>
          ))}
        </g>
      ),
    },
    qingming: {
      left: <WillowTree x={40} />,
      right: (
        <g>
          <WillowTree x={190} flip />
          <path d="M0 330 q40 -14 80 -2 t80 -4 t60 0 V340 H0 Z" fill="#3f6212" opacity=".7" />
          {[30, 60, 100, 140].map((gx, i) => <path key={i} d={`M${gx} 330 q-4 -16 -10 -22 M${gx} 330 q2 -18 6 -24`} stroke="#65a30d" strokeWidth="2" fill="none" />)}
        </g>
      ),
    },
    'labor-day': {
      left: (
        <g>
          <Gear x={80} y={220} r={46} color="#a8a29e" />
          <Gear x={150} y={170} r={30} color="#fbbf24" reverse />
          <Gear x={150} y={280} r={26} color="#78716c" reverse />
          <path d="M30 330 q60 -50 120 0 z" fill="#facc15" />
          <path d="M26 330 h130 v8 h-130 z" fill="#ca8a04" />
          <path d="M90 288 q0 -18 0 -30" stroke="#ca8a04" strokeWidth="4" />
        </g>
      ),
      right: (
        <g>
          <rect x={50} y={270} width="140" height="62" rx="8" fill="#dc2626" />
          <rect x={50} y={270} width="140" height="62" rx="8" fill="url(#fa-g-shade)" />
          <path d="M96 270 v-16 h48 v16" stroke="#7f1d1d" strokeWidth="7" fill="none" />
          <rect x={50} y={292} width="140" height="6" fill="#7f1d1d" />
          <g className="fa-bob">
            <path d="M120 120 h50 v20 q0 30 -25 34 q-25 -4 -25 -34 z" fill="url(#fa-g-gold)" />
            <path d="M120 128 q-18 0 -16 16 q4 12 18 10 M170 128 q18 0 16 16 q-4 12 -18 10" stroke="#f59e0b" strokeWidth="4" fill="none" />
            <rect x={138} y={174} width="14" height="26" fill="#f59e0b" />
            <rect x={124} y={198} width="42" height="12" rx="3" fill="#92400e" />
            <Star x={145} y={146} r={10} color="#fff7d6" />
          </g>
          <path d="M40 236 l60 -10 l4 14 l-60 10 z" fill="#ea580c" />
          <text x={74} y={244} textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff" transform="rotate(-9 74 240)">辛苦了</text>
        </g>
      ),
    },
    'mothers-day': {
      left: (
        <g>
          {[[78, 150], [112, 130], [146, 152], [92, 182], [132, 184], [112, 162]].map(([x, y], i) => (
            <g key={i}>
              <path d={`M${x} ${y + 14} L110 300`} stroke="#15803d" strokeWidth="3.5" />
              <Carnation x={x} y={y} r={18} color={i % 2 ? '#f472b6' : '#ec4899'} dark={i % 2 ? '#db2777' : '#be185d'} />
            </g>
          ))}
          {[[66, 210], [154, 214], [86, 236], [136, 238]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="16" ry="5" fill="#16a34a" transform={`rotate(${i % 2 ? 36 : -36} ${x} ${y})`} />)}
          <path d="M54 214 L110 340 L166 214 Z" fill="#d6b48a" />
          <path d="M54 214 L110 340 L166 214 Z" fill="url(#fa-g-shade)" />
          <path d="M66 214 L110 330 L92 214 Z" fill="#fff" opacity=".18" />
          <path d="M80 264 q30 14 60 0 l-6 16 q-24 -8 -48 0 z" fill="#db2777" />
          <path d="M110 272 c-16 -10 -30 8 -14 16 M110 272 c16 -10 30 8 14 16" stroke="#db2777" strokeWidth="5" fill="none" />
        </g>
      ),
      right: (
        <g>
          <Gift x={70} y={244} w={110} h={88} box="#fce7f3" ribbon="#db2777" />
          <path d="M126 236 L132 150" stroke="#15803d" strokeWidth="3.5" />
          <Carnation x={132} y={140} r={20} color="#f43f5e" dark="#be123c" />
          <g {...sway(70, 200, -0.6, true)}>
            <line x1={70} y1={200} x2={70} y2={220} stroke="#a16207" strokeWidth="1.5" />
            <rect x={30} y={220} width="80" height="44" rx="6" fill="#fff7ed" stroke="#fbcfe8" strokeWidth="2" />
            <text x={70} y={248} textAnchor="middle" fontSize="15" fontWeight="900" fill="#be185d">謝謝媽媽</text>
          </g>
          <Heart x={180} y={190} s={12} color="#f9a8d4" className="fa-pulse" />
          <Heart x={40} y={170} s={9} color="#fbcfe8" className="fa-pulse" delay={-0.8} />
        </g>
      ),
    },
    'day-520': {
      left: (
        <g>
          <rect x={98} y={250} width="12" height="90" fill="#334155" />
          <g className="fa-neon">
            <path d="M104 233 C6 163 48 93 104 139 C160 93 202 163 104 233 Z" fill="#2e1065" stroke="#f0abfc" strokeWidth="5" />
            <path d="M104 233 C6 163 48 93 104 139 C160 93 202 163 104 233 Z" fill="none" stroke="#f0abfc" strokeWidth="14" opacity=".25" />
          </g>
          <NeonText x={104} y={190} text="520" size={44} color="#f472b6" />
        </g>
      ),
      right: (
        <g>
          <rect x={112} y={240} width="14" height="100" fill="#475569" />
          <path d="M70 180 h100 v70 h-100 z" fill="#8b5cf6" />
          <path d="M70 180 a50 40 0 0 1 100 0 z" fill="#a78bfa" />
          <rect x={86} y={204} width="68" height="8" rx="4" fill="#2e1065" />
          <path d="M170 196 v-36 h22 v14 h-22" fill="#f43f5e" stroke="#be123c" />
          {[[96, 168, -12], [130, 160, 8]].map(([x, y, r], i) => (
            <g key={i} transform={`rotate(${r} ${x} ${y})`}>
              <rect x={(x as number) - 22} y={(y as number) - 14} width="44" height="30" rx="3" fill="#fff" />
              <path d={`M${(x as number) - 22} ${(y as number) - 14} l22 16 l22 -16`} stroke="#c4b5fd" strokeWidth="2" fill="none" />
              <Heart x={x as number} y={(y as number) + 4} s={5} color="#f43f5e" />
            </g>
          ))}
          <Heart x={150} y={110} s={12} color="#f9a8d4" className="fa-float-up" />
          <Heart x={92} y={120} s={9} color="#f0abfc" className="fa-float-up" delay={-1.4} />
        </g>
      ),
    },
    'dragon-boat': {
      left: (
        <g>
          <path d="M40 340 V70 q0 -10 10 -10 h120" stroke="#a16207" strokeWidth="7" fill="none" strokeLinecap="round" />
          <Sachet x={80} y={110} color="#dc2626" />
          <Sachet x={120} y={130} color="#f59e0b" delay={-0.7} />
          <Sachet x={160} y={104} color="#16a34a" delay={-1.3} />
          <g {...sway(54, 340, -0.4, true)}>
            {[-14, -4, 6, 16].map((dx, i) => (
              <path key={i} d={`M${54 + dx} 340 q${dx} -90 ${dx * 2 + 10} -170`} stroke={i % 2 ? '#4d7c0f' : '#65a30d'} strokeWidth="5" fill="none" strokeLinecap="round" />
            ))}
            <rect x={36} y={280} width="36" height="10" rx="3" fill="#dc2626" />
          </g>
        </g>
      ),
      right: (
        <g>
          <ellipse cx={120} cy={316} rx={90} ry={18} fill="#a16207" />
          <ellipse cx={120} cy={308} rx={90} ry={18} fill="#ca8a04" />
          <ellipse cx={120} cy={306} rx={78} ry={13} fill="#fde68a" opacity=".5" />
          <Zongzi x={84} y={286} s={1.1} />
          <Zongzi x={136} y={290} s={1.2} />
          <Zongzi x={112} y={250} s={1.05} />
          <Sachet x={180} y={150} color="#9333ea" delay={-0.9} />
          <path d="M180 60 v60" stroke="#b91c1c" strokeWidth="2" />
        </g>
      ),
    },
    'mid-year-618': {
      left: (
        <g>
          {[[30, 270, 90, 62], [120, 280, 70, 52], [50, 214, 70, 56], [130, 232, 50, 48]].map(([x, y, w, h], i) => (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} rx="4" fill="#d6b48a" />
              <rect x={x} y={y} width={w} height={h} rx="4" fill="url(#fa-g-shade)" />
              <rect x={x + w / 2 - 7} y={y} width="14" height={h} fill="#06b6d4" opacity=".85" />
            </g>
          ))}
          <g {...sway(150, 180, 0, true)}>
            <line x1={150} y1={180} x2={150} y2={200} stroke="#0e7490" strokeWidth="2" />
            <path d="M118 200 h64 l10 18 l-10 18 h-64 z" fill="#06b6d4" />
            <circle cx={182} cy={218} r="4" fill="#ecfeff" />
            <text x={146} y={226} textAnchor="middle" fontSize="20" fontWeight="900" fill="#fff">618</text>
          </g>
        </g>
      ),
      right: (
        <g>
          <Bag x={100} y={200} w={86} h={130} color="#06b6d4" label="6.18" />
          <Bag x={44} y={240} w={70} h={92} color="#fb923c" handle="#7c2d12" />
          <Bag x={150} y={268} w={56} h={64} color="#f8fafc" handle="#0e7490" />
          <Sparkle x={60} y={200} r={10} color="#a5f3fc" />
        </g>
      ),
    },
    qixi: {
      left: (
        <g>
          <path d="M10 340 C40 280 60 220 150 170 C170 160 190 150 210 150" stroke="#44403c" strokeWidth="9" fill="none" strokeLinecap="round" />
          <path d="M80 236 q30 -40 70 -40" stroke="#44403c" strokeWidth="5" fill="none" />
          {[[56, 270], [120, 196], [176, 158], [150, 192]].map(([x, y], i) => <Blossom key={i} x={x} y={y} r={8} color="#fbcfe8" center="#db2777" />)}
          <Magpie x={92} y={222} s={1.1} />
          <Magpie x={170} y={140} s={0.95} flip />
          <Heart x={132} y={150} s={8} color="#f9a8d4" className="fa-pulse" />
        </g>
      ),
      right: (
        <g>
          {[[60, 30, 90], [120, 20, 140], [176, 30, 70]].map(([x, top, len], i) => (
            <g key={i} {...sway(x, top, -i * 0.7, true)}>
              <line x1={x} y1={top} x2={x} y2={top + len} stroke="#c4b5fd" strokeWidth="1.5" />
              <circle cx={x} cy={top + len + 16} r={30} fill="url(#fa-g-lampglow)" className="fa-glow" />
              <Star x={x} y={top + len + 16} r={20} color={['#fde68a', '#c4b5fd', '#fbcfe8'][i]} />
            </g>
          ))}
          <path d="M20 330 q90 -60 190 -20" stroke="#a5b4fc" strokeWidth="3" fill="none" strokeDasharray="2 8" strokeLinecap="round" />
          <Magpie x={110} y={286} s={0.9} />
        </g>
      ),
    },
    'fathers-day': {
      left: (
        <g>
          <path d="M100 340 V40" stroke="#78350f" strokeWidth="8" strokeLinecap="round" />
          <path d="M70 340 L100 300 L130 340" stroke="#78350f" strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M100 60 h40 M100 60 h-40" stroke="#78350f" strokeWidth="6" strokeLinecap="round" />
          <Tie x={140} y={100} />
          <g transform="translate(60 210)">
            <path d="M-22 -12 L0 0 L-22 12 Z M22 -12 L0 0 L22 12 Z" fill="#fbbf24" />
            <circle r="5" fill="#b45309" />
          </g>
          <path d="M58 60 q-6 40 2 70" stroke="#a16207" strokeWidth="2" fill="none" />
        </g>
      ),
      right: (
        <g>
          <Gift x={80} y={244} w={110} h={88} box="#1e3a8a" ribbon="#fbbf24" />
          <Mug x={50} y={282} />
          <g {...sway(150, 180, -0.4, true)}>
            <line x1={150} y1={180} x2={150} y2={196} stroke="#fbbf24" strokeWidth="1.5" />
            <rect x={106} y={196} width="88" height="40" rx="6" fill="#fef9c3" stroke="#fbbf24" strokeWidth="2" />
            <text x={150} y={222} textAnchor="middle" fontSize="15" fontWeight="900" fill="#1e3a8a">謝謝爸爸</text>
          </g>
          <Sparkle x={200} y={150} r={10} color="#fde68a" delay={-0.5} />
        </g>
      ),
    },
    'ghost-festival': {
      left: (
        <g>
          <path d="M0 312 q30 -8 60 0 t60 0 t60 0 t60 0 V340 H0 Z" fill="#134e4a" opacity=".85" />
          <path d="M0 322 q30 -6 60 0 t60 0 t60 0 t60 0" stroke="#5eead4" strokeOpacity=".3" strokeWidth="2" fill="none" className="fa-wave" />
          <WaterLantern x={70} y={310} />
          <WaterLantern x={170} y={318} s={0.75} delay={-1.6} />
        </g>
      ),
      right: (
        <g>
          <path d="M0 312 q30 -8 60 0 t60 0 t60 0 t60 0 V340 H0 Z" fill="#134e4a" opacity=".85" />
          {[170, 186, 200].map((rx, i) => <path key={i} d={`M${rx} 320 q-4 -80 6 -150`} stroke="#4d7c0f" strokeWidth="3" fill="none" />)}
          {[176, 196].map((rx) => <ellipse key={rx} cx={rx + 4} cy={170} rx="4" ry="16" fill="#78350f" />)}
          <WaterLantern x={110} y={314} s={0.9} delay={-0.8} />
        </g>
      ),
    },
    'double-9': {
      left: (
        <g>
          <Gift x={30} y={262} w={100} h={70} box="#10b981" ribbon="#fde047" />
          <Gift x={50} y={196} w={64} h={52} box="#fde047" ribbon="#059669" />
          <Gift x={136} y={286} w={56} h={46} box="#065f46" ribbon="#fde047" />
          <g {...sway(150, 220, 0, true)}>
            <line x1={150} y1={220} x2={150} y2={240} stroke="#065f46" strokeWidth="2" />
            <path d="M120 240 h60 l10 16 l-10 16 h-60 z" fill="#fde047" />
            <text x={150} y={264} textAnchor="middle" fontSize="20" fontWeight="900" fill="#065f46">9.9</text>
          </g>
        </g>
      ),
      right: (
        <g>
          <Bag x={70} y={180} w={120} h={150} color="#10b981" label="9.9" labelColor="#fef9c3" />
          <Bag x={30} y={262} w={60} h={70} color="#fde047" handle="#065f46" />
          <Sparkle x={196} y={160} r={12} color="#fef08a" />
          <Sparkle x={50} y={230} r={8} delay={-0.9} />
        </g>
      ),
    },
    'mid-autumn': {
      left: (
        <g>
          <path d="M0 320 q60 -26 120 -6 t100 -4 V340 H0 Z" fill="#334155" opacity=".9" />
          <Rabbit x={90} y={290} s={1.2} />
          <Lantern x={176} y={250} r={20} body="#f59e0b" trim="#b45309" delay={-0.6} cord={60} />
          <Sparkle x={40} y={190} r={8} color="#fef3c7" />
        </g>
      ),
      right: (
        <g>
          <path d="M210 340 C200 260 160 200 70 150" stroke="#3f3f46" strokeWidth="8" fill="none" strokeLinecap="round" />
          <path d="M150 200 q-30 -10 -50 -40" stroke="#3f3f46" strokeWidth="4" fill="none" />
          {[[90, 152], [118, 170], [150, 196], [104, 176], [70, 148], [170, 230], [128, 158]].map(([x, y], i) => (
            <g key={i}>
              <ellipse cx={x} cy={y} rx="14" ry="6" fill="#166534" transform={`rotate(${i * 40} ${x} ${y})`} />
              <circle cx={x + 6} cy={y - 6} r="3" fill="#fbbf24" /><circle cx={x - 4} cy={y + 4} r="2.4" fill="#fde68a" />
            </g>
          ))}
          <ellipse cx={90} cy={312} rx={70} ry={14} fill="#e2e8f0" />
          <Mooncake x={66} y={292} r={24} />
          <Mooncake x={116} y={296} r={22} />
        </g>
      ),
    },
    'teachers-day': {
      left: (
        <g>
          <Book x={30} y={300} w={140} h={32} color="#7c2d12" />
          <Book x={40} y={268} w={120} h={32} color="#1e3a8a" />
          <Book x={34} y={238} w={130} h={30} color="#166534" />
          <rect x={150} y={180} width="40" height="58" rx="6" fill="#57534e" />
          {[160, 170, 180].map((bx, i) => (
            <g key={i}>
              <path d={`M${bx} 182 L${bx - 6 + i * 6} 110`} stroke="#a16207" strokeWidth="4" />
              <path d={`M${bx - 6 + i * 6} 110 l-4 -16 l8 0 z`} fill="#1c1917" />
            </g>
          ))}
          <path d="M44 236 q30 -8 60 0" stroke="#fde68a" strokeWidth="2" fill="none" />
        </g>
      ),
      right: (
        <g>
          <g {...sway(120, 50, 0, true)}>
            <line x1={120} y1={30} x2={120} y2={50} stroke="#78350f" strokeWidth="2" />
            <rect x={84} y={50} width="72" height="10" rx="5" fill="#78350f" />
            <rect x={90} y={58} width="60" height="160" fill="#fef3c7" />
            <rect x={90} y={58} width="60" height="160" fill="url(#fa-g-shade)" />
            <text x={120} y={118} textAnchor="middle" fontSize="38" fontWeight="900" fill="#7c2d12" fontFamily="serif">師</text>
            <text x={120} y={168} textAnchor="middle" fontSize="38" fontWeight="900" fill="#7c2d12" fontFamily="serif">恩</text>
            <rect x={116} y={186} width="10" height="10" fill="#dc2626" />
            <rect x={84} y={216} width="72" height="10" rx="5" fill="#78350f" />
          </g>
          <path d="M210 340 C190 290 180 260 140 250" stroke="#44403c" strokeWidth="6" fill="none" strokeLinecap="round" />
          {[[150, 252], [176, 272], [192, 300], [164, 240]].map(([x, y], i) => <Blossom key={i} x={x} y={y} r={9} color="#fdf2f8" center="#f472b6" />)}
        </g>
      ),
    },
    'national-day': {
      left: (
        <g>
          <g {...sway(100, 160, 0, true)}>
            {Array.from({ length: 16 }, (_, i) => (
              <path key={i} d="M100 110 l10 -40 l10 40 z" fill={i % 2 ? '#dc2626' : '#1d4ed8'} transform={`rotate(${i * 22.5} 100 150)`} />
            ))}
            <circle cx={100} cy={150} r={40} fill="#f8fafc" />
            <circle cx={100} cy={150} r={32} fill="#dc2626" />
            <text x={100} y={160} textAnchor="middle" fontSize="26" fontWeight="900" fill="#fff">雙十</text>
            <path d="M80 186 l-16 90 l16 -10 l12 14 z" fill="#1d4ed8" />
            <path d="M120 186 l16 90 l-16 -10 l-12 14 z" fill="#dc2626" />
          </g>
        </g>
      ),
      right: (
        <g>
          {[[80, 0], [120, 1], [160, 2]].map(([x, i]) => (
            <g key={x}>
              <rect x={x - 12} y={270} width="24" height="62" rx="3" fill={['#dc2626', '#1d4ed8', '#f8fafc'][i]} />
              <rect x={x - 12} y={270} width="24" height="62" rx="3" fill="url(#fa-g-shade)" />
              {Array.from({ length: 6 }, (_, j) => (
                <circle key={j} className="fa-spark-up" style={{ animationDelay: `${(i * 0.4 + j * 0.3) % 1.8}s`, ['--sx' as string]: `${(j - 2.5) * 10}px` }} cx={x} cy={266} r="3" fill={['#fde047', '#fff', '#93c5fd'][j % 3]} />
              ))}
            </g>
          ))}
          <path d="M40 332 h160 v8 h-160 z" fill="#475569" />
        </g>
      ),
    },
    retrocession: {
      left: (
        <g>
          <path d="M10 340 C30 280 50 240 120 200 C150 186 170 170 200 150" stroke="#44403c" strokeWidth="8" fill="none" strokeLinecap="round" />
          <path d="M70 250 q-10 -40 10 -80 M140 192 q20 -30 10 -70" stroke="#44403c" strokeWidth="4" fill="none" />
          {[[60, 268], [80, 170], [110, 214], [150, 120], [176, 162], [140, 190], [40, 300]].map(([x, y], i) => <Blossom key={i} x={x} y={y} r={10} color="#fdf2f8" center="#e11d48" />)}
        </g>
      ),
      right: (
        <g>
          <g className="fa-spin-slow" style={{ transformOrigin: '120px 210px' }}>
            {Array.from({ length: 16 }, (_, i) => <path key={i} d="M116 150 L120 60 L124 150 Z" fill="#fcd34d" opacity=".55" transform={`rotate(${i * 22.5} 120 210)`} />)}
          </g>
          <circle cx={120} cy={210} r={40} fill="#fbbf24" />
          <path d="M120 140 C140 160 150 190 146 230 C142 270 128 300 108 320 C100 300 96 270 98 240 C100 200 104 170 120 140 Z" fill="#16a34a" stroke="#14532d" strokeWidth="2" />
        </g>
      ),
    },
    'double-ninth': {
      left: (
        <g>
          {[[60, 260, '#facc15'], [130, 270, '#f97316']].map(([x, y, c], i) => (
            <g key={i}>
              <path d={`M${(x as number) - 30} ${(y as number) + 20} h60 l-8 52 h-44 z`} fill="#92400e" />
              <path d={`M${(x as number) - 34} ${(y as number) + 16} h68 v10 h-68 z`} fill="#b45309" />
              <path d={`M${x} ${(y as number) + 16} v-40`} stroke="#15803d" strokeWidth="4" />
              <Chrysanthemum x={x as number} y={(y as number) - 34} r={34} color={c as string} />
              <Chrysanthemum x={(x as number) + (i ? -26 : 26)} y={(y as number) - 4} r={20} color={i ? '#fde047' : '#fb923c'} />
            </g>
          ))}
        </g>
      ),
      right: (
        <g>
          <path d="M0 340 L60 200 L100 250 L150 150 L220 260 V340 Z" fill="#57534e" opacity=".85" />
          <path d="M150 150 L170 180 L150 176 L132 186 Z" fill="#f8fafc" opacity=".6" />
          <g transform="translate(140 140)">
            <path d="M-20 0 h40 l-6 -10 h-28 z" fill="#b91c1c" />
            <path d="M-26 -10 q26 -18 52 0 z" fill="#7f1d1d" />
            <rect x="-14" y="0" width="4" height="14" fill="#7f1d1d" /><rect x="10" y="0" width="4" height="14" fill="#7f1d1d" />
          </g>
          <path d="M40 340 q10 -50 40 -80" stroke="#365314" strokeWidth="3" fill="none" />
          {[[78, 262], [70, 274], [86, 276], [60, 290]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="5" fill="#dc2626" />)}
        </g>
      ),
    },
    halloween: {
      left: (
        <g>
          <Pumpkin x={70} y={300} r={38} />
          <Pumpkin x={150} y={308} r={30} delay={-0.7} />
          <Pumpkin x={104} y={238} r={30} delay={-1.3} />
          <path d="M20 340 h190" stroke="#3b0764" strokeWidth="6" />
        </g>
      ),
      right: (
        <g>
          <path d="M150 340 C150 280 140 220 120 160 M134 230 C160 200 190 190 210 196 M126 190 C100 160 70 150 50 160 M120 160 C120 120 140 90 160 80" stroke="#1c1917" strokeWidth="10" fill="none" strokeLinecap="round" />
          <g {...sway(70, 160, 0)}>
            <line x1={70} y1={160} x2={70} y2={196} stroke="#d4d4d8" strokeWidth="1.5" />
            <path d="M54 230 q0 -34 16 -34 q16 0 16 34 l-5 -5 l-5 5 l-6 -5 l-6 5 l-5 -5 z" fill="#f8fafc" />
            <circle cx={64} cy={212} r="2.5" fill="#1c1917" /><circle cx={76} cy={212} r="2.5" fill="#1c1917" />
          </g>
          <g {...sway(186, 196, -1)}>
            <line x1={186} y1={196} x2={186} y2={230} stroke="#d4d4d8" strokeWidth="1.5" />
            <Pumpkin x={186} y={248} r={16} face />
          </g>
          <Pumpkin x={150} y={318} r={20} delay={-0.4} />
        </g>
      ),
    },
    'double-11': {
      left: (
        <g>
          <rect x={98} y={250} width="12" height="90" fill="#7f1d1d" />
          <rect x={22} y={140} width="168" height="110" rx="14" fill="#450a0a" stroke="#facc15" strokeWidth="4" />
          <Bulbs x={30} y={148} w={152} h={94} />
          <NeonText x={106} y={210} text="11.11" size={46} color="#ef4444" />
        </g>
      ),
      right: (
        <g>
          <Bag x={90} y={180} w={100} h={150} color="#ef4444" label="11.11" labelColor="#fef08a" />
          <Bag x={30} y={240} w={74} h={92} color="#facc15" handle="#7f1d1d" />
          <Gift x={150} y={296} w={52} h={36} box="#fb923c" ribbon="#fef08a" />
          {Array.from({ length: 8 }, (_, i) => <rect key={i} className="fa-twinkle" style={{ animationDelay: `${i * 0.2}s` }} x={40 + i * 20} y={150 - (i % 3) * 18} width="7" height="12" rx="1.5" fill={['#fde047', '#f87171', '#fff', '#fb923c'][i % 4]} transform={`rotate(${i * 30} ${43 + i * 20} ${156 - (i % 3) * 18})`} />)}
        </g>
      ),
    },
    'double-12': {
      left: (
        <g>
          <rect x={98} y={250} width="12" height="90" fill="#78350f" />
          <rect x={28} y={150} width="152" height="100" rx="50" fill="#451a03" stroke="#fcd34d" strokeWidth="4" />
          <Bulbs x={48} y={160} w={112} h={80} color="#fda4af" step={14} />
          <NeonText x={104} y={214} text="12.12" size={40} color="#f59e0b" />
          <path d="M104 150 c-20 -24 -40 -4 -18 4 M104 150 c20 -24 40 -4 18 4" stroke="#fb7185" strokeWidth="6" fill="none" />
        </g>
      ),
      right: (
        <g>
          <Gift x={40} y={270} w={80} h={62} box="#f59e0b" ribbon="#fb7185" />
          <Gift x={124} y={276} w={70} h={56} box="#fb7185" ribbon="#fef3c7" />
          <Gift x={78} y={208} w={72} h={50} box="#fef3c7" ribbon="#f59e0b" />
          <Gift x={98} y={156} w={40} h={36} box="#f43f5e" ribbon="#fde68a" />
          <Sparkle x={180} y={180} r={11} color="#fde68a" />
        </g>
      ),
    },
    dongzhi: {
      left: <Bowl x={104} y={300} s={1.25} />,
      right: (
        <g>
          <Bowl x={130} y={310} s={0.9} />
          <path d="M40 330 l70 -150" stroke="#78350f" strokeWidth="5" strokeLinecap="round" />
          <path d="M54 334 l72 -148" stroke="#a16207" strokeWidth="5" strokeLinecap="round" />
          <ellipse cx={60} cy={326} rx="40" ry="8" fill="#e2e8f0" />
        </g>
      ),
    },
    'new-year-eve': {
      left: (
        <g>
          <circle cx={100} cy={190} r={90} fill="url(#fa-g-lampglow)" opacity=".6" />
          <circle cx={100} cy={190} r={66} fill="#1e1b4b" stroke="url(#fa-g-gold)" strokeWidth="9" />
          {Array.from({ length: 12 }, (_, i) => <rect key={i} x={98} y={132} width="4" height={i % 3 ? 7 : 13} fill="#fde68a" transform={`rotate(${i * 30} 100 190)`} />)}
          <path d="M100 190 L100 140" stroke="#fef3c7" strokeWidth="5" strokeLinecap="round" />
          <path d="M100 190 L96 148" stroke="#fde047" strokeWidth="3" strokeLinecap="round" className="fa-tick" style={{ transformOrigin: '100px 190px' }} />
          <circle cx={100} cy={190} r={6} fill="#fde047" />
          <rect x={94} y={256} width="12" height="84" fill="#4c1d95" />
          <Sparkle x={180} y={120} r={14} color="#fde047" />
          <Sparkle x={24} y={110} r={10} delay={-0.7} />
        </g>
      ),
      right: (
        <g>
          <Balloon x={70} y={90} r={24} color="#a855f7" len={170} />
          <Balloon x={120} y={70} r={26} color="#fde047" len={190} delay={-1} />
          <Balloon x={168} y={100} r={22} color="#f0abfc" len={160} delay={-2} />
          <path d="M20 270 q100 -30 200 0 l-10 26 l10 26 q-100 -30 -200 0 l10 -26 z" fill="url(#fa-g-gold)" />
          <text x={120} y={302} textAnchor="middle" fontSize="34" fontWeight="900" fill="#4c1d95">{year}</text>
        </g>
      ),
    },
  }
}

export function EdgeArt({ id, side, year, className, preserve }: { id: string; side: Side; year: number; className?: string; preserve?: string }) {
  const set = edges(year)[id]
  if (!set) return null
  return (
    <svg className={className} viewBox={VB} preserveAspectRatio={preserve ?? (side === 'left' ? 'xMinYMax meet' : 'xMaxYMax meet')} aria-hidden="true">
      {side === 'left' ? set.left : set.right}
    </svg>
  )
}

export function hasEdgeArt(id: string): boolean {
  return id in edges(2000)
}
