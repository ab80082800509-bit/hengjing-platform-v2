import {
  BLOCK_COMBO_GRACE,
  BLOCK_PERFECT_BONUS,
  BLOCK_SHAPES,
  BLOCK_SIZE,
  canPlace,
  comboBonus,
  emptyBoard,
  fitsAnywhere,
  hasAnyMove,
  lineBonus,
  newBlockGame,
  parseBlockState,
  placePiece,
  previewLines,
  type BlockState,
} from '../lib/arcade/block-rules'
import { marketplaceHref, readMarketplaceNav } from '../lib/marketplace-url'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}
const idx = (r: number, c: number) => r * BLOCK_SIZE + c
const withTray = (state: BlockState, ...shapeIds: string[]): BlockState => ({
  ...state,
  tray: shapeIds.map((shapeId, i) => ({ key: `t${i}`, shapeId, color: 1 })),
})

assert(BLOCK_SHAPES.every((item) => item.cells.length > 0 && item.weight > 0), '方塊形狀資料不完整')
assert(new Set(BLOCK_SHAPES.map((item) => item.id)).size === BLOCK_SHAPES.length, '方塊形狀 id 重複')

const fresh = newBlockGame(42)
assert(fresh.tray.length === 3 && fresh.tray.every(Boolean), '開局要發三塊')
assert(JSON.stringify(newBlockGame(42)) === JSON.stringify(fresh), '同一個種子要發出同樣的牌')
assert(!fresh.over && fresh.score === 0, '開局狀態錯誤')

const board = emptyBoard()
assert(canPlace(board, 'i5h', 0, 3) && !canPlace(board, 'i5h', 0, 4), '邊界判定錯誤')
board[idx(0, 0)] = 1
assert(!canPlace(board, 'o2', 0, 0) && canPlace(board, 'o2', 1, 0), '佔用格判定錯誤')

// 單行消除：第 0 行先填 7 格，再放一個單格。
let s = withTray(fresh, 'dot', 'dot', 'dot')
s.board = emptyBoard()
for (let c = 1; c < BLOCK_SIZE; c += 1) s.board[idx(0, c)] = 2
s.board[idx(5, 5)] = 3
assert(previewLines(s.board, s.tray[0]!, 0, 0).rows[0] === 0, '預覽消除行錯誤')
let r = placePiece(s, 0, 0, 0)
assert(!('error' in r), '合法放置失敗')
if ('error' in r) throw new Error()
assert(r.rows.length === 1 && r.cols.length === 0 && r.clearedCells.length === 8, '單行消除錯誤')
assert(r.gained.total === 1 + lineBonus(1) && r.state.combo === 1, '單行分數或連擊錯誤')
assert(r.state.board.slice(0, 8).every((v) => v === 0) && r.state.board[idx(5, 5)] === 3, '消除後棋盤錯誤')

// 連擊：保留 3 手，第 2 次消除有加成。
s = r.state
for (let c = 0; c < BLOCK_SIZE - 1; c += 1) s.board[idx(1, c)] = 2
r = placePiece(s, 1, 4, 4)
if ('error' in r) throw new Error(r.error)
assert(r.state.combo === 1 && r.state.comboLeft === BLOCK_COMBO_GRACE - 1, '未消除時連擊應保留')
r = placePiece(r.state, 2, 1, 7)
if ('error' in r) throw new Error(r.error)
assert(r.state.combo === 2 && r.gained.combo === comboBonus(2, 1) && r.gained.combo > 0, '連擊加成錯誤')
assert(r.refilled && r.state.tray.every(Boolean), '三塊用完要補牌')

// 連擊在保留步數用完後中斷。
let c3 = withTray(r.state, 'dot', 'dot', 'dot')
c3.board = emptyBoard()
c3.board[idx(7, 7)] = 1
for (let i = 0; i < BLOCK_COMBO_GRACE; i += 1) {
  const step = placePiece(c3, i, 3, i)
  if ('error' in step) throw new Error(step.error)
  c3 = step.state
}
assert(c3.combo === 0, '連擊保留步數用完應中斷')

// 同時消除一行一列＋全清獎勵。
s = withTray(fresh, 'dot', 'i2h', 'i2h')
s.board = emptyBoard()
for (let c = 1; c < BLOCK_SIZE; c += 1) s.board[idx(0, c)] = 4
for (let rr = 1; rr < BLOCK_SIZE; rr += 1) s.board[idx(rr, 0)] = 4
r = placePiece(s, 0, 0, 0)
if ('error' in r) throw new Error(r.error)
assert(r.rows.length === 1 && r.cols.length === 1 && r.clearedCells.length === 15, '行列同時消除錯誤')
assert(r.gained.perfect === BLOCK_PERFECT_BONUS && r.gained.lines === lineBonus(2), '多線或全清分數錯誤')

// 非法放置不改狀態。
const bad = placePiece(s, 1, 0, 7)
assert('error' in bad && bad.error === 'blocked', '越界應拒絕')
assert('error' in placePiece({ ...s, tray: [null, null, null] }, 0, 0, 0), '用掉的方塊應拒絕')

// 結束判定：棋盤棋盤格狀填滿，只剩 2 格以上的方塊。
const full = emptyBoard().map((_, i) => ((Math.floor(i / BLOCK_SIZE) + i) % 2 === 0 ? 1 : 0))
assert(!fitsAnywhere(full, 'i2h') && !fitsAnywhere(full, 'o2') && fitsAnywhere(full, 'dot'), '格狀棋盤判定錯誤')
s = withTray(fresh, 'dot', 'i2h', 'o2')
s.board = full.slice()
r = placePiece(s, 0, 0, 1)
if ('error' in r) throw new Error(r.error)
assert(r.state.over && !hasAnyMove(r.state.board, r.state.tray), '無合法放置時要結束')
assert('error' in placePiece(r.state, 1, 0, 0), '結束後不能再放')

// 隨機自動對局：分數只增不減、棋盤值合法、最後一定能結束。
for (let seed = 1; seed <= 30; seed += 1) {
  let g = newBlockGame(seed)
  let guard = 0
  while (!g.over && guard < 5000) {
    guard += 1
    let moved = false
    for (let slot = 0; slot < 3 && !moved; slot += 1) {
      const piece = g.tray[slot]
      if (!piece) continue
      for (let p = 0; p < 64 && !moved; p += 1) {
        const res = placePiece(g, slot, Math.floor(p / 8), p % 8)
        if ('error' in res) continue
        assert(res.state.score >= g.score && res.state.board.every((v) => v >= 0 && v <= 7), '自動對局狀態錯誤')
        g = res.state
        moved = true
      }
    }
    assert(moved || g.over, '還有合法放置卻找不到')
  }
  assert(g.over, `種子 ${seed} 沒有結束`)
}

// 存檔讀回：合法存檔原樣還原，竄改過的存檔丟棄。
const mid = newBlockGame(7)
assert(JSON.stringify(parseBlockState(JSON.parse(JSON.stringify(mid)))) === JSON.stringify(mid), '存檔讀回不一致')
assert(parseBlockState({ ...mid, board: mid.board.slice(1) }) === null, '棋盤長度錯誤的存檔要丟棄')
assert(parseBlockState({ ...mid, tray: [{ key: 'x', shapeId: 'nope', color: 1 }, null, null] }) === null, '未知形狀的存檔要丟棄')

// 網址可以直接開啟方塊遊戲，也不影響合成小舖。
const blocksNav = readMarketplaceNav(new URLSearchParams('page=arcade&game=blocks'))
assert(blocksNav.page === 'arcade' && blocksNav.game === 'blocks', '方塊遊戲網址讀取錯誤')
assert(marketplaceHref('/', blocksNav).includes('game=blocks'), '方塊遊戲網址產生錯誤')
assert(readMarketplaceNav(new URLSearchParams('page=arcade&game=merge')).game === 'merge', '合成小舖網址被影響')
assert(readMarketplaceNav(new URLSearchParams('page=arcade&game=hack')).game === null, '未知遊戲應忽略')

console.log('方塊大挑戰規則檢查通過')
