'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { claimMyGameReward, fetchGameRewardRules, fetchMyGameRewards } from '@/lib/arcade/arcade-client'
import type { GameRewardState, GameRewardTask } from '@/lib/arcade/game-reward-snapshot'
import type { GameRewardId } from '@/lib/arcade/game-reward-policy'
import { GAME_LABEL, REWARD_TASK_COPY } from '@/lib/arcade/game-catalog'
import { ArtUse, PayCoin } from './arcade-art'
import { useResumeRefresh } from './use-resume-refresh'

const STATUS_LABEL: Record<GameRewardTask['status'], string> = {
  locked: '尚未開放',
  in_progress: '進行中',
  claimable: '可領取',
  claimed: '已領取',
  capped: '已達上限',
}

function untilText(resetAt: string, nowMs: number): string {
  const left = Math.max(0, Date.parse(resetAt) - nowMs)
  const h = Math.floor(left / 3600000)
  const m = Math.floor((left % 3600000) / 60000)
  if (h >= 24) return `${Math.floor(h / 24)} 天 ${h % 24} 小時`
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`
}

function TaskIcon({ task }: { task: GameRewardTask }) {
  const art = REWARD_TASK_COPY[task.id]?.art ?? 'ic-star'
  if (art === 'blocks') {
    return (
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <rect x="6" y="20" width="10" height="10" rx="2" fill="#f97316" /><rect x="17" y="20" width="10" height="10" rx="2" fill="#f97316" />
        <rect x="17" y="9" width="10" height="10" rx="2" fill="#14b8a6" /><rect x="28" y="20" width="10" height="10" rx="2" fill="#facc15" />
      </svg>
    )
  }
  if (art === 'street') {
    return (
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <rect x="8" y="16" width="28" height="22" fill="#fff7ea" stroke="#4a2c1a" strokeWidth="2" />
        <path d="M6 16 h32 l-3 7 h-26z" fill="#db2777" stroke="#4a2c1a" strokeWidth="2" />
        <rect x="19" y="26" width="8" height="12" fill="#a16207" />
      </svg>
    )
  }
  return <ArtUse id={art} size={44} viewBox={art.startsWith('cu-') ? '22 16 76 76' : undefined} />
}

function Burst() {
  const colors = ['#f97316', '#facc15', '#22c55e', '#fb7185', '#60a5fa']
  return (
    <span className="pa-burst" aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2
        return <i key={i} style={{ '--c': colors[i % colors.length], '--dx': `${Math.cos(angle) * 46}px`, '--dy': `${Math.sin(angle) * 34}px` } as CSSProperties} />
      })}
    </span>
  )
}

export function GameRewardHud({
  authUserId,
  refreshKey,
  focusGame,
  onNeedLogin,
}: {
  authUserId: string | null
  refreshKey?: number | string
  focusGame?: GameRewardId
  onNeedLogin?: () => void
}) {
  const [state, setState] = useState<GameRewardState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyTask, setBusyTask] = useState<string | null>(null)
  const [burstTask, setBurstTask] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [view, setView] = useState<'daily' | 'weekly'>('daily')
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    const result = authUserId ? await fetchMyGameRewards(authUserId) : await fetchGameRewardRules()
    if (mine !== generation.current) return
    if (result.data) {
      setState(result.data)
      setError(null)
    } else {
      setError(result.error)
    }
  }, [authUserId])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, refreshKey == null ? 0 : 500)
    return () => window.clearTimeout(timer)
  }, [load, refreshKey])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  const resume = useCallback(() => {
    setNowMs(Date.now())
    void load()
  }, [load])
  useResumeRefresh(resume)

  useEffect(() => {
    if (!state) return
    const next = Math.min(Date.parse(state.dailyResetAt), Date.parse(state.weeklyResetAt))
    if (nowMs >= next) void load()
  }, [nowMs, state, load])

  const claim = async (task: GameRewardTask) => {
    if (!authUserId) {
      onNeedLogin?.()
      return
    }
    if (busyTask) return
    setBusyTask(task.id)
    const result = await claimMyGameReward(task.id, authUserId)
    setBusyTask(null)
    if (!result.data) {
      setNotice(result.error ?? '獎勵狀態沒有變更')
      void load()
      return
    }
    setState(result.data)
    const awarded = result.data.claim?.awardedPoints ?? 0
    setBurstTask(task.id)
    window.setTimeout(() => setBurstTask(null), 900)
    setNotice(result.data.claim?.replayed
      ? '這項今天已經記錄過，沒有重複計算'
      : `已記錄「${REWARD_TASK_COPY[task.id]?.title ?? task.id}」${awarded} 點。正式 Pay 點數尚未開放，這次 +0`)
  }

  if (!state) {
    return (
      <section aria-label="遊戲獎勵進度" className="pa-card">
        <h2 className="pa-section-title">遊戲獎勵進度</h2>
        <p className="mt-2 text-sm text-muted-foreground" role={error ? 'alert' : 'status'}>{error ?? '正在讀取獎勵進度…'}</p>
      </section>
    )
  }

  const tasks = state.tasks.filter((task) => (focusGame ? task.gameId === focusGame : true) && task.period === view)
  const dailyPct = state.dailyCap ? Math.min(1, state.dailyUsed / state.dailyCap) : 0
  const circumference = 2 * Math.PI * 40
  const claimable = state.tasks.filter((task) => task.status === 'claimable').length

  return (
    <section aria-label="遊戲獎勵進度" className="pa-card pa-reward">
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs><linearGradient id="pa-ring-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fde68a" /><stop offset="1" stopColor="#f97316" /></linearGradient></defs>
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="pa-section-title">
          {focusGame ? `${GAME_LABEL[focusGame]}獎勵進度` : '今日遊戲獎勵'}
          {claimable > 0 ? <span className="pa-chip warn">{claimable} 項可領取</span> : null}
        </h2>
        <small className="text-xs font-bold text-muted-foreground">台北時間 {state.taipeiDay}｜三款遊戲共用額度</small>
      </div>

      <div className="pa-reward-top">
        <div className="pa-ring" role="img" aria-label={`今日已累計 ${state.dailyUsed} 點，每日上限 ${state.dailyCap} 點`}>
          <svg viewBox="0 0 100 100">
            <circle className="track" cx="50" cy="50" r="40" />
            <circle className="fill" cx="50" cy="50" r="40" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - dailyPct)} />
          </svg>
          <div className="pa-ring-label"><b>{state.dailyUsed}<span className="text-sm text-muted-foreground">/{state.dailyCap}</span></b><small>今日點數</small></div>
        </div>
        <div className="pa-meters">
          <div className="pa-meter">
            <div className="pa-meter-head"><span>本週累計</span><span>{state.weeklyUsed} / {state.weeklyCap}</span></div>
            <div className="pa-meter-bar" role="progressbar" aria-label="本週累計" aria-valuenow={state.weeklyUsed} aria-valuemin={0} aria-valuemax={state.weeklyCap}>
              <i className="weekly" style={{ width: `${state.weeklyCap ? Math.min(100, (state.weeklyUsed / state.weeklyCap) * 100) : 0}%` }} />
            </div>
          </div>
          <div className="pa-meter">
            <div className="pa-meter-head"><span>每週額外任務</span><span>{state.weeklyQuestUsed} / {state.weeklyQuest}</span></div>
            <div className="pa-meter-bar" role="progressbar" aria-label="每週額外任務" aria-valuenow={state.weeklyQuestUsed} aria-valuemin={0} aria-valuemax={state.weeklyQuest}>
              <i style={{ width: `${state.weeklyQuest ? Math.min(100, (state.weeklyQuestUsed / state.weeklyQuest) * 100) : 0}%` }} />
            </div>
          </div>
          <p className="text-[11px] font-bold text-muted-foreground">
            每日重置倒數 {untilText(state.dailyResetAt, nowMs)}｜每週一 00:00 重置（{state.weekStart.slice(5)}～{state.weekEnd.slice(5)}）
          </p>
        </div>
      </div>

      <div className="pa-withheld">
        <PayCoin />
        <span>
          <b>正式 Pay 點數尚未發放。</b>任務達成會記錄在這裡（累計 {state.withheldTotal} 點，實際入帳 0 點）。每日 {state.dailyCap}、每週任務 {state.weeklyQuest}、每週上限 {state.weeklyCap} 點都是規劃值，尚待站長簽核。刮刮卡另計，不佔這個額度。
        </span>
      </div>

      <div className="pa-tabs" role="tablist" aria-label="獎勵週期">
        <button type="button" role="tab" className="pa-tab" aria-selected={view === 'daily'} onClick={() => setView('daily')}>每日任務</button>
        <button type="button" role="tab" className="pa-tab" aria-selected={view === 'weekly'} onClick={() => setView('weekly')}>每週任務</button>
      </div>

      <ul className="pa-tasks">
        {tasks.map((task) => {
          const copy = REWARD_TASK_COPY[task.id] ?? { title: task.id, detail: '' }
          const pct = Math.min(100, (task.progress / task.target) * 100)
          return (
            <li key={task.id} className="pa-task" data-status={task.status}>
              <span className="pa-task-icon"><TaskIcon task={task} /></span>
              <div className="min-w-0">
                <p className="pa-task-name">
                  {copy.title}
                  {!focusGame ? <span className="pa-chip soon">{GAME_LABEL[task.gameId]}</span> : null}
                </p>
                <p className="pa-task-sub">
                  {task.status === 'locked' ? copy.detail : `${copy.detail}｜${task.progress} / ${task.target}`}
                </p>
                {task.status !== 'locked' ? <div className="pa-task-prog" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div> : null}
              </div>
              <div className="pa-task-side">
                <span className="pa-pts"><PayCoin />{task.status === 'claimed' ? task.awardedPoints : task.status === 'claimable' ? task.claimablePoints : task.points}</span>
                {task.status === 'claimable' ? (
                  <button type="button" className="pa-task-claim" disabled={busyTask != null} onClick={() => { void claim(task) }}>
                    {busyTask === task.id ? '記錄中…' : '領取'}
                  </button>
                ) : (
                  <span className={`pa-state ${task.status === 'claimed' ? 'owned' : task.status === 'capped' ? 'ready' : task.status === 'locked' ? 'closed' : 'locked'}`}>
                    {task.status === 'in_progress' && !state.signedIn ? '登入後累積' : STATUS_LABEL[task.status]}
                  </span>
                )}
              </div>
              {burstTask === task.id ? <Burst /> : null}
            </li>
          )
        })}
      </ul>
      {!state.signedIn ? (
        <button type="button" className="pa-btn primary" onClick={onNeedLogin}>登入後開始累積任務</button>
      ) : null}
      {notice ? <p role="status" className="text-xs font-bold text-amber-200">{notice}</p> : null}
    </section>
  )
}
