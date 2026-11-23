/**
 * Pay 服方塊大挑戰的單局規則。純函式、不碰網路與資料庫，畫面與檢查腳本共用同一份。
 * 分數只在這裡計算；本批不發放 Pay 點，後續批次要結算時以 BlockState 為準重算。
 */

export const BLOCK_SIZE = 8
export const BLOCK_TRAY_SIZE = 3
/** 消除後連擊可保留的放置次數，期間再消除一次就繼續累加。 */
export const BLOCK_COMBO_GRACE = 3
export const BLOCK_PERFECT_BONUS = 300

export const BLOCK_COLORS = ['orange', 'amber', 'coral', 'mint', 'sky', 'grape', 'leaf'] as const
export type BlockColor = (typeof BLOCK_COLORS)[number]

/** 0 為空格，其餘是 BLOCK_COLORS 的索引 + 1。 */
export type BlockBoard = number[]

export type BlockShape = { id: string; cells: ReadonlyArray<readonly [row: number, col: number]>; weight: number }

const shape = (id: string, rows: string[], weight: number): BlockShape => {
  const cells: Array<[number, number]> = []
  rows.forEach((line, r) => [...line].forEach((ch, c) => { if (ch === '#') cells.push([r, c]) }))
  return { id, cells, weight }
}

export const BLOCK_SHAPES: readonly BlockShape[] = [
  shape('dot', ['#'], 3),
  shape('i2h', ['##'], 5),
  shape('i2v', ['#', '#'], 5),
  shape('i3h', ['###'], 6),
  shape('i3v', ['#', '#', '#'], 6),
  shape('i4h', ['####'], 4),
  shape('i4v', ['#', '#', '#', '#'], 4),
  shape('i5h', ['#####'], 2),
  shape('i5v', ['#', '#', '#', '#', '#'], 2),
  shape('o2', ['##', '##'], 6),
  shape('o3', ['###', '###', '###'], 2),
  shape('r23', ['###', '###'], 3),
  shape('r32', ['##', '##', '##'], 3),
  shape('v1', ['##', '#.'], 4),
  shape('v2', ['##', '.#'], 4),
  shape('v3', ['#.', '##'], 4),
  shape('v4', ['.#', '##'], 4),
  shape('big-v1', ['###', '#..', '#..'], 2),
  shape('big-v2', ['###', '..#', '..#'], 2),
  shape('big-v3', ['#..', '#..', '###'], 2),
  shape('big-v4', ['..#', '..#', '###'], 2),
  shape('l1', ['#.', '#.', '##'], 3),
  shape('l2', ['###', '#..'], 3),
  shape('l3', ['##', '.#', '.#'], 3),
  shape('l4', ['..#', '###'], 3),
  shape('j1', ['.#', '.#', '##'], 3),
  shape('j2', ['#..', '###'], 3),
  shape('j3', ['##', '#.', '#.'], 3),
  shape('j4', ['###', '..#'], 3),
  shape('t1', ['###', '.#.'], 3),
  shape('t2', ['.#.', '###'], 3),
  shape('t3', ['#.', '##', '#.'], 3),
  shape('t4', ['.#', '##', '.#'], 3),
  shape('s1', ['.##', '##.'], 2),
  shape('s2', ['#.', '##', '.#'], 2),
  shape('z1', ['##.', '.##'], 2),
  shape('z2', ['.#', '##', '#.'], 2),
]

const SHAPE_BY_ID = new Map(BLOCK_SHAPES.map((item) => [item.id, item]))
export const blockShape = (id: string): BlockShape => SHAPE_BY_ID.get(id) ?? BLOCK_SHAPES[0]

export const shapeBounds = (item: BlockShape) => ({
  rows: Math.max(...item.cells.map(([r]) => r)) + 1,
  cols: Math.max(...item.cells.map(([, c]) => c)) + 1,
})

export type BlockPiece = { key: string; shapeId: string; color: number }

export type BlockState = {
  seed: number
  rng: number
  board: BlockBoard
  tray: Array<BlockPiece | null>
  score: number
  combo: number
  comboLeft: number
  bestCombo: number
  lines: number
  moves: number
  dealt: number
  over: boolean
}

/** mulberry32，回傳下一個亂數狀態與 [0, 1) 的值。 */
function nextRandom(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296]
}

export const emptyBoard = (): BlockBoard => Array<number>(BLOCK_SIZE * BLOCK_SIZE).fill(0)

export function canPlace(board: BlockBoard, shapeId: string, row: number, col: number): boolean {
  return blockShape(shapeId).cells.every(([r, c]) => {
    const rr = row + r
    const cc = col + c
    return rr >= 0 && rr < BLOCK_SIZE && cc >= 0 && cc < BLOCK_SIZE && board[rr * BLOCK_SIZE + cc] === 0
  })
}

export function fitsAnywhere(board: BlockBoard, shapeId: string): boolean {
  for (let row = 0; row < BLOCK_SIZE; row += 1) {
    for (let col = 0; col < BLOCK_SIZE; col += 1) {
      if (canPlace(board, shapeId, row, col)) return true
    }
  }
  return false
}

export function hasAnyMove(board: BlockBoard, tray: ReadonlyArray<BlockPiece | null>): boolean {
  return tray.some((piece) => piece !== null && fitsAnywhere(board, piece.shapeId))
}

/** 放下後會被填滿的行與列；畫面用來預覽，placePiece 用來真正消除。 */
export function completedLines(board: BlockBoard): { rows: number[]; cols: number[] } {
  const rows: number[] = []
  const cols: number[] = []
  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    let rowFull = true
    let colFull = true
    for (let j = 0; j < BLOCK_SIZE; j += 1) {
      if (board[i * BLOCK_SIZE + j] === 0) rowFull = false
      if (board[j * BLOCK_SIZE + i] === 0) colFull = false
    }
    if (rowFull) rows.push(i)
    if (colFull) cols.push(i)
  }
  return { rows, cols }
}

export function stampPiece(board: BlockBoard, piece: BlockPiece, row: number, col: number): BlockBoard {
  const next = board.slice()
  for (const [r, c] of blockShape(piece.shapeId).cells) next[(row + r) * BLOCK_SIZE + col + c] = piece.color
  return next
}

export function previewLines(board: BlockBoard, piece: BlockPiece, row: number, col: number) {
  if (!canPlace(board, piece.shapeId, row, col)) return { rows: [], cols: [] }
  return completedLines(stampPiece(board, piece, row, col))
}

/** 同時消除的行列越多加成越高：1 條 100、2 條 300、3 條 600…… */
export const lineBonus = (lines: number) => 50 * lines * (lines + 1)
/** 連擊加成：第 n 次連擊每條線多 50 × (n − 1)。 */
export const comboBonus = (combo: number, lines: number) => (combo > 1 ? 50 * (combo - 1) * lines : 0)

function dealTray(rng: number, board: BlockBoard, dealt: number): { tray: BlockPiece[]; rng: number } {
  const total = BLOCK_SHAPES.reduce((sum, item) => sum + item.weight, 0)
  const pick = (state: number): [BlockShape, number] => {
    const [s1, roll] = nextRandom(state)
    let left = roll * total
    for (const item of BLOCK_SHAPES) {
      left -= item.weight
      if (left < 0) return [item, s1]
    }
    return [BLOCK_SHAPES[0], s1]
  }
  let state = rng
  let tray: BlockPiece[] = []
  // 盡量讓三塊中至少一塊放得下；真的沒有空位時照常發牌，交給結束判定。
  for (let attempt = 0; attempt < 12; attempt += 1) {
    tray = []
    for (let i = 0; i < BLOCK_TRAY_SIZE; i += 1) {
      const [item, s1] = pick(state)
      const [s2, colorRoll] = nextRandom(s1)
      state = s2
      tray.push({ key: `p${dealt + i}-${attempt}`, shapeId: item.id, color: 1 + Math.floor(colorRoll * BLOCK_COLORS.length) })
    }
    if (hasAnyMove(board, tray)) break
  }
  return { tray, rng: state }
}

/** 挑戰模式會帶入有障礙格的開局棋盤；經典模式一律從空棋盤開始。 */
export function newBlockGame(seed: number, board: BlockBoard = emptyBoard()): BlockState {
  const { tray, rng } = dealTray(seed | 0, board, 0)
  return { seed: seed | 0, rng, board, tray, score: 0, combo: 0, comboLeft: 0, bestCombo: 0, lines: 0, moves: 0, dealt: BLOCK_TRAY_SIZE, over: !hasAnyMove(board, tray) }
}

/** 讀回本機暫存的牌局；任何欄位不合法就當作沒有存檔。 */
export function parseBlockState(raw: unknown): BlockState | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  const int = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0
  if (!Array.isArray(v.board) || v.board.length !== BLOCK_SIZE * BLOCK_SIZE) return null
  if (!v.board.every((cell) => int(cell) && (cell as number) <= BLOCK_COLORS.length)) return null
  if (!Array.isArray(v.tray) || v.tray.length !== BLOCK_TRAY_SIZE) return null
  const tray: Array<BlockPiece | null> = []
  for (const item of v.tray as unknown[]) {
    if (item === null) { tray.push(null); continue }
    const p = item as Record<string, unknown>
    if (typeof p.key !== 'string' || typeof p.shapeId !== 'string' || !SHAPE_BY_ID.has(p.shapeId)) return null
    if (!int(p.color) || (p.color as number) < 1 || (p.color as number) > BLOCK_COLORS.length) return null
    tray.push({ key: p.key, shapeId: p.shapeId, color: p.color as number })
  }
  if (tray.every((item) => item === null)) return null
  const nums = ['score', 'combo', 'comboLeft', 'bestCombo', 'lines', 'moves', 'dealt'] as const
  if (!nums.every((key) => int(v[key])) || typeof v.seed !== 'number' || typeof v.rng !== 'number') return null
  const board = (v.board as number[]).slice()
  return {
    seed: v.seed | 0,
    rng: v.rng | 0,
    board,
    tray,
    score: v.score as number,
    combo: v.combo as number,
    comboLeft: Math.min(v.comboLeft as number, BLOCK_COMBO_GRACE),
    bestCombo: v.bestCombo as number,
    lines: v.lines as number,
    moves: v.moves as number,
    dealt: v.dealt as number,
    over: !hasAnyMove(board, tray),
  }
}

export type BlockPlaceResult = {
  state: BlockState
  placedCells: number[]
  clearedCells: number[]
  rows: number[]
  cols: number[]
  gained: { place: number; lines: number; combo: number; perfect: number; total: number }
  refilled: boolean
}

export const BLOCK_ERRORS = {
  over: '這局已經結束',
  missing: '這個方塊已經用掉了',
  blocked: '這個位置放不下',
} as const

export function placePiece(state: BlockState, slot: number, row: number, col: number): BlockPlaceResult | { error: keyof typeof BLOCK_ERRORS } {
  if (state.over) return { error: 'over' }
  const piece = state.tray[slot]
  if (!piece) return { error: 'missing' }
  if (!canPlace(state.board, piece.shapeId, row, col)) return { error: 'blocked' }

  const cells = blockShape(piece.shapeId).cells
  const placedCells = cells.map(([r, c]) => (row + r) * BLOCK_SIZE + col + c)
  const stamped = stampPiece(state.board, piece, row, col)
  const { rows, cols } = completedLines(stamped)
  const cleared = new Set<number>()
  for (const r of rows) for (let c = 0; c < BLOCK_SIZE; c += 1) cleared.add(r * BLOCK_SIZE + c)
  for (const c of cols) for (let r = 0; r < BLOCK_SIZE; r += 1) cleared.add(r * BLOCK_SIZE + c)
  const board = stamped.map((value, index) => (cleared.has(index) ? 0 : value))

  const lineCount = rows.length + cols.length
  let combo = state.combo
  let comboLeft = state.comboLeft
  if (lineCount > 0) {
    combo += 1
    comboLeft = BLOCK_COMBO_GRACE
  } else if (comboLeft > 0) {
    comboLeft -= 1
    if (comboLeft === 0) combo = 0
  }
  const perfect = lineCount > 0 && board.every((value) => value === 0) ? BLOCK_PERFECT_BONUS : 0
  const gained = {
    place: cells.length,
    lines: lineBonus(lineCount),
    combo: lineCount > 0 ? comboBonus(combo, lineCount) : 0,
    perfect,
    total: 0,
  }
  gained.total = gained.place + gained.lines + gained.combo + gained.perfect

  let tray = state.tray.map((item, index) => (index === slot ? null : item))
  let rng = state.rng
  let dealt = state.dealt
  const refilled = tray.every((item) => item === null)
  if (refilled) {
    const next = dealTray(rng, board, dealt)
    tray = next.tray
    rng = next.rng
    dealt += BLOCK_TRAY_SIZE
  }

  const nextState: BlockState = {
    ...state,
    rng,
    board,
    tray,
    dealt,
    score: state.score + gained.total,
    combo,
    comboLeft,
    bestCombo: Math.max(state.bestCombo, combo),
    lines: state.lines + lineCount,
    moves: state.moves + 1,
    over: !hasAnyMove(board, tray),
  }
  return { state: nextState, placedCells, clearedCells: [...cleared], rows, cols, gained, refilled }
}
