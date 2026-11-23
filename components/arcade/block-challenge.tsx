'use client'

import './block-challenge.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Medal, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import type { EquippedPerks } from '@/lib/rewards/perk-catalog'
import { SceneBackdrop, boardClass } from '@/components/home/perk-visuals'
import {
  BLOCK_COMBO_GRACE,
  BLOCK_SIZE,
  blockShape,
  canPlace,
  fitsAnywhere,
  newBlockGame,
  parseBlockState,
  placePiece,
  previewLines,
  shapeBounds,
  type BlockPiece,
  type BlockPlaceResult,
  type BlockState,
} from '@/lib/arcade/block-rules'
import {
  BLOCK_LEVELS,
  EMPTY_STATS,
  RANKED_REJECT_TEXT,
  STAGE_THEME_NAME,
  addStepStats,
  dailyKey,
  dailySpec,
  evaluateAchievements,
  goalProgress,
  goalText,
  isDayKey,
  isLevelId,
  levelSpec,
  levelUnlocked,
  newlyDone,
  parseRecords,
  parseSavedRun,
  parseStats,
  rankedSpec,
  recordRun,
  startRun,
  stepRun,
  taipeiDayKey,
  taipeiWeek,
  type BlockAchievementView,
  type BlockStats,
  type ChallengeRun,
  type ChallengeStep,
  type LevelRecord,
  type RankedSubmit,
  type SavedRun,
} from '@/lib/arcade/block-modes'
import { startRankedRun, submitRankedRun } from '@/lib/arcade/block-board-client'
import { FESTIVAL_THEMES } from '@/lib/arcade/festival-theme'
import { FestivalBanner, festivalStyle, useFestivalTheme } from './festival-banner'
import { LiveEventsBoard } from './live-events-board'
import { MergeAudio, readAudioPrefs, type MergeSfx } from './merge-audio'
import { AchievementPanel, BoardPanel, DailyCard, GoalIcon, LevelMap, ModeTabs, type BlockTab } from './block-lobby'

const SAVE_KEY = 'hengjing:blocks:game:v1:'
const BEST_KEY = 'hengjing:blocks:best:v1:'
const SFX_KEY = 'hengjing:blocks:sfx:v1'
const RUN_KEY = 'hengjing:blocks:run:v1:'
const LEVELS_KEY = 'hengjing:blocks:levels:v1:'
const DAILY_KEY = 'hengjing:blocks:daily:v1:'
const STATS_KEY = 'hengjing:blocks:stats:v1:'
const CLEAR_MS = 640
const OVER_DELAY_MS = 750

const TAB_OF_MODE: Record<ChallengeRun['spec']['mode'], BlockTab> = { level: 'levels', daily: 'daily', ranked: 'board' }
const BACK_LABEL: Record<ChallengeRun['spec']['mode'], string> = { level: '關卡列表', daily: '每日挑戰', ranked: '排行榜' }

type Hover = { row: number; col: number; valid: boolean; rows: number[]; cols: number[] }

type Drag = {
  slot: number
  piece: BlockPiece
  pointerId: number
  lift: number
  pitch: number
  cell: number
  originX: number
  originY: number
  w: number
  h: number
  rows: number
  cols: number
  home: { x: number; y: number; scale: number }
  x: number
  y: number
  started: number
}

type Fx = {
  id: number
  cleared: Array<[index: number, color: number, delay: number]>
  rows: number[]
  cols: number[]
  placed: number[]
  pop: { text: string; left: number; top: number } | null
  banner: { main: string; sub: string | null; tone: 'combo' | 'lines' | 'perfect' | 'special' } | null
}

type SubmitState = { state: 'idle' } | { state: 'sending' } | { state: 'done'; result: RankedSubmit } | { state: 'error'; message: string }

const readJson = (key: string): unknown => {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
const writeJson = (key: string, value: unknown) => {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 無痕模式或空間不足時只保留在這次頁面。
  }
}

const randomSeed = () => {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] | 0
}

const LINE_WORD: Record<number, string> = { 2: '雙線消除', 3: '三線消除' }

function specialText(special: ChallengeStep['special'] | null): string | null {
  if (!special || !special.bonus) return null
  const parts: string[] = []
  if (special.stars) parts.push(`星星 ×${special.stars}`)
  if (special.stones) parts.push(`石磚 ×${special.stones}`)
  if (special.ice) parts.push(`冰磚裂開 ×${special.ice}`)
  if (special.gold) parts.push(`金磚 ×${special.gold}`)
  return `${parts.join('・')} +${special.bonus}`
}

export function BlockChallenge({
  authResolved,
  authUserId,
  previewId,
  onNeedLogin,
  onBack,
  equippedPerks,
}: {
  authResolved: boolean
  authUserId: string | null
  previewId: string | null
  onNeedLogin: () => void
  onBack: () => void
  /** 點數商城的方塊棋盤與遊戲場景；只是外觀，不影響規則。 */
  equippedPerks?: EquippedPerks
}) {
  const { theme } = useFestivalTheme(previewId)
  const owner = authUserId ?? 'guest'
  const [tab, setTab] = useState<BlockTab>('classic')
  const [classic, setClassic] = useState<BlockState | null>(null)
  const [run, setRun] = useState<ChallengeRun | null>(null)
  const [showRun, setShowRun] = useState(false)
  const [best, setBest] = useState(0)
  const [levels, setLevels] = useState<Record<string, LevelRecord>>({})
  const [daily, setDaily] = useState<Record<string, LevelRecord>>({})
  const [stats, setStats] = useState<BlockStats>(EMPTY_STATS)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [newBest, setNewBest] = useState(false)
  const [shownScore, setShownScore] = useState(0)
  const [hover, setHover] = useState<Hover | null>(null)
  const [dragSlot, setDragSlot] = useState<number | null>(null)
  const [fx, setFx] = useState<Fx | null>(null)
  const [overOpen, setOverOpen] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [shakeSlot, setShakeSlot] = useState<number | null>(null)
  const [frameShake, setFrameShake] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [sfxOn, setSfxOn] = useState(true)
  const [intro, setIntro] = useState<{ id: number; title: string; goal: string } | null>(null)
  const [achvQueue, setAchvQueue] = useState<BlockAchievementView[]>([])
  const [rankedBusy, setRankedBusy] = useState(false)
  const [rankedError, setRankedError] = useState<string | null>(null)
  const [submit, setSubmit] = useState<SubmitState>({ state: 'idle' })
  const [boardRefresh, setBoardRefresh] = useState(0)

  const classicRef = useRef<BlockState | null>(null)
  const runRef = useRef<ChallengeRun | null>(null)
  const modeRef = useRef<'classic' | 'run'>('classic')
  const gridRef = useRef<HTMLDivElement | null>(null)
  const floatRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const hoverKey = useRef('')
  const busyRef = useRef(false)
  const audioRef = useRef<MergeAudio | null>(null)
  const fxSeq = useRef(0)
  const timers = useRef<number[]>([])
  const bestRef = useRef(0)
  const startBestRef = useRef(0)
  const statsRef = useRef<BlockStats>(EMPTY_STATS)
  const levelsRef = useRef<Record<string, LevelRecord>>({})
  const dailyRef = useRef<Record<string, LevelRecord>>({})
  const sendRankedRef = useRef<(target: ChallengeRun) => Promise<void>>(async () => {})

  const today = taipeiDayKey(nowMs)
  const runMode = Boolean(run && showRun && TAB_OF_MODE[run.spec.mode] === tab)
  const playingView = tab === 'classic' || runMode
  const game = runMode ? run!.game : classic
  const locked = !game || game.over || (runMode && run!.status !== 'playing')

  const currentGame = () => (modeRef.current === 'run' ? runRef.current?.game ?? null : classicRef.current)

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)) }, [])

  useEffect(() => {
    const on = readJson(SFX_KEY) !== false
    setSfxOn(on)
    audioRef.current = new MergeAudio({ music: false, sfx: on && readAudioPrefs().sfx !== false })
    const onVis = () => {
      audioRef.current?.setHidden(document.hidden)
      if (!document.hidden) setNowMs(Date.now())
    }
    document.addEventListener('visibilitychange', onVis)
    const clock = window.setInterval(() => setNowMs(Date.now()), 15000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.clearInterval(clock)
      audioRef.current?.dispose()
      audioRef.current = null
    }
  }, [])

  const sfx = useCallback((name: MergeSfx) => {
    const audio = audioRef.current
    if (!audio) return
    audio.unlock()
    audio.play(name)
  }, [])

  const achvContext = () => ({ best: bestRef.current, stats: statsRef.current, levels: levelsRef.current, daily: dailyRef.current })

  const commitClassic = useCallback((next: BlockState) => {
    classicRef.current = next
    setClassic(next)
    writeJson(SAVE_KEY + owner, next.over ? null : next)
    if (next.score > bestRef.current) {
      bestRef.current = next.score
      setBest(next.score)
      writeJson(BEST_KEY + owner, next.score)
    }
  }, [owner])

  const commitRun = useCallback((next: ChallengeRun | null) => {
    runRef.current = next
    setRun(next)
    // 排行賽結束後要等伺服器回覆才清掉，網路中斷時重新整理還能再送。
    if (next && (next.status === 'playing' || next.spec.mode === 'ranked')) writeJson(RUN_KEY + owner, { key: next.spec.key, moves: next.moves } satisfies SavedRun)
    else writeJson(RUN_KEY + owner, null)
  }, [owner])

  const commitStats = (next: BlockStats) => {
    statsRef.current = next
    setStats(next)
    writeJson(STATS_KEY + owner, next)
  }

  useEffect(() => {
    if (!authResolved) return
    const savedBest = Number(readJson(BEST_KEY + owner))
    bestRef.current = Number.isFinite(savedBest) && savedBest > 0 ? Math.floor(savedBest) : 0
    setBest(bestRef.current)
    startBestRef.current = bestRef.current
    const saved = parseBlockState(readJson(SAVE_KEY + owner))
    const start = saved && !saved.over ? saved : newBlockGame(randomSeed())
    classicRef.current = start
    setClassic(start)
    levelsRef.current = parseRecords(readJson(LEVELS_KEY + owner), isLevelId)
    setLevels(levelsRef.current)
    dailyRef.current = parseRecords(readJson(DAILY_KEY + owner), isDayKey)
    setDaily(dailyRef.current)
    statsRef.current = parseStats(readJson(STATS_KEY + owner))
    setStats(statsRef.current)
    let savedRun = parseSavedRun(readJson(RUN_KEY + owner))
    if (savedRun?.spec.mode === 'daily' && savedRun.spec.key !== dailyKey(taipeiDayKey(Date.now()))) savedRun = null
    if (savedRun && savedRun.spec.mode !== 'ranked' && savedRun.status !== 'playing') savedRun = null
    if (savedRun?.spec.mode === 'level' && !levelUnlocked(levelsRef.current, Number(savedRun.spec.key.slice('level:'.length)))) savedRun = null
    runRef.current = savedRun
    setRun(savedRun)
    if (!savedRun) writeJson(RUN_KEY + owner, null)
    setShowRun(false)
    setSubmit({ state: 'idle' })
    setRankedError(null)
    setShownScore(start.score)
    setOverOpen(false)
    setNewBest(false)
    setFx(null)
    setAchvQueue([])
    if (savedRun?.spec.mode === 'ranked' && savedRun.status === 'ended') {
      setTab('board')
      setShowRun(true)
      void sendRankedRef.current(savedRun)
    }
  }, [authResolved, owner])

  // 切換經典／挑戰畫面時，拖曳與結算狀態跟著換成該局。
  useLayoutEffect(() => {
    modeRef.current = runMode ? 'run' : 'classic'
    const current = runMode ? runRef.current : null
    setHover(null)
    setFx(null)
    setConfirmRestart(false)
    setShownScore((runMode ? current?.game.score : classicRef.current?.score) ?? 0)
    setOverOpen(runMode ? Boolean(current && current.status !== 'playing') : Boolean(classicRef.current?.over))
  }, [runMode, run?.spec.key])

  // 台灣時間換日：昨天的每日挑戰立刻結束，不能延續到今天。
  useEffect(() => {
    const current = runRef.current
    if (!current || current.spec.mode !== 'daily' || current.spec.key === dailyKey(today)) return
    commitRun(null)
    setShowRun(false)
    setToast('已經換日，昨日挑戰結束了，來挑戰今天的新題目吧')
    later(() => setToast(null), 2600)
  }, [today, commitRun, later])

  // 分數數字滾動
  const score = game?.score ?? 0
  useEffect(() => {
    if (shownScore === score) return
    const from = shownScore
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 420)
      const eased = 1 - (1 - k) ** 3
      setShownScore(Math.round(from + (score - from) * eased))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score])

  useEffect(() => {
    if (!achvQueue.length) return
    const t = window.setTimeout(() => setAchvQueue((list) => list.slice(1)), 2600)
    return () => window.clearTimeout(t)
  }, [achvQueue])

  const flashToast = useCallback((text: string) => {
    setToast(text)
    later(() => setToast((cur) => (cur === text ? null : cur)), 1400)
  }, [later])

  const resetBoardFx = () => {
    setOverOpen(false)
    setNewBest(false)
    setConfirmRestart(false)
    setFx(null)
    setHover(null)
  }

  const restartClassic = () => {
    const fresh = newBlockGame(randomSeed())
    startBestRef.current = bestRef.current
    commitClassic(fresh)
    setShownScore(0)
    resetBoardFx()
    sfx('spawn')
  }

  const beginRun = (next: ChallengeRun) => {
    modeRef.current = 'run'
    commitRun(next)
    setShowRun(true)
    setShownScore(0)
    setSubmit({ state: 'idle' })
    resetBoardFx()
    fxSeq.current += 1
    const id = fxSeq.current
    setIntro({ id, title: next.spec.title, goal: next.spec.goal ? goalText(next.spec.goal) : '經典規則，拚本週最高分' })
    later(() => setIntro((cur) => (cur?.id === id ? null : cur)), 2200)
    sfx('spawn')
  }

  const startRanked = async () => {
    if (rankedBusy) return
    setRankedBusy(true)
    setRankedError(null)
    const res = await startRankedRun(authUserId)
    setRankedBusy(false)
    if (res.state === 'ok') {
      setTab('board')
      beginRun(startRun(rankedSpec(res.data.runId, res.data.seed)))
    } else {
      setRankedError(res.state === 'unavailable' ? '排行榜尚未開放，無法開始排行賽' : res.message)
    }
  }

  const sendRanked = async (target: ChallengeRun) => {
    const runId = target.spec.key.split(':')[1]
    setSubmit({ state: 'sending' })
    const res = await submitRankedRun(runId, target.moves, authUserId)
    if (res.state === 'ok') {
      setSubmit({ state: 'done', result: res.data })
      if (runRef.current?.spec.key === target.spec.key) writeJson(RUN_KEY + owner, null)
      setBoardRefresh((n) => n + 1)
      if (res.data.status === 'verified') sfx('chest')
    } else {
      setSubmit({ state: 'error', message: res.state === 'unavailable' ? '排行榜尚未開放，這局成績沒有送出' : res.message })
    }
  }
  sendRankedRef.current = sendRanked

  const restart = () => {
    const current = runRef.current
    if (modeRef.current === 'run' && current) {
      if (current.spec.mode === 'ranked') void startRanked()
      else beginRun(startRun(current.spec))
      return
    }
    restartClassic()
  }

  const onRestartClick = () => {
    const current = currentGame()
    const finished = !current || current.over || (modeRef.current === 'run' && runRef.current?.status !== 'playing')
    if (finished || current.moves === 0 || confirmRestart) {
      restart()
      return
    }
    setConfirmRestart(true)
    later(() => setConfirmRestart(false), 3000)
  }

  const toggleSfx = () => {
    const next = !sfxOn
    setSfxOn(next)
    writeJson(SFX_KEY, next)
    if (audioRef.current) audioRef.current.prefs = { music: false, sfx: next }
    if (next) sfx('tap')
  }

  const playLevel = (id: number) => {
    const level = BLOCK_LEVELS.find((item) => item.id === id)
    if (!level) return
    const spec = levelSpec(level)
    const current = runRef.current
    if (current?.spec.key === spec.key && current.status === 'playing') {
      setShowRun(true)
      return
    }
    beginRun(startRun(spec))
  }

  const playDaily = () => {
    const spec = dailySpec(today)
    const current = runRef.current
    if (current?.spec.key === spec.key && current.status === 'playing') {
      setShowRun(true)
      return
    }
    beginRun(startRun(spec))
  }

  const changeTab = (next: BlockTab) => {
    if (dragRef.current) return
    setTab(next)
    setRankedError(null)
    // 已結束的挑戰看完結果就收起，回到該模式的大廳。
    if (runRef.current && runRef.current.status !== 'playing') setShowRun(false)
  }

  // ---------- 拖曳 ----------

  const setFloat = (x: number, y: number, scale: number, transition: string) => {
    const el = floatRef.current
    if (!el) return
    el.style.transition = transition
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
  }

  const locate = (drag: Drag): Hover | null => {
    const cx = drag.x + drag.w / 2
    const cy = drag.y + drag.h / 2
    const span = drag.pitch * BLOCK_SIZE
    const pad = drag.pitch * 0.6
    if (cx < drag.originX - pad || cx > drag.originX + span + pad || cy < drag.originY - pad || cy > drag.originY + span + pad) return null
    const col = Math.round((drag.x - drag.originX) / drag.pitch)
    const row = Math.round((drag.y - drag.originY) / drag.pitch)
    const board = currentGame()?.board
    if (!board) return null
    const valid = canPlace(board, drag.piece.shapeId, row, col)
    const lines = valid ? previewLines(board, drag.piece, row, col) : { rows: [], cols: [] }
    return { row, col, valid, rows: lines.rows, cols: lines.cols }
  }

  const moveTo = (clientX: number, clientY: number) => {
    const drag = dragRef.current
    if (!drag) return
    drag.x = clientX - drag.w / 2
    drag.y = clientY - drag.h / 2 - drag.lift
    const settling = performance.now() - drag.started < 140
    setFloat(drag.x, drag.y, 1, settling ? 'transform 140ms cubic-bezier(.2,.9,.3,1.2)' : 'none')
    const next = locate(drag)
    const key = next ? `${next.row}:${next.col}:${next.valid}` : ''
    if (key !== hoverKey.current) {
      if (next?.valid && hoverKey.current && !hoverKey.current.endsWith('true')) sfx('tap')
      hoverKey.current = key
      setHover(next)
    }
  }

  const endDrag = (cancel: boolean) => {
    const drag = dragRef.current
    if (!drag) return
    window.removeEventListener('pointermove', onWinMove)
    window.removeEventListener('pointerup', onWinUp)
    window.removeEventListener('pointercancel', onWinCancel)
    const spot = cancel ? null : locate(drag)
    hoverKey.current = ''
    setHover(null)
    if (spot?.valid && currentGame()) {
      busyRef.current = true
      setFloat(drag.originX + spot.col * drag.pitch, drag.originY + spot.row * drag.pitch, 1, 'transform 90ms ease-out')
      later(() => {
        dragRef.current = null
        setDragSlot(null)
        busyRef.current = false
        applyPlacement(drag.slot, spot.row, spot.col)
      }, 90)
      return
    }
    busyRef.current = true
    if (spot && !spot.valid) {
      sfx('error')
      flashToast('這裡放不下')
      setShakeSlot(drag.slot)
      later(() => setShakeSlot(null), 420)
    }
    setFloat(drag.home.x, drag.home.y, drag.home.scale, 'transform 200ms cubic-bezier(.3,.7,.4,1)')
    later(() => {
      dragRef.current = null
      setDragSlot(null)
      busyRef.current = false
    }, 200)
  }

  // 監聽器本身要穩定才能正確移除，所以透過 ref 轉呼叫最新的處理函式。
  const handlers = useRef({ moveTo, endDrag })
  handlers.current = { moveTo, endDrag }
  const winHandlers = useMemo(() => ({
    move: (e: PointerEvent) => {
      if (e.pointerId !== dragRef.current?.pointerId) return
      e.preventDefault()
      handlers.current.moveTo(e.clientX, e.clientY)
    },
    up: (e: PointerEvent) => {
      if (e.pointerId !== dragRef.current?.pointerId) return
      handlers.current.moveTo(e.clientX, e.clientY)
      handlers.current.endDrag(false)
    },
    cancel: (e: PointerEvent) => {
      if (e.pointerId !== dragRef.current?.pointerId) return
      handlers.current.endDrag(true)
    },
  }), [])
  const onWinMove = winHandlers.move
  const onWinUp = winHandlers.up
  const onWinCancel = winHandlers.cancel

  useEffect(() => () => {
    window.removeEventListener('pointermove', winHandlers.move)
    window.removeEventListener('pointerup', winHandlers.up)
    window.removeEventListener('pointercancel', winHandlers.cancel)
  }, [winHandlers])

  const startDrag = (slot: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = currentGame()
    const piece = current?.tray[slot]
    const grid = gridRef.current
    if (!current || !piece || !grid || current.over || busyRef.current || dragRef.current) return
    if (modeRef.current === 'run' && runRef.current?.status !== 'playing') return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    setIntro(null)
    const cells = grid.querySelectorAll<HTMLElement>('.bc-cell')
    const c0 = cells[0].getBoundingClientRect()
    const c1 = cells[1].getBoundingClientRect()
    const pitch = c1.left - c0.left
    const cell = c0.width
    const { rows, cols } = shapeBounds(blockShape(piece.shapeId))
    const w = cols * pitch - (pitch - cell)
    const h = rows * pitch - (pitch - cell)
    const pieceEl = event.currentTarget.querySelector<HTMLElement>('.bc-piece')
    const pr = pieceEl?.getBoundingClientRect()
    const scale = pr ? pr.width / w : 0.5
    const touch = event.pointerType !== 'mouse'
    dragRef.current = {
      slot,
      piece,
      pointerId: event.pointerId,
      lift: touch ? h / 2 + Math.max(48, cell * 1.4) : 0,
      pitch,
      cell,
      originX: c0.left,
      originY: c0.top,
      w,
      h,
      rows,
      cols,
      home: { x: pr?.left ?? event.clientX, y: pr?.top ?? event.clientY, scale },
      x: pr?.left ?? event.clientX,
      y: pr?.top ?? event.clientY,
      started: performance.now(),
    }
    setDragSlot(slot)
    sfx('tap')
    window.addEventListener('pointermove', onWinMove, { passive: false })
    window.addEventListener('pointerup', onWinUp)
    window.addEventListener('pointercancel', onWinCancel)
    const { clientX, clientY } = event
    requestAnimationFrame(() => {
      const drag = dragRef.current
      if (!drag) return
      setFloat(drag.home.x, drag.home.y, drag.home.scale, 'none')
      requestAnimationFrame(() => {
        if (dragRef.current === drag) handlers.current.moveTo(clientX, clientY)
      })
    })
  }

  useLayoutEffect(() => {
    if (dragSlot === null) return
    const drag = dragRef.current
    if (drag) setFloat(drag.home.x, drag.home.y, drag.home.scale, 'none')
  }, [dragSlot])

  // ---------- 放置結果 ----------

  const finishRun = (done: ChallengeRun) => {
    const [, id] = done.spec.key.split(':')
    if (done.spec.mode === 'level') {
      levelsRef.current = recordRun(levelsRef.current, id, done)
      setLevels(levelsRef.current)
      writeJson(LEVELS_KEY + owner, levelsRef.current)
    } else if (done.spec.mode === 'daily') {
      dailyRef.current = recordRun(dailyRef.current, id, done)
      setDaily(dailyRef.current)
      writeJson(DAILY_KEY + owner, dailyRef.current)
    } else {
      void sendRanked(done)
    }
  }

  const applyPlacement = (slot: number, row: number, col: number) => {
    const isRun = modeRef.current === 'run'
    const current = currentGame()
    if (!current) return
    const before = evaluateAchievements(achvContext())
    let result: BlockPlaceResult
    let special: ChallengeStep['special'] | null = null
    let nextRun: ChallengeRun | null = null
    if (isRun && runRef.current) {
      const step = stepRun(runRef.current, slot, row, col)
      if ('error' in step) {
        flashToast('這裡放不下')
        sfx('error')
        return
      }
      result = step.result
      special = step.special
      nextRun = step.run
    } else {
      const placed = placePiece(current, slot, row, col)
      if ('error' in placed) {
        flashToast('這裡放不下')
        sfx('error')
        return
      }
      result = placed
    }
    const next = result.state
    const prevBoard = current.board
    const lineCount = result.rows.length + result.cols.length
    const stamped = result.placedCells
    const centerR = stamped.reduce((sum, i) => sum + Math.floor(i / BLOCK_SIZE), 0) / stamped.length
    const centerC = stamped.reduce((sum, i) => sum + (i % BLOCK_SIZE), 0) / stamped.length
    const piece = current.tray[slot] as BlockPiece
    const cleared = result.clearedCells.map((index): [number, number, number] => {
      const r = Math.floor(index / BLOCK_SIZE)
      const c = index % BLOCK_SIZE
      const dist = Math.hypot(r - centerR, c - centerC)
      return [index, prevBoard[index] || piece.color, Math.round(dist * 34)]
    })
    const bonusText = specialText(special)
    let banner: Fx['banner'] = null
    if (result.gained.perfect) banner = { main: '完美清盤', sub: `+${result.gained.perfect}`, tone: 'perfect' }
    else if (lineCount > 0 && next.combo >= 2) banner = { main: `連擊 ×${next.combo}`, sub: bonusText ?? (lineCount >= 2 ? (LINE_WORD[lineCount] ?? `${lineCount} 線消除`) : null), tone: 'combo' }
    else if (lineCount >= 2) banner = { main: LINE_WORD[lineCount] ?? `${lineCount} 線消除`, sub: bonusText, tone: 'lines' }
    else if (special?.stars) banner = { main: '星星入袋', sub: bonusText, tone: 'special' }
    else if (special?.stones) banner = { main: '石磚粉碎', sub: bonusText, tone: 'special' }
    else if (special?.gold) banner = { main: 'Pay 金磚', sub: bonusText, tone: 'special' }
    fxSeq.current += 1
    const id = fxSeq.current
    setFx({
      id,
      cleared,
      rows: result.rows,
      cols: result.cols,
      placed: result.placedCells,
      pop: { text: `+${result.gained.total}`, left: ((centerC + 0.5) / BLOCK_SIZE) * 100, top: ((centerR + 0.5) / BLOCK_SIZE) * 100 },
      banner,
    })
    later(() => setFx((cur) => (cur?.id === id ? { ...cur, cleared: [], rows: [], cols: [] } : cur)), CLEAR_MS + 200)
    later(() => setFx((cur) => (cur?.id === id ? null : cur)), 1300)

    let nextStats = addStepStats(statsRef.current, result, special)
    const ended = nextRun ? nextRun.status !== 'playing' : next.over
    if (ended) nextStats = { ...nextStats, games: nextStats.games + 1 }
    commitStats(nextStats)
    if (nextRun) {
      commitRun(nextRun)
      if (ended) finishRun(nextRun)
    } else {
      commitClassic(next)
    }

    if (lineCount > 0) {
      sfx(lineCount >= 2 || next.combo >= 2 ? 'mergeMax' : 'merge')
      if (result.gained.perfect) later(() => sfx('chest'), 260)
      else if (special?.stars) later(() => sfx('coin'), 220)
      setFrameShake((n) => n + 1)
      navigator.vibrate?.(lineCount >= 2 ? [18, 30, 18] : 16)
    } else {
      sfx('pop')
    }
    if (result.refilled) later(() => sfx('spawn'), 160)

    const unlocked = newlyDone(before, evaluateAchievements(achvContext()))
    if (unlocked.length) {
      setAchvQueue((list) => [...list, ...unlocked])
      later(() => sfx('unlock'), 420)
    }

    if (ended) {
      if (!nextRun) setNewBest(next.score > 0 && next.score > startBestRef.current)
      const won = nextRun?.status === 'won'
      later(() => {
        setOverOpen(true)
        sfx(won ? 'upgrade' : 'error')
      }, OVER_DELAY_MS + (lineCount > 0 ? CLEAR_MS : 0))
    }
  }

  // ---------- 畫面資料 ----------

  const preview = useMemo(() => {
    const ghost = new Map<number, boolean>()
    const willClear = new Set<number>()
    if (!hover || dragSlot === null || !game) return { ghost, willClear }
    const piece = game.tray[dragSlot]
    if (!piece) return { ghost, willClear }
    for (const [r, c] of blockShape(piece.shapeId).cells) {
      const rr = hover.row + r
      const cc = hover.col + c
      if (rr >= 0 && rr < BLOCK_SIZE && cc >= 0 && cc < BLOCK_SIZE) ghost.set(rr * BLOCK_SIZE + cc, hover.valid)
    }
    for (const r of hover.rows) for (let c = 0; c < BLOCK_SIZE; c += 1) willClear.add(r * BLOCK_SIZE + c)
    for (const c of hover.cols) for (let r = 0; r < BLOCK_SIZE; r += 1) willClear.add(r * BLOCK_SIZE + c)
    return { ghost, willClear }
  }, [hover, dragSlot, game])

  const dragPiece = dragSlot !== null ? game?.tray[dragSlot] ?? null : null
  const stuck = useMemo(() => (game ? game.tray.map((piece) => (piece ? !fitsAnywhere(game.board, piece.shapeId) : false)) : []), [game])
  const clearingMap = useMemo(() => new Map((fx?.cleared ?? []).map(([i, color, delay]) => [i, { color, delay }])), [fx])
  const placedSet = useMemo(() => new Set(fx?.placed ?? []), [fx])
  const achievements = useMemo(() => evaluateAchievements({ best, stats, levels, daily }), [best, stats, levels, daily])

  const activeRun = runMode ? run : null
  const goal = activeRun?.spec.goal ?? null
  const progress = activeRun && goal ? goalProgress(activeRun, goal) : 0
  const movesLeft = activeRun?.spec.moveLimit != null ? Math.max(0, activeRun.spec.moveLimit - activeRun.game.moves) : null
  const runRecord = activeRun
    ? activeRun.spec.mode === 'level' ? levels[activeRun.spec.key.split(':')[1]] : activeRun.spec.mode === 'daily' ? daily[activeRun.spec.key.split(':')[1]] : undefined
    : undefined
  const shownBest = activeRun ? (activeRun.spec.mode === 'ranked' ? null : runRecord?.best ?? 0) : best

  const hint = (() => {
    if (!game) return '準備棋盤中'
    if (activeRun && activeRun.status === 'won') return '挑戰成功！'
    if (activeRun && activeRun.status !== 'playing') return activeRun.reason === 'moves' ? '步數用完了' : '沒有任何方塊放得下了'
    if (game.over) return '沒有任何方塊放得下，這局結束了'
    if (hover && dragPiece) {
      if (!hover.valid) return '這個位置放不下，換個地方試試'
      const n = hover.rows.length + hover.cols.length
      return n > 0 ? `放開就能消除 ${n} 條！` : '放開即可放下方塊'
    }
    if (dragPiece) return '拖到棋盤上，看到亮起的位置就能放'
    if (game.combo > 0) return `連擊中！${game.comboLeft} 手內再消除一次就能延續`
    if (activeRun && goal) return `目標：${goalText(goal)}${movesLeft !== null ? `，還有 ${movesLeft} 步` : ''}`
    if (game.moves === 0) return '按住下方方塊拖到棋盤，填滿整行或整列就會消除'
    return '同時消除多行多列分數更高，連續消除還有連擊加成'
  })()

  const themeName = FESTIVAL_THEMES.find((item) => item.id === previewId)?.name
  const nextLevel = activeRun?.spec.mode === 'level' ? BLOCK_LEVELS.find((level) => `level:${level.id - 1}` === activeRun.spec.key) : undefined
  const week = taipeiWeek(nowMs)
  const levelsCleared = BLOCK_LEVELS.filter((level) => levels[String(level.id)]?.cleared).length
  const daysCleared = Object.values(daily).filter((item) => item.cleared).length
  const doneCount = achievements.filter((item) => item.state === 'done').length
  const backToLobby = () => {
    setShowRun(false)
    setOverOpen(false)
  }

  return (
    <section aria-label="Pay 服方塊大挑戰" className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium">
          <ArrowLeft className="size-4" />返回遊樂園
        </button>
        <p className="text-xs font-bold text-muted-foreground">{themeName ? `畫面主題：${themeName}` : '畫面主題跟隨今天的節慶'}</p>
      </div>
      <div className="mt-4">
        <FestivalBanner previewId={previewId} compact />
      </div>
      <header className="mt-4">
        <h1 className="text-2xl font-black">Pay 服方塊大挑戰</h1>
        <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">
          把方塊放進 8×8 棋盤，填滿整行或整列就會消除。經典模式拚最高分，也可以挑戰關卡、每日任務與每週排行。所有模式都不會發放 Pay 點數。
        </p>
      </header>

      <div className="bl-wrap mt-4">
        <ModeTabs
          tab={tab}
          onTab={changeTab}
          badges={{ daily: daily[today]?.cleared ? '完成' : daily[today]?.tries ? undefined : '新', achievements: `${doneCount}` }}
        />

        {!playingView && tab === 'levels' ? <LevelMap levels={levels} active={run} onPlay={playLevel} /> : null}
        {!playingView && tab === 'daily' ? <DailyCard today={today} nowMs={nowMs} records={daily} active={run} onPlay={playDaily} /> : null}
        {tab === 'achievements' ? (
          <AchievementPanel views={achievements} best={best} stats={stats} levelsCleared={levelsCleared} daysCleared={daysCleared} />
        ) : null}
        {!playingView && tab === 'board' ? (
          <BoardPanel
            authResolved={authResolved}
            authUserId={authUserId}
            nowMs={nowMs}
            active={run}
            busy={rankedBusy}
            error={rankedError}
            refreshKey={boardRefresh}
            onNeedLogin={onNeedLogin}
            onStart={() => void startRanked()}
            onResume={() => setShowRun(true)}
          />
        ) : null}
        {!playingView && toast ? <div className="bl-toast" role="status">{toast}</div> : null}
      </div>

      {!playingView ? (
        <div className="mt-4">
          <LiveEventsBoard authUserId={authUserId} onNeedLogin={onNeedLogin} game="block_challenge" />
        </div>
      ) : null}

      {playingView ? (
        <div
          className={`bc-game mt-4 ${equippedPerks?.scene ? 'pv-scene-host' : ''}`}
          data-festival={theme.id}
          data-stage={activeRun ? activeRun.spec.theme : undefined}
          style={festivalStyle(theme)}
          onPointerUpCapture={() => audioRef.current?.unlock()}
        >
          <SceneBackdrop id={equippedPerks?.scene} dim />
          {activeRun ? (
            <div className="bc-runbar">
              <button type="button" className="bc-back" onClick={backToLobby}><ArrowLeft className="size-4" />{BACK_LABEL[activeRun.spec.mode]}</button>
              <span className="bc-runtitle">{activeRun.spec.title}</span>
              <span className="bc-stagename">{activeRun.spec.mode === 'ranked' ? `${week.key.slice(5).replace('-', '/')}–${week.lastDay.slice(5).replace('-', '/')}` : STAGE_THEME_NAME[activeRun.spec.theme]}</span>
            </div>
          ) : null}
          <div className="bc-hud">
            <div className="bc-score">
              <span className="bc-label">分數</span>
              <b className="bc-num" aria-live="polite">{shownScore.toLocaleString()}</b>
            </div>
            {shownBest !== null ? (
              <div className="bc-best" aria-label={`${activeRun ? '本關最佳' : '最高分'} ${shownBest}`}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 3.5L12 4l4.5 7.5L21 8l-2 11H5z" fill="#ffd36b" stroke="#5a2a0c" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="12" cy="14" r="1.8" fill="#f97316" /></svg>
                <span>{shownBest.toLocaleString()}</span>
              </div>
            ) : null}
            <div className="bc-actions">
              <button type="button" className="bc-icon" onClick={toggleSfx} aria-label={sfxOn ? '關閉音效' : '開啟音效'} aria-pressed={sfxOn}>
                {sfxOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </button>
              <button type="button" className={`bc-restart ${confirmRestart ? 'is-confirm' : ''}`} onClick={onRestartClick} disabled={rankedBusy}>
                <RotateCcw className="size-4" />{confirmRestart ? '確定重來？' : '重新開始'}
              </button>
            </div>
          </div>

          {activeRun && goal ? (
            <div className="bc-goal" data-done={progress >= goal.target}>
              <GoalIcon kind={goal.kind} />
              <div className="bc-goal-main">
                <div className="bc-goal-text"><b>{goalText(goal)}</b><span>{Math.min(progress, goal.target).toLocaleString()} / {goal.target.toLocaleString()}</span></div>
                <div className="bc-goal-bar"><i style={{ width: `${Math.min(100, (progress / goal.target) * 100)}%` }} /></div>
              </div>
              {movesLeft !== null ? (
                <span className="bc-moves" data-low={movesLeft <= 5} aria-label={`剩 ${movesLeft} 步`}><b>{movesLeft}</b><small>步</small></span>
              ) : null}
            </div>
          ) : null}
          {activeRun && !goal ? (
            <div className="bc-goal" data-kind="ranked">
              <GoalIcon kind="ranked" />
              <div className="bc-goal-main">
                <div className="bc-goal-text"><b>排行賽｜經典規則</b><span>伺服器重算後上榜</span></div>
              </div>
            </div>
          ) : null}

          <div className="bc-meter" data-on={game && game.combo > 0 ? 'true' : 'false'}>
            <span className="bc-combo">連擊 <b>×{game?.combo ?? 0}</b></span>
            <span className="bc-pips" aria-label={`連擊剩 ${game?.comboLeft ?? 0} 手`}>
              {Array.from({ length: BLOCK_COMBO_GRACE }, (_, i) => <i key={i} data-lit={game && game.combo > 0 && i < game.comboLeft ? 'true' : 'false'} />)}
            </span>
            <span className="bc-stat">消除 <b>{game?.lines ?? 0}</b> 條</span>
            {!authUserId && authResolved ? (
              <button type="button" className="bc-guest" onClick={onNeedLogin}>訪客試玩｜登入</button>
            ) : null}
          </div>

          <div className="bc-stage">
            <div key={frameShake} className={`bc-frame ${frameShake ? 'is-hit' : ''}`}>
              <div ref={gridRef} className={`bc-grid ${boardClass(equippedPerks?.board)} ${locked && activeRun?.status !== 'won' ? 'is-over' : ''} ${activeRun?.status === 'won' ? 'is-won' : ''}`} role="group" aria-label="方塊棋盤">
                {Array.from({ length: BLOCK_SIZE * BLOCK_SIZE }, (_, index) => {
                  const value = game?.board[index] ?? 0
                  const ghost = preview.ghost.get(index)
                  const clearing = clearingMap.get(index)
                  const r = Math.floor(index / BLOCK_SIZE)
                  const c = index % BLOCK_SIZE
                  const willClear = preview.willClear.has(index)
                  return (
                    <div
                      key={index}
                      className={`bc-cell ${(Math.floor(r / 2) + Math.floor(c / 2)) % 2 ? 'alt' : ''} ${willClear ? 'will-clear' : ''} ${ghost === false ? 'is-bad' : ''}`}
                      style={{ '--i': r + c } as CSSProperties}
                    >
                      {value ? <span className={`bc-tile ${placedSet.has(index) ? 'is-placed' : ''}`} data-c={value} /> : null}
                      {!value && ghost === true && dragPiece ? <span className="bc-tile is-ghost" data-c={dragPiece.color} /> : null}
                      {clearing ? <span className="bc-tile is-clearing" data-c={clearing.color} style={{ '--d': `${clearing.delay}ms` } as CSSProperties} /> : null}
                    </div>
                  )
                })}
                <div className="bc-fx" aria-hidden="true">
                  {fx?.rows.map((row) => <i key={`r${fx.id}-${row}`} className="bc-beam row" style={{ gridRow: row + 1 }} />)}
                  {fx?.cols.map((col) => <i key={`c${fx.id}-${col}`} className="bc-beam col" style={{ gridColumn: col + 1 }} />)}
                  {fx?.pop ? <span key={`p${fx.id}`} className="bc-pop" style={{ left: `${fx.pop.left}%`, top: `${fx.pop.top}%` }}>{fx.pop.text}</span> : null}
                </div>
              </div>
              {fx?.banner ? (
                <div key={`b${fx.id}`} className="bc-banner" data-tone={fx.banner.tone}>
                  <strong>{fx.banner.main}</strong>
                  {fx.banner.sub ? <small>{fx.banner.sub}</small> : null}
                </div>
              ) : null}
              {intro && activeRun ? (
                <div key={`i${intro.id}`} className="bc-intro" aria-live="polite">
                  <small>{intro.title}</small>
                  <strong>{intro.goal}</strong>
                  {activeRun.spec.moveLimit ? <em>{activeRun.spec.moveLimit} 步內完成</em> : null}
                </div>
              ) : null}
              {toast ? <div className="bc-toast" role="status">{toast}</div> : null}
            </div>

            {overOpen && game && !activeRun ? (
              <div className="bc-over" role="dialog" aria-modal="true" aria-label="遊戲結束">
                <div className="bc-over-card">
                  <div className="bc-over-ribbon">遊戲結束</div>
                  <p className="bc-over-why">棋盤上已經沒有位置能放下剩下的方塊</p>
                  <div className="bc-over-score">
                    <span>本局分數</span>
                    <b>{game.score.toLocaleString()}</b>
                    {newBest ? <em>新紀錄！</em> : null}
                  </div>
                  <dl className="bc-over-stats">
                    <div><dt>消除</dt><dd>{game.lines} 條</dd></div>
                    <div><dt>最高連擊</dt><dd>×{game.bestCombo}</dd></div>
                    <div><dt>放置</dt><dd>{game.moves} 塊</dd></div>
                    <div><dt>最高分</dt><dd>{best.toLocaleString()}</dd></div>
                  </dl>
                  <button type="button" className="bc-cta" onClick={restartClassic} autoFocus>再玩一局</button>
                  <button type="button" className="bc-cta ghost" onClick={onBack}>返回遊樂園</button>
                  <p className="bc-over-note">本局不發放 Pay 點數，正式獎勵會在後續開放。</p>
                </div>
              </div>
            ) : null}

            {overOpen && activeRun && activeRun.status !== 'playing' ? (
              <div className="bc-over" role="dialog" aria-modal="true" aria-label={activeRun.status === 'won' ? '挑戰成功' : activeRun.status === 'lost' ? '挑戰失敗' : '排行賽結束'}>
                <div className="bc-over-card" data-result={activeRun.status}>
                  {activeRun.status === 'won' ? <div className="bc-confetti" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--k': i } as CSSProperties} />)}</div> : null}
                  <div className="bc-over-ribbon">{activeRun.status === 'won' ? '挑戰成功' : activeRun.status === 'lost' ? '挑戰失敗' : '排行賽結束'}</div>
                  <p className="bc-over-why">
                    {activeRun.status === 'won'
                      ? `${goal ? goalText(goal) : ''}達成！用了 ${activeRun.game.moves} 步`
                      : activeRun.status === 'lost'
                        ? `${activeRun.reason === 'moves' ? '步數用完了' : '沒有位置能放方塊了'}，${goal ? `進度 ${Math.min(progress, goal.target).toLocaleString()}/${goal.target.toLocaleString()}` : ''}`
                        : '棋盤上已經沒有位置能放下剩下的方塊'}
                  </p>
                  {activeRun.status === 'won' ? <div className="bc-stars" aria-hidden="true"><i /><i /><i /></div> : null}
                  <div className="bc-over-score">
                    <span>本局分數</span>
                    <b>{activeRun.game.score.toLocaleString()}</b>
                    {activeRun.bonus ? <em className="is-bonus">特殊方塊 +{activeRun.bonus}</em> : null}
                  </div>
                  <dl className="bc-over-stats">
                    <div><dt>消除</dt><dd>{activeRun.game.lines} 條</dd></div>
                    <div><dt>最高連擊</dt><dd>×{activeRun.game.bestCombo}</dd></div>
                    <div><dt>步數</dt><dd>{activeRun.game.moves}{activeRun.spec.moveLimit ? `/${activeRun.spec.moveLimit}` : ''}</dd></div>
                    {activeRun.spec.mode === 'ranked' ? (
                      <div><dt>週期</dt><dd>{week.key.slice(5).replace('-', '/')} 起</dd></div>
                    ) : (
                      <div><dt>{activeRun.spec.mode === 'daily' ? '今日最佳' : '本關最佳'}</dt><dd>{(runRecord?.best ?? 0).toLocaleString()}</dd></div>
                    )}
                  </dl>
                  {activeRun.spec.mode === 'ranked' ? (
                    <div className="bc-submit" data-state={submit.state === 'done' ? submit.result.status : submit.state}>
                      {submit.state === 'sending' || submit.state === 'idle' ? '伺服器重算驗證中…' : null}
                      {submit.state === 'done' && submit.result.status === 'verified'
                        ? submit.result.rank ? `已驗證上榜！本週第 ${submit.result.rank} 名` : '已驗證，成績已記錄'
                        : null}
                      {submit.state === 'done' && submit.result.status !== 'verified' ? `成績未列入排行：${RANKED_REJECT_TEXT[submit.result.reason] ?? '驗證沒有通過'}` : null}
                      {submit.state === 'error' ? (
                        <>
                          <span>{submit.message}</span>
                          <button type="button" className="bl-ghost" onClick={() => void sendRanked(activeRun)}>重新送出</button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {activeRun.status === 'won' && nextLevel ? (
                    <button type="button" className="bc-cta" onClick={() => playLevel(nextLevel.id)} autoFocus>下一關：{nextLevel.name}</button>
                  ) : (
                    <button type="button" className="bc-cta" onClick={restart} disabled={rankedBusy} autoFocus>
                      {activeRun.spec.mode === 'ranked' ? '再來一場排行賽' : activeRun.status === 'won' ? '再玩一次' : '再試一次'}
                    </button>
                  )}
                  {activeRun.status === 'won' && nextLevel ? <button type="button" className="bc-cta ghost" onClick={restart}>再玩一次</button> : null}
                  <button type="button" className="bc-cta ghost" onClick={backToLobby}>返回{BACK_LABEL[activeRun.spec.mode]}</button>
                  <p className="bc-over-note">挑戰結果不發放 Pay 點數，正式獎勵會在後續開放。</p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="bc-tray" aria-label="待用方塊">
            {[0, 1, 2].map((slot) => {
              const piece = game?.tray[slot] ?? null
              if (!piece) return <div key={`empty-${slot}`} className="bc-slot is-empty" aria-hidden="true" />
              const { rows, cols } = shapeBounds(blockShape(piece.shapeId))
              const dead = stuck[slot]
              return (
                <button
                  key={piece.key}
                  type="button"
                  className={`bc-slot ${dragSlot === slot ? 'is-lifted' : ''} ${dead ? 'is-stuck' : ''} ${shakeSlot === slot ? 'is-shake' : ''}`}
                  aria-label={`方塊 ${slot + 1}${piece.color === 10 ? '（Pay 金磚）' : ''}${dead ? '，目前沒有位置可放' : ''}`}
                  onPointerDown={(event) => startDrag(slot, event)}
                  onContextMenu={(event) => event.preventDefault()}
                  disabled={locked}
                >
                  <PieceArt piece={piece} rows={rows} cols={cols} />
                </button>
              )
            })}
          </div>
          <p className="bc-hint" aria-live="polite">{hint}</p>

          {achvQueue[0] ? (
            <div key={achvQueue[0].id} className="bc-achv" role="status">
              <span className="bc-achv-medal"><Medal className="size-5" /></span>
              <span><small>成就達成</small><b>{achvQueue[0].name}</b></span>
            </div>
          ) : null}
        </div>
      ) : null}

      {dragPiece && typeof document !== 'undefined'
        ? createPortal(
          <div ref={floatRef} className={`bc-float ${hover?.valid ? 'is-snap' : ''} ${hover && !hover.valid ? 'is-bad' : ''}`} aria-hidden="true">
            <PieceArt
              piece={dragPiece}
              {...shapeBounds(blockShape(dragPiece.shapeId))}
              tile={dragRef.current?.cell}
              gap={dragRef.current ? dragRef.current.pitch - dragRef.current.cell : undefined}
            />
          </div>,
          document.body,
        )
        : null}
    </section>
  )
}

function PieceArt({ piece, rows, cols, tile, gap }: { piece: BlockPiece; rows: number; cols: number; tile?: number; gap?: number }) {
  const style = {
    gridTemplateColumns: `repeat(${cols}, var(--ts))`,
    gridTemplateRows: `repeat(${rows}, var(--ts))`,
    ...(tile ? { '--ts': `${tile}px` } : {}),
    ...(gap !== undefined ? { gap: `${gap}px` } : {}),
  } as CSSProperties
  return (
    <span className="bc-piece" style={style}>
      {blockShape(piece.shapeId).cells.map(([r, c]) => (
        <span key={`${r}-${c}`} className="bc-tile" data-c={piece.color} style={{ gridRow: r + 1, gridColumn: c + 1 }} />
      ))}
    </span>
  )
}
