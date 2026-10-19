'use client'

import { useState, type ReactNode } from 'react'
import { Check, Clover, Coins, Crown, Gift, Info, Recycle, Share2, ShoppingBag, Ticket, type LucideIcon } from 'lucide-react'
import { ResetCountdown } from './day-clock'
import { Confetti } from './confetti'
import { ScratchSurface } from './scratch-surface'
import { PRIZE_TABLE, RECYCLE_POINTS, SCRATCH_MAX_CHANCES, type PrizeKind, type ScratchCard, type ScratchOutcome } from './scratch-config'

const PRIZE_ICON: Record<PrizeKind, LucideIcon> = { coupon: Gift, points: Coins, founder: Crown, none: Clover }
const PRIZE_TINT: Record<PrizeKind, string> = {
  coupon: 'bg-primary/15 text-brand-ink',
  points: 'bg-amber-500/15 text-amber-400',
  founder: 'bg-yellow-500/15 text-yellow-400',
  none: 'bg-muted text-muted-foreground',
}

const nt = (n: number) => `NT$ ${n.toLocaleString('zh-TW')}`

function describe(o: ScratchOutcome) {
  if (o.kind === 'none') {
    return {
      title: `保底 +${o.points} 點`,
      sub: '再接再厲，保底平台通用點數已入帳',
      summary: `這次沒有中大獎，已發放保底 ${o.points} 點平台通用點數，明天 00:00 重製後再來試試手氣。`,
    }
  }
  if (o.kind === 'points') {
    const sub = o.fallbackFrom ? (o.fallbackFrom === 'founder' ? '大額券今日已發完，改發紅利點數' : '優惠券已發完或已持有，改發紅利點數') : '平台簽到紅利點數已入帳'
    return { title: `+${o.points} 點`, sub, summary: `恭喜獲得 ${o.points} 點平台簽到紅利點數，已存入您的點數。` }
  }
  return {
    title: o.headline,
    sub: `${o.sellerName}・滿 ${nt(o.minSpend)} 可用`,
    summary: `恭喜獲得「${o.sellerName}」${o.title}優惠券（折扣碼 ${o.code}），已發送至我的優惠券包，另贈 ${o.bonusPoints} 點保底紅利。`,
  }
}

function PrizeFace({ card }: { card: ScratchCard }) {
  const o = card.outcome
  const Icon = PRIZE_ICON[o.kind]
  const { title, sub } = describe(o)

  if (card.recycled && (o.kind === 'coupon' || o.kind === 'founder')) {
    return (
      <div
        aria-hidden={!card.revealed}
        className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-accent via-card to-background px-4 text-center"
      >
        <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
          <Recycle className="size-6" aria-hidden />
        </span>
        <p className="text-balance text-2xl font-black text-foreground md:text-3xl">已分解 +{RECYCLE_POINTS} 點</p>
        <p className="text-pretty text-xs text-muted-foreground md:text-sm">「{o.sellerName}」折價券已換成平台通用點數</p>
      </div>
    )
  }

  return (
    <div
      aria-hidden={!card.revealed}
      className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-accent via-card to-background px-4 text-center"
    >
      <span className={`flex size-12 items-center justify-center rounded-2xl ${PRIZE_TINT[o.kind]}`}>
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="text-balance text-2xl font-black text-foreground md:text-3xl">{title}</p>
      <p className="text-pretty text-xs text-muted-foreground md:text-sm">{sub}</p>
      {(o.kind === 'coupon' || o.kind === 'founder') && (
        <p className="mt-1 rounded-lg border border-dashed border-primary/60 px-3 py-0.5 font-mono text-sm font-black tracking-widest text-brand-ink">{o.code}</p>
      )}
      {(o.kind === 'coupon' || o.kind === 'founder') && (
        <p className="inline-flex items-center gap-1 text-xs font-bold text-amber-400">
          <Coins className="size-3.5" aria-hidden />
          另贈保底 {o.bonusPoints} 點
        </p>
      )}
    </div>
  )
}

function IdleFace({ exhausted }: { exhausted: boolean }) {
  return (
    <div className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-gradient-to-br from-muted to-background px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-card text-muted-foreground">
        <Ticket className="size-6" aria-hidden />
      </span>
      <p className="text-base font-black">{exhausted ? '今日免費次數已用完' : '今日幸運刮刮卡'}</p>
      <p className="text-xs text-muted-foreground">{exhausted ? '明天 00:00 重製後再來刮一張' : '按下「開始刮卡」，再用手指或滑鼠刮開塗層'}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-border/70 bg-muted/40 p-4">
      <h3 className="text-sm font-black">{title}</h3>
      {children}
    </section>
  )
}

export function ScratchCardPanel({
  loggedIn,
  skew,
  chancesTotal,
  chancesLeft,
  shared,
  founderLeft,
  card,
  onStart,
  onReveal,
  onShare,
  onGoCoupons,
  onRecycle,
  onGoStore,
}: {
  loggedIn: boolean
  skew: number
  chancesTotal: number
  chancesLeft: number
  shared: boolean
  founderLeft: number
  card: ScratchCard | null
  onStart: () => void
  onReveal: () => void
  onShare: () => void
  onGoCoupons: () => void
  onRecycle: () => void
  onGoStore: (sellerId: string) => void
}) {
  const [progress, setProgress] = useState(0)
  const [fireKey, setFireKey] = useState(0)

  const scratching = !!card && !card.revealed
  const exhausted = loggedIn && chancesLeft <= 0
  const used = chancesTotal - chancesLeft

  const handleReveal = () => {
    if (!card || card.revealed) return
    onReveal()
    if (card.outcome.kind !== 'none') setFireKey((k) => k + 1)
  }

  const wonCouponOutcome = card?.revealed && (card.outcome.kind === 'coupon' || card.outcome.kind === 'founder') ? card.outcome : null
  const wonCoupon = !!wonCouponOutcome && !card?.recycled

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/50 px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">今日免費刮卡次數</p>
          <div className="mt-1 flex items-center gap-1.5">
            {Array.from({ length: SCRATCH_MAX_CHANCES }, (_, i) => {
              const unlocked = i < chancesTotal
              const left = i >= used && unlocked
              return (
                <span
                  key={i}
                  title={!unlocked ? '邀請朋友解鎖' : left ? '可使用' : '已使用'}
                  className={`flex size-8 items-center justify-center rounded-lg border ${
                    left
                      ? 'border-primary bg-accent text-brand-ink'
                      : unlocked
                        ? 'border-border bg-muted text-muted-foreground'
                        : 'border-dashed border-border text-muted-foreground/60'
                  }`}
                >
                  {unlocked && !left ? <Check className="size-4" aria-hidden /> : <Ticket className="size-4" aria-hidden />}
                </span>
              )
            })}
            <span className="ml-1 text-sm font-black">
              {loggedIn ? `剩餘 ${chancesLeft} / ${chancesTotal} 次` : '登入後免費 1 次'}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">距離每日 00:00 免費次數重製</p>
          <ResetCountdown skew={skew} className="text-xl font-black text-brand-ink" />
        </div>
      </div>

      <div className="relative">
        {card ? (
          <ScratchSurface key={card.id} revealed={card.revealed} onReveal={handleReveal} onProgress={setProgress}>
            <PrizeFace card={card} />
          </ScratchSurface>
        ) : (
          <IdleFace exhausted={exhausted} />
        )}
        <Confetti fireKey={fireKey} />
      </div>

      {scratching && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>已刮開 {Math.min(100, Math.round(progress * 100))}%（超過 50% 自動揭曉）</span>
          <button type="button" onClick={handleReveal} className="rounded-full border border-border bg-card px-3 py-1 font-bold text-foreground transition hover:bg-muted">
            直接揭曉
          </button>
        </div>
      )}

      {card?.revealed && (
        <p role="status" className="rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-accent-foreground">
          {card.recycled && wonCouponOutcome
            ? `已將「${wonCouponOutcome.sellerName}」折價券分解為 ${RECYCLE_POINTS} 點平台通用點數，連同保底共獲得 ${RECYCLE_POINTS + wonCouponOutcome.bonusPoints} 點。`
            : describe(card.outcome).summary}
        </p>
      )}

      {wonCoupon && wonCouponOutcome && (
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onGoStore(wonCouponOutcome.sellerId)}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98]"
          >
            <ShoppingBag className="size-4" aria-hidden />
            收下並去逛逛
          </button>
          <button
            type="button"
            onClick={onRecycle}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground transition hover:bg-muted active:scale-[0.98]"
          >
            <Recycle className="size-4" aria-hidden />
            不想要？分解換 {RECYCLE_POINTS} 點
          </button>
        </div>
      )}

      {!scratching && (
        <div className="grid gap-2 sm:grid-cols-2">
          {exhausted ? (
            <button
              type="button"
              disabled
              className="inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-full bg-muted px-5 py-2.5 text-sm font-bold text-muted-foreground sm:col-span-2"
            >
              <Ticket className="size-4" aria-hidden />
              今日次數已用完，明天再來
            </button>
          ) : (
            <button
              type="button"
              onClick={onStart}
              className={`inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] ${wonCoupon ? '' : 'sm:col-span-2'}`}
            >
              <Ticket className="size-4" aria-hidden />
              {!loggedIn ? '登入後免費刮卡' : card?.revealed ? '再刮一張' : '開始刮卡'}
            </button>
          )}
          {wonCoupon && (
            <button
              type="button"
              onClick={onGoCoupons}
              className={`inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted active:scale-[0.98] ${exhausted ? 'sm:col-span-2' : ''}`}
            >
              <Gift className="size-4" aria-hidden />
              查看我的優惠券包
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 px-4 py-3">
        <p className="min-w-0 text-xs text-muted-foreground">
          {shared ? '今日已領取邀請加碼，免費次數共 2 次' : '朋友透過你的專屬連結進站，今日可額外多刮 1 次（每日上限 2 次）'}
        </p>
        {shared ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400">
            <Check className="size-4" aria-hidden />
            已加碼
          </span>
        ) : (
          <button
            type="button"
            onClick={onShare}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted active:scale-[0.98]"
          >
            <Share2 className="size-4" aria-hidden />
            邀請朋友 +1 次
          </button>
        )}
      </div>

      <Section title="獎項與中獎機率">
        <ul className="mt-3 space-y-2">
          {PRIZE_TABLE.map((p) => {
            const Icon = PRIZE_ICON[p.kind]
            return (
              <li key={p.kind} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${PRIZE_TINT[p.kind]}`}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black">{p.label}</p>
                  <p className="text-pretty text-xs text-muted-foreground">
                    {p.kind === 'founder' ? `${p.detail}（今日剩餘 ${founderLeft} 張）` : p.detail}
                  </p>
                </div>
                <span className="shrink-0 text-right">
                  <span className="block text-lg font-black text-brand-ink">約 {p.odds}%</span>
                  <span className="block text-[10px] text-muted-foreground">中獎率</span>
                </span>
              </li>
            )
          })}
        </ul>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
          <li>每位會員每日免費 1 次，朋友透過你的專屬邀請連結進站後可額外獲得 1 次，每日上限 2 次，台灣時間每日 00:00 重製。</li>
          <li>優惠券由賣家自主發行、履約與售後，結帳時折抵商品金額；平台不經手交易金流，不提供現金或購物金折抵。</li>
          <li>優惠券已發完或已持有同款時，改發紅利點數（一般券 20 點、大額券 30 點）。</li>
          <li>刮中折價券不想要？可當場分解為 {RECYCLE_POINTS} 點平台通用點數，分解後折價券會退回賣家名額，且無法復原。</li>
        </ul>
      </Section>

      <p className="flex items-start gap-2 rounded-2xl border border-dashed border-primary/50 bg-accent/60 px-4 py-3 text-xs leading-relaxed text-accent-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-brand-ink" aria-hidden />
        獲得的平台點數可至【簽到點數商城】自由兌換全站任意賣家的專屬優惠券喔！
      </p>
    </div>
  )
}
