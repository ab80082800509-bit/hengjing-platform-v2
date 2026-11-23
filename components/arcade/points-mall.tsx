'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { fetchMyPointsMall } from '@/lib/arcade/arcade-client'
import type { PointsMallState } from '@/lib/arcade/points-mall-snapshot'
import { fetchPointOfferCoupons } from '@/lib/rewards/coupon-client'
import type { PointOfferCoupon } from '@/lib/rewards/coupon-snapshot'
import type { AchievementState } from '@/lib/arcade/achievement-snapshot'
import { ACHIEVEMENT_COPY } from '@/lib/arcade/game-catalog'
import { isPerkEquipped, perkDefinitionById, type EquippedPerks, type PerkCategory } from '@/lib/rewards/perk-catalog'
import { perkView } from '@/lib/rewards/perk-mall-state'
import { CATEGORY_META, CATEGORY_ORDER, PERKS, RARITY_META } from '@/components/home/perks-catalog'
import { PerkArt, skinStyleFor, type PerkViewer } from '@/components/home/perks-shop'
import { couponBadge, couponTitle, remainOf, slashDate } from '@/components/seller/coupon-utils'
import { MedalArt, PayCoin, ZoneIcon } from './arcade-art'

type Zone = 'collection' | 'coupon' | 'benefit'

const ZONES: { id: Zone; name: string; note: string }[] = [
  { id: 'collection', name: '虛擬收藏區', note: '外觀收藏與遊戲勳章。已停止販售的不開放兌換' },
  { id: 'coupon', name: '購物優惠區', note: '商家授權的點數兌換券' },
  { id: 'benefit', name: '限定福利區', note: '規劃中，尚未開放' },
]

const PLANNED_BENEFITS = [
  { id: 'festival-frame', name: '節慶限定頭像框', note: '依節慶主題推出，數量與點數尚未訂定' },
  { id: 'member-day', name: '會員日運費折抵', note: '需確認平台成本與適用範圍' },
  { id: 'partner-trial', name: '合作商家體驗券', note: '需商家同意參與與提供庫存' },
  { id: 'merch', name: 'Pay 服實體周邊', note: '需確認成本、庫存與寄送方式' },
]

export function PointsMall({
  authUserId,
  points,
  ownedPerks,
  equippedPerks,
  viewer,
  perkBusy,
  achievements,
  refreshKey,
  onUnlockPerk,
  onEquipPerk,
  onRedeemCoupon,
  onNeedLogin,
  onOpenAchievements,
}: {
  authUserId: string | null
  points: number | null
  ownedPerks: string[]
  equippedPerks: EquippedPerks
  viewer: PerkViewer
  perkBusy: boolean
  achievements: AchievementState | null
  refreshKey?: number | string
  onUnlockPerk: (id: string) => void
  onEquipPerk: (id: string) => void
  onRedeemCoupon: (id: string, cost: number) => Promise<void>
  onNeedLogin: () => void
  onOpenAchievements: () => void
}) {
  const [zone, setZone] = useState<Zone>('collection')
  const [category, setCategory] = useState<PerkCategory | 'all'>('all')
  const [mall, setMall] = useState<PointsMallState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [offers, setOffers] = useState<PointOfferCoupon[] | null>(null)
  const [offersError, setOffersError] = useState<string | null>(null)
  const generation = useRef(0)
  const offerGeneration = useRef(0)

  const loadOffers = useCallback(() => {
    if (!authUserId) {
      setOffers(null)
      setOffersError(null)
      return
    }
    const mine = ++offerGeneration.current
    void fetchPointOfferCoupons(authUserId).then((result) => {
      if (mine !== offerGeneration.current) return
      if (result.data) {
        setOffers(result.data.coupons)
        setOffersError(null)
      } else {
        setOffers(null)
        setOffersError(result.error)
      }
    })
  }, [authUserId])

  useEffect(() => {
    if (zone === 'coupon') loadOffers()
  }, [zone, loadOffers, refreshKey])

  useEffect(() => {
    if (!authUserId) {
      setMall(null)
      return
    }
    const mine = ++generation.current
    void fetchMyPointsMall(authUserId).then((result) => {
      if (mine !== generation.current) return
      if (result.data) {
        setMall(result.data)
        setError(null)
      } else setError(result.error)
    })
  }, [authUserId, refreshKey, ownedPerks.length, points])

  const balance = points ?? mall?.balance ?? null
  const perkState: 'loading' | 'unavailable' | 'closed' | 'open' = mall
    ? mall.perkPurchaseEnabled ? 'open' : 'closed'
    : error ? 'unavailable' : 'loading'
  const server = useMemo(() => (mall?.perks ? new Map(mall.perks.map((row) => [row.id, row])) : null), [mall])
  const shown = PERKS.filter((perk) => category === 'all' || perk.category === category)

  const redeem = (coupon: PointOfferCoupon) => {
    if (!authUserId) return onNeedLogin()
    if (pending) return
    setPending(coupon.id)
    void onRedeemCoupon(coupon.id, coupon.offer.pointsCost).finally(() => {
      setPending(null)
      loadOffers()
    })
  }

  return (
    <section aria-label="Pay 點數商城" className="pa-card grid gap-3">
      <div className="pa-mall-head">
        <h2 className="pa-section-title">Pay 點數商城</h2>
        <span className="pa-balance" aria-label={`目前 Pay 點數 ${balance ?? '讀取中'}`}>
          <PayCoin />{authUserId ? balance ?? '…' : '登入後顯示'}
          <small className="text-[11px] font-bold text-muted-foreground">點</small>
        </span>
      </div>
      <p className="text-xs text-muted-foreground">點數來源沿用簽到與刮刮卡帳本。兌換時由伺服器在同一筆交易內確認身分、價格、資格與餘額，扣點、記帳與入庫一起完成，重複送出不會重複扣點。遊戲活動獎勵是紀錄與勳章，不會出現在 Pay 點數餘額。</p>

      <div className="pa-zones" role="tablist" aria-label="商城分區">
        {ZONES.map((item) => (
          <button key={item.id} type="button" role="tab" className="pa-zone" aria-selected={zone === item.id} onClick={() => setZone(item.id)}>
            <b>{item.name}</b>
            <small>{item.note}</small>
            <ZoneIcon zone={item.id} />
          </button>
        ))}
      </div>

      {error ? <p role="alert" className="text-sm font-bold text-destructive">{error}</p> : null}

      {zone === 'collection' ? (
        <div className="grid gap-3">
          {authUserId && perkState === 'closed' ? (
            <p className="pa-withheld"><PayCoin /><span><b>虛擬收藏兌換尚未開放。</b>40 件收藏的點數價格尚待站長核准，已擁有的收藏可照常裝備。</span></p>
          ) : authUserId && perkState === 'unavailable' ? (
            <p className="pa-withheld"><PayCoin /><span><b>暫停兌換：無法確認兌換狀態。</b>這不是點數不足，也不是兌換關閉；點數沒有變動，修復後重新整理即可。</span></p>
          ) : authUserId && mall && mall.catalogVersion === 1 ? (
            <p className="pa-withheld"><PayCoin /><span><b>新收藏尚未上架。</b>商城資料庫還是原本的 15 件，新增的 25 件要等資料庫更新後才能兌換。</span></p>
          ) : null}
          <div className="pa-cats" role="group" aria-label="收藏分類">
            <button type="button" className="pa-cat" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>全部 {PERKS.length}</button>
            {CATEGORY_ORDER.map((c) => (
              <button key={c} type="button" className="pa-cat" aria-pressed={category === c} onClick={() => setCategory(c)}>
                {CATEGORY_META[c].label} {PERKS.filter((perk) => perk.category === c).length}
              </button>
            ))}
          </div>
          {category !== 'all' ? <p className="text-xs text-muted-foreground">顯示位置：{CATEGORY_META[category].place}</p> : null}
          <ul className="pa-items">
            {shown.map((perk) => {
              const def = perkDefinitionById.get(perk.id)
              if (!def) return null
              const owned = ownedPerks.includes(perk.id)
              const equipped = isPerkEquipped(equippedPerks, perk)
              const view = perkView(def, {
                loggedIn: !!authUserId,
                owned,
                balance,
                purchaseOpen: mall ? mall.perkPurchaseEnabled : null,
                paused: perkState === 'unavailable',
                server,
              })
              const fill = perk.category === 'scene' || perk.category === 'effect'
              return (
                <li key={perk.id} className="pa-item">
                  <div className={`pa-item-stage ${fill ? 'pa-fill' : ''}`} style={perk.category === 'skin' ? skinStyleFor({ skin: perk.id }) : { backgroundImage: RARITY_META[perk.rarity].stage }}>
                    <PerkArt perk={perk} viewer={viewer} size="sm" />
                  </div>
                  <p className="pa-item-name">{perk.label}</p>
                  <p className="pa-item-sub">{CATEGORY_META[perk.category].label}｜{RARITY_META[perk.rarity].label}{def.sale?.kind === 'festival' ? '｜節慶限定' : ''}</p>
                  {view.note && !owned ? <p className={`pa-item-sub ${view.kind === 'available' ? '' : 'pa-reason'}`}>{view.note}</p> : null}
                  <div className="pa-item-foot">
                    {owned ? (
                      perk.category === 'sticker' ? (
                        <span className="pa-state owned">已擁有・聊天可用</span>
                      ) : (
                        <>
                          <span className={`pa-state ${equipped ? 'equipped' : 'owned'}`}>{equipped ? '裝備中' : '已擁有'}</span>
                          <button type="button" className="pa-btn ghost !min-h-8 !px-3 !py-1 text-xs" disabled={perkBusy} onClick={() => onEquipPerk(perk.id)}>{equipped ? '卸下' : '裝備'}</button>
                        </>
                      )
                    ) : (
                      <>
                        <span className="pa-pts"><PayCoin />{view.cost}</span>
                        {!authUserId ? (
                          <button type="button" className="pa-btn ghost !min-h-8 !px-3 !py-1 text-xs" onClick={onNeedLogin}>登入</button>
                        ) : view.canBuy ? (
                          <button type="button" className="pa-btn primary !min-h-8 !px-3 !py-1 text-xs" disabled={perkBusy} onClick={() => onUnlockPerk(perk.id)}>兌換</button>
                        ) : (
                          <span className={`pa-state ${view.kind === 'locked' || view.kind === 'not_started' ? 'locked' : 'closed'}`}>{view.label}</span>
                        )}
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black">遊戲勳章收藏</h3>
            <button type="button" className="pa-btn ghost !min-h-8 !py-1 text-xs" onClick={onOpenAchievements}>前往成就牆</button>
          </div>
          <ul className="pa-items">
            {Object.entries(ACHIEVEMENT_COPY).map(([id, copy]) => {
              const item = achievements?.achievements.find((row) => row.id === id)
              const unlocked = !!item?.unlocked
              const shown = achievements?.showcase === id
              return (
                <li key={id} className="pa-item">
                  <div className="pa-item-stage"><MedalArt tier={item?.tier ?? 'bronze'} art={copy.art} locked={!unlocked} className="h-20 w-16" /></div>
                  <p className="pa-item-name">{copy.name}</p>
                  <p className="pa-item-sub">{copy.detail}</p>
                  <div className="pa-item-foot">
                    <span className={`pa-state ${shown ? 'equipped' : unlocked ? 'owned' : 'locked'}`}>{shown ? '展示中' : unlocked ? '已解鎖・可展示' : '未解鎖'}</span>
                    <span className="text-[11px] font-bold text-muted-foreground">不扣點</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {zone === 'coupon' ? (
        <div className="grid gap-3">
          {!authUserId ? (
            <div className="pa-empty">登入後顯示可用點數兌換的商家優惠券。<br /><button type="button" className="pa-btn primary mt-2" onClick={onNeedLogin}>登入</button></div>
          ) : offersError ? (
            <p role="alert" className="pa-withheld"><PayCoin /><span><b>購物優惠區暫時無法顯示。</b>{offersError}</span></p>
          ) : !offers ? (
            <p className="text-sm text-muted-foreground">正在讀取優惠券…</p>
          ) : offers.length === 0 ? (
            <div className="pa-empty">目前沒有商家開放 Pay 點數兌換的優惠券。<br />商家需在賣家中心「優惠券管理」明確開放 Pay 點數兌換並自訂點數，券才會出現在這裡；一般優惠券不會自動變成點數兌換券。</div>
          ) : (
            <ul className="pa-items">
              {offers.map((coupon) => {
                const badge = couponBadge(coupon)
                const cost = coupon.offer.pointsCost
                const short = balance != null && balance < cost
                const left = Math.min(coupon.offer.pointsQty - coupon.offer.pointsIssued, remainOf(coupon))
                const until = coupon.offer.endsOn < coupon.endAt ? coupon.offer.endsOn : coupon.endAt
                return (
                  <li key={coupon.id} className="pa-item">
                    <div className="pa-item-stage" style={{ background: 'linear-gradient(135deg,#14532d,#166534)' } as CSSProperties}>
                      <span className="text-center font-black text-white"><small className="block text-[11px] opacity-80">{badge.label}</small><span className="text-2xl">{badge.value}</span></span>
                    </div>
                    <p className="pa-item-name">{coupon.name}</p>
                    <p className="pa-item-sub">{coupon.sellerName}｜{couponTitle(coupon)}</p>
                    <p className="pa-item-sub">剩 {left} 張｜兌換至 {slashDate(until)}</p>
                    <p className="pa-item-sub">折扣由 {coupon.sellerName} 提供</p>
                    <div className="pa-item-foot">
                      <span className="pa-pts"><PayCoin />{cost}</span>
                      {coupon.held ? (
                        <span className="pa-state owned">已兌換</span>
                      ) : (
                        <button type="button" className="pa-btn primary !min-h-8 !px-3 !py-1 text-xs" disabled={pending != null || short} onClick={() => redeem(coupon)}>
                          {pending === coupon.id ? '兌換中…' : short ? '點數不足' : '兌換'}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}

      {zone === 'benefit' ? (
        <ul className="pa-items">
          {PLANNED_BENEFITS.map((benefit) => (
            <li key={benefit.id} className="pa-item pa-planned">
              <div className="pa-item-stage"><ZoneIcon zone="benefit" /></div>
              <p className="pa-item-name">{benefit.name}</p>
              <p className="pa-item-sub">{benefit.note}</p>
              <div className="pa-item-foot"><span className="pa-state planned">規劃中・尚未開放</span></div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
