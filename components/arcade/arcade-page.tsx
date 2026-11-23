'use client'

import './arcade.css'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Lock } from 'lucide-react'
import { ARCADE_GAMES } from '@/lib/arcade/game-catalog'
import type { AchievementState } from '@/lib/arcade/achievement-snapshot'
import type { EquippedPerks } from '@/lib/rewards/perk-catalog'
import type { PerkViewer } from '@/components/home/perks-shop'
import { SceneBackdrop } from '@/components/home/perk-visuals'
import { FestivalArt, FestivalBanner, festivalStyle, useFestivalTheme } from './festival-banner'
import { useFestivalPreviewId } from '@/components/festival/festival-store'
import { MergeShop } from './merge-shop'
import { BlockChallenge } from './block-challenge'
import { DreamStreet } from './dream-street'
import { MERGE_ART_SVG } from './merge-art'
import { GameCover } from './arcade-art'
import { GameRewardHud } from './reward-hud'
import { AchievementWall } from './achievement-wall'
import { LiveEventsBoard } from './live-events-board'
import { PointsMall } from './points-mall'

export type HubTab = 'rewards' | 'achievements' | 'mall'

const TABS: { id: HubTab; label: string }[] = [
  { id: 'rewards', label: '每日獎勵' },
  { id: 'achievements', label: '我的成就' },
  { id: 'mall', label: '點數商城' },
]

export type ArcadeMemberProps = {
  viewer: PerkViewer
  points: number | null
  ownedPerks: string[]
  equippedPerks: EquippedPerks
  perkBusy: boolean
  scratchLeft: number | null
  scratchTotal: number | null
  onUnlockPerk: (id: string) => void
  onEquipPerk: (id: string) => void
  onRedeemCoupon: (id: string, cost: number) => Promise<void>
}

/** 方塊大挑戰與夢想商店街只開放會員遊玩；未登入時不掛載遊戲，也不讀寫訪客存檔。 */
function GameLoginGate({ name, authResolved, onNeedLogin, onBack }: { name: string; authResolved: boolean; onNeedLogin: () => void; onBack: () => void }) {
  return (
    <section aria-label={`${name}需要登入`} className="pa-hub mt-6 grid gap-5">
      <div>
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium">
          <ArrowLeft className="size-4" />返回遊樂園
        </button>
      </div>
      <div className="pa-card grid justify-items-center gap-3 p-8 text-center">
        <Lock className="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-black">{authResolved ? `登入後才能開始${name}` : '正在確認登入狀態…'}</h1>
        {authResolved ? (
          <>
            <p className="max-w-md text-pretty text-sm text-muted-foreground">請用買個 Pay 服會員的 Email 與密碼登入。登入完成後會留在這個遊戲頁面。</p>
            <button type="button" className="pa-btn primary" onClick={onNeedLogin}>會員登入</button>
          </>
        ) : null}
      </div>
    </section>
  )
}

export function ArcadePage({
  game,
  authResolved,
  authUserId,
  member,
  onBack,
  onOpenHub,
  onOpenGame,
  onOpenScratch,
  onNeedLogin,
  visitOwnerId = null,
  onLeaveVisit,
  onVisitStreet,
  tab,
  onTabChange,
  mallFocusKey = 0,
}: {
  tab: HubTab
  onTabChange: (tab: HubTab) => void
  /** 每次遞增就切到點數商城並捲到分頁列。 */
  mallFocusKey?: number
  game: 'merge' | 'blocks' | 'street' | null
  authResolved: boolean
  authUserId: string | null
  member: ArcadeMemberProps
  onBack: () => void
  onOpenHub: () => void
  onOpenGame: (game: 'merge' | 'blocks' | 'street') => void
  onOpenScratch: () => void
  onNeedLogin: () => void
  visitOwnerId?: string | null
  onLeaveVisit?: () => void
  onVisitStreet?: (ownerId: string) => void
}) {
  const previewId = useFestivalPreviewId()
  const setTab = onTabChange
  const [achievements, setAchievements] = useState<AchievementState | null>(null)
  const { theme } = useFestivalTheme(previewId)
  const tabsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mallFocusKey > 0 && game === null) tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [mallFocusKey, game])

  if (game === 'merge') {
    return (
      <MergeShop
        authResolved={authResolved}
        authUserId={authUserId}
        previewId={previewId}
        onNeedLogin={onNeedLogin}
        onBack={onOpenHub}
        equippedPerks={member.equippedPerks}
      />
    )
  }

  if ((game === 'blocks' || game === 'street') && !authUserId) {
    return <GameLoginGate name={game === 'blocks' ? 'Pay 服方塊大挑戰' : 'Pay 服夢想商店街'} authResolved={authResolved} onNeedLogin={onNeedLogin} onBack={onOpenHub} />
  }

  if (game === 'blocks') {
    return (
      <BlockChallenge
        authResolved={authResolved}
        authUserId={authUserId}
        previewId={previewId}
        onNeedLogin={onNeedLogin}
        onBack={onOpenHub}
        equippedPerks={member.equippedPerks}
      />
    )
  }

  if (game === 'street') {
    return (
      <DreamStreet
        authResolved={authResolved}
        authUserId={authUserId}
        previewId={previewId}
        visitOwnerId={visitOwnerId}
        onNeedLogin={onNeedLogin}
        onBack={onOpenHub}
        onLeaveVisit={onLeaveVisit}
        onVisitStreet={onVisitStreet}
      />
    )
  }

  const festive = theme.id !== 'brand'

  return (
    <section aria-label="Pay 服遊樂園" className="pa-hub mt-6 grid gap-5" data-festival={theme.id} style={festivalStyle(theme)}>
      <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: MERGE_ART_SVG }} />
      <div>
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium">
          <ArrowLeft className="size-4" />返回市集
        </button>
      </div>
      <FestivalBanner previewId={previewId} />
      <header className={member.equippedPerks.scene ? 'pv-scene-host overflow-hidden rounded-3xl p-5 text-zinc-900' : undefined}>
        <SceneBackdrop id={member.equippedPerks.scene} />
        <h1 className="text-2xl font-black md:text-3xl">Pay 服遊樂園</h1>
        <p className={`mt-1 max-w-2xl text-pretty text-sm ${member.equippedPerks.scene ? 'font-bold text-zinc-800 [text-shadow:0_1px_0_rgb(255_255_255/.6)]' : 'text-muted-foreground'}`}>
          三款小遊戲共用每日獎勵額度，每日幸運刮刮卡沿用原本的次數與獎項。遊戲 Pay 點數尚未正式發放。
        </p>
      </header>

      <ul className="pa-games" aria-label="遊戲入口">
        {ARCADE_GAMES.map((entry) => {
          const open = entry.status !== 'coming_soon'
          const scratchText = entry.id === 'scratch'
            ? member.scratchLeft == null || member.scratchTotal == null ? '讀取今日次數中' : `今日剩 ${member.scratchLeft} / ${member.scratchTotal} 次`
            : null
          return (
            <li key={entry.id} className={`pa-game ${open ? 'is-open' : 'is-soon'}`} aria-label={`${entry.name}${open ? '' : '，尚未開放'}`}>
              <div className="pa-cover">
                <GameCover cover={entry.cover} />
                {festive && open ? <span className="pa-ribbon">{theme.name}</span> : null}
                {festive && open ? <FestivalArt decor={theme.decor} themeId={theme.id} className="pa-cover-fx" /> : null}
                {!open ? <div className="pa-lock"><span><Lock className="size-4" />尚未開放</span></div> : null}
              </div>
              <div className="pa-game-body">
                <div className="pa-game-meta">
                  <span className={`pa-chip ${entry.status === 'open' ? 'open' : entry.status === 'existing' ? 'existing' : 'soon'}`}>
                    {entry.status === 'open' ? '可以玩' : entry.status === 'existing' ? '沿用既有功能' : '尚未開放'}
                  </span>
                  <span className="pa-chip soon">{entry.sharesGameCap ? '共用每日獎勵額度' : '獨立計算，不佔遊戲額度'}</span>
                </div>
                <h3>{entry.name}</h3>
                <p>{entry.tagline}{scratchText ? `｜${scratchText}` : ''}</p>
                <div className="pa-game-cta">
                  {entry.id === 'merge' ? (
                    <button type="button" className="pa-btn primary w-full" onClick={() => onOpenGame('merge')}>進入合成小舖</button>
                  ) : entry.id === 'blocks' ? (
                    <button type="button" className="pa-btn primary w-full" onClick={() => onOpenGame('blocks')}>開始方塊挑戰</button>
                  ) : entry.id === 'street' && open ? (
                    <button type="button" className="pa-btn primary w-full" onClick={() => onOpenGame('street')}>進入夢想商店街</button>
                  ) : entry.id === 'scratch' ? (
                    <button type="button" className="pa-btn ghost w-full" onClick={onOpenScratch}>開啟刮刮卡</button>
                  ) : (
                    <button type="button" className="pa-btn ghost w-full" disabled aria-disabled="true">敬請期待</button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <div ref={tabsRef} className="pa-tabs scroll-mt-24" role="tablist" aria-label="遊樂園功能">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" className="pa-tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'rewards' ? (
        <div className="grid gap-4">
          <GameRewardHud authUserId={authUserId} onNeedLogin={onNeedLogin} />
          <LiveEventsBoard authUserId={authUserId} onNeedLogin={onNeedLogin} />
        </div>
      ) : null}
      {tab === 'achievements' || tab === 'mall' ? (
        <div className={tab === 'achievements' ? '' : 'hidden'}>
          <AchievementWall
            authUserId={authUserId}
            viewer={member.viewer}
            equippedPerks={member.equippedPerks}
            onNeedLogin={onNeedLogin}
            onState={setAchievements}
          />
        </div>
      ) : null}
      {tab === 'mall' ? (
        <PointsMall
          authUserId={authUserId}
          points={member.points}
          ownedPerks={member.ownedPerks}
          equippedPerks={member.equippedPerks}
          viewer={member.viewer}
          perkBusy={member.perkBusy}
          achievements={achievements}
          onUnlockPerk={member.onUnlockPerk}
          onEquipPerk={member.onEquipPerk}
          onRedeemCoupon={member.onRedeemCoupon}
          onNeedLogin={onNeedLogin}
          onOpenAchievements={() => setTab('achievements')}
        />
      ) : null}
    </section>
  )
}
