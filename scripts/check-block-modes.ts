/**
 * 第七階段第 2 批：方塊挑戰關卡、每日挑戰、特殊格、本機成就與排行賽重算檢查。
 * 純規則檢查，不連資料庫；排行榜 SQL 只比對檔案內容，不執行。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BLOCK_SHAPES, BLOCK_SIZE, fitsAnywhere, newBlockGame, placePiece, type BlockState } from '../lib/arcade/block-rules'
import {
  BLOCK_LEVELS,
  EMPTY_STATS,
  SPECIAL_BONUS,
  TILE_GOLD,
  TILE_ICE,
  TILE_STAR,
  TILE_STONE,
  addStepStats,
  dailySpec,
  evaluateAchievements,
  goalProgress,
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
  replayRun,
  specFromKey,
  startRun,
  stepRun,
  taipeiDayKey,
  taipeiWeek,
  type ChallengeRun,
  type ChallengeSpec,
} from '../lib/arcade/block-modes'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}
const idx = (r: number, c: number) => r * BLOCK_SIZE + c

// ---------- 簡單的貪婪機器人：證明固定種子的關卡確實打得過 ----------

const PROBES = ['o3', 'i5h', 'i5v', 'big-v1']
const mobility = (board: number[]) => PROBES.filter((id) => fitsAnywhere(board, id)).length
/** 目標是石磚或星星時，偏好把含特殊格的行列填滿。 */
function targetPull(board: number[], tile: number) {
  let pull = 0
  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    let rowHit = false
    let colHit = false
    let rowFill = 0
    let colFill = 0
    for (let j = 0; j < BLOCK_SIZE; j += 1) {
      const rv = board[idx(i, j)]
      const cv = board[idx(j, i)]
      if (rv === tile) rowHit = true
      if (cv === tile) colHit = true
      if (rv) rowFill += 1
      if (cv) colFill += 1
    }
    if (rowHit) pull += rowFill * rowFill
    if (colHit) pull += colFill * colFill
  }
  return pull
}

function botPlay(spec: ChallengeSpec, maxMoves = 400): ChallengeRun {
  let run = startRun(spec)
  while (run.status === 'playing' && run.moves.length < maxMoves) {
    let best: { score: number; run: ChallengeRun } | null = null
    for (let slot = 0; slot < 3; slot += 1) {
      if (!run.game.tray[slot]) continue
      for (let p = 0; p < 64; p += 1) {
        const step = stepRun(run, slot, Math.floor(p / 8), p % 8)
        if ('error' in step) continue
        const next = step.run
        let score = 0
        if (next.status === 'won') score += 1e9 - next.moves.length
        if (next.status === 'lost') score -= 1e9
        if (spec.goal) {
          const gain = goalProgress(next, spec.goal) - goalProgress(run, spec.goal)
          score += (spec.goal.kind === 'score' ? gain / 10 : gain) * 400
        }
        const lines = step.result.rows.length + step.result.cols.length
        score += lines * 120 + (lines > 0 ? next.game.combo * 60 : 0)
        score += next.game.board.filter((v) => v === 0).length * 6 + mobility(next.game.board) * 90
        if (spec.goal?.kind === 'stones') score += (targetPull(next.game.board, TILE_STONE) + targetPull(next.game.board, TILE_ICE)) * 2
        if (spec.goal?.kind === 'stars') score += targetPull(next.game.board, TILE_STAR) * 2
        if (spec.goal?.kind === 'ice') score += targetPull(next.game.board, TILE_ICE) * 2
        if (!best || score > best.score) best = { score, run: next }
      }
    }
    if (!best) break
    run = best.run
  }
  return run
}

// ---------- 關卡 ----------

for (const level of BLOCK_LEVELS) {
  const spec = levelSpec(level)
  assert(level.layout === null || (level.layout.length === 8 && level.layout.every((line) => (level.chapter === 1 ? /^[.X*]{8}$/ : /^[.X*I]{8}$/).test(line))), `第 ${level.id} 關版面格式錯誤`)
  const start = startRun(spec)
  if (level.goal.kind === 'ice') assert(start.game.board.filter((v) => v === TILE_ICE).length >= level.goal.target, `第 ${level.id} 關冰磚不夠`)
  if (level.goal.kind === 'stones' && level.chapter === 2) assert(start.game.board.filter((v) => v === TILE_STONE || v === TILE_ICE).length >= level.goal.target, `第 ${level.id} 關石磚與冰磚不夠`)
  assert(start.status === 'playing' && !start.game.over, `第 ${level.id} 關開局就結束`)
  if (level.goal.kind === 'stars') assert(start.starsTotal >= level.goal.target, `第 ${level.id} 關星星不夠`)
  if (level.goal.kind === 'stones' && level.chapter === 1) assert(start.game.board.filter((v) => v === TILE_STONE).length >= level.goal.target, `第 ${level.id} 關石磚不夠`)
  assert(JSON.stringify(startRun(spec)) === JSON.stringify(start), `第 ${level.id} 關開局不可重現`)
  const played = botPlay(spec)
  assert(played.status === 'won', `第 ${level.id} 關機器人打不過（${played.status}/${played.reason}，${played.game.moves} 步，進度 ${goalProgress(played, level.goal)}/${level.goal.target}）`)
  assert(played.game.moves <= level.moveLimit, `第 ${level.id} 關超過步數仍判勝`)
  const again = replayRun(spec, played.moves)
  assert(again && JSON.stringify(again) === JSON.stringify(played), `第 ${level.id} 關重算結果不同`)
  console.log(`  ✓ 第 ${level.id} 關 ${level.name}：${played.game.moves}/${level.moveLimit} 步過關，${played.game.score} 分`)
}

// 成功後不能再放；失敗判定：步數用完。
{
  const spec = levelSpec(BLOCK_LEVELS[0])
  const won = botPlay(spec)
  const [s, r, c] = [0, 0, 0]
  assert('error' in stepRun(won, s, r, c), '過關後不能再放方塊')
  const tight: ChallengeSpec = { ...spec, moveLimit: 3 }
  let run = startRun(tight)
  for (let i = 0; i < 3; i += 1) {
    const slot = run.game.tray.findIndex(Boolean)
    let moved = false
    for (let p = 0; p < 64 && !moved; p += 1) {
      const step = stepRun(run, slot, Math.floor(p / 8), p % 8)
      if ('error' in step) continue
      run = step.run
      moved = true
    }
  }
  assert(run.status === 'lost' && run.reason === 'moves', '步數用完沒達標要判失敗')
  assert('error' in stepRun(run, 0, 0, 0), '失敗後不能再放方塊')
}

// 失敗判定：沒有位置可放。
{
  const spec: ChallengeSpec = { ...levelSpec(BLOCK_LEVELS[0]), layout: Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => ((r + c) % 2 ? 'X' : '.')).join('')) }
  const run = startRun(spec)
  const fits = run.game.tray.some((p) => p && fitsAnywhere(run.game.board, p.shapeId))
  assert(fits ? run.status === 'playing' : run.status === 'lost' && run.reason === 'stuck', '開局卡死要判失敗')
}

// ---------- 特殊格 ----------
{
  const base = startRun({ ...levelSpec(BLOCK_LEVELS[0]), layout: ['XXXXXXX.', '*.......', '........', '........', '........', '........', '........', '........'], goal: { kind: 'stones', target: 7 } })
  const run: ChallengeRun = { ...base, game: { ...base.game, tray: [{ key: 'a', shapeId: 'dot', color: 1 }, null, null] } }
  const step = stepRun(run, 0, 0, 7)
  if ('error' in step) throw new Error(step.error)
  assert(step.special.stones === 7 && step.run.stones === 7, '石磚要跟著整行一起打碎')
  assert(step.special.bonus === 7 * SPECIAL_BONUS.stone, '石磚加分錯誤')
  assert(step.run.game.score === step.result.gained.total && step.result.gained.total === 1 + 100 + 7 * SPECIAL_BONUS.stone, '特殊加分沒算進總分')
  assert(step.run.status === 'won', '達到石磚目標要立即過關')
  assert(step.run.game.board[idx(1, 0)] === TILE_STAR, '沒消到的星星要留著')

  const starRun: ChallengeRun = { ...base, game: { ...base.game, board: base.game.board.map((v, i) => (i >= 8 && i < 16 && i !== 15 ? (i === 8 ? TILE_STAR : 3) : 0)), tray: [{ key: 'a', shapeId: 'dot', color: 1 }, null, null] } }
  const starStep = stepRun(starRun, 0, 1, 7)
  if ('error' in starStep) throw new Error(starStep.error)
  assert(starStep.special.stars === 1 && starStep.special.bonus === SPECIAL_BONUS.star, '星星收集錯誤')
}

// 冰磚：第一次消除裂成石磚留在原位，第二次才清掉；裂冰不算完美清盤。
{
  const base = startRun({ ...levelSpec(BLOCK_LEVELS[0]), layout: ['IIIIIII.', '........', '........', '........', '........', '........', '........', '........'], goal: { kind: 'ice', target: 99 } })
  const dot = { key: 'a', shapeId: 'dot', color: 1 }
  const run: ChallengeRun = { ...base, game: { ...base.game, tray: [dot, { ...dot, key: 'b' }, null] } }
  const first = stepRun(run, 0, 0, 7)
  if ('error' in first) throw new Error(first.error)
  assert(first.special.ice === 7 && first.run.ice === 7 && first.special.stones === 0, '冰磚第一次消除要算打裂')
  assert(first.special.bonus === 7 * SPECIAL_BONUS.ice, '冰磚加分錯誤')
  assert(first.result.gained.perfect === 0 && first.run.perfects === 0 && first.run.game.score === first.result.gained.total, '冰磚裂開不能拿完美清盤分')
  assert([0, 1, 2, 3, 4, 5, 6].every((c) => first.run.game.board[idx(0, c)] === TILE_STONE) && first.run.game.board[idx(0, 7)] === 0, '冰磚要裂成石磚留在原位')
  const second = stepRun(first.run, 1, 0, 7)
  if ('error' in second) throw new Error(second.error)
  assert(second.special.stones === 7 && second.run.stones === 7 && second.run.ice === 7, '裂開的冰磚第二次消除要算石磚')
  assert(second.run.game.board.slice(0, 8).every((v) => v === 0), '第二次消除後冰磚位置要清空')}

// 第二章：舊「8 關全破」成就仍以第一章 8 關為準，不因新增關卡而退回未完成。
{
  assert(BLOCK_LEVELS.filter((l) => l.chapter === 1).length === 8 && BLOCK_LEVELS.filter((l) => l.chapter === 2).length === 8, '章節關卡數錯誤')
  assert(BLOCK_LEVELS.every((l, i) => l.id === i + 1), '關卡編號要連續')
  const cleared = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), { cleared: true, best: 1, fewest: 1, tries: 1 }]))
  const oldSave = Object.fromEntries(evaluateAchievements({ best: 0, stats: EMPTY_STATS, levels: cleared(8), daily: {} }).map((a) => [a.id, a]))
  assert(oldSave.level_all.state === 'done' && oldSave.level_all.target === 8, '舊存檔 8 關全破成就要維持達成')
  assert(oldSave.frost_1.state !== 'done' && oldSave.frost_all.state !== 'done', '第二章成就不能自動達成')
  assert(levelUnlocked(cleared(8), 9) && !levelUnlocked(cleared(8), 10), '第二章要在第 8 關後依序解鎖')
  const all = Object.fromEntries(evaluateAchievements({ best: 0, stats: EMPTY_STATS, levels: cleared(16), daily: {} }).map((a) => [a.id, a]))
  assert(all.frost_1.state === 'done' && all.frost_all.state === 'done', '第二章成就錯誤')
  assert(Object.keys(parseRecords(cleared(16), isLevelId)).length === 16, '第二章關卡紀錄要能讀回')
}

// Pay 金磚：依補牌次數固定出現，可重現。
{
  const spec = levelSpec(BLOCK_LEVELS.find((level) => level.goldEvery === 1)!)
  const played = botPlay({ ...spec, goal: null, moveLimit: 30 })
  const again = replayRun({ ...spec, goal: null, moveLimit: 30 }, played.moves)!
  assert(JSON.stringify(again) === JSON.stringify(played), '金磚出現位置不可重現')
  assert(played.gold > 0 && played.bonus >= played.gold * SPECIAL_BONUS.gold, '金磚沒有出現或沒有加分')
  let sawGold = false
  let r = startRun({ ...spec, goal: null, moveLimit: 30 })
  for (const [s, row, col] of played.moves) {
    const step = stepRun(r, s, row, col)
    if ('error' in step) throw new Error(step.error)
    if (step.result.refilled) sawGold ||= step.run.game.tray.some((p) => p?.color === TILE_GOLD)
    r = step.run
  }
  assert(sawGold, '補牌時應出現金磚')
}

// ---------- 排行賽＝經典規則 ----------
for (const seed of [1, 99, -123456]) {
  const spec = rankedSpec('run-x', seed)
  const played = botPlay(spec, 300)
  let classic: BlockState = newBlockGame(seed)
  for (const [s, r, c] of played.moves) {
    const res = placePiece(classic, s, r, c)
    if ('error' in res) throw new Error(res.error)
    classic = res.state
  }
  assert(classic.score === played.game.score && classic.lines === played.game.lines, '排行賽分數要和經典模式完全一致')
  assert(played.bonus === 0 && played.gold === 0, '排行賽不能有特殊加分')
  assert(played.status === 'ended' || played.moves.length === 300, '排行賽沒有目標，結束要標記為 ended')
}

// ---------- 存檔讀回與竄改 ----------
{
  const spec = levelSpec(BLOCK_LEVELS[1])
  const played = botPlay({ ...spec }, 6)
  const restored = parseSavedRun(JSON.parse(JSON.stringify({ key: spec.key, moves: played.moves })))
  assert(restored && JSON.stringify(restored) === JSON.stringify(played), '挑戰進度重新整理後要能還原')
  const forged = played.moves.map((m) => [...m])
  forged[2] = [forged[2][0], 9, 9]
  assert(parseSavedRun({ key: spec.key, moves: forged }) === null, '竄改過的步驟要整局作廢')
  assert(parseSavedRun({ key: 'level:99', moves: [] }) === null, '不存在的關卡要拒絕')
  assert(parseSavedRun({ key: spec.key, moves: [[0, 0.5, 1]] }) === null, '非整數步驟要拒絕')
}

// ---------- 台灣時間 ----------
{
  const at = (iso: string) => Date.parse(iso)
  assert(taipeiDayKey(at('2026-10-26T15:59:59Z')) === '2026-10-26', '台北 23:59 仍是當天')
  assert(taipeiDayKey(at('2026-10-26T16:00:00Z')) === '2026-10-27', '台北 00:00 要換日')
  const w1 = taipeiWeek(at('2026-11-01T15:59:59Z'))
  const w2 = taipeiWeek(at('2026-11-01T16:00:00Z'))
  assert(w1.key === '2026-10-26' && w1.lastDay === '2026-11-01', '週日 23:59 仍屬本週')
  assert(w2.key === '2026-11-02', '週一 00:00 要換週')
  assert(w1.endMs === w2.startMs && w2.startMs === at('2026-11-01T16:00:00Z'), '週期邊界要接續')
  assert(taipeiWeek(at('2026-12-31T20:00:00Z')).key === '2026-12-28', '跨年週錯誤')
}

// ---------- 每日挑戰 ----------
{
  assert(JSON.stringify(dailySpec('2026-10-27')) === JSON.stringify(dailySpec('2026-10-27')), '同一天題目要固定')
  assert(JSON.stringify(specFromKey('daily:2026-10-27')) === JSON.stringify(dailySpec('2026-10-27')), '每日代號讀回錯誤')
  assert(dailySpec('2026-10-27').seed !== dailySpec('2026-10-28').seed, '不同日期要換題')
  let won = 0
  const kinds = new Set<string>()
  const days = 30
  for (let d = 0; d < days; d += 1) {
    const day = taipeiDayKey(Date.parse('2026-10-01T04:00:00Z') + d * 86400000)
    const spec = dailySpec(day)
    kinds.add(spec.goal!.kind)
    if (spec.goal!.kind === 'stars') assert(startRun(spec).starsTotal === spec.goal!.target, `${day} 星星數量與目標不符`)
    if (botPlay(spec).status === 'won') won += 1
  }
  assert(kinds.size >= 4, '每日挑戰題型太單一')
  assert(won >= days * 0.8, `每日挑戰太難，機器人只過 ${won}/${days}`)
  console.log(`  ✓ 每日挑戰：機器人 ${won}/${days} 天過關，題型 ${[...kinds].join('、')}`)
}

// ---------- 紀錄與成就 ----------
{
  const spec = levelSpec(BLOCK_LEVELS[0])
  const won = botPlay(spec)
  let levels = recordRun({}, '1', won)
  assert(levels['1'].cleared && levels['1'].tries === 1 && levels['1'].fewest === won.game.moves, '過關紀錄錯誤')
  assert(levelUnlocked(levels, 2) && !levelUnlocked(levels, 3), '關卡解鎖順序錯誤')
  const lost = { ...won, status: 'lost' as const, game: { ...won.game, score: won.game.score + 999 } }
  levels = recordRun(levels, '1', lost)
  assert(levels['1'].cleared && levels['1'].tries === 2 && levels['1'].best === won.game.score + 999, '失敗不能取消已過關，但最高分要更新')
  assert(recordRun(levels, '1', startRun(spec)) === levels, '進行中的挑戰不能記成一次')
  assert(Object.keys(parseRecords({ 1: levels['1'], 99: levels['1'], x: 1 }, isLevelId)).join() === '1', '關卡紀錄要過濾不明資料')
  assert(Object.keys(parseRecords({ '2026-10-27': { cleared: true }, bad: {} }, isDayKey)).join() === '2026-10-27', '每日紀錄要過濾不明資料')

  let daily = {}
  for (let d = 0; d < 70; d += 1) {
    const day = taipeiDayKey(Date.parse('2026-08-01T04:00:00Z') + d * 86400000)
    daily = recordRun(daily, day, { ...won, spec: dailySpec(day), status: 'won' })
  }
  assert(Object.keys(daily).length === 60, '每日紀錄只保留最近 60 天')

  let stats = parseStats(null)
  assert(JSON.stringify(stats) === JSON.stringify(EMPTY_STATS), '空統計錯誤')
  let s0 = startRun(spec)
  for (const [slot, r, c] of won.moves) {
    const step = stepRun(s0, slot, r, c)
    if ('error' in step) throw new Error(step.error)
    stats = addStepStats(stats, step.result, step.special)
    s0 = step.run
  }
  assert(stats.lines === won.game.lines && stats.bestCombo === won.game.bestCombo, '累計統計要和實際對局一致')

  const before = evaluateAchievements({ best: 0, stats: EMPTY_STATS, levels: {}, daily: {} })
  assert(before.every((a) => a.state === 'locked'), '沒玩過時成就都未達成')
  const after = evaluateAchievements({ best: 1200, stats: { ...EMPTY_STATS, lines: 20, bestCombo: 4 }, levels: { 1: levels['1'] }, daily })
  const byId = Object.fromEntries(after.map((a) => [a.id, a]))
  assert(byId.score_1k.state === 'done' && byId.score_5k.state === 'progress' && byId.score_5k.current === 1200, '分數成就錯誤')
  assert(byId.lines_50.state === 'progress' && byId.lines_50.current === 20, '消除成就錯誤')
  assert(byId.combo_4.state === 'done' && byId.combo_8.state === 'progress', '連擊成就錯誤')
  assert(byId.level_1.state === 'done' && byId.level_4.current === 1, '關卡成就錯誤')
  assert(byId.daily_7.state === 'done' && byId.perfect_1.state === 'locked', '每日／清盤成就錯誤')
  assert(newlyDone(before, after).some((a) => a.id === 'score_1k') && newlyDone(after, after).length === 0, '新達成判定錯誤')
}

// ---------- 排行榜 SQL 提案：形狀表與重算範例必須與前端規則一致 ----------
{
  const sql = readFileSync(resolve(process.cwd(), 'supabase/manual/20261027010000_block_weekly_board_preview.sql'), 'utf8')
    .replace(/\r\n/g, '\n')
  const shapeJson = sql.match(/-- BLOCK_SHAPES:BEGIN\n\s*shapes jsonb := '([^']+)'/)
  assert(shapeJson, 'SQL 找不到形狀表')
  const shapes = JSON.parse(shapeJson![1]) as Array<[number, number[]]>
  assert(shapes.length === BLOCK_SHAPES.length, 'SQL 形狀數量不一致')
  BLOCK_SHAPES.forEach((shape, i) => {
    assert(shapes[i][0] === shape.weight, `SQL 形狀 ${shape.id} 權重不一致`)
    assert(JSON.stringify(shapes[i][1]) === JSON.stringify(shape.cells.flat()), `SQL 形狀 ${shape.id} 格子不一致`)
  })
  const vector = sql.match(/-- BLOCK_VECTOR seed=(-?\d+) score=(\d+) lines=(\d+) combo=(\d+)\n[\s\S]*?'(\[[^']*\])'/)
  assert(vector, 'SQL 找不到重算範例')
  const [, seed, score, lines, combo, moves] = vector!
  const replay = replayRun(rankedSpec('vector', Number(seed)), JSON.parse(moves))
  assert(replay && replay.status === 'ended', 'SQL 範例在前端重算不是完整對局')
  assert(replay!.game.score === Number(score) && replay!.game.lines === Number(lines) && replay!.game.bestCombo === Number(combo), 'SQL 範例分數與前端重算不一致')
}

console.log('方塊挑戰模式檢查通過')
