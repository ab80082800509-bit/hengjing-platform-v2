// 夢想商店街的背景音樂與音效。全部由 Web Audio 即時合成，旋律、和聲與節奏皆為原創，不載入外部音檔。
// AudioContext 只在玩家點擊或按鍵時建立；音樂預設關閉，需玩家主動開啟。

export type StreetSfx = 'tap' | 'arrive' | 'serve' | 'coin' | 'make' | 'done' | 'upgrade' | 'rank' | 'miss' | 'error' | 'open'

export type StreetAudioPrefs = { music: boolean; sfx: boolean; musicVol: number; sfxVol: number }

export const DEFAULT_STREET_AUDIO: StreetAudioPrefs = { music: false, sfx: true, musicVol: 0.6, sfxVol: 0.8 }

const MUSIC_LEVEL = 0.22
const SFX_LEVEL = 0.6
const BPM = 104
const EIGHTH = 60 / BPM / 2
const SWING = 0.1

export function parseStreetAudio(raw: unknown): StreetAudioPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_STREET_AUDIO
  const src = raw as Partial<StreetAudioPrefs>
  const vol = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback)
  return {
    music: src.music === true,
    sfx: src.sfx !== false,
    musicVol: vol(src.musicVol, DEFAULT_STREET_AUDIO.musicVol),
    sfxVol: vol(src.sfxVol, DEFAULT_STREET_AUDIO.sfxVol),
  }
}

/* ---------- 樂曲：F 大調，A（8 小節）- B（8 小節）- A'（加鐘琴對位）循環，約 55 秒 ---------- */

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const midi = (name: string) => {
  const m = /^([A-G])(b|#)?(\d)$/.exec(name)
  if (!m) return null
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0)
}

type Ev = { at: number; note: number | null; len: number }
const bar = (text: string): Ev[] => {
  const out: Ev[] = []
  let at = 0
  for (const token of text.trim().split(/\s+/)) {
    const [name, len] = token.split(':')
    out.push({ at, note: name === 'r' ? null : midi(name), len: Number(len) })
    at += Number(len)
  }
  return out
}

const MELODY_A = [
  'A4:2 C5:2 F5:3 E5:1',
  'D5:2 C5:1 A4:1 F5:2 D5:2',
  'D5:3 C5:1 Bb4:2 D5:2',
  'C5:4 r:2 G4:1 A4:1',
  'A4:2 C5:2 F5:2 G5:1 A5:1',
  'G5:2 F5:1 D5:1 F5:2 A5:2',
  'G5:2 F5:2 E5:2 D5:1 E5:1',
  'F5:6 r:2',
]
const MELODY_B = [
  'D5:1 F5:1 Bb5:2 A5:1 G5:1 F5:2',
  'E5:1 G5:1 C6:2 Bb5:1 A5:1 G5:2',
  'A5:2 E5:1 C5:1 E5:2 A5:2',
  'F5:3 E5:1 D5:4',
  'Bb4:1 D5:1 G5:2 F5:1 D5:1 Bb4:2',
  'C5:1 E5:1 G5:2 A5:1 G5:1 E5:2',
  'F5:2 A5:2 G5:1 F5:1 D5:1 C5:1',
  'E5:2 G5:2 C5:2 r:2',
]
// 每小節兩個半小節和弦：[根音, 和弦音...]
const CHORDS: Record<string, number[]> = {
  F: [41, 65, 69, 72],
  Dm: [38, 62, 65, 69],
  Bb: [46, 62, 65, 70],
  C: [48, 64, 67, 72],
  Am: [45, 64, 69, 72],
  Gm: [43, 62, 67, 70],
}
const HARMONY_A = ['F F', 'Dm Dm', 'Bb Bb', 'C C', 'F F', 'Dm Dm', 'Bb C', 'F F']
const HARMONY_B = ['Bb Bb', 'C C', 'Am Am', 'Dm Dm', 'Gm Gm', 'C C', 'F Dm', 'C C']

type Bar = { melody: Ev[]; chords: [string, string]; bell: boolean; fill: boolean }
const SONG: Bar[] = [
  ...MELODY_A.map((m, i) => ({ melody: bar(m), chords: HARMONY_A[i].split(' ') as [string, string], bell: false, fill: i === 7 })),
  ...MELODY_B.map((m, i) => ({ melody: bar(m), chords: HARMONY_B[i].split(' ') as [string, string], bell: false, fill: i === 7 })),
  ...MELODY_A.map((m, i) => ({ melody: bar(m), chords: HARMONY_A[i].split(' ') as [string, string], bell: true, fill: i === 7 })),
]

const hz = (note: number) => 440 * 2 ** ((note - 69) / 12)

type ToneOptions = { type?: OscillatorType; gain?: number; to?: number; attack?: number; lowpass?: number; detune?: number }

export class StreetAudio {
  prefs: StreetAudioPrefs
  private ctx: AudioContext | null = null
  private sfxBus: GainNode | null = null
  private musicBus: GainNode | null = null
  private noise: AudioBuffer | null = null
  private timer: number | null = null
  private bar = 0
  private step = 0
  private nextAt = 0
  private lastCoin = 0
  private hidden = false
  private disposed = false

  constructor(prefs: StreetAudioPrefs) {
    this.prefs = prefs
  }

  get musicPlaying() {
    return this.timer != null
  }

  /** 只能在玩家操作的事件裡呼叫。 */
  unlock() {
    if (typeof window === 'undefined' || this.hidden || this.disposed) return
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      const master = ctx.createGain()
      master.gain.value = 0.9
      const limiter = ctx.createDynamicsCompressor()
      master.connect(limiter)
      limiter.connect(ctx.destination)
      this.sfxBus = ctx.createGain()
      this.sfxBus.gain.value = SFX_LEVEL * this.prefs.sfxVol
      this.sfxBus.connect(master)
      this.musicBus = ctx.createGain()
      this.musicBus.gain.value = 0
      this.musicBus.connect(master)
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
      this.noise = buffer
      this.ctx = ctx
    }
    if (this.ctx.state === 'running') this.syncMusic()
    else void this.ctx.resume().then(() => this.syncMusic(), () => undefined)
  }

  setPrefs(next: StreetAudioPrefs) {
    this.prefs = next
    const ctx = this.ctx
    if (ctx && this.sfxBus) this.sfxBus.gain.setTargetAtTime(SFX_LEVEL * next.sfxVol, ctx.currentTime, 0.05)
    if (ctx && this.musicBus && this.timer != null) this.musicBus.gain.setTargetAtTime(MUSIC_LEVEL * next.musicVol, ctx.currentTime, 0.08)
    this.syncMusic()
  }

  setHidden(hidden: boolean) {
    this.hidden = hidden
    if (!this.ctx) return
    if (hidden) {
      this.stopMusic()
      void this.ctx.suspend().catch(() => undefined)
    } else {
      void this.ctx.resume().then(() => this.syncMusic(), () => undefined)
    }
  }

  dispose() {
    this.disposed = true
    this.stopMusic()
    const ctx = this.ctx
    this.ctx = null
    this.sfxBus = null
    this.musicBus = null
    void ctx?.close().catch(() => undefined)
  }

  play(name: StreetSfx) {
    const ctx = this.ctx
    const bus = this.sfxBus
    if (!this.prefs.sfx || !ctx || !bus || ctx.state !== 'running') return
    const t = ctx.currentTime + 0.005
    switch (name) {
      case 'tap':
        this.tone(bus, 990, t, 0.05, { to: 1400, gain: 0.1 })
        break
      case 'open':
        ;[65, 69, 72, 77].forEach((n, i) => this.pluck(bus, n, t + i * 0.07, 0.22, 0.4))
        break
      case 'arrive':
        // 門鈴：叮—咚
        this.bell(bus, 88, t, 0.16, 1.1)
        this.bell(bus, 84, t + 0.22, 0.14, 1.3)
        break
      case 'make':
        this.hit(bus, t, 0.08, 1200, 1.5, 0.18)
        this.tone(bus, 330, t, 0.12, { type: 'triangle', to: 520, gain: 0.12 })
        break
      case 'done':
        this.bell(bus, 93, t, 0.12, 0.7)
        this.bell(bus, 93, t + 0.12, 0.08, 0.6)
        break
      case 'serve':
        ;[72, 76, 79, 84].forEach((n, i) => this.pluck(bus, n, t + i * 0.075, 0.24, 0.45))
        this.bell(bus, 91, t + 0.32, 0.1, 0.8)
        break
      case 'coin': {
        if (t - this.lastCoin < 0.05) return
        this.lastCoin = t
        this.tone(bus, 1976, t, 0.06, { type: 'square', gain: 0.04, lowpass: 5200 })
        this.tone(bus, 2637, t + 0.055, 0.22, { type: 'square', gain: 0.04, lowpass: 5200 })
        break
      }
      case 'upgrade':
        ;[65, 69, 72].forEach((n, i) => this.pluck(bus, n, t + i * 0.11, 0.26, 0.3))
        ;[65, 72, 77, 81].forEach((n) => this.tone(bus, hz(n), t + 0.36, 1.3, { type: 'triangle', gain: 0.09, attack: 0.02 }))
        this.tone(bus, hz(41), t + 0.36, 1.3, { gain: 0.26, attack: 0.02 })
        ;[89, 93, 96, 101].forEach((n, i) => this.bell(bus, n, t + 0.5 + i * 0.07, 0.07, 0.6))
        break
      case 'rank':
        ;[77, 81, 84, 89].forEach((n, i) => this.bell(bus, n, t + i * 0.09, 0.1, 0.7))
        break
      case 'miss':
        this.tone(bus, hz(67), t, 0.25, { type: 'triangle', to: hz(62), gain: 0.12 })
        this.tone(bus, hz(62), t + 0.22, 0.35, { type: 'triangle', to: hz(58), gain: 0.1 })
        break
      case 'error':
        this.tone(bus, 220, t, 0.12, { type: 'square', to: 180, gain: 0.045, lowpass: 1200 })
        this.tone(bus, 196, t + 0.13, 0.16, { type: 'square', to: 150, gain: 0.045, lowpass: 1200 })
        break
    }
  }

  private syncMusic() {
    if (this.prefs.music && this.ctx?.state === 'running' && !this.hidden && !this.disposed) this.startMusic()
    else this.stopMusic()
  }

  private startMusic() {
    const ctx = this.ctx
    const bus = this.musicBus
    if (!ctx || !bus || this.timer != null) return
    bus.gain.cancelScheduledValues(ctx.currentTime)
    bus.gain.setTargetAtTime(MUSIC_LEVEL * this.prefs.musicVol, ctx.currentTime, 0.5)
    this.bar = 0
    this.step = 0
    this.nextAt = ctx.currentTime + 0.12
    this.timer = window.setInterval(() => this.schedule(), 60)
    this.schedule()
  }

  private stopMusic() {
    if (this.timer != null) window.clearInterval(this.timer)
    this.timer = null
    const ctx = this.ctx
    if (ctx && this.musicBus) {
      this.musicBus.gain.cancelScheduledValues(ctx.currentTime)
      this.musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.12)
    }
  }

  private schedule() {
    const ctx = this.ctx
    const bus = this.musicBus
    if (!ctx || !bus) return
    while (this.nextAt < ctx.currentTime + 0.4) {
      const b = SONG[this.bar]
      const s = this.step
      const at = this.nextAt + (s % 2 === 1 ? EIGHTH * SWING : 0)
      const chord = CHORDS[b.chords[s < 4 ? 0 : 1]]

      for (const ev of b.melody) {
        if (ev.at === s && ev.note != null) this.lead(bus, ev.note, at, ev.len * EIGHTH)
      }
      // 低音：一拍根音、三拍五度，第 8 格接經過音。
      if (s === 0 || s === 4) this.bass(bus, chord[0], at, EIGHTH * 2.6)
      if (s === 2 || s === 6) this.bass(bus, chord[0] + 7, at, EIGHTH * 1.4)
      // 鋼琴式和弦反拍
      if (s === 1 || s === 3 || s === 5 || s === 7) chord.slice(1).forEach((n) => this.keys(bus, n - 12, at, EIGHTH * 0.9))
      // 柔和的長音墊底
      if (s === 0 || s === 4) chord.slice(1).forEach((n) => this.pad(bus, n, at, EIGHTH * 4))
      // A' 段加鐘琴分解和弦
      if (b.bell && s % 2 === 1) this.bell(bus, chord[1 + ((s >> 1) % 3)] + 24, at, 0.05, 0.5)
      // 鼓組：大鼓 1、3 拍，拍手 2、4 拍，沙鈴每個八分音符
      if (s === 0 || s === 4) this.kick(bus, at)
      if (s === 2 || s === 6) this.hit(bus, at, 0.09, 1800, 1.2, 0.2)
      this.hit(bus, at, 0.035, 7000, 1.2, s % 2 === 1 ? 0.09 : 0.05)
      if (b.fill && s >= 5) this.hit(bus, at + EIGHTH / 2, 0.05, 2400, 2, 0.12)

      this.step = (s + 1) % 8
      if (this.step === 0) this.bar = (this.bar + 1) % SONG.length
      this.nextAt += EIGHTH
    }
  }

  private lead(bus: AudioNode, note: number, at: number, dur: number) {
    // 雙振盪器加輕微顫音，像木笛與鋼片琴的混合音色。
    this.tone(bus, hz(note), at, dur * 0.95 + 0.08, { type: 'triangle', gain: 0.26, attack: 0.012, lowpass: 3600 })
    this.tone(bus, hz(note), at, dur * 0.6, { type: 'sine', gain: 0.1, attack: 0.004, detune: 7 })
    this.tone(bus, hz(note + 12), at, 0.18, { gain: 0.05, attack: 0.002 })
  }

  private bass(bus: AudioNode, note: number, at: number, dur: number) {
    this.tone(bus, hz(note), at, dur, { type: 'triangle', gain: 0.34, attack: 0.008, lowpass: 900 })
    this.tone(bus, hz(note + 12), at, dur * 0.5, { gain: 0.08, attack: 0.006 })
  }

  private keys(bus: AudioNode, note: number, at: number, dur: number) {
    this.tone(bus, hz(note), at, dur, { type: 'triangle', gain: 0.06, attack: 0.004, lowpass: 2200 })
  }

  private pad(bus: AudioNode, note: number, at: number, dur: number) {
    this.tone(bus, hz(note), at, dur, { type: 'sawtooth', gain: 0.018, attack: 0.18, lowpass: 1100 })
  }

  private bell(bus: AudioNode, note: number, at: number, gain: number, dur: number) {
    this.tone(bus, hz(note), at, dur, { gain, attack: 0.003 })
    this.tone(bus, hz(note) * 2.76, at, dur * 0.35, { gain: gain * 0.3, attack: 0.002 })
  }

  private pluck(bus: AudioNode, note: number, at: number, gain: number, dur = 0.5) {
    this.tone(bus, hz(note), at, dur, { type: 'triangle', gain, attack: 0.004, lowpass: 3200 })
    this.tone(bus, hz(note + 12), at, dur * 0.45, { gain: gain * 0.25, attack: 0.003 })
  }

  private kick(bus: AudioNode, at: number) {
    this.tone(bus, 130, at, 0.22, { to: 48, gain: 0.32, attack: 0.002 })
  }

  private tone(bus: AudioNode, freq: number, at: number, dur: number, options: ToneOptions = {}) {
    const ctx = this.ctx
    if (!ctx) return
    const { type = 'sine', gain = 0.2, to, attack = 0.005, lowpass, detune } = options
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, at)
    if (detune) osc.detune.setValueAtTime(detune, at)
    if (to) osc.frequency.exponentialRampToValueAtTime(to, at + dur)
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, at)
    env.gain.exponentialRampToValueAtTime(gain, at + attack)
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    let head: AudioNode = osc
    if (lowpass) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = lowpass
      osc.connect(filter)
      head = filter
    }
    head.connect(env)
    env.connect(bus)
    osc.start(at)
    osc.stop(at + dur + 0.03)
  }

  private hit(bus: AudioNode, at: number, dur: number, freq: number, q: number, gain: number) {
    const ctx = this.ctx
    if (!ctx || !this.noise) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = freq
    filter.Q.value = q
    const env = ctx.createGain()
    env.gain.setValueAtTime(gain, at)
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    src.connect(filter)
    filter.connect(env)
    env.connect(bus)
    src.start(at, Math.random() * 0.5, dur + 0.02)
  }
}
