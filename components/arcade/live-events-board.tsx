'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { claimMyLiveEvent, fetchMyLiveEvents } from '@/lib/arcade/arcade-client'
import { resolveLiveBoard, type LiveEventsState } from '@/lib/arcade/live-events-snapshot'
import { CADENCE_LABEL, LIVE_EVENTS, SEASON_META, anchoredNow, untilText, type SeasonId } from '@/lib/arcade/live-ops'
import type { GameRewardId } from '@/lib/arcade/game-reward-policy'
import { ArtUse, MedalArt } from './arcade-art'
import { useResumeRefresh } from './use-resume-refresh'

const GAME_LABEL: Record<GameRewardId, string> = {
  merge_shop: '合成小舖',
  block_challenge: '方塊大挑戰',
  dream_street: '夢想商店街',
}

function eventCopy(eventId: string, variant: number) {
  const def = LIVE_EVENTS.find((item) => item.id === eventId)
  const v = def?.variants[variant] ?? def?.variants[0]
  return { title: v?.title ?? eventId, detail: v?.detail ?? '', medal: def?.reward.medal ?? 'ic-star', festival: def?.cadence === 'festival' }
}

function periodText(periodKey: string) {
  const [kind, ...rest] = periodKey.split(':')
  const day = rest[rest.length - 1] ?? ''
  if (kind === 'd') return day.slice(5).replace('-', '/')
  if (kind === 'w') return `${day.slice(5).replace('-', '/')} 當週`
  if (kind === 'm') return `${day.slice(0, 4)} 年 ${Number(day.slice(5, 7))} 月`
  if (kind === 's') {
    const [year, season] = day.split('-')
    const meta = SEASON_META[season as SeasonId]
    return meta ? `${year} ${meta.name}` : day
  }
  return `${day.slice(0, 4)} 年`
}

/** 每日／每週／每月／遊戲季／節慶活動。登入後的期別只認伺服器；未登入只預覽台北時間的當期內容。獎勵只有活動紀錄，不發 Pay 點數。 */
export function LiveEventsBoard({
  authUserId,
  onNeedLogin,
  game,
}: {
  authUserId: string | null
  onNeedLogin?: () => void
  /** 有指定時只顯示該遊戲的當期活動，完整收藏仍留在遊樂園獎勵頁。 */
  game?: GameRewardId
}) {
  const [now, setNow] = useState<number | null>(null)
  const [state, setState] = useState<LiveEventsState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const generation = useRef(0)
  const anchor = useRef<{ server: number; local: number } | null>(null)

  const accept = useCallback((data: LiveEventsState) => {
    anchor.current = data.serverNow == null ? null : { server: data.serverNow, local: Date.now() }
    setState(data)
    setError(null)
  }, [])

  const load = useCallback(() => {
    if (!authUserId) {
      anchor.current = null
      setState(null)
      return
    }
    const mine = ++generation.current
    void fetchMyLiveEvents(authUserId).then((result) => {
      if (mine !== generation.current) return
      if (result.data) accept(result.data)
      else setError(result.error)
    })
  }, [accept, authUserId])

  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(load, [load])

  const resume = useCallback(() => {
    setNow(Date.now())
    load()
  }, [load])
  useResumeRefresh(resume)

  const clock = now == null ? null : anchor.current ? anchoredNow(anchor.current.server, anchor.current.local, now) : now
  const waitingForServer = Boolean(authUserId) && !state && !error
  const cards = useMemo(
    () => (clock == null || waitingForServer ? [] : resolveLiveBoard(clock, state, game)),
    [clock, waitingForServer, state, game],
  )
  const ended = clock != null && cards.some((card) => card.source === 'server' && card.endsAt <= clock)
  useEffect(() => {
    if (ended) load()
  }, [ended, load])

  useEffect(() => {
    if (clock == null || cards.length === 0) return
    const ahead = cards.map((card) => card.endsAt - clock).filter((wait) => wait > 0)
    if (!ahead.length) return
    const wait = Math.min(...ahead)
    // 瀏覽器把超過約 24 天的計時器當成立即到期；長週期改由 30 秒刻度繼續倒數。
    if (wait > 12 * 3600_000) return
    const timer = window.setTimeout(() => setNow(Date.now()), wait + 250)
    return () => window.clearTimeout(timer)
  }, [clock, cards])

  const claim = async (eventId: string) => {
    if (!authUserId || busy) return
    setBusy(eventId)
    setNotice(null)
    const result = await claimMyLiveEvent(eventId, authUserId)
    setBusy(null)
    if (result.data) {
      accept(result.data)
      setNotice(`已收進活動紀錄：${eventCopy(eventId, result.data.events.find((e) => e.eventId === eventId)?.variant ?? 0).title}`)
    } else {
      setError(result.error)
      load()
    }
  }

  const pendingReason = authUserId && error && !state ? error : null

  return (
    <section aria-label={game ? `${GAME_LABEL[game]}本期活動` : '限時活動'} className="pa-card grid gap-3">
      <h2 className="pa-section-title">
        {game ? '本期活動' : '限時活動'}
        <small>台北時間自動換期・活動只發紀錄與收藏，不發 Pay 點數</small>
      </h2>
      {!authUserId ? <button type="button" className="pa-btn primary justify-self-start" onClick={onNeedLogin}>登入參加活動</button> : null}
      {waitingForServer ? <p role="status" className="text-sm font-bold text-sky-300">正在依台北時間讀取本期活動…</p> : null}
      {pendingReason ? <p role="status" className="text-sm font-bold text-sky-300">{pendingReason}；以下為活動時程，開放後進度會自動計算。</p> : null}
      {error && state ? <p role="alert" className="text-sm font-bold text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="text-sm font-bold text-emerald-400">{notice}</p> : null}

      <ul className="pa-tasks sm:grid-cols-2">
        {cards.map((item) => {
          const done = item.progress >= item.target
          const waiting = item.source === 'preview' || !item.available
          const status = item.claimed ? 'claimed' : waiting ? 'locked' : done ? 'claimable' : 'open'
          return (
            <li key={item.claimKey} className="pa-task" data-status={status} data-festival={item.festival ? 'on' : undefined}>
              <span className="pa-task-icon"><ArtUse id={item.medal} size={44} /></span>
              <div className="min-w-0">
                <p className="pa-task-name">
                  {item.title}
                  <span className="rounded-full bg-zinc-700 px-2 py-0.5 text-[10.5px] text-zinc-200">{CADENCE_LABEL[item.cadence]}</span>
                </p>
                <p className="pa-task-sub">{GAME_LABEL[item.gameId]}・{periodText(item.periodKey)}・{item.detail}・剩 {untilText(item.endsAt, clock ?? item.endsAt)}</p>
                <div className="pa-task-prog" role="progressbar" aria-label={`${item.title}進度`} aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={item.target}>
                  <i style={{ width: `${Math.min(100, (item.progress / Math.max(1, item.target)) * 100)}%` }} />
                </div>
              </div>
              <div className="pa-task-side text-xs font-bold">
                <span className={waiting ? 'text-sky-300' : 'text-zinc-300'}>{waiting ? '待開放' : `${item.progress} / ${item.target}`}</span>
                {item.claimed ? (
                  <span className="text-emerald-400">本期已完成</span>
                ) : authUserId && !waiting ? (
                  <button type="button" className="pa-task-claim" disabled={!done || busy !== null} onClick={() => { void claim(item.id) }}>
                    {busy === item.id ? '確認中…' : done ? '收進紀錄' : '進行中'}
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>

      {!game && state?.records.length ? (
        <div className="grid gap-2">
          <h3 className="text-sm font-black text-muted-foreground">我的活動收藏（永久保留）</h3>
          <ul className="flex flex-wrap gap-2">
            {state.records.map((record) => {
              const copy = eventCopy(record.eventId, record.variant)
              return (
                <li key={`${record.eventId}@${record.periodKey}`} className="flex items-center gap-2 rounded-full border border-zinc-700 bg-[#1f1f23] py-1 pl-1 pr-3 text-xs font-bold" title={copy.detail}>
                  <MedalArt tier={copy.festival ? 'gold' : 'silver'} art={record.medal} className="size-7" />
                  {copy.title}<span className="text-muted-foreground">{periodText(record.periodKey)}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
