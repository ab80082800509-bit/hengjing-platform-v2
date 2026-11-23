/**
 * 方塊大挑戰的挑戰關卡、每日挑戰、排行賽與本機成就。純函式，畫面、檢查腳本與排行榜 SQL 驗證共用。
 * 經典模式仍直接用 block-rules 的 newBlockGame / placePiece；這裡只在外面包一層目標、步數與特殊格。
 * 對局只存「關卡代號＋每一步」，讀回時從頭重算，竄改過或不合法的步驟整局作廢。
 */
import {
  BLOCK_SIZE,
  canPlace,
  hasAnyMove,
  newBlockGame,
  placePiece,
  stampPiece,
  emptyBoard,
  type BlockBoard,
  type BlockPlaceResult,
  type BlockState,
} from './block-rules'

/** 棋盤格值 1–7 是一般材質；以下是挑戰模式專用的特殊格。 */
export const TILE_STONE = 8
export const TILE_STAR = 9
export const TILE_GOLD = 10
/** 冰磚（第二章）：第一次被消除時裂成石磚留在原地，要再消一次才會不見。 */
export const TILE_ICE = 11
export const SPECIAL_BONUS = { stone: 20, star: 60, gold: 30, ice: 25 } as const

/** 關卡內容版本：第 2 版加入第二章（第 9～16 關）與冰磚。舊存檔的第 1～8 關紀錄不變。 */
export const BLOCK_CONTENT_VERSION = 2

// ---------- 台灣時間 ----------

const TPE_OFFSET_MS = 8 * 3600 * 1000
const DAY_MS = 24 * 3600 * 1000

/** Asia/Taipei 沒有日光節約時間，固定 UTC+8。 */
export function taipeiDayKey(ms: number): string {
  return new Date(ms + TPE_OFFSET_MS).toISOString().slice(0, 10)
}

/** 週一 00:00 起算、下週一 00:00 結束，與 game_reward_period('weekly') 相同。 */
export function taipeiWeek(ms: number): { key: string; startMs: number; endMs: number; lastDay: string } {
  const local = new Date(ms + TPE_OFFSET_MS)
  const isoIndex = (local.getUTCDay() + 6) % 7
  const mondayLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - isoIndex)
  const startMs = mondayLocal - TPE_OFFSET_MS
  return { key: taipeiDayKey(startMs), startMs, endMs: startMs + 7 * DAY_MS, lastDay: taipeiDayKey(startMs + 6 * DAY_MS) }
}

// ---------- 種子 ----------

function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h | 0
}

function rngFrom(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), s | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- 關卡資料 ----------

export type BlockGoalKind = 'score' | 'lines' | 'combo' | 'stars' | 'stones' | 'ice'
export type BlockGoal = { kind: BlockGoalKind; target: number }
export type BlockStageTheme = 'market' | 'alley' | 'harbor' | 'night' | 'vault' | 'garden' | 'frost'

export type ChallengeSpec = {
  key: string
  mode: 'level' | 'daily' | 'ranked'
  title: string
  theme: BlockStageTheme
  seed: number
  goal: BlockGoal | null
  moveLimit: number | null
  /** 8 行字串：. 空格、X 石磚、* 星星、I 冰磚 */
  layout: readonly string[] | null
  /** 每補幾次牌出現一塊 Pay 金磚；0 表示不出現。 */
  goldEvery: number
}

export type BlockLevel = {
  id: number
  /** 第幾章；第二章從第 9 關開始，要先通過第 8 關。 */
  chapter: 1 | 2
  name: string
  intro: string
  theme: BlockStageTheme
  seed: number
  goal: BlockGoal
  moveLimit: number
  layout: readonly string[] | null
  goldEvery: number
}

export const STAGE_THEME_NAME: Record<BlockStageTheme, string> = {
  market: '開市廣場',
  alley: '石磚小巷',
  harbor: '港口燈塔',
  night: '星光夜市',
  vault: 'Pay 金庫',
  garden: '茶園步道',
  frost: '冰雪市集',
}

export const BLOCK_CHAPTERS = [
  { id: 1, name: '第一章｜開市大街', intro: '石磚、星星與 Pay 金磚' },
  { id: 2, name: '第二章｜冰雪市集', intro: '新障礙冰磚：消一次裂成石磚，再消一次才會不見' },
] as const

export const BLOCK_LEVELS: readonly BlockLevel[] = [
  { id: 1, chapter: 1, name: '開市暖身', intro: '先熟悉手感，消除 5 條就過關', theme: 'market', seed: 1101, goal: { kind: 'lines', target: 5 }, moveLimit: 24, layout: null, goldEvery: 0 },
  {
    id: 2, chapter: 1, name: '石磚小巷', intro: '石磚擋路！把它們所在的行或列填滿就能打碎', theme: 'alley', seed: 2006, goal: { kind: 'stones', target: 6 }, moveLimit: 28, goldEvery: 0,
    layout: ['........', '.X....X.', '........', '...XX...', '........', '.X....X.', '........', '........'],
  },
  { id: 3, chapter: 1, name: '港口連擊', intro: '連續消除不中斷，打出 ×3 連擊', theme: 'harbor', seed: 3301, goal: { kind: 'combo', target: 3 }, moveLimit: 30, layout: null, goldEvery: 0 },
  {
    id: 4, chapter: 1, name: '星光夜市', intro: '消除星星所在的行列，把 4 顆星星收進口袋', theme: 'night', seed: 4409, goal: { kind: 'stars', target: 4 }, moveLimit: 30, goldEvery: 0,
    layout: ['........', '.*......', '........', '......*.', '........', '..*.....', '........', '.....*..'],
  },
  { id: 5, chapter: 1, name: '金磚衝分', intro: '每次補牌都有一塊 Pay 金磚，消掉它分數加倍衝刺', theme: 'vault', seed: 5501, goal: { kind: 'score', target: 1500 }, moveLimit: 32, layout: null, goldEvery: 1 },
  {
    id: 6, chapter: 1, name: '茶園石牆', intro: '石牆圍住茶園，打碎 10 塊石磚', theme: 'garden', seed: 6002, goal: { kind: 'stones', target: 10 }, moveLimit: 36, goldEvery: 0,
    layout: ['X......X', '........', '..X..X..', '...XX...', '...XX...', '..X..X..', '........', 'X......X'],
  },
  { id: 7, chapter: 1, name: '燈塔長連擊', intro: '高手考驗：一路連擊到 ×5', theme: 'harbor', seed: 7703, goal: { kind: 'combo', target: 5 }, moveLimit: 42, layout: null, goldEvery: 3 },
  {
    id: 8, chapter: 1, name: '夜市之王', intro: '石磚、星星、金磚全上場，收齊 6 顆星星', theme: 'night', seed: 8807, goal: { kind: 'stars', target: 6 }, moveLimit: 42, goldEvery: 2,
    layout: ['*......*', '..X..X..', '........', '.X.**.X.', '........', '..X..X..', '........', '*......*'],
  },
  // ---- 第二章｜冰雪市集（內容版本 2）----
  {
    id: 9, chapter: 2, name: '初雪攤位', intro: '冰磚登場！把冰磚那一行填滿，消一次會裂成石磚', theme: 'frost', seed: 9103, goal: { kind: 'ice', target: 4 }, moveLimit: 30, goldEvery: 0,
    layout: ['........', '........', '........', '..IIII..', '........', '........', '........', '........'],
  },
  {
    id: 10, chapter: 2, name: '冰柱小巷', intro: '冰磚排成一列，打裂後記得再清掉碎石', theme: 'frost', seed: 10207, goal: { kind: 'stones', target: 6 }, moveLimit: 34, goldEvery: 0,
    layout: ['........', '........', '.I.II.I.', '........', '........', '.I.II.I.', '........', '........'],
  },
  { id: 11, chapter: 2, name: '熱可可連擊', intro: '在冰面上打出 ×3 連擊暖暖身', theme: 'frost', seed: 11311, goal: { kind: 'combo', target: 3 }, moveLimit: 38, goldEvery: 0, layout: ['I......I', '........', '........', '........', '........', '........', '........', 'I......I'] },
  {
    id: 12, chapter: 2, name: '雪地尋星', intro: '星星被冰磚圍住，收集 5 顆星星', theme: 'frost', seed: 12409, goal: { kind: 'stars', target: 5 }, moveLimit: 38, goldEvery: 0,
    layout: ['........', '.I*I....', '........', '.....I*I', '..*.....', '........', '.I*I..*.', '........'],
  },
  { id: 13, chapter: 2, name: '金庫結霜', intro: '金磚與冰磚同場，拿到 2,200 分', theme: 'vault', seed: 13502, goal: { kind: 'score', target: 2200 }, moveLimit: 36, goldEvery: 1, layout: ['........', '...II...', '........', 'I......I', 'I......I', '........', '...II...', '........'] },
  {
    id: 14, chapter: 2, name: '冰牆茶園', intro: '冰牆圍住茶園，打裂 8 塊冰磚', theme: 'garden', seed: 14611, goal: { kind: 'ice', target: 8 }, moveLimit: 40, goldEvery: 0,
    layout: ['........', '..IIII..', '........', '...X....', '....X...', '........', '..IIII..', '........'],
  },
  { id: 15, chapter: 2, name: '港口寒流', intro: '冰磚與石磚擋路，消除 14 條', theme: 'harbor', seed: 15712, goal: { kind: 'lines', target: 14 }, moveLimit: 40, goldEvery: 3, layout: ['.X....I.', '........', '..I..X..', '........', '........', '..X..I..', '........', '.I....X.'] },
  {
    id: 16, chapter: 2, name: '冰雪市集之王', intro: '冰磚、石磚、星星與金磚全上場，收齊 6 顆星星', theme: 'frost', seed: 16818, goal: { kind: 'stars', target: 6 }, moveLimit: 46, goldEvery: 2,
    layout: ['*I....I*', 'I......I', '...XX...', '..*..*..', '........', '...XX...', 'I......I', '*I....I*'],
  },
]

export const levelKey = (id: number) => `level:${id}`
export const dailyKey = (day: string) => `daily:${day}`
export const rankedKey = (runId: string, seed: number) => `ranked:${runId}:${seed | 0}`

const DAILY_THEMES: readonly BlockStageTheme[] = ['market', 'alley', 'harbor', 'night', 'vault', 'garden']

/** 同一天固定同一題：種子、目標、障礙格位置全由日期決定。 */
export function dailySpec(day: string): ChallengeSpec {
  const seed = hash32(`hengjing-blocks-daily:${day}`)
  const rand = rngFrom(seed)
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]
  const kind = pick<BlockGoalKind>(['lines', 'stones', 'stars', 'score', 'combo'])
  const theme = pick(DAILY_THEMES)
  const rows = Array.from({ length: BLOCK_SIZE }, () => Array<string>(BLOCK_SIZE).fill('.'))
  const scatter = (count: number, mark: string) => {
    let placed = 0
    for (let guard = 0; placed < count && guard < 400; guard += 1) {
      const r = Math.floor(rand() * BLOCK_SIZE)
      const c = Math.floor(rand() * BLOCK_SIZE)
      if (rows[r][c] !== '.') continue
      if (rows[r].filter((ch) => ch !== '.').length >= 2) continue
      if (rows.filter((line) => line[c] !== '.').length >= 2) continue
      rows[r][c] = mark
      placed += 1
    }
    return placed
  }
  let goal: BlockGoal
  let moveLimit: number
  let goldEvery = 0
  if (kind === 'stones') {
    goal = { kind, target: scatter(6 + Math.floor(rand() * 3), 'X') }
    moveLimit = 32
  } else if (kind === 'stars') {
    goal = { kind, target: scatter(4 + Math.floor(rand() * 2), '*') }
    scatter(2, 'X')
    moveLimit = 32
  } else if (kind === 'score') {
    goal = { kind, target: 1400 + Math.floor(rand() * 5) * 100 }
    goldEvery = 1
    moveLimit = 34
  } else if (kind === 'combo') {
    goal = { kind, target: 3 + Math.floor(rand() * 2) }
    moveLimit = 40
  } else {
    goal = { kind, target: 7 + Math.floor(rand() * 3) }
    scatter(3, 'X')
    moveLimit = 30
  }
  const layout = rows.map((line) => line.join(''))
  return {
    key: dailyKey(day),
    mode: 'daily',
    title: `${day.slice(5).replace('-', '/')} 每日挑戰`,
    theme,
    seed,
    goal,
    moveLimit,
    layout: layout.some((line) => line !== '........') ? layout : null,
    goldEvery,
  }
}

export function levelSpec(level: BlockLevel): ChallengeSpec {
  return { key: levelKey(level.id), mode: 'level', title: `第 ${level.id} 關｜${level.name}`, theme: level.theme, seed: level.seed, goal: level.goal, moveLimit: level.moveLimit, layout: level.layout, goldEvery: level.goldEvery }
}

/** 排行賽沿用經典規則：空棋盤、沒有特殊格、沒有步數上限，種子由伺服器發。 */
export function rankedSpec(runId: string, seed: number): ChallengeSpec {
  return { key: rankedKey(runId, seed), mode: 'ranked', title: '每週排行賽', theme: 'market', seed: seed | 0, goal: null, moveLimit: null, layout: null, goldEvery: 0 }
}

export function specFromKey(key: string): ChallengeSpec | null {
  const [mode, a, b] = key.split(':')
  if (mode === 'level') {
    const level = BLOCK_LEVELS.find((item) => String(item.id) === a)
    return level ? levelSpec(level) : null
  }
  if (mode === 'daily' && /^\d{4}-\d{2}-\d{2}$/.test(a ?? '')) return dailySpec(a)
  if (mode === 'ranked' && a && /^-?\d+$/.test(b ?? '')) return rankedSpec(a, Number(b))
  return null
}

export function layoutBoard(layout: readonly string[] | null): BlockBoard {
  const board = emptyBoard()
  layout?.forEach((line, r) => [...line].forEach((ch, c) => {
    if (r < BLOCK_SIZE && c < BLOCK_SIZE) board[r * BLOCK_SIZE + c] = ch === 'X' ? TILE_STONE : ch === '*' ? TILE_STAR : ch === 'I' ? TILE_ICE : 0
  }))
  return board
}

// ---------- 對局 ----------

export type BlockMove = [slot: number, row: number, col: number]
export type ChallengeStatus = 'playing' | 'won' | 'lost' | 'ended'

export type ChallengeRun = {
  spec: ChallengeSpec
  game: BlockState
  moves: BlockMove[]
  stars: number
  starsTotal: number
  stones: number
  /** 打裂的冰磚數 */
  ice: number
  gold: number
  bonus: number
  perfects: number
  status: ChallengeStatus
  reason: 'moves' | 'stuck' | null
}

export type ChallengeStep = {
  run: ChallengeRun
  result: BlockPlaceResult
  special: { stones: number; stars: number; gold: number; ice: number; bonus: number }
}

export function goalProgress(run: Pick<ChallengeRun, 'game' | 'stars' | 'stones'> & { ice?: number }, goal: BlockGoal): number {
  if (goal.kind === 'score') return run.game.score
  if (goal.kind === 'lines') return run.game.lines
  if (goal.kind === 'combo') return run.game.bestCombo
  if (goal.kind === 'stars') return run.stars
  if (goal.kind === 'ice') return run.ice ?? 0
  return run.stones
}

export function goalText(goal: BlockGoal): string {
  if (goal.kind === 'score') return `拿到 ${goal.target.toLocaleString()} 分`
  if (goal.kind === 'lines') return `消除 ${goal.target} 條`
  if (goal.kind === 'combo') return `打出 ×${goal.target} 連擊`
  if (goal.kind === 'stars') return `收集 ${goal.target} 顆星星`
  if (goal.kind === 'ice') return `打裂 ${goal.target} 塊冰磚`
  return `打碎 ${goal.target} 塊石磚`
}

function settle(run: ChallengeRun): ChallengeRun {
  const { spec, game } = run
  if (spec.goal && goalProgress(run, spec.goal) >= spec.goal.target) return { ...run, status: 'won', reason: null }
  if (spec.moveLimit !== null && game.moves >= spec.moveLimit) return { ...run, status: spec.goal ? 'lost' : 'ended', reason: 'moves' }
  if (game.over) return { ...run, status: spec.goal ? 'lost' : 'ended', reason: 'stuck' }
  return { ...run, status: 'playing', reason: null }
}

export function startRun(spec: ChallengeSpec): ChallengeRun {
  const board = layoutBoard(spec.layout)
  return settle({
    spec,
    game: newBlockGame(spec.seed, board),
    moves: [],
    stars: 0,
    starsTotal: board.filter((v) => v === TILE_STAR).length,
    stones: 0,
    ice: 0,
    gold: 0,
    bonus: 0,
    perfects: 0,
    status: 'playing',
    reason: null,
  })
}

export function stepRun(run: ChallengeRun, slot: number, row: number, col: number): ChallengeStep | { error: 'over' | 'missing' | 'blocked' } {
  if (run.status !== 'playing') return { error: 'over' }
  const piece = run.game.tray[slot]
  if (!piece) return { error: 'missing' }
  if (!canPlace(run.game.board, piece.shapeId, row, col)) return { error: 'blocked' }
  const stamped = stampPiece(run.game.board, piece, row, col)
  const result = placePiece(run.game, slot, row, col)
  if ('error' in result) return result
  const special = { stones: 0, stars: 0, gold: 0, ice: 0, bonus: 0 }
  const cracked: number[] = []
  for (const index of result.clearedCells) {
    if (stamped[index] === TILE_STONE) special.stones += 1
    else if (stamped[index] === TILE_STAR) special.stars += 1
    else if (stamped[index] === TILE_GOLD) special.gold += 1
    else if (stamped[index] === TILE_ICE) cracked.push(index)
  }
  special.ice = cracked.length
  special.bonus = special.stones * SPECIAL_BONUS.stone + special.stars * SPECIAL_BONUS.star + special.gold * SPECIAL_BONUS.gold + special.ice * SPECIAL_BONUS.ice
  let game = result.state
  let gained = result.gained
  if (cracked.length) {
    const board = game.board.slice()
    for (const index of cracked) board[index] = TILE_STONE
    // 冰磚裂成石磚還留在盤上，不算完美清盤。
    game = { ...game, board, over: !hasAnyMove(board, game.tray), score: game.score - gained.perfect }
    gained = { ...gained, total: gained.total - gained.perfect, perfect: 0 }
  }
  if (special.bonus) game = { ...game, score: game.score + special.bonus }
  const deal = game.dealt / 3 - 1
  if (result.refilled && run.spec.goldEvery > 0 && deal % run.spec.goldEvery === 0) {
    const goldSlot = deal % 3
    game = { ...game, tray: game.tray.map((item, i) => (item && i === goldSlot ? { ...item, color: TILE_GOLD } : item)) }
  }
  const perfect = gained.perfect > 0 ? 1 : 0
  const next = settle({
    ...run,
    game,
    moves: [...run.moves, [slot, row, col]],
    stars: run.stars + special.stars,
    stones: run.stones + special.stones,
    ice: run.ice + special.ice,
    gold: run.gold + special.gold,
    bonus: run.bonus + special.bonus,
    perfects: run.perfects + perfect,
  })
  return { run: next, result: { ...result, state: game, gained: { ...gained, total: gained.total + special.bonus } }, special }
}

/** 從頭重算整局；任何一步不合法就回傳 null。 */
export function replayRun(spec: ChallengeSpec, moves: readonly unknown[]): ChallengeRun | null {
  let run = startRun(spec)
  for (const raw of moves) {
    if (!Array.isArray(raw) || raw.length !== 3 || !raw.every((n) => Number.isInteger(n))) return null
    const step = stepRun(run, raw[0], raw[1], raw[2])
    if ('error' in step) return null
    run = step.run
  }
  return run
}

export type SavedRun = { key: string; moves: BlockMove[] }

export function parseSavedRun(raw: unknown): ChallengeRun | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (typeof v.key !== 'string' || !Array.isArray(v.moves) || v.moves.length > 3000) return null
  const spec = specFromKey(v.key)
  return spec ? replayRun(spec, v.moves) : null
}

// ---------- 本機紀錄 ----------

export type LevelRecord = { cleared: boolean; best: number; fewest: number | null; tries: number }
export type DailyRecord = LevelRecord
export type BlockStats = { games: number; lines: number; bestCombo: number; perfects: number; stones: number; stars: number }

export const EMPTY_STATS: BlockStats = { games: 0, lines: 0, bestCombo: 0, perfects: 0, stones: 0, stars: 0 }
const EMPTY_RECORD: LevelRecord = { cleared: false, best: 0, fewest: null, tries: 0 }
const DAILY_KEEP = 60

const nat = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : 0)

function parseRecord(raw: unknown): LevelRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  const fewest = typeof v.fewest === 'number' && Number.isInteger(v.fewest) && v.fewest > 0 ? v.fewest : null
  return { cleared: v.cleared === true, best: nat(v.best), fewest: v.cleared === true ? fewest : null, tries: nat(v.tries) }
}

export function parseRecords(raw: unknown, validKey: (key: string) => boolean): Record<string, LevelRecord> {
  const out: Record<string, LevelRecord> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const record = validKey(key) ? parseRecord(value) : null
    if (record) out[key] = record
  }
  return out
}

export const isLevelId = (key: string) => BLOCK_LEVELS.some((level) => String(level.id) === key)
export const isDayKey = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(key)

export function parseStats(raw: unknown): BlockStats {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATS }
  const v = raw as Record<string, unknown>
  return { games: nat(v.games), lines: nat(v.lines), bestCombo: nat(v.bestCombo), perfects: nat(v.perfects), stones: nat(v.stones), stars: nat(v.stars) }
}

/** 一局挑戰結束後更新該關或該日紀錄；只有真的結束（勝或負）才算一次挑戰。 */
export function recordRun(records: Record<string, LevelRecord>, id: string, run: ChallengeRun): Record<string, LevelRecord> {
  if (run.status === 'playing') return records
  const prev = records[id] ?? EMPTY_RECORD
  const won = run.status === 'won'
  const next: LevelRecord = {
    cleared: prev.cleared || won,
    best: Math.max(prev.best, run.game.score),
    fewest: won ? Math.min(prev.fewest ?? Infinity, run.game.moves) : prev.fewest,
    tries: prev.tries + 1,
  }
  const merged = { ...records, [id]: next }
  if (run.spec.mode !== 'daily') return merged
  const days = Object.keys(merged).sort()
  for (const day of days.slice(0, Math.max(0, days.length - DAILY_KEEP))) delete merged[day]
  return merged
}

/** 每一步的累計數據；三種模式都算，供成就使用。 */
export function addStepStats(stats: BlockStats, result: BlockPlaceResult, special: { stones: number; stars: number } | null): BlockStats {
  const lines = result.rows.length + result.cols.length
  return {
    ...stats,
    lines: stats.lines + lines,
    bestCombo: Math.max(stats.bestCombo, result.state.combo),
    perfects: stats.perfects + (result.gained.perfect > 0 ? 1 : 0),
    stones: stats.stones + (special?.stones ?? 0),
    stars: stats.stars + (special?.stars ?? 0),
  }
}

export function levelUnlocked(levels: Record<string, LevelRecord>, id: number): boolean {
  return id === BLOCK_LEVELS[0].id || Boolean(levels[String(id - 1)]?.cleared)
}

// ---------- 每週排行榜回應 ----------

export type WeeklyBoardRow = { rank: number; nickname: string; score: number; lines: number; bestCombo: number; me: boolean }
export type WeeklyBoard = {
  weekStart: string
  weekEnd: string
  total: number
  rows: WeeklyBoardRow[]
  me: { rank: number; score: number; lines: number; bestCombo: number } | null
}
export type RankedStart = { runId: string; seed: number; weekStart: string }
export type RankedSubmit =
  | { status: 'verified'; score: number; rank: number | null; weekBest: number | null; weekStart: string }
  | { status: 'rejected' | 'duplicate'; reason: string }

const posInt = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 1

/** 只取白名單欄位；就算資料庫多回傳了其他欄位也不會進到畫面。 */
export function parseWeeklyBoard(raw: unknown): WeeklyBoard | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (typeof v.weekStart !== 'string' || !isDayKey(v.weekStart) || typeof v.weekEnd !== 'string' || !isDayKey(v.weekEnd)) return null
  if (!Array.isArray(v.rows)) return null
  const rows: WeeklyBoardRow[] = []
  for (const item of v.rows as unknown[]) {
    const r = (item ?? {}) as Record<string, unknown>
    if (!posInt(r.rank) || typeof r.nickname !== 'string') return null
    rows.push({ rank: r.rank as number, nickname: r.nickname.slice(0, 24), score: nat(r.score), lines: nat(r.lines), bestCombo: nat(r.bestCombo), me: r.me === true })
  }
  const m = v.me && typeof v.me === 'object' ? (v.me as Record<string, unknown>) : null
  return {
    weekStart: v.weekStart,
    weekEnd: v.weekEnd,
    total: nat(v.total),
    rows,
    me: m && posInt(m.rank) ? { rank: m.rank as number, score: nat(m.score), lines: nat(m.lines), bestCombo: nat(m.bestCombo) } : null,
  }
}

export function parseRankedStart(raw: unknown): RankedStart | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (typeof v.runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(v.runId)) return null
  if (typeof v.seed !== 'number' || !Number.isInteger(v.seed) || typeof v.weekStart !== 'string' || !isDayKey(v.weekStart)) return null
  return { runId: v.runId, seed: v.seed | 0, weekStart: v.weekStart }
}

export function parseRankedSubmit(raw: unknown): RankedSubmit | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (v.status === 'verified' && typeof v.weekStart === 'string') {
    return { status: 'verified', score: nat(v.score), rank: posInt(v.rank) ? (v.rank as number) : null, weekBest: typeof v.weekBest === 'number' ? nat(v.weekBest) : null, weekStart: v.weekStart }
  }
  if (v.status === 'rejected' || v.status === 'duplicate') return { status: v.status, reason: typeof v.reason === 'string' ? v.reason : 'unknown' }
  return null
}

export const RANKED_REJECT_TEXT: Record<string, string> = {
  format: '對局紀錄格式不正確',
  expired: '開局超過 24 小時，成績不列入排行',
  too_fast: '送出速度異常，成績不列入排行',
  illegal_move: '伺服器重算時發現不合法的步驟',
  not_finished: '對局還沒結束，不能送出',
  already_closed: '這場排行賽已經送出過，不會重複計算',
}

// ---------- 成就 ----------

/** 正式勳章、特權或 Pay 點數尚未簽核；這裡只判定本機進度，不發任何東西。 */
export const BLOCK_ACHIEVEMENT_GRANT_ENABLED = false as const

export type BlockAchievementGroup = 'score' | 'lines' | 'combo' | 'levels'
export type BlockAchievementContext = { best: number; stats: BlockStats; levels: Record<string, LevelRecord>; daily: Record<string, DailyRecord> }
type BlockAchievementDef = { id: string; name: string; detail: string; group: BlockAchievementGroup; target: number; metric: (ctx: BlockAchievementContext) => number }

const chapterLevels = (chapter: 1 | 2) => BLOCK_LEVELS.filter((level) => level.chapter === chapter)
const clearedIn = (chapter: 1 | 2) => (ctx: BlockAchievementContext) => chapterLevels(chapter).filter((level) => ctx.levels[String(level.id)]?.cleared).length
/** 第一章的關卡成就維持原本 8 關的門檻，加入第二章後已解鎖的成就不會倒退。 */
const clearedLevels = clearedIn(1)
const clearedDays = (ctx: BlockAchievementContext) => Object.values(ctx.daily).filter((record) => record.cleared).length

export const BLOCK_ACHIEVEMENTS: readonly BlockAchievementDef[] = [
  { id: 'score_1k', name: '初試身手', detail: '經典模式單局 1,000 分', group: 'score', target: 1000, metric: (ctx) => ctx.best },
  { id: 'score_5k', name: '方塊高手', detail: '經典模式單局 5,000 分', group: 'score', target: 5000, metric: (ctx) => ctx.best },
  { id: 'score_12k', name: '萬分店長', detail: '經典模式單局 12,000 分', group: 'score', target: 12000, metric: (ctx) => ctx.best },
  { id: 'lines_50', name: '清潔小幫手', detail: '累計消除 50 條', group: 'lines', target: 50, metric: (ctx) => ctx.stats.lines },
  { id: 'lines_300', name: '整理達人', detail: '累計消除 300 條', group: 'lines', target: 300, metric: (ctx) => ctx.stats.lines },
  { id: 'perfect_1', name: '一塵不染', detail: '完成 1 次完美清盤', group: 'lines', target: 1, metric: (ctx) => ctx.stats.perfects },
  { id: 'combo_4', name: '連擊上手', detail: '打出 ×4 連擊', group: 'combo', target: 4, metric: (ctx) => ctx.stats.bestCombo },
  { id: 'combo_8', name: '連擊風暴', detail: '打出 ×8 連擊', group: 'combo', target: 8, metric: (ctx) => ctx.stats.bestCombo },
  { id: 'level_1', name: '開市大吉', detail: '通過第 1 關', group: 'levels', target: 1, metric: clearedLevels },
  { id: 'level_4', name: '夜市常客', detail: '通過 4 個挑戰關卡', group: 'levels', target: 4, metric: clearedLevels },
  { id: 'level_all', name: '夜市之王', detail: `通過第一章全部 ${chapterLevels(1).length} 個挑戰關卡`, group: 'levels', target: chapterLevels(1).length, metric: clearedLevels },
  { id: 'frost_1', name: '破冰新手', detail: '通過第二章第 9 關', group: 'levels', target: 1, metric: (ctx) => (ctx.levels['9']?.cleared ? 1 : 0) },
  { id: 'frost_all', name: '冰雪市集之王', detail: `通過第二章全部 ${chapterLevels(2).length} 個挑戰關卡`, group: 'levels', target: chapterLevels(2).length, metric: clearedIn(2) },
  { id: 'daily_1', name: '今日打卡', detail: '完成 1 次每日挑戰', group: 'levels', target: 1, metric: clearedDays },
  { id: 'daily_7', name: '一週全勤', detail: '累計完成 7 天每日挑戰', group: 'levels', target: 7, metric: clearedDays },
]

export type BlockAchievementView = { id: string; name: string; detail: string; group: BlockAchievementGroup; target: number; current: number; state: 'done' | 'progress' | 'locked' }

export function evaluateAchievements(ctx: BlockAchievementContext): BlockAchievementView[] {
  return BLOCK_ACHIEVEMENTS.map(({ metric, ...def }) => {
    const current = Math.min(def.target, Math.max(0, Math.floor(metric(ctx))))
    return { ...def, current, state: current >= def.target ? 'done' : current > 0 ? 'progress' : 'locked' }
  })
}

export function newlyDone(before: readonly BlockAchievementView[], after: readonly BlockAchievementView[]): BlockAchievementView[] {
  const was = new Set(before.filter((item) => item.state === 'done').map((item) => item.id))
  return after.filter((item) => item.state === 'done' && !was.has(item.id))
}
