'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { setMyGameBadge, syncMyAchievements } from '@/lib/arcade/arcade-client'
import type { AchievementState } from '@/lib/arcade/achievement-snapshot'
import { ACHIEVEMENT_COPY, TIER_META, achievementName } from '@/lib/arcade/game-catalog'
import type { EquippedPerks } from '@/lib/rewards/perk-catalog'
import { PerkAvatar, PerkTags, type PerkViewer } from '@/components/home/perks-shop'
import { ProfileEffect } from '@/components/home/perk-visuals'
import { MedalArt } from './arcade-art'

const GROUPS = [
  { id: 'orders', label: '合成小舖・熟客里程碑' },
  { id: 'shop', label: '合成小舖・小舖經營' },
  { id: 'collection', label: '合成小舖・收藏里程碑' },
  { id: 'street', label: '夢想商店街' },
  { id: 'block', label: '方塊大挑戰・排行賽' },
] as const

export function GameBadgeChip({ achievementId }: { achievementId: string | null | undefined }) {
  const copy = achievementId ? ACHIEVEMENT_COPY[achievementId] : null
  if (!copy || !achievementId) return null
  return (
    <span className="pa-gbadge" title="遊戲成就勳章">
      <MedalArt tier="gold" art={copy.art} className="" />
      {copy.name}
    </span>
  )
}

/** 遊戲中只在背景同步成就，新解鎖時跳出提示，不佔版面。 */
export function AchievementToastWatcher({ authUserId, refreshKey }: { authUserId: string | null; refreshKey: number | string }) {
  const [toast, setToast] = useState<{ id: string; tier: AchievementState['achievements'][number]['tier'] } | null>(null)
  useEffect(() => {
    if (!authUserId) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void syncMyAchievements(authUserId).then((result) => {
        const fresh = result.data?.newlyUnlocked ?? []
        const id = fresh[fresh.length - 1]
        if (cancelled || !id || !result.data) return
        setToast({ id, tier: result.data.achievements.find((item) => item.id === id)?.tier ?? 'gold' })
      })
    }, 900)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [authUserId, refreshKey])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])
  const copy = toast ? ACHIEVEMENT_COPY[toast.id] : null
  if (!toast || !copy) return null
  return (
    <div className="pa-unlock-toast" role="status">
      <MedalArt tier={toast.tier} art={copy.art} className="" />
      <span><small>成就解鎖！</small><b>{copy.name}</b></span>
    </div>
  )
}

export function AchievementWall({
  authUserId,
  refreshKey,
  viewer,
  equippedPerks,
  onNeedLogin,
  onState,
}: {
  authUserId: string | null
  refreshKey?: number | string
  viewer: PerkViewer
  equippedPerks: EquippedPerks
  onNeedLogin?: () => void
  onState?: (state: AchievementState) => void
}) {
  const [state, setState] = useState<AchievementState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const generation = useRef(0)
  const onStateRef = useRef(onState)
  onStateRef.current = onState

  const apply = useCallback((next: AchievementState) => {
    setState(next)
    onStateRef.current?.(next)
    if (next.newlyUnlocked.length) {
      setFresh(next.newlyUnlocked)
      setToast(next.newlyUnlocked[next.newlyUnlocked.length - 1])
    }
  }, [])

  useEffect(() => {
    if (!authUserId) {
      setState(null)
      return
    }
    const mine = ++generation.current
    const timer = window.setTimeout(() => {
      void syncMyAchievements(authUserId).then((result) => {
        if (mine !== generation.current) return
        if (result.data) {
          apply(result.data)
          setError(null)
        } else setError(result.error)
      })
    }, refreshKey == null ? 0 : 700)
    return () => window.clearTimeout(timer)
  }, [authUserId, refreshKey, apply])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const toggleBadge = async (id: string) => {
    if (!authUserId || !state || busy) return
    setBusy(true)
    const result = await setMyGameBadge(state.showcase === id ? null : id, authUserId)
    setBusy(false)
    if (result.data) apply(result.data)
    else setError(result.error)
  }

  const unlocked = state?.achievements.filter((item) => item.unlocked).length ?? 0
  const total = Object.keys(ACHIEVEMENT_COPY).length
  const pending = state ? Object.keys(ACHIEVEMENT_COPY).filter((id) => !state.achievements.some((item) => item.id === id && (item.available || item.unlocked))).length : 0
  const toastCopy = toast ? ACHIEVEMENT_COPY[toast] : null
  const toastTier = toast ? state?.achievements.find((item) => item.id === toast)?.tier ?? 'gold' : 'gold'

  return (
    <section aria-label="我的遊戲成就" className="pa-card grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="pa-section-title">我的遊戲成就<small>{authUserId && !state && !error ? '正在讀取成就…' : `${unlocked} / ${total} 已解鎖${pending ? `・${pending} 項待開放` : ''}`}</small></h2>
      </div>

      <div className="pa-showcase relative overflow-hidden">
        <ProfileEffect id={equippedPerks.effect} interactive />
        <PerkAvatar viewer={viewer} equipped={equippedPerks} size="size-14" />
        <div className="min-w-0">
          <p className="pa-showcase-name">
            {viewer.name}
            <PerkTags equipped={equippedPerks} />
            <GameBadgeChip achievementId={state?.showcase} />
          </p>
          <p className="pa-showcase-sub">
            {authUserId
              ? state?.showcase
                ? `公開展示中：${achievementName(state.showcase)}。暱稱、頭像框與頭銜沿用會員資料。`
                : '選一枚已解鎖的勳章公開展示，暱稱與頭像框沿用會員資料。'
              : '登入後，合成小舖、方塊大挑戰與夢想商店街的成就會自動收進這裡。'}
          </p>
        </div>
      </div>

      {!authUserId ? (
        <button type="button" className="pa-btn primary justify-self-start" onClick={onNeedLogin}>登入查看成就</button>
      ) : null}
      {error ? <p role="alert" className="text-sm font-bold text-destructive">{error}</p> : null}

      {GROUPS.map((group) => {
        const items = Object.entries(ACHIEVEMENT_COPY).filter(([, copy]) => copy.group === group.id)
        return (
          <div key={group.id} className="grid gap-2">
            <h3 className="text-sm font-black text-muted-foreground">{group.label}</h3>
            <ul className="pa-medals">
              {items.map(([id, copy]) => {
                const progress = state?.achievements.find((item) => item.id === id)
                const tier = progress?.tier ?? 'bronze'
                const isUnlocked = !!progress?.unlocked
                const isPending = !isUnlocked && !!state && (!progress || !progress.available)
                const equipped = state?.showcase === id
                const classes = ['pa-medal', isUnlocked ? 'unlocked' : 'locked']
                if (isPending) classes.push('pending')
                if (equipped) classes.push('equipped')
                if (fresh.includes(id)) classes.push('fresh')
                return (
                  <li key={id} className={classes.join(' ')} style={{ '--tier': TIER_META[tier].ring } as CSSProperties}>
                    {isUnlocked && (tier === 'gold' || tier === 'legend') ? <span className="shine" aria-hidden="true" /> : null}
                    <MedalArt tier={tier} art={copy.art} locked={!isUnlocked && !progress?.progress} />
                    <span className="pa-medal-name">{copy.name}</span>
                    <span className="pa-medal-detail">{copy.detail}</span>
                    {isUnlocked ? (
                      <>
                        <span className="pa-medal-foot">{TIER_META[tier].label}勳章・已解鎖</span>
                        <button type="button" aria-pressed={equipped} disabled={busy} onClick={() => { void toggleBadge(id) }}>
                          {equipped ? '取消展示' : '公開展示'}
                        </button>
                      </>
                    ) : isPending ? (
                      <span className="pa-medal-foot">待開放・資料來源上線後自動計算</span>
                    ) : (
                      <>
                        <div className="pa-medal-prog" role="progressbar" aria-label={`${copy.name}進度`} aria-valuenow={progress?.progress ?? 0} aria-valuemin={0} aria-valuemax={progress?.target ?? 1}>
                          <i style={{ width: `${progress ? Math.min(100, (progress.progress / progress.target) * 100) : 0}%` }} />
                        </div>
                        <span className="pa-medal-foot">{progress ? `${progress.progress} / ${progress.target}` : authUserId && !state ? '讀取中' : '未完成'}</span>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      <p className="text-[11px] text-muted-foreground">成就依三款遊戲的伺服器進度解鎖（合成小舖存檔、商店街雲端存檔、方塊排行賽驗證成績），不需要也不能自行宣告完成。勳章不扣點、不發 Pay 點，和虛擬特權收藏一起顯示。</p>

      {toast && toastCopy ? (
        <div className="pa-unlock-toast" role="status">
          <MedalArt tier={toastTier} art={toastCopy.art} className="" />
          <span><small>成就解鎖！</small><b>{toastCopy.name}</b></span>
        </div>
      ) : null}
    </section>
  )
}
