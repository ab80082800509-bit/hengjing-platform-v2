/**
 * 節慶動畫素材：共用圖形定義、前景粒子、特殊動態、頂部掛飾與背景氛圍。
 * 全部只是畫面，不攔截點擊；動畫只用 transform 與 opacity。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { FestivalParticle, FestivalSpecial, FestivalTopper } from '@/lib/arcade/festival-theme'

type Vars = CSSProperties & Record<`--${string}`, string | number>

/** 依序號產生固定的亂數，伺服器與瀏覽器結果一致，不會每次重繪都跳動。 */
function rand(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

function range(i: number, salt: number, [min, max]: [number, number]): number {
  return min + rand(i, salt) * (max - min)
}

export function FestivalSprite() {
  return (
    <svg className="fa-sprite" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="fa-g-pine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22c55e" /><stop offset="1" stopColor="#14532d" /></linearGradient>
        <linearGradient id="fa-g-red" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ef4444" /><stop offset="1" stopColor="#991b1b" /></linearGradient>
        <linearGradient id="fa-g-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fef08a" /><stop offset=".5" stopColor="#f59e0b" /><stop offset="1" stopColor="#b45309" /></linearGradient>
        <linearGradient id="fa-g-shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity=".18" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".22" /></linearGradient>
        <radialGradient id="fa-g-lampglow"><stop offset="0" stopColor="#fde68a" stopOpacity=".55" /><stop offset="1" stopColor="#fde68a" stopOpacity="0" /></radialGradient>
        <radialGradient id="fa-g-pumpkinglow"><stop offset="0" stopColor="#fb923c" stopOpacity=".5" /><stop offset="1" stopColor="#fb923c" stopOpacity="0" /></radialGradient>
        <radialGradient id="fa-g-orb"><stop offset="0" stopColor="#fff" /><stop offset=".35" stopColor="currentColor" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></radialGradient>
        <radialGradient id="fa-g-moon" cx=".4" cy=".35"><stop offset="0" stopColor="#fffbeb" /><stop offset=".7" stopColor="#fde68a" /><stop offset="1" stopColor="#f59e0b" /></radialGradient>
        <linearGradient id="fa-g-skylantern" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fde68a" /><stop offset="1" stopColor="#f97316" /></linearGradient>

        <symbol id="fa-s-flake" viewBox="-12 -12 24 24">
          <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none">
            {[0, 60, 120].map((r) => <path key={r} d="M0 -11 V11 M-3 -8 L0 -5 L3 -8 M-3 8 L0 5 L3 8" transform={`rotate(${r})`} />)}
          </g>
        </symbol>
        <symbol id="fa-s-snowdot" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="url(#fa-g-orb)" /></symbol>
        <symbol id="fa-s-orb" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="url(#fa-g-orb)" /></symbol>
        <symbol id="fa-s-envelope" viewBox="0 0 24 24">
          <rect x="5" y="2" width="14" height="20" rx="2" fill="currentColor" />
          <path d="M5 7 Q12 12 19 7" stroke="#7f1d1d" strokeWidth="1" fill="none" />
          <circle cx="12" cy="10" r="3" fill="#fcd34d" />
        </symbol>
        <symbol id="fa-s-heart" viewBox="0 0 24 24"><path d="M12 21 C-2 12 4 1 12 7 C20 1 26 12 12 21 Z" fill="currentColor" /><ellipse cx="7.5" cy="8" rx="1.6" ry="2.6" fill="#fff" opacity=".45" /></symbol>
        <symbol id="fa-s-diamond" viewBox="0 0 24 24"><path d="M6 3 H18 L23 9 L12 22 L1 9 Z" fill="currentColor" /><path d="M1 9 H23 M6 3 L9 9 L12 22 L15 9 L18 3" stroke="#fff" strokeOpacity=".6" fill="none" /></symbol>
        <symbol id="fa-s-bubble" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="currentColor" fillOpacity=".18" stroke="currentColor" strokeWidth="1.2" /><ellipse cx="8" cy="7.5" rx="2.5" ry="1.6" fill="#fff" opacity=".8" transform="rotate(-30 8 7.5)" /></symbol>
        <symbol id="fa-s-drop" viewBox="0 0 24 24"><path d="M12 0 V24" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></symbol>
        <symbol id="fa-s-willow" viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="2.6" ry="10" fill="currentColor" transform="rotate(20 12 12)" /></symbol>
        <symbol id="fa-s-mote" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="url(#fa-g-orb)" /></symbol>
        <symbol id="fa-s-bokeh" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="url(#fa-g-orb)" opacity=".55" /><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth=".8" /></symbol>
        <symbol id="fa-s-petal" viewBox="0 0 24 24"><path d="M12 22 C4 18 2 10 5 4 L8 6 L10 2 L12 5 L14 2 L16 6 L19 4 C22 10 20 18 12 22 Z" fill="currentColor" /><path d="M12 21 V8" stroke="#000" strokeOpacity=".12" /></symbol>
        <symbol id="fa-s-letter" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2" fill="currentColor" /><path d="M2 6 L12 13 L22 6" stroke="#c4b5fd" strokeWidth="1.4" fill="none" /><path d="M12 16 C8 13 10 10 12 12 C14 10 16 13 12 16 Z" fill="#f43f5e" /></symbol>
        <symbol id="fa-s-bamboo" viewBox="0 0 24 24"><path d="M2 20 Q12 4 22 3 Q16 14 2 20 Z" fill="currentColor" /><path d="M3 19 L21 4" stroke="#365314" strokeOpacity=".5" /></symbol>
        <symbol id="fa-s-confetti" viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="1.5" fill="currentColor" /></symbol>
        <symbol id="fa-s-streamer" viewBox="0 0 24 24"><path d="M4 2 Q12 6 6 12 T8 22" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" /></symbol>
        <symbol id="fa-s-star4" viewBox="0 0 24 24"><path d="M12 0 Q13.6 10.4 24 12 Q13.6 13.6 12 24 Q10.4 13.6 0 12 Q10.4 10.4 12 0 Z" fill="currentColor" /></symbol>
        <symbol id="fa-s-star5" viewBox="0 0 24 24"><path d="M12 1 L15 9 L23 9 L16.5 14 L19 22 L12 17 L5 22 L7.5 14 L1 9 L9 9 Z" fill="currentColor" /></symbol>
        <symbol id="fa-s-osmanthus" viewBox="0 0 24 24">{[0, 90, 180, 270].map((r) => <ellipse key={r} cx="12" cy="6.5" rx="4.2" ry="5.5" fill="currentColor" transform={`rotate(${r} 12 12)`} />)}<circle cx="12" cy="12" r="2.4" fill="#b45309" /></symbol>
        <symbol id="fa-s-apricot" viewBox="0 0 24 24">{[0, 72, 144, 216, 288].map((r) => <circle key={r} cx="12" cy="6" r="5" fill="currentColor" transform={`rotate(${r} 12 12)`} />)}<circle cx="12" cy="12" r="2.6" fill="#f472b6" /></symbol>
        <symbol id="fa-s-chrys" viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="3.4" ry="11" fill="currentColor" /><path d="M12 3 V21" stroke="#a16207" strokeOpacity=".35" /></symbol>
        <symbol id="fa-s-bat" viewBox="0 0 48 24">
          <g className="fa-flap">
            <path d="M24 10 C18 2 10 2 2 6 C6 8 8 12 6 16 C10 13 14 14 16 18 C18 14 21 13 24 14 Z" fill="currentColor" />
            <path d="M24 10 C30 2 38 2 46 6 C42 8 40 12 42 16 C38 13 34 14 32 18 C30 14 27 13 24 14 Z" fill="currentColor" />
          </g>
          <ellipse cx="24" cy="13" rx="4" ry="5" fill="currentColor" />
          <path d="M21 8 L22 5 L23.5 8 M24.5 8 L26 5 L27 8" fill="currentColor" />
          <circle cx="22.5" cy="11.5" r=".9" fill="#fde047" /><circle cx="25.5" cy="11.5" r=".9" fill="#fde047" />
        </symbol>
        <symbol id="fa-s-ribbon" viewBox="0 0 24 24"><path d="M3 4 C10 2 14 8 9 11 C4 14 10 20 20 19" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" /></symbol>
        <symbol id="fa-s-steam" viewBox="0 0 24 24"><path d="M12 23 C6 18 18 14 12 9 C7 5 15 3 12 0" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" /></symbol>
        <symbol id="fa-s-tangyuan" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor" stroke="#000" strokeOpacity=".08" /><ellipse cx="9" cy="8.5" rx="3" ry="2" fill="#fff" opacity=".8" /></symbol>
      </defs>
    </svg>
  )
}

type Motion = 'fall' | 'rise' | 'twinkle' | 'drift'
type ParticleConf = { items: [string, string][]; motion: Motion; count: number; size: [number, number]; dur: [number, number]; spin?: boolean; opacity?: number }

const PARTICLES: Record<FestivalParticle, ParticleConf> = {
  snow: { items: [['flake', '#ffffff'], ['snowdot', '#ffffff'], ['snowdot', '#e0f2fe'], ['flake', '#e0f2fe']], motion: 'fall', count: 36, size: [7, 18], dur: [10, 20], spin: true, opacity: 0.92 },
  'red-envelope': { items: [['envelope', '#dc2626'], ['star4', '#fcd34d'], ['envelope', '#b91c1c'], ['star4', '#fde68a']], motion: 'fall', count: 20, size: [10, 22], dur: [10, 17], spin: true },
  'glow-orb': { items: [['orb', '#fdba74'], ['orb', '#fda4af'], ['orb', '#fde68a']], motion: 'rise', count: 22, size: [8, 22], dur: [14, 24], opacity: 0.85 },
  'heart-rise': { items: [['heart', '#fb7185'], ['heart', '#e11d48'], ['heart', '#fecdd3']], motion: 'rise', count: 20, size: [10, 22], dur: [12, 20], opacity: 0.85 },
  diamond: { items: [['diamond', '#f9a8d4'], ['diamond', '#fde68a'], ['star4', '#ffffff']], motion: 'fall', count: 20, size: [8, 16], dur: [10, 18], spin: true },
  'heart-white': { items: [['heart', '#f8fafc'], ['heart', '#bfdbfe'], ['star4', '#ffffff']], motion: 'fall', count: 22, size: [8, 16], dur: [11, 18], spin: true, opacity: 0.85 },
  bubble: { items: [['bubble', '#7dd3fc'], ['bubble', '#f9a8d4'], ['bubble', '#fde68a'], ['bubble', '#86efac']], motion: 'rise', count: 20, size: [12, 32], dur: [12, 20], opacity: 0.8 },
  drizzle: { items: [['drop', '#cbd5e1'], ['drop', '#e2e8f0'], ['drop', '#cbd5e1'], ['willow', '#84cc16']], motion: 'fall', count: 26, size: [12, 24], dur: [4, 7], opacity: 0.4 },
  'warm-mote': { items: [['mote', '#fbbf24'], ['mote', '#fdba74'], ['star4', '#fde68a']], motion: 'rise', count: 18, size: [5, 12], dur: [14, 22], opacity: 0.7 },
  'carnation-petal': { items: [['petal', '#f472b6'], ['petal', '#ec4899'], ['petal', '#fbcfe8'], ['heart', '#f9a8d4']], motion: 'fall', count: 26, size: [10, 20], dur: [10, 18], spin: true, opacity: 0.92 },
  'love-letter': { items: [['letter', '#ffffff'], ['heart', '#f0abfc'], ['heart', '#f472b6'], ['heart', '#c4b5fd']], motion: 'fall', count: 18, size: [10, 20], dur: [11, 18], spin: true },
  'bamboo-leaf': { items: [['bamboo', '#65a30d'], ['bamboo', '#4d7c0f'], ['bamboo', '#84cc16']], motion: 'fall', count: 16, size: [16, 28], dur: [11, 18], spin: true, opacity: 0.88 },
  'confetti-cool': { items: [['confetti', '#06b6d4'], ['confetti', '#fb923c'], ['confetti', '#ffffff'], ['confetti', '#67e8f9'], ['star4', '#fdba74']], motion: 'fall', count: 28, size: [6, 13], dur: [8, 14], spin: true },
  'star-twinkle': { items: [['star4', '#ffffff'], ['star4', '#c4b5fd'], ['star5', '#fde68a']], motion: 'twinkle', count: 32, size: [5, 13], dur: [2.5, 5] },
  'gold-bokeh': { items: [['bokeh', '#fbbf24'], ['bokeh', '#fde68a'], ['bokeh', '#93c5fd']], motion: 'rise', count: 18, size: [10, 26], dur: [16, 26], opacity: 0.55 },
  'candle-mote': { items: [['mote', '#fde68a'], ['mote', '#fcd34d']], motion: 'rise', count: 9, size: [4, 9], dur: [18, 28], opacity: 0.55 },
  streamer: { items: [['streamer', '#10b981'], ['streamer', '#fde047'], ['confetti', '#ffffff'], ['confetti', '#34d399']], motion: 'fall', count: 24, size: [8, 18], dur: [8, 14], spin: true },
  osmanthus: { items: [['osmanthus', '#fbbf24'], ['osmanthus', '#fde68a'], ['osmanthus', '#f59e0b']], motion: 'fall', count: 26, size: [6, 12], dur: [10, 18], spin: true },
  'apricot-petal': { items: [['apricot', '#fdf2f8'], ['apricot', '#fbcfe8']], motion: 'fall', count: 18, size: [8, 15], dur: [11, 18], spin: true, opacity: 0.88 },
  'sparkle-tricolor': { items: [['star4', '#f87171'], ['star4', '#93c5fd'], ['star4', '#ffffff']], motion: 'twinkle', count: 26, size: [6, 14], dur: [2, 4.5] },
  'sparkle-gold': { items: [['star4', '#fcd34d'], ['mote', '#fde68a'], ['star4', '#ffffff']], motion: 'twinkle', count: 22, size: [6, 14], dur: [2.5, 5] },
  'chrysanthemum-petal': { items: [['chrys', '#facc15'], ['chrys', '#fb923c'], ['chrys', '#fde047']], motion: 'fall', count: 20, size: [8, 16], dur: [10, 17], spin: true },
  bat: { items: [['bat', '#1c1917'], ['bat', '#3b0764'], ['bat', '#27272a']], motion: 'drift', count: 10, size: [22, 40], dur: [14, 24] },
  'confetti-hot': { items: [['confetti', '#ef4444'], ['confetti', '#facc15'], ['confetti', '#ffffff'], ['streamer', '#fb923c'], ['star4', '#fde047']], motion: 'fall', count: 34, size: [6, 14], dur: [6, 11], spin: true },
  'ribbon-curl': { items: [['ribbon', '#fb7185'], ['ribbon', '#f59e0b'], ['confetti', '#fef3c7'], ['star4', '#fde68a']], motion: 'fall', count: 22, size: [10, 20], dur: [9, 15], spin: true },
  steam: { items: [['steam', '#ffffff'], ['tangyuan', '#fbcfe8'], ['tangyuan', '#ffffff']], motion: 'rise', count: 14, size: [12, 24], dur: [12, 20], opacity: 0.55 },
  'star-glitter': { items: [['star4', '#fde047'], ['star5', '#f0abfc'], ['star4', '#ffffff']], motion: 'twinkle', count: 32, size: [6, 15], dur: [2, 4.5] },
}

export function Particles({ kind }: { kind: FestivalParticle }) {
  const conf = PARTICLES[kind]
  const ratio = kind === 'bat' ? 2 : 1
  return (
    <>
      {Array.from({ length: conf.count }, (_, i) => {
        const [shape, color] = conf.items[i % conf.items.length]
        const size = range(i, 1, conf.size)
        const dur = range(i, 2, conf.dur)
        const style: Vars = {
          left: conf.motion === 'drift' ? '0' : `${(range(i, 3, [0, 100])).toFixed(2)}%`,
          top: conf.motion === 'twinkle' || conf.motion === 'drift' ? `${range(i, 4, conf.motion === 'drift' ? [12, 60] : [6, 92]).toFixed(2)}%` : '0',
          width: `${(size * ratio).toFixed(1)}px`,
          height: `${size.toFixed(1)}px`,
          color,
          opacity: conf.opacity ?? 1,
          '--d': `${dur.toFixed(2)}s`,
          '--dl': `${(-range(i, 5, [0, dur])).toFixed(2)}s`,
          '--sw': `${range(i, 6, [-60, 60]).toFixed(0)}px`,
          '--rot': `${range(i, 7, [-540, 540]).toFixed(0)}deg`,
        }
        return (
          <span key={i} className={`fa-p fa-m-${conf.motion}${conf.spin ? ' fa-spinning' : ''}`} style={style}>
            <svg viewBox={shape === 'bat' ? '0 0 48 24' : shape === 'flake' ? '-12 -12 24 24' : '0 0 24 24'}><use href={`#fa-s-${shape}`} /></svg>
          </span>
        )
      })}
    </>
  )
}

function Burst({ colors, rays = 14 }: { colors: string[]; rays?: number }) {
  return (
    <svg viewBox="-50 -50 100 100">
      <g className="fa-burst">
        {Array.from({ length: rays }, (_, i) => (
          <g key={i} transform={`rotate(${(360 / rays) * i})`}>
            <line x1="0" y1="-10" x2="0" y2="-38" stroke={colors[i % colors.length]} strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="0" cy="-44" r="2.6" fill={colors[(i + 1) % colors.length]} />
          </g>
        ))}
        <circle r="5" fill="#fff" />
      </g>
      <g className="fa-burst-crackle">
        {Array.from({ length: 10 }, (_, i) => <circle key={i} cx={Math.cos(i * 0.63) * 30} cy={Math.sin(i * 0.63) * 30} r="1.6" fill="#fff" />)}
      </g>
    </svg>
  )
}

function Fireworks({ colors }: { colors: string[][] }) {
  const spots = [[16, 18, 150], [78, 14, 180], [46, 26, 130], [88, 34, 120], [30, 36, 110], [62, 10, 140]]
  return (
    <>
      {spots.map(([x, y, size], i) => (
        <div key={i} className="fa-firework" style={{ left: `${x}%`, top: `calc(var(--fa-top) + ${y}vh)`, width: size, height: size, '--dl': `${(i * 1.15).toFixed(2)}s` } as Vars}>
          <Burst colors={colors[i % colors.length]} />
        </div>
      ))}
    </>
  )
}

function Santa() {
  return (
    <div className="fa-fly fa-santa">
      <svg viewBox="0 0 440 150" className="fa-bob-fast">
        {[[18, 92], [40, 80], [62, 96], [30, 108], [8, 76]].map(([x, y], i) => (
          <path key={i} className="fa-twinkle" style={{ animationDelay: `${i * 0.2}s`, transformOrigin: `${x}px ${y}px` }} d={`M${x} ${y - 6} Q${x + 1} ${y - 1} ${x + 6} ${y} Q${x + 1} ${y + 1} ${x} ${y + 6} Q${x - 1} ${y + 1} ${x - 6} ${y} Q${x - 1} ${y - 1} ${x} ${y - 6} Z`} fill="#fde68a" />
        ))}
        <path d="M70 96 C120 94 170 70 260 72 M70 100 C130 100 180 84 330 76 M70 104 C140 104 200 96 400 80" stroke="#a16207" strokeWidth="1.6" fill="none" />
        {[240, 310, 380].map((x, i) => (
          <g key={x} transform={`translate(${x} ${70 - i * 4})`}>
            <g className="fa-gallop" style={{ animationDelay: `${i * -0.15}s` }}>
              <path d="M-16 8 l-8 18 M-8 9 l-2 19 M12 8 l6 18 M18 6 l12 14" stroke="#78350f" strokeWidth="4" strokeLinecap="round" />
            </g>
            <ellipse cx="0" cy="0" rx="26" ry="12" fill="#92400e" />
            <ellipse cx="-4" cy="4" rx="18" ry="6" fill="#d6a46a" opacity=".7" />
            <path d="M18 -4 q10 -14 14 -22" stroke="#92400e" strokeWidth="9" strokeLinecap="round" />
            <ellipse cx="38" cy="-28" rx="11" ry="8" fill="#92400e" />
            <circle cx="49" cy="-27" r={i === 2 ? 4.5 : 3} fill={i === 2 ? '#ef4444' : '#451a03'} className={i === 2 ? 'fa-glow' : undefined} />
            <circle cx="38" cy="-31" r="1.6" fill="#fff" />
            <path d="M32 -34 l-6 -14 l-6 4 M26 -48 l4 -6 M36 -35 l2 -16 l6 -4 M38 -51 l-4 -5" stroke="#d6b48a" strokeWidth="2.6" fill="none" strokeLinecap="round" />
            <path d="M-26 -4 q-8 -2 -10 4" stroke="#78350f" strokeWidth="4" strokeLinecap="round" />
            <rect x="8" y="-10" width="18" height="5" rx="2" fill="#dc2626" />
          </g>
        ))}
        <g transform="translate(70 70)">
          <path d="M-40 26 H80 Q96 26 98 12" stroke="#fbbf24" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M-46 34 H86 q14 0 16 -10" stroke="#fbbf24" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M-44 -6 Q-50 22 -30 24 H64 Q86 24 88 -2 L70 -2 Q66 10 54 10 H-20 Q-30 10 -28 -6 Z" fill="#dc2626" />
          <path d="M-44 -6 Q-50 22 -30 24 H64 Q86 24 88 -2" stroke="#fbbf24" strokeWidth="3" fill="none" />
          <path d="M-20 -8 q-6 -30 18 -36 q24 4 14 36 z" fill="#92400e" />
          <rect x="-14" y="-38" width="14" height="12" rx="2" fill="#16a34a" transform="rotate(-12 -7 -32)" />
          <rect x="0" y="-40" width="12" height="12" rx="2" fill="#60a5fa" transform="rotate(10 6 -34)" />
          <ellipse cx="32" cy="-6" rx="22" ry="20" fill="#dc2626" />
          <rect x="12" y="-2" width="40" height="6" fill="#1c1917" />
          <rect x="28" y="-3" width="8" height="8" fill="#fbbf24" />
          <circle cx="38" cy="-32" r="11" fill="#fcd9b8" />
          <path d="M26 -30 q12 26 26 0 q-2 14 -13 16 q-11 -2 -13 -16 z" fill="#fff" />
          <circle cx="42" cy="-35" r="1.6" fill="#1c1917" />
          <path d="M26 -38 q10 -18 26 -4 q-12 -4 -26 4 z" fill="#dc2626" />
          <path d="M50 -42 q12 -2 14 10" stroke="#dc2626" strokeWidth="6" fill="none" strokeLinecap="round" />
          <circle cx="65" cy="-30" r="4" fill="#fff" />
          <rect x="24" y="-40" width="30" height="6" rx="3" fill="#fff" />
          <path d="M50 -10 q14 -10 22 -26" stroke="#dc2626" strokeWidth="7" strokeLinecap="round" fill="none" />
          <circle cx="72" cy="-36" r="4" fill="#fff" />
        </g>
      </svg>
    </div>
  )
}

function SkyLanterns({ kind }: { kind: 'lantern' | 'heart' | 'gift' }) {
  const n = kind === 'lantern' ? 8 : 5
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const dur = range(i, 11, kind === 'lantern' ? [20, 30] : [16, 24])
        const style: Vars = {
          left: `${range(i, 12, [4, 92]).toFixed(1)}%`,
          width: `${range(i, 13, kind === 'lantern' ? [28, 54] : [36, 60]).toFixed(0)}px`,
          '--d': `${dur.toFixed(1)}s`,
          '--dl': `${(-range(i, 14, [0, dur])).toFixed(1)}s`,
        }
        return (
          <span key={i} className="fa-riser" style={style}>
            {kind === 'lantern' ? (
              <svg viewBox="0 0 40 60">
                <circle cx="20" cy="30" r="22" fill="url(#fa-g-lampglow)" />
                <path d="M8 6 H32 L36 46 Q20 52 4 46 Z" fill="url(#fa-g-skylantern)" />
                <path d="M14 8 L12 46 M26 8 L28 46" stroke="#c2410c" strokeOpacity=".35" />
                <ellipse cx="20" cy="46" rx="16" ry="4" fill="#9a3412" opacity=".4" />
                <ellipse cx="20" cy="49" rx="4" ry="3" fill="#fff7d6" className="fa-flicker" style={{ transformOrigin: '20px 50px' }} />
              </svg>
            ) : kind === 'heart' ? (
              <svg viewBox="0 0 40 80">
                <path d="M20 40 q-6 18 2 38" stroke="#fecdd3" strokeWidth="1.2" fill="none" />
                <path d="M20 40 C-4 26 4 2 20 13 C36 2 44 26 20 40 Z" fill={['#e11d48', '#fb7185', '#f43f5e'][i % 3]} />
                <ellipse cx="12" cy="14" rx="3" ry="5" fill="#fff" opacity=".45" />
              </svg>
            ) : (
              <svg viewBox="0 0 40 46">
                <rect x="6" y="16" width="28" height="26" rx="3" fill="#f8fafc" />
                <rect x="4" y="11" width="32" height="8" rx="2" fill="#e0f2fe" />
                <rect x="17" y="11" width="6" height="31" fill={['#60a5fa', '#93c5fd', '#f9a8d4'][i % 3]} />
                <path d="M20 11 c-10 -10 -16 0 -8 3 z M20 11 c10 -10 16 0 8 3 z" fill={['#60a5fa', '#93c5fd', '#f9a8d4'][i % 3]} />
              </svg>
            )}
          </span>
        )
      })}
    </>
  )
}

function Plane({ envelope = false }: { envelope?: boolean }) {
  return (
    <div className={`fa-fly fa-plane${envelope ? ' is-envelope' : ''}`}>
      {envelope ? (
        <svg viewBox="0 0 160 60">
          {[0, 1, 2].map((i) => <path key={i} className="fa-twinkle" style={{ animationDelay: `${i * 0.3}s` }} d={`M${18 + i * 22} ${36 - i * 4} C${10 + i * 22} ${30 - i * 4} ${14 + i * 22} ${24 - i * 4} ${18 + i * 22} ${29 - i * 4} C${22 + i * 22} ${24 - i * 4} ${26 + i * 22} ${30 - i * 4} ${18 + i * 22} ${36 - i * 4} Z`} fill="#f9a8d4" />)}
          <g transform="translate(96 30) rotate(-8)">
            <rect x="-30" y="-20" width="60" height="40" rx="4" fill="#fff" />
            <path d="M-30 -18 L0 4 L30 -18" stroke="#c4b5fd" strokeWidth="3" fill="none" />
            <path d="M0 14 C-12 4 -6 -6 0 0 C6 -6 12 4 0 14 Z" fill="#f43f5e" />
            <path d="M-30 -8 L-52 -20 L-40 0 Z M30 -8 L52 -20 L40 0 Z" fill="#ede9fe" />
          </g>
        </svg>
      ) : (
        <svg viewBox="0 0 160 60">
          <path d="M0 40 Q30 30 56 34" stroke="#fff" strokeOpacity=".5" strokeWidth="2" strokeDasharray="4 6" fill="none" />
          <path d="M60 30 L150 10 L96 44 Z" fill="#f8fafc" />
          <path d="M96 44 L150 10 L104 30 Z" fill="#cbd5e1" />
          <path d="M60 30 L104 30 L96 52 Z" fill="#e2e8f0" />
        </svg>
      )}
    </div>
  )
}

function DragonBoat() {
  return (
    <div className="fa-fly fa-dragonboat">
      <svg viewBox="0 0 420 120">
        <g className="fa-bob">
          <path d="M20 70 Q10 50 30 44 Q24 58 40 62" fill="#f59e0b" stroke="#b45309" strokeWidth="2" />
          <path d="M30 66 H350 Q380 66 392 52 L400 60 Q384 92 340 92 H70 Q40 92 30 66 Z" fill="#b91c1c" />
          <path d="M40 74 H340" stroke="#fbbf24" strokeWidth="3" />
          {Array.from({ length: 14 }, (_, i) => <path key={i} d={`M${56 + i * 20} 80 q10 -8 20 0`} stroke="#fde68a" strokeWidth="2" fill="none" opacity=".8" />)}
          <path d="M350 66 Q370 30 396 26 Q414 24 418 38 Q404 36 400 46 Q392 56 380 60 Z" fill="#15803d" stroke="#14532d" strokeWidth="2" />
          <path d="M396 26 l-6 -16 l10 10 M404 28 l2 -16 l4 14" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="400" cy="34" r="4" fill="#fff" /><circle cx="401" cy="34" r="2" fill="#1c1917" />
          <path d="M414 40 q-6 8 -16 6" stroke="#fde68a" strokeWidth="2" fill="none" />
          <path d="M370 46 q-6 -12 6 -18 M360 54 q-8 -10 2 -18" stroke="#fbbf24" strokeWidth="2" fill="none" />
          {[90, 130, 170, 230, 270, 310].map((x, i) => (
            <g key={x}>
              <circle cx={x} cy="44" r="7" fill="#fcd9b8" />
              <path d={`M${x - 7} 42 q7 -8 14 0`} fill="#dc2626" />
              <rect x={x - 7} y="50" width="14" height="16" rx="4" fill={i % 2 ? '#2563eb' : '#f8fafc'} />
              <g className="fa-row" style={{ transformOrigin: `${x}px 56px`, animationDelay: `${i * -0.06}s` }}>
                <path d={`M${x} 56 L${x - 22} 100`} stroke="#78350f" strokeWidth="3" strokeLinecap="round" />
                <ellipse cx={x - 23} cy="102" rx="4" ry="8" fill="#a16207" transform={`rotate(25 ${x - 23} 102)`} />
              </g>
            </g>
          ))}
          <ellipse cx="200" cy="58" rx="14" ry="10" fill="#dc2626" stroke="#fbbf24" strokeWidth="2" />
          <path d="M200 48 v-30" stroke="#78350f" strokeWidth="2" />
          <path d="M200 18 h26 l-6 8 l6 8 h-26 z" fill="#facc15" className="fa-flag" style={{ transformOrigin: '200px 26px' }} />
        </g>
        <g className="fa-wave">
          <path d="M-40 98 q20 -10 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V120 H-40 Z" fill="#0ea5e9" opacity=".55" />
          <path d="M-40 104 q20 -8 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" stroke="#e0f2fe" strokeWidth="2" fill="none" opacity=".7" />
        </g>
      </svg>
    </div>
  )
}

function CartDash() {
  return (
    <div className="fa-fly fa-cart">
      <svg viewBox="0 0 220 100">
        {[30, 46, 62].map((y, i) => <path key={y} d={`M${4 + i * 8} ${y} H${60 + i * 6}`} stroke="#a5f3fc" strokeWidth="4" strokeLinecap="round" opacity={0.8 - i * 0.2} />)}
        <path d="M70 20 h18 l14 50 h80 l14 -40 h-100" stroke="#e0f2fe" strokeWidth="6" fill="none" strokeLinejoin="round" strokeLinecap="round" />
        <rect x="108" y="8" width="30" height="26" rx="3" fill="#d6b48a" /><rect x="118" y="8" width="8" height="26" fill="#06b6d4" />
        <rect x="140" y="14" width="34" height="22" rx="3" fill="#fb923c" />
        <circle cx="114" cy="84" r="9" fill="#0e7490" stroke="#e0f2fe" strokeWidth="3" />
        <circle cx="170" cy="84" r="9" fill="#0e7490" stroke="#e0f2fe" strokeWidth="3" />
      </svg>
    </div>
  )
}

function MagpieBridge() {
  return (
    <div className="fa-bridge">
      {Array.from({ length: 11 }, (_, i) => {
        const t = i / 10
        const style: Vars = { left: `${(t * 100).toFixed(1)}%`, top: `${(Math.sin(t * Math.PI) * -60 + 60).toFixed(1)}px`, '--i': i }
        return (
          <svg key={i} className="fa-bridge-bird" style={style} viewBox="-50 -30 100 50">
            <g transform={i < 5 ? undefined : 'scale(-1 1)'}>
              <path d="M-26 6 L-46 14 L-40 4 Z" fill="#1e1b4b" />
              <ellipse cx="0" cy="0" rx="22" ry="11" fill="#1e1b4b" />
              <path d="M-6 -2 q10 12 22 4 q-6 10 -22 4 z" fill="#f8fafc" />
              <path className="fa-flap" d="M-10 -4 q10 -26 30 -20 q-12 8 -30 20 z" fill="#4338ca" />
              <circle cx="16" cy="-6" r="8" fill="#1e1b4b" />
              <path d="M23 -6 l8 2 l-8 2 z" fill="#facc15" />
            </g>
          </svg>
        )
      })}
      <span className="fa-shooting" />
    </div>
  )
}

function Geese() {
  return (
    <div className="fa-fly fa-geese">
      <svg viewBox="0 0 260 120">
        {[[200, 60], [170, 44], [140, 28], [110, 12], [170, 76], [140, 92], [110, 108]].map(([x, y], i) => (
          <g key={i} transform={`translate(${x} ${y})`}>
            <path className="fa-flap" d="M0 0 q-10 -12 -22 -10 q8 4 10 10 M0 0 q-10 12 -22 10 q8 -4 10 -10" stroke="#292524" strokeWidth="3" fill="none" strokeLinecap="round" style={{ animationDelay: `${i * -0.1}s` }} />
            <path d="M0 0 h10" stroke="#292524" strokeWidth="3" strokeLinecap="round" />
          </g>
        ))}
      </svg>
    </div>
  )
}

function Ghost() {
  return (
    <div className="fa-fly fa-ghost">
      <svg viewBox="0 0 120 140" className="fa-bob-fast">
        <path d="M20 70 Q20 10 60 10 Q100 10 100 70 V120 l-10 -10 l-10 12 l-10 -12 l-10 12 l-10 -12 l-10 12 l-10 -12 l-10 10 Z" fill="#f8fafc" opacity=".92" />
        <ellipse cx="46" cy="58" rx="6" ry="9" fill="#1c1917" /><ellipse cx="74" cy="58" rx="6" ry="9" fill="#1c1917" />
        <ellipse cx="60" cy="82" rx="8" ry="6" fill="#1c1917" />
        <ellipse cx="34" cy="74" rx="6" ry="3" fill="#fda4af" opacity=".7" /><ellipse cx="86" cy="74" rx="6" ry="3" fill="#fda4af" opacity=".7" />
        <path d="M20 80 q-14 6 -12 20 M100 80 q14 6 12 20" stroke="#f8fafc" strokeWidth="8" strokeLinecap="round" fill="none" opacity=".9" />
      </svg>
    </div>
  )
}

function BagRush() {
  const bags = [['#ef4444', '#fef08a', 22], ['#facc15', '#7f1d1d', 40], ['#fb923c', '#fff', 30]] as const
  return (
    <>
      {bags.map(([c, t, y], i) => (
        <div key={i} className="fa-fly fa-bagrush" style={{ top: `calc(var(--fa-top) + ${y}vh)`, '--dl': `${(i * 1.6).toFixed(1)}s` } as Vars}>
          <svg viewBox="0 0 180 90">
            {[30, 46, 62].map((ly, j) => <path key={ly} d={`M${j * 10} ${ly} H${70 - j * 6}`} stroke={c} strokeWidth="5" strokeLinecap="round" opacity={0.9 - j * 0.25} />)}
            <path d="M110 22 v-8 a14 14 0 0 1 28 0 v8" stroke="#18181b" strokeWidth="4" fill="none" />
            <path d="M92 22 H156 L152 86 H96 Z" fill={c} />
            <text x="124" y="64" textAnchor="middle" fontSize="20" fontWeight="900" fill={t}>11.11</text>
            <path d="M160 20 l6 -10 M166 30 l12 -4 M162 42 l12 4" stroke="#fde047" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      ))}
    </>
  )
}

function GiftPop() {
  const spots = [[18, 22], [72, 16], [46, 34]]
  return (
    <>
      {spots.map(([x, y], i) => (
        <div key={i} className="fa-giftpop" style={{ left: `${x}%`, top: `calc(var(--fa-top) + ${y}vh)`, '--dl': `${(i * 3.2).toFixed(1)}s` } as Vars}>
          <svg viewBox="-60 -70 120 130">
            <g className="fa-giftpop-confetti">
              {Array.from({ length: 12 }, (_, j) => <rect key={j} x={Math.cos(j * 0.52) * 44 - 3} y={Math.sin(j * 0.52) * 36 - 40} width="6" height="10" rx="1.5" fill={['#fb7185', '#f59e0b', '#fef3c7', '#fde68a'][j % 4]} transform={`rotate(${j * 30} ${Math.cos(j * 0.52) * 44} ${Math.sin(j * 0.52) * 36 - 35})`} />)}
            </g>
            <rect x="-24" y="-4" width="48" height="40" rx="4" fill="#f59e0b" />
            <rect x="-5" y="-4" width="10" height="40" fill="#fb7185" />
            <g className="fa-giftpop-lid">
              <rect x="-28" y="-14" width="56" height="12" rx="3" fill="#fbbf24" />
              <rect x="-5" y="-14" width="10" height="12" fill="#fb7185" />
              <path d="M0 -14 c-14 -14 -24 -2 -10 4 z M0 -14 c14 -14 24 -2 10 4 z" fill="#fb7185" />
            </g>
          </svg>
        </div>
      ))}
    </>
  )
}

function GlintPop() {
  const spots = [[12, 20], [84, 16], [30, 44], [66, 38], [50, 12], [92, 52]]
  return (
    <>
      {spots.map(([x, y], i) => (
        <svg key={i} className="fa-glint" viewBox="0 0 24 24" style={{ left: `${x}%`, top: `calc(var(--fa-top) + ${y}vh)`, '--dl': `${(i * 0.85).toFixed(2)}s`, color: i % 2 ? '#fde68a' : '#f9a8d4' } as Vars}>
          <use href="#fa-s-star4" />
        </svg>
      ))}
    </>
  )
}

function HeartBloom() {
  return (
    <>
      {Array.from({ length: 10 }, (_, i) => (
        <svg key={i} className="fa-bloom" viewBox="0 0 24 24" style={{ left: `${i < 5 ? 4 + i * 3 : 82 + (i - 5) * 3}%`, width: `${range(i, 21, [16, 30]).toFixed(0)}px`, '--dl': `${(i * 0.7).toFixed(1)}s`, '--sw': `${range(i, 22, [-40, 40]).toFixed(0)}px`, color: ['#f472b6', '#fbcfe8', '#db2777'][i % 3] } as Vars}>
          <use href="#fa-s-heart" />
        </svg>
      ))}
    </>
  )
}

function BagBounce() {
  return (
    <div className="fa-fly fa-bagbounce">
      <div className="fa-hop">
        <svg viewBox="0 0 100 110">
          <path d="M34 26 v-10 a16 16 0 0 1 32 0 v10" stroke="#065f46" strokeWidth="5" fill="none" />
          <path d="M16 26 H84 L80 104 H20 Z" fill="#10b981" />
          <path d="M16 26 H84 L80 104 H20 Z" fill="url(#fa-g-shade)" />
          <text x="50" y="74" textAnchor="middle" fontSize="26" fontWeight="900" fill="#fef9c3">9.9</text>
        </svg>
      </div>
    </div>
  )
}

export function Special({ kind }: { kind: FestivalSpecial }) {
  switch (kind) {
    case 'santa': return <Santa />
    case 'fireworks': return <Fireworks colors={[['#fde047', '#f0abfc', '#fff'], ['#60a5fa', '#a855f7', '#fde68a'], ['#f87171', '#fff', '#93c5fd']]} />
    case 'fireworks-gold': return <Fireworks colors={[['#fde047', '#f59e0b', '#fff7d6'], ['#ef4444', '#fbbf24', '#fde68a']]} />
    case 'sky-lanterns': return <SkyLanterns kind="lantern" />
    case 'heart-balloons': return <SkyLanterns kind="heart" />
    case 'gift-rise': return <SkyLanterns kind="gift" />
    case 'paper-plane': return <Plane />
    case 'envelope-plane': return <Plane envelope />
    case 'dragon-boat': return <DragonBoat />
    case 'cart-dash': return <CartDash />
    case 'magpie-bridge': return <MagpieBridge />
    case 'light-sweep': return <span className="fa-sweep" />
    case 'bag-bounce': return <BagBounce />
    case 'geese': return <Geese />
    case 'ghost-float': return <Ghost />
    case 'bag-rush': return <BagRush />
    case 'gift-pop': return <GiftPop />
    case 'glint-pop': return <GlintPop />
    case 'heart-bloom': return <HeartBloom />
    case 'cloud-drift':
    case 'sun-rays':
      return null
  }
}

export function Topper({ kind }: { kind: FestivalTopper }) {
  const width = 1600
  const step = kind === 'xmas-lights' ? 50 : kind === 'lanterns' ? 110 : 56
  const n = Math.floor(width / step)
  const sag = (x: number) => 4 + Math.abs(Math.sin((x / width) * Math.PI * 8)) * 12
  let body: ReactNode
  if (kind === 'xmas-lights') {
    body = (
      <>
        <path d={`M0 2 ${Array.from({ length: 8 }, (_, i) => `Q${i * 200 + 100} 26 ${i * 200 + 200} 2`).join(' ')}`} stroke="#14532d" strokeWidth="2.5" fill="none" />
        {Array.from({ length: n }, (_, i) => {
          const x = 25 + i * step
          const y = 2 + Math.sin(((x % 200) / 200) * Math.PI) * 12
          return (
            <g key={i}>
              <rect x={x - 3} y={y} width="6" height="5" rx="1" fill="#3f6212" />
              <ellipse cx={x} cy={y + 12} rx="5" ry="8" fill={['#ef4444', '#fde047', '#22c55e', '#60a5fa', '#f472b6'][i % 5]} className="fa-bulb" style={{ animationDelay: `${(i % 4) * 0.4}s` }} />
            </g>
          )
        })}
      </>
    )
  } else if (kind === 'lanterns') {
    body = (
      <>
        <path d={`M0 2 ${Array.from({ length: 16 }, (_, i) => `Q${i * 100 + 50} 14 ${i * 100 + 100} 2`).join(' ')}`} stroke="#7c2d12" strokeWidth="2" fill="none" />
        {Array.from({ length: n }, (_, i) => {
          const x = 55 + i * step
          return (
            <g key={i} className="fa-sway" style={{ transformOrigin: `${x}px 6px`, animationDelay: `${(i % 4) * -0.6}s` }}>
              <line x1={x} y1="6" x2={x} y2="12" stroke="#7c2d12" />
              <rect x={x - 5} y="11" width="10" height="3" fill="#f59e0b" />
              <ellipse cx={x} cy="24" rx="10" ry="11" fill="#dc2626" />
              <rect x={x - 5} y="34" width="10" height="3" fill="#f59e0b" />
              <path d={`M${x} 37 v7`} stroke="#f59e0b" strokeWidth="2" />
            </g>
          )
        })}
      </>
    )
  } else {
    const colors = kind === 'bunting' ? ['#dc2626', '#f8fafc', '#1d4ed8'] : kind === 'spooky-bunting' ? ['#f97316', '#3b0764', '#1c1917'] : ['#ef4444', '#facc15', '#fb923c']
    body = (
      <>
        <path d={`M0 3 ${Array.from({ length: 16 }, (_, i) => `Q${i * 100 + 50} 18 ${i * 100 + 100} 3`).join(' ')}`} stroke="#d4d4d8" strokeWidth="1.5" fill="none" />
        {Array.from({ length: n }, (_, i) => {
          const x = 28 + i * step
          const y = sag(x) - 2
          return (
            <g key={i} className="fa-flutter" style={{ transformOrigin: `${x}px ${y}px`, animationDelay: `${(i % 5) * -0.3}s` }}>
              <path d={`M${x - 14} ${y} L${x + 14} ${y} L${x} ${y + 24} Z`} fill={colors[i % colors.length]} />
              {kind === 'spooky-bunting' && i % 3 === 2 ? <path d={`M${x - 6} ${y + 6} q6 4 12 0 q-6 6 -12 0`} fill="#f97316" /> : null}
            </g>
          )
        })}
      </>
    )
  }
  return <svg viewBox={`0 0 ${width} 46`} preserveAspectRatio="xMidYMin slice">{body}</svg>
}

function Stars({ n = 40, salt = 1 }: { n?: number; salt?: number }) {
  return (
    <svg className="fa-bg-stars" viewBox="0 0 100 60" preserveAspectRatio="xMidYMid slice">
      {Array.from({ length: n }, (_, i) => (
        <circle key={i} className="fa-twinkle" style={{ animationDelay: `${(rand(i, salt) * 4).toFixed(2)}s` }} cx={(rand(i, salt + 1) * 100).toFixed(2)} cy={(rand(i, salt + 2) * 60).toFixed(2)} r={(0.08 + rand(i, salt + 3) * 0.16).toFixed(2)} fill="#fff" />
      ))}
    </svg>
  )
}

function Moon({ color = 'url(#fa-g-moon)', rabbit = false, className = '' }: { color?: string; rabbit?: boolean; className?: string }) {
  return (
    <svg className={`fa-bg-moon ${className}`} viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="98" fill="url(#fa-g-lampglow)" />
      <circle cx="100" cy="100" r="62" fill={color} />
      <circle cx="78" cy="84" r="9" fill="#000" opacity=".06" /><circle cx="118" cy="118" r="13" fill="#000" opacity=".06" /><circle cx="122" cy="78" r="6" fill="#000" opacity=".05" />
      {rabbit ? <path d="M92 132 q-4 -18 8 -22 q-6 -18 0 -26 q4 10 4 20 q4 -12 10 -16 q0 12 -6 20 q12 6 8 24 z" fill="#b45309" opacity=".22" /> : null}
    </svg>
  )
}

function Clouds({ color = '#e2e8f0', opacity = 0.18 }: { color?: string; opacity?: number }) {
  return (
    <>
      {[[8, 46, 0], [30, 40, -30], [18, 60, -60], [4, 52, -90]].map(([top, dur, delay], i) => (
        <svg key={i} className="fa-bg-cloud" style={{ top: `${top + i * 8}%`, animationDuration: `${dur * 2}s`, animationDelay: `${delay}s`, opacity } as Vars} viewBox="0 0 200 60">
          <path d="M20 50 q-18 0 -16 -14 q2 -14 20 -12 q4 -18 26 -18 q18 0 26 14 q10 -10 26 -4 q14 6 12 18 q18 -2 22 10 q2 8 -10 8 z" fill={color} />
          <path d="M40 40 q30 -6 60 0 t60 0" stroke="#fde68a" strokeOpacity=".25" strokeWidth="2" fill="none" />
        </svg>
      ))}
    </>
  )
}

function Hills({ color, opacity = 1, snow = false }: { color: string; opacity?: number; snow?: boolean }) {
  return (
    <svg className="fa-bg-hills" viewBox="0 0 1600 200" preserveAspectRatio="none" style={{ opacity }}>
      <path d="M0 120 Q200 60 400 110 T800 100 T1200 90 T1600 110 V200 H0 Z" fill={color} opacity=".55" />
      <path d="M0 150 Q300 100 600 140 T1200 130 T1600 150 V200 H0 Z" fill={snow ? '#f8fafc' : color} opacity={snow ? 0.85 : 0.9} />
    </svg>
  )
}

function Skyline() {
  return (
    <svg className="fa-bg-hills" viewBox="0 0 1600 200" preserveAspectRatio="none">
      <path d="M0 200 V150 h60 v-30 h40 v40 h50 v-70 h30 v-20 h20 v20 h30 v90 h60 v-50 h50 v60 h40 v-110 l20 -30 l20 30 v110 h50 v-40 h70 v50 h60 v-80 h40 v80 h60 v-60 h50 v70 h80 v-90 h30 v-40 h20 v40 h30 v90 h50 v-50 h60 v60 h50 v-70 h40 v70 h60 v-40 h80 v50 h50 v-30 h40 V200 Z" fill="#1e1b4b" opacity=".85" />
      {Array.from({ length: 40 }, (_, i) => <rect key={i} className="fa-twinkle" style={{ animationDelay: `${(rand(i, 9) * 4).toFixed(1)}s` }} x={(rand(i, 7) * 1560 + 20).toFixed(0)} y={(150 + rand(i, 8) * 40).toFixed(0)} width="4" height="5" fill="#fde68a" opacity=".7" />)}
    </svg>
  )
}

function Bokeh({ colors, n = 14 }: { colors: string[]; n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="fa-bg-bokeh" style={{ left: `${(rand(i, 31) * 100).toFixed(1)}%`, top: `${(rand(i, 32) * 100).toFixed(1)}%`, width: `${(60 + rand(i, 33) * 160).toFixed(0)}px`, background: `radial-gradient(circle, ${colors[i % colors.length]} 0%, transparent 68%)`, animationDelay: `${(-rand(i, 34) * 12).toFixed(1)}s` }} />
      ))}
    </>
  )
}

/** 背景氛圍層：放在內容後方，只在卡片之間與頁首下方透出來。 */
export function Backdrop({ id, special }: { id: string; special: FestivalSpecial | null }) {
  const extra: ReactNode[] = []
  if (special === 'sun-rays') extra.push(<div key="rays" className="fa-bg-rays" />)
  if (special === 'cloud-drift') extra.push(<Clouds key="clouds" color="#cbd5e1" opacity={0.22} />)
  switch (id) {
    case 'christmas': return <><div className="fa-bg-aurora" /><Stars n={50} /><Hills color="#1e293b" snow />{extra}</>
    case 'lunar-new-year': return <><Bokeh colors={['#fbbf24', '#f87171']} n={12} /><Clouds color="#fbbf24" opacity={0.12} />{extra}</>
    case 'lantern-festival': return <><Stars n={40} salt={3} /><Bokeh colors={['#fb923c', '#fda4af', '#fde68a']} n={16} /><Hills color="#1e1b4b" />{extra}</>
    case 'valentine': case 'day-520': return <><Bokeh colors={['#fb7185', '#f0abfc', '#fda4af']} n={16} />{extra}</>
    case 'white-day': return <><Bokeh colors={['#e0f2fe', '#bfdbfe', '#f8fafc']} n={16} /><Stars n={24} salt={5} />{extra}</>
    case 'womens-day': return <><Bokeh colors={['#f9a8d4', '#fcd34d']} n={14} />{extra}</>
    case 'childrens-day': return <><div className="fa-bg-rainbow" /><Clouds color="#f8fafc" opacity={0.16} />{extra}</>
    case 'qingming': return <><div className="fa-bg-mist" /><Hills color="#365314" opacity={0.6} />{extra}</>
    case 'labor-day': return <><Bokeh colors={['#fbbf24', '#fb923c']} n={10} />{extra}</>
    case 'mothers-day': return <><Bokeh colors={['#f9a8d4', '#fde68a', '#fbcfe8']} n={16} />{extra}</>
    case 'dragon-boat': return <><Hills color="#064e3b" opacity={0.8} /><div className="fa-bg-water" />{extra}</>
    case 'mid-year-618': return <><div className="fa-bg-streaks" />{extra}</>
    case 'qixi': return <><div className="fa-bg-milkyway" /><Stars n={70} salt={7} />{extra}</>
    case 'fathers-day': return <><div className="fa-bg-beams" /><Bokeh colors={['#fbbf24', '#60a5fa']} n={10} />{extra}</>
    case 'ghost-festival': return <><Moon className="is-pale" color="#e2e8f0" /><Stars n={24} salt={11} /><div className="fa-bg-water is-calm" />{extra}</>
    case 'double-9': return <><Bokeh colors={['#34d399', '#fde047']} n={14} />{extra}</>
    case 'mid-autumn': return <><Stars n={36} salt={13} /><Moon rabbit />{extra}<Hills color="#1e293b" /></>
    case 'teachers-day': return <><Bokeh colors={['#fcd34d', '#fbcfe8']} n={10} />{extra}</>
    case 'national-day': return <><Stars n={40} salt={17} /><Skyline />{extra}</>
    case 'retrocession': return <><div className="fa-bg-sunrise" />{extra}</>
    case 'double-ninth': return <><Moon className="is-small" /><Hills color="#44403c" opacity={0.85} />{extra}</>
    case 'halloween': return <><Stars n={30} salt={19} /><Moon className="is-orange" color="#fb923c" /><Hills color="#1c1917" />{extra}</>
    case 'double-11': return <><div className="fa-bg-speed" />{extra}</>
    case 'double-12': return <><Bokeh colors={['#fbbf24', '#fb7185']} n={16} />{extra}</>
    case 'dongzhi': return <><Bokeh colors={['#fde68a', '#fecdd3']} n={12} />{extra}</>
    case 'new-year-eve': return <><Stars n={60} salt={23} /><Skyline />{extra}</>
    default: return <>{extra}</>
  }
}
