// 合成小舖的背景音樂與音效。全部由 Web Audio 即時合成（原創旋律與音色），不載入外部音檔。
// AudioContext 只在玩家點擊或按鍵時建立，瀏覽器不允許、也不會自動播放。

export type MergeSfx =
  | 'tap'
  | 'spawn'
  | 'pop'
  | 'merge'
  | 'mergeMax'
  | 'unlock'
  | 'serve'
  | 'coin'
  | 'upgrade'
  | 'chest'
  | 'error'

export type MergeAudioPrefs = { music: boolean; sfx: boolean }

const PREFS_KEY = 'hengjing:merge-shop:audio:v1'
const DEFAULT_PREFS: MergeAudioPrefs = { music: false, sfx: true }
const MUSIC_LEVEL = 0.16
const SFX_LEVEL = 0.55
const EIGHTH = 0.3

// 五聲音階（C D E G A）小曲，8 小節一輪，每格是一個八分音符；null 是休止。
const MELODY: (number | null)[] = [
  76, null, 79, 81, 79, null, 76, null,
  74, 76, 79, null, 76, null, 74, null,
  72, null, 74, 76, 79, null, 81, 79,
  76, null, null, null, 74, null, null, null,
  79, null, 81, 84, 81, null, 79, null,
  76, 79, 81, null, 79, null, 76, null,
  74, null, 76, 79, 76, 74, 72, null,
  72, null, null, null, null, null, null, null,
]
const BASS = [48, 43, 45, 43, 41, 48, 43, 48]

export function readAudioPrefs(): MergeAudioPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const saved = JSON.parse(raw) as Partial<MergeAudioPrefs> | null
    return { music: saved?.music === true, sfx: saved?.sfx !== false }
  } catch {
    return DEFAULT_PREFS
  }
}

function writeAudioPrefs(prefs: MergeAudioPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // 無痕模式或儲存空間已滿時只在這次頁面有效。
  }
}

const hz = (note: number) => 440 * 2 ** ((note - 69) / 12)

type ToneOptions = { type?: OscillatorType; gain?: number; to?: number; attack?: number; lowpass?: number }

export class MergeAudio {
  prefs: MergeAudioPrefs
  private ctx: AudioContext | null = null
  private sfxBus: GainNode | null = null
  private musicBus: GainNode | null = null
  private noise: AudioBuffer | null = null
  private timer: number | null = null
  private step = 0
  private nextAt = 0
  private lastCoin = 0
  private hidden = false

  constructor(prefs: MergeAudioPrefs) {
    this.prefs = prefs
  }

  get running() {
    return this.ctx?.state === 'running'
  }

  get musicPlaying() {
    return this.timer != null
  }

  unlock() {
    if (typeof window === 'undefined' || this.hidden) return
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
      this.sfxBus.gain.value = SFX_LEVEL
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

  setPrefs(next: MergeAudioPrefs) {
    this.prefs = next
    writeAudioPrefs(next)
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
    this.stopMusic()
    const ctx = this.ctx
    this.ctx = null
    void ctx?.close().catch(() => undefined)
  }

  play(name: MergeSfx) {
    const ctx = this.ctx
    const bus = this.sfxBus
    if (!this.prefs.sfx || !ctx || !bus || ctx.state !== 'running') return
    const t = ctx.currentTime + 0.005
    switch (name) {
      case 'tap':
        this.tone(bus, 880, t, 0.06, { to: 1320, gain: 0.12 })
        break
      case 'spawn':
        this.hit(bus, t, 0.12, 900, 1.4, 0.4)
        this.tone(bus, 260, t + 0.02, 0.18, { to: 620, gain: 0.16, type: 'triangle' })
        break
      case 'pop':
        this.tone(bus, 560, t, 0.1, { to: 1150, gain: 0.22 })
        this.hit(bus, t, 0.04, 2600, 2, 0.12)
        break
      case 'merge':
        this.pluck(bus, 76, t, 0.3)
        this.pluck(bus, 83, t + 0.08, 0.3)
        this.tone(bus, 2093, t + 0.15, 0.28, { gain: 0.07 })
        this.tone(bus, 2637, t + 0.21, 0.3, { gain: 0.06 })
        break
      case 'mergeMax':
        ;[72, 76, 79, 84].forEach((note, i) => this.pluck(bus, note, t + i * 0.07, 0.28, 0.7))
        this.sparkle(bus, t + 0.3, [96, 98, 100, 103], 0.05, 0.07)
        break
      case 'unlock':
        this.sparkle(bus, t, [84, 86, 88, 91, 93, 96], 0.05, 0.1)
        break
      case 'serve':
        ;[72, 76, 79, 84].forEach((note, i) => this.pluck(bus, note, t + i * 0.08, 0.24, 0.45))
        this.tone(bus, hz(88), t + 0.34, 0.45, { gain: 0.1 })
        break
      case 'coin': {
        if (t - this.lastCoin < 0.045) return
        this.lastCoin = t
        this.tone(bus, 1976, t, 0.06, { type: 'square', gain: 0.045, lowpass: 5000 })
        this.tone(bus, 2637, t + 0.05, 0.2, { type: 'square', gain: 0.045, lowpass: 5000 })
        break
      }
      case 'upgrade':
        ;[67, 72, 76].forEach((note, i) => this.pluck(bus, note, t + i * 0.12, 0.24, 0.3))
        ;[72, 76, 79, 84].forEach((note) => this.tone(bus, hz(note), t + 0.38, 1.2, { type: 'triangle', gain: 0.1, attack: 0.02 }))
        this.tone(bus, hz(48), t + 0.38, 1.2, { gain: 0.28, attack: 0.02 })
        this.sparkle(bus, t + 0.55, [91, 93, 96, 98, 100], 0.06, 0.07)
        break
      case 'chest':
        this.hit(bus, t, 0.16, 320, 0.8, 0.45)
        this.tone(bus, 150, t, 0.32, { type: 'sawtooth', to: 95, gain: 0.07, lowpass: 900 })
        this.sparkle(bus, t + 0.26, [79, 81, 84, 86, 88, 91, 93, 96], 0.045, 0.09)
        ;[84, 88, 91].forEach((note) => this.tone(bus, hz(note), t + 0.62, 0.9, { gain: 0.06, attack: 0.01 }))
        break
      case 'error':
        this.tone(bus, 220, t, 0.12, { type: 'square', to: 180, gain: 0.05, lowpass: 1200 })
        this.tone(bus, 196, t + 0.13, 0.16, { type: 'square', to: 150, gain: 0.05, lowpass: 1200 })
        break
    }
  }

  private syncMusic() {
    if (this.prefs.music && this.running && !this.hidden) this.startMusic()
    else this.stopMusic()
  }

  private startMusic() {
    const ctx = this.ctx
    const bus = this.musicBus
    if (!ctx || !bus || this.timer != null) return
    bus.gain.cancelScheduledValues(ctx.currentTime)
    bus.gain.setTargetAtTime(MUSIC_LEVEL, ctx.currentTime, 0.4)
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
    while (this.nextAt < ctx.currentTime + 0.35) {
      const at = this.nextAt
      const step = this.step
      const note = MELODY[step]
      if (note != null) this.pluck(bus, note, at, 0.2, 0.55)
      const beat = step % 8
      const root = BASS[Math.floor(step / 8)] ?? 48
      if (beat === 0) this.tone(bus, hz(root), at, 0.5, { gain: 0.3, attack: 0.01 })
      if (beat === 4) this.tone(bus, hz(root + 7), at, 0.45, { gain: 0.22, attack: 0.01 })
      if (beat === 2 || beat === 6) this.hit(bus, at, 0.05, 1700, 7, 0.16)
      this.step = (step + 1) % MELODY.length
      this.nextAt += EIGHTH
    }
  }

  private tone(bus: AudioNode, freq: number, at: number, dur: number, options: ToneOptions = {}) {
    const ctx = this.ctx
    if (!ctx) return
    const { type = 'sine', gain = 0.2, to, attack = 0.005, lowpass } = options
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, at)
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

  private pluck(bus: AudioNode, note: number, at: number, gain: number, dur = 0.5) {
    this.tone(bus, hz(note), at, dur, { type: 'triangle', gain, attack: 0.004, lowpass: 3200 })
    this.tone(bus, hz(note + 12), at, dur * 0.45, { gain: gain * 0.25, attack: 0.003 })
  }

  private sparkle(bus: AudioNode, at: number, notes: number[], gap: number, gain: number) {
    notes.forEach((note, i) => this.tone(bus, hz(note), at + i * gap, 0.32, { gain, attack: 0.004 }))
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
