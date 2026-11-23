'use client'

import { useEffect, useState } from 'react'
import { CalendarDays, Check, Crown, Flag, LayoutGrid, Lock, LogIn, Medal, Play, RefreshCw, Timer, Trophy } from 'lucide-react'
import {
  BLOCK_LEVELS,
  STAGE_THEME_NAME,
  BLOCK_CHAPTERS,
  TILE_ICE,
  TILE_STAR,
  TILE_STONE,
  dailySpec,
  goalProgress,
  goalText,
  layoutBoard,
  levelKey,
  levelUnlocked,
  taipeiDayKey,
  taipeiWeek,
  type BlockAchievementView,
  type BlockGoalKind,
  type BlockStats,
  type ChallengeRun,
  type DailyRecord,
  type LevelRecord,
  type WeeklyBoard,
} from '@/lib/arcade/block-modes'
import { fetchWeeklyBoard } from '@/lib/arcade/block-board-client'

export type BlockTab = 'classic' | 'levels' | 'daily' | 'achievements' | 'board'

const TABS: { id: BlockTab; label: string; Icon: typeof Play }[] = [
  { id: 'classic', label: '經典', Icon: LayoutGrid },
  { id: 'levels', label: '關卡', Icon: Flag },
  { id: 'daily', label: '每日', Icon: CalendarDays },
  { id: 'achievements', label: '成就', Icon: Medal },
  { id: 'board', label: '排行', Icon: Crown },
]

export function ModeTabs({ tab, onTab, badges }: { tab: BlockTab; onTab: (tab: BlockTab) => void; badges: Partial<Record<BlockTab, string>> }) {
  return (
    <div className="bl-tabs" role="tablist" aria-label="方塊大挑戰模式">
      {TABS.map(({ id, label, Icon }) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} className="bl-tab" onClick={() => onTab(id)}>
          <Icon className="size-4" aria-hidden="true" />
          <span>{label}</span>
          {badges[id] ? <em>{badges[id]}</em> : null}
        </button>
      ))}
    </div>
  )
}

export function GoalIcon({ kind }: { kind: BlockGoalKind | 'ranked' }) {
  return <i className="bl-goal-icon" data-kind={kind} aria-hidden="true" />
}

function MiniBoard({ layout }: { layout: readonly string[] | null }) {
  const board = layoutBoard(layout)
  return (
    <span className="bl-mini" aria-hidden="true">
      {board.map((value, i) => <i key={i} data-t={value === TILE_STONE ? 'stone' : value === TILE_STAR ? 'star' : value === TILE_ICE ? 'ice' : undefined} />)}
    </span>
  )
}

// ---------- 關卡地圖 ----------

export function LevelMap({ levels, active, onPlay }: { levels: Record<string, LevelRecord>; active: ChallengeRun | null; onPlay: (id: number) => void }) {
  const cleared = BLOCK_LEVELS.filter((level) => levels[String(level.id)]?.cleared).length
  return (
    <div className="bl-panel">
      <div className="bl-head">
        <div>
          <h2>挑戰關卡</h2>
          <p>每關目標不同，有步數限制。過關後解鎖下一關，同一關每次發的方塊都一樣，可以反覆研究。</p>
        </div>
        <div className="bl-count"><b>{cleared}</b>/{BLOCK_LEVELS.length}<small>已過關</small></div>
      </div>
      {BLOCK_CHAPTERS.map((chapter) => {
        const list = BLOCK_LEVELS.filter((level) => level.chapter === chapter.id)
        const opened = levelUnlocked(levels, list[0].id)
        const done = list.filter((level) => levels[String(level.id)]?.cleared).length
        return (
      <section key={chapter.id} className="bl-chapter" data-chapter={chapter.id} aria-label={chapter.name}>
      <h3 className="bl-chapter-head">
        <b>{chapter.name}</b>
        <span>{opened ? `${done}/${list.length} 已過關・${chapter.intro}` : `通過第 ${list[0].id - 1} 關後開放・${chapter.intro}`}</span>
      </h3>
      <ol className="bl-levels">
        {list.map((level) => {
          const record = levels[String(level.id)]
          const open = levelUnlocked(levels, level.id)
          const resuming = active?.spec.key === levelKey(level.id) && active.status === 'playing' && active.moves.length > 0
          return (
            <li key={level.id}>
              <button
                type="button"
                className="bl-level"
                data-stage={level.theme}
                data-state={record?.cleared ? 'cleared' : open ? 'open' : 'locked'}
                disabled={!open}
                onClick={() => onPlay(level.id)}
                aria-label={`第 ${level.id} 關 ${level.name}，${goalText(level.goal)}，${open ? (record?.cleared ? '已過關' : '可挑戰') : '尚未解鎖'}`}
              >
                <span className="bl-level-no">{level.id}</span>
                <MiniBoard layout={level.layout} />
                <span className="bl-level-body">
                  <strong>{level.name}</strong>
                  <span className="bl-level-goal"><GoalIcon kind={level.goal.kind} />{goalText(level.goal)}</span>
                  <span className="bl-level-meta">
                    {STAGE_THEME_NAME[level.theme]}｜{level.moveLimit} 步內
                    {level.goldEvery ? '｜金磚' : ''}
                  </span>
                  {record?.cleared ? (
                    <span className="bl-level-best"><Check className="size-3" />最佳 {record.best.toLocaleString()} 分{record.fewest ? `・${record.fewest} 步` : ''}</span>
                  ) : resuming ? (
                    <span className="bl-level-best is-resume"><Play className="size-3" />繼續上次進度</span>
                  ) : record?.tries ? (
                    <span className="bl-level-best is-try">已挑戰 {record.tries} 次</span>
                  ) : null}
                </span>
                {!open ? <span className="bl-lock"><Lock className="size-4" /></span> : null}
              </button>
            </li>
          )
        })}
      </ol>
      </section>
        )
      })}
      <SpecialLegend />
    </div>
  )
}

function SpecialLegend() {
  return (
    <ul className="bl-legend" aria-label="特殊方塊說明">
      <li><span className="bc-tile" data-c="8" /><b>石磚</b>擋住格子，整行或整列填滿時一起打碎，+20 分</li>
      <li><span className="bc-tile" data-c="9" /><b>星星</b>消除所在的行列即可收集，+60 分</li>
      <li><span className="bc-tile" data-c="10" /><b>Pay 金磚</b>補牌時出現的特殊方塊，每格消除 +30 分</li>
      <li><span className="bc-tile" data-c="11" /><b>冰磚</b>第二章登場。消一次裂成石磚（+25 分），再消一次才會不見</li>
    </ul>
  )
}

// ---------- 每日挑戰 ----------

function untilMidnight(nowMs: number) {
  const day = 86400000
  const local = nowMs + 8 * 3600000
  const left = (Math.floor(local / day) + 1) * day - local
  const h = Math.floor(left / 3600000)
  const m = Math.floor((left % 3600000) / 60000)
  return `${h} 小時 ${m} 分`
}

export function DailyCard({ today, nowMs, records, active, onPlay }: { today: string; nowMs: number; records: Record<string, DailyRecord>; active: ChallengeRun | null; onPlay: () => void }) {
  const spec = dailySpec(today)
  const record = records[today]
  const live = active?.spec.key === spec.key && active.status === 'playing' && active.moves.length > 0 ? active : null
  const progress = live && spec.goal ? goalProgress(live, spec.goal) : null
  const status = record?.cleared ? 'done' : live ? 'live' : record?.tries ? 'failed' : 'new'
  const days = Array.from({ length: 7 }, (_, i) => taipeiDayKey(nowMs - (6 - i) * 86400000))
  const streak = Object.values(records).filter((item) => item.cleared).length
  return (
    <div className="bl-panel">
      <div className="bl-daily" data-stage={spec.theme} data-status={status}>
        <div className="bl-daily-top">
          <span className="bl-date"><CalendarDays className="size-4" />{today.replace(/-/g, '/')}｜台灣時間</span>
          <span className="bl-chip" data-status={status}>
            {status === 'done' ? '今日已完成' : status === 'live' ? '進行中' : status === 'failed' ? '尚未成功' : '今日未挑戰'}
          </span>
        </div>
        <div className="bl-daily-main">
          <MiniBoard layout={spec.layout} />
          <div>
            <p className="bl-daily-theme">{STAGE_THEME_NAME[spec.theme]}</p>
            <h2><GoalIcon kind={spec.goal!.kind} />{goalText(spec.goal!)}</h2>
            <p className="bl-daily-rule">{spec.moveLimit} 步內完成{spec.goldEvery ? '｜每次補牌出現 Pay 金磚' : ''}{spec.layout ? '｜棋盤上有特殊格' : ''}</p>
            {progress !== null && spec.goal ? (
              <div className="bl-bar" aria-label={`進度 ${progress}/${spec.goal.target}`}>
                <i style={{ width: `${Math.min(100, (progress / spec.goal.target) * 100)}%` }} />
                <span>{Math.min(progress, spec.goal.target).toLocaleString()} / {spec.goal.target.toLocaleString()}・已用 {live!.game.moves} 步</span>
              </div>
            ) : null}
          </div>
        </div>
        <dl className="bl-daily-stats">
          <div><dt>今日最佳</dt><dd>{record ? record.best.toLocaleString() : '—'}</dd></div>
          <div><dt>最少步數</dt><dd>{record?.fewest ?? '—'}</dd></div>
          <div><dt>挑戰次數</dt><dd>{record?.tries ?? 0}</dd></div>
          <div><dt>累計完成</dt><dd>{streak} 天</dd></div>
        </dl>
        <button type="button" className="bl-cta" onClick={onPlay}>
          <Play className="size-4" />{live ? '繼續挑戰' : record?.tries ? '再挑戰一次' : '開始今日挑戰'}
        </button>
        <p className="bl-note"><Timer className="size-3.5" />距離換題 {untilMidnight(nowMs)}・同一天題目固定，完成不會發放 Pay 點數</p>
      </div>
      <ol className="bl-week" aria-label="最近 7 天">
        {days.map((day) => {
          const item = records[day]
          return (
            <li key={day} data-state={item?.cleared ? 'done' : item?.tries ? 'tried' : 'none'} data-today={day === today}>
              <b>{day.slice(8)}</b>
              <i>{item?.cleared ? <Check className="size-3" /> : null}</i>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ---------- 成就 ----------

const GROUP_NAME = { score: '分數', lines: '消除', combo: '連擊', levels: '關卡與每日' } as const

export function AchievementPanel({ views, best, stats, levelsCleared, daysCleared }: { views: BlockAchievementView[]; best: number; stats: BlockStats; levelsCleared: number; daysCleared: number }) {
  const done = views.filter((item) => item.state === 'done').length
  return (
    <div className="bl-panel">
      <div className="bl-head">
        <div>
          <h2>方塊成就</h2>
          <p>依照實際對局即時判定，紀錄存在這台裝置並按登入帳號分開。正式勳章與獎勵尚未開放，達成不會發放 Pay 點數。</p>
        </div>
        <div className="bl-count"><b>{done}</b>/{views.length}<small>已達成</small></div>
      </div>
      <dl className="bl-records">
        <div><dt>經典最高分</dt><dd>{best.toLocaleString()}</dd></div>
        <div><dt>累計消除</dt><dd>{stats.lines.toLocaleString()} 條</dd></div>
        <div><dt>最高連擊</dt><dd>×{stats.bestCombo}</dd></div>
        <div><dt>完美清盤</dt><dd>{stats.perfects} 次</dd></div>
        <div><dt>關卡過關</dt><dd>{levelsCleared}/{BLOCK_LEVELS.length}</dd></div>
        <div><dt>每日完成</dt><dd>{daysCleared} 天</dd></div>
      </dl>
      {(Object.keys(GROUP_NAME) as Array<keyof typeof GROUP_NAME>).map((group) => (
        <section key={group} className="bl-achv-group" aria-label={GROUP_NAME[group]}>
          <h3>{GROUP_NAME[group]}</h3>
          <ul className="bl-achvs">
            {views.filter((item) => item.group === group).map((item) => (
              <li key={item.id} className="bl-achv" data-state={item.state}>
                <span className="bl-medal" data-group={group}><Trophy className="size-5" /></span>
                <span className="bl-achv-body">
                  <strong>{item.name}</strong>
                  <small>{item.detail}</small>
                  <span className="bl-bar thin"><i style={{ width: `${(item.current / item.target) * 100}%` }} /></span>
                </span>
                <span className="bl-chip" data-status={item.state === 'done' ? 'done' : item.state === 'progress' ? 'live' : 'new'}>
                  {item.state === 'done' ? '已達成' : item.state === 'progress' ? `${item.current.toLocaleString()}/${item.target.toLocaleString()}` : '未達成'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="bl-note">正式勳章、展示徽章與獎勵發放：尚未開放（待站長核准後接入第六階段成就系統）。</p>
    </div>
  )
}

// ---------- 每週排行 ----------

type BoardView = { state: 'loading' } | { state: 'unavailable' } | { state: 'error'; message: string } | { state: 'ok'; data: WeeklyBoard }

export function BoardPanel({
  authResolved,
  authUserId,
  nowMs,
  active,
  busy,
  error,
  refreshKey,
  onNeedLogin,
  onStart,
  onResume,
}: {
  authResolved: boolean
  authUserId: string | null
  nowMs: number
  active: ChallengeRun | null
  busy: boolean
  error: string | null
  refreshKey: number
  onNeedLogin: () => void
  onStart: () => void
  onResume: () => void
}) {
  const [offset, setOffset] = useState<0 | -1>(0)
  const [view, setView] = useState<BoardView>({ state: 'loading' })
  const [reload, setReload] = useState(0)
  const week = taipeiWeek(nowMs + offset * 7 * 86400000)

  useEffect(() => {
    if (!authResolved) return
    let alive = true
    setView({ state: 'loading' })
    fetchWeeklyBoard(offset, authUserId).then((result) => {
      if (alive) setView(result)
    })
    return () => { alive = false }
  }, [authResolved, authUserId, offset, reload, refreshKey, week.key])

  const open = view.state === 'ok'
  const rows = view.state === 'ok' ? view.data.rows : []
  const podium = rows.filter((row) => row.rank <= 3).slice(0, 3)
  const resumable = active?.spec.mode === 'ranked' && active.status === 'playing' && active.moves.length > 0

  return (
    <div className="bl-panel">
      <div className="bl-head">
        <div>
          <h2>每週排行榜</h2>
          <p>排行賽使用經典規則，開局方塊由伺服器發出，成績由伺服器依每一步重算後才上榜。每週一 00:00（台灣時間）換榜。</p>
        </div>
      </div>
      <div className="bl-week-switch" role="tablist" aria-label="週期">
        <button type="button" role="tab" aria-selected={offset === 0} onClick={() => setOffset(0)}>本週</button>
        <button type="button" role="tab" aria-selected={offset === -1} onClick={() => setOffset(-1)}>上週</button>
        <span>{week.key.slice(5).replace('-', '/')} – {week.lastDay.slice(5).replace('-', '/')}</span>
      </div>

      {view.state === 'loading' ? <div className="bl-board-empty">讀取排行榜中…</div> : null}

      {view.state === 'unavailable' ? (
        <div className="bl-board-locked">
          <span className="bl-board-lock"><Lock className="size-7" /></span>
          <strong>每週排行榜尚未開放</strong>
          <p>排行成績必須由伺服器重算驗證，相關資料庫設定正等待站長核准。開放前不顯示任何排名，本機分數也不會上榜。</p>
        </div>
      ) : null}

      {view.state === 'error' ? (
        <div className="bl-board-locked">
          <strong>{view.message}</strong>
          <button type="button" className="bl-ghost" onClick={() => setReload((n) => n + 1)}><RefreshCw className="size-4" />重新讀取</button>
        </div>
      ) : null}

      {view.state === 'ok' ? (
        rows.length === 0 ? (
          <div className="bl-board-empty">這一週還沒有人上榜，搶下第一名吧！</div>
        ) : (
          <>
            <ol className="bl-podium" aria-label="前三名">
              {podium.map((row) => (
                <li key={`p-${row.rank}-${row.nickname}`} data-rank={row.rank} data-me={row.me}>
                  <span className="bl-podium-crown"><Crown className="size-5" /></span>
                  <b>{row.nickname}</b>
                  <span>{row.score.toLocaleString()}</span>
                  <i>{row.rank}</i>
                </li>
              ))}
            </ol>
            <ol className="bl-rows" aria-label="排行榜">
              {rows.map((row, i) => (
                <li key={`${row.rank}-${i}`} data-me={row.me}>
                  <b className="bl-rank">{row.rank}</b>
                  <span className="bl-name">{row.nickname}{row.me ? <em>你</em> : null}</span>
                  <span className="bl-sub">消除 {row.lines}・×{row.bestCombo}</span>
                  <strong>{row.score.toLocaleString()}</strong>
                </li>
              ))}
            </ol>
          </>
        )
      ) : null}

      {open ? (
        <div className="bl-mine">
          {!authUserId ? (
            <>
              <span>登入後才能參加排行賽並查看自己的名次</span>
              <button type="button" className="bl-ghost" onClick={onNeedLogin}><LogIn className="size-4" />登入</button>
            </>
          ) : view.data.me ? (
            <span>你的{offset === 0 ? '本週' : '上週'}名次：<b>第 {view.data.me.rank} 名</b>・{view.data.me.score.toLocaleString()} 分（共 {view.data.total} 人）</span>
          ) : (
            <span>你{offset === 0 ? '本週' : '上週'}還沒有上榜成績</span>
          )}
        </div>
      ) : null}

      {open && authUserId && offset === 0 ? (
        <button type="button" className="bl-cta" disabled={busy} onClick={resumable ? onResume : onStart}>
          <Play className="size-4" />{busy ? '向伺服器取得開局中…' : resumable ? '繼續排行賽' : '開始排行賽'}
        </button>
      ) : null}
      {!open && view.state !== 'loading' ? (
        <button type="button" className="bl-cta" disabled aria-disabled="true"><Lock className="size-4" />排行賽尚未開放</button>
      ) : null}
      {error ? <p className="bl-error" role="alert">{error}</p> : null}
      <p className="bl-note">公開榜單只顯示公開暱稱與成績，不顯示 Email 或其他會員資料。上榜不發放 Pay 點數。</p>
    </div>
  )
}