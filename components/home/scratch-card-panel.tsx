'use client'

import { useState, type ReactNode } from 'react'
import { Check, Clover, Coins, Crown, Gift, Info, Share2, Ticket, type LucideIcon } from 'lucide-react'
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

function describe(o: ScratchOutcome) {
  if (o.kind === 'none') {
    return {
      title: `保底 +${o.points} 點`,
      sub: '已寫入正式點數帳本',
      summary: `這次沒有中大獎。保底 ${o.points} 點已寫入正式點數帳本。`,
    }
  }
  if (o.kind === 'coupon') {
    return {
      title: o.headline,
      sub: `${o.sellerName}・已放入券包`,
      summary: `獲得「${o.sellerName}」${o.title}。這次沒有改點數，也沒有同時領替代點數。`,
    }
  }
  if (o.kind === 'points') {
    const sub = o.fallbackFrom === 'founder'
      ? '創始券尚未開放，已改入帳正式點數'
      : o.fallbackFrom === 'coupon'
        ? '目前沒有可發的優惠券，已改入帳正式點數'
        : '已寫入正式點數帳本'
    const summary = o.fallbackFrom
      ? o.fallbackFrom === 'founder'
        ? `創始券尚未開放，這次改入帳 ${o.points} 點，已寫入正式點數帳本。沒有建立創始券。`
        : `目前沒有可發的優惠券，這次改入帳 ${o.points} 點，已寫入正式點數帳本。沒有同時發券。`
      : `獲得 ${o.points} 點，已寫入正式點數帳本。`
    return { title: `+${o.points} 點`, sub, summary }
  }
  return {
    title: '這張結果不能使用',
    sub: '請重新整理',
    summary: '這次結果無法顯示。請重新整理；若點數已入帳或券已進券包，不會再發一次。',
  }
}

function PrizeFace({ card }: { card: ScratchCard }) {
  const o = card.outcome
  const iconKind = o.kind === 'founder' ? 'points' : o.kind
  const Icon = PRIZE_ICON[iconKind]
  const { title, sub } = describe(o)
  return (
    <div
      aria-hidden={!card.revealed}
      className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-accent via-card to-background px-4 text-center"
    >
      <span className={`flex size-12 items-center justify-center rounded-2xl ${PRIZE_TINT[iconKind]}`}>
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="text-balance text-2xl font-black text-foreground md:text-3xl">{title}</p>
      <p className="text-pretty text-xs text-muted-foreground md:text-sm">{sub}</p>
    </div>
  )
}

function IdleFace({ exhausted }: { exhausted: boolean }) {
  return (
    <div className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-gradient-to-br from-muted to-background px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-card text-muted-foreground">
        <Ticket className="size-6" aria-hidden />
      </span>
      <p className="text-base font-black">{exhausted ? '今日次數已用完' : '今日幸運刮刮卡'}</p>
      <p className="text-xs text-muted-foreground">{exhausted ? '台灣時間明天 00:00 後再來刮一張' : '按下「開始刮卡」，再用手指或滑鼠刮開塗層'}</p>
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
  card,
  busy,
  errorText,
  onStart,
  onReveal,
  onShare,
}: {
  loggedIn: boolean
  skew: number
  chancesTotal: number | null
  chancesLeft: number | null
  shared: boolean
  card: ScratchCard | null
  busy: boolean
  errorText: string | null
  onStart: () => void
  onReveal: () => void
  onShare: () => void
}) {
  const [progress, setProgress] = useState(0)
  const [fireKey, setFireKey] = useState(0)

  const scratching = !!card && !card.revealed
  const exhausted = loggedIn && chancesLeft === 0
  const used = chancesTotal != null && chancesLeft != null ? chancesTotal - chancesLeft : 0

  const handleReveal = () => {
    if (!card || card.revealed || busy) return
    onReveal()
    setFireKey((k) => k + 1)
  }

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/50 px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">今日刮卡次數</p>
          <div className="mt-1 flex items-center gap-1.5">
            {Array.from({ length: SCRATCH_MAX_CHANCES }, (_, i) => {
              const unlocked = chancesTotal != null && i < chancesTotal
              const left = unlocked && i >= used
              return (
                <span
                  key={i}
                  title={!unlocked ? '朋友完成註冊後解鎖' : left ? '可使用' : '已使用'}
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
              {!loggedIn ? '登入後免費 1 次' : chancesLeft == null || chancesTotal == null ? '讀取中' : `剩餘 ${chancesLeft} / ${chancesTotal} 次`}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">距離台灣時間 00:00 重製</p>
          <ResetCountdown skew={skew} className="text-xl font-black text-brand-ink" />
        </div>
      </div>

      {errorText && (
        <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">
          {errorText}
        </p>
      )}

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
          <button type="button" onClick={handleReveal} disabled={busy} className="rounded-full border border-border bg-card px-3 py-1 font-bold text-foreground transition hover:bg-muted disabled:opacity-50">
            直接揭曉
          </button>
        </div>
      )}

      {card?.revealed && (
        <p role="status" className="rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-accent-foreground">
          {describe(card.outcome).summary}
        </p>
      )}

      {!scratching && (
        <div className="grid gap-2">
          {exhausted ? (
            <button
              type="button"
              disabled
              className="inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-full bg-muted px-5 py-2.5 text-sm font-bold text-muted-foreground"
            >
              <Ticket className="size-4" aria-hidden />
              今日次數已用完，明天再來
            </button>
          ) : (
            <button
              type="button"
              onClick={onStart}
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:opacity-50"
            >
              <Ticket className="size-4" aria-hidden />
              {!loggedIn ? '登入後免費刮卡' : busy ? '正在向伺服器確認…' : card?.revealed ? '再刮一張' : '開始刮卡'}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 px-4 py-3">
        <p className="min-w-0 text-xs text-muted-foreground">
          {shared ? '今天已有朋友完成註冊，刮卡次數共 2 次' : '朋友用你的連結完成註冊並驗證信箱後，今天可再刮 1 次。只點開連結不會加次數。'}
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

      <Section title="玩法、次數與獎勵">
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
                  <p className="text-pretty text-xs text-muted-foreground">{p.detail}</p>
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
          <li>每位會員每天免費 1 次。朋友必須用你的連結完成新會員註冊，並完成信箱驗證，你當天才能再刮 1 次。</li>
          <li>只點開連結、未完成註冊，不會增加次數。同一位朋友只能成立一次，不能邀請自己。</li>
          <li>每天最多 2 次。邀請加的那 1 次只在台灣時間當天有效，00:00 作廢，不會留到隔天。</li>
          <li>開獎與入帳都由伺服器決定。重新整理、重新登入或換裝置不會補回已用次數，也不會重領同一張。</li>
          <li>刮中一般券時，只會發一張商家授權的券，或改入帳替代點數，不會兩樣一起領。附贈點數與分解成 {RECYCLE_POINTS} 點尚未開放。</li>
          <li>平台不經手商品貨款。這裡的點數也不能拿去結帳折抵。</li>
        </ul>
      </Section>

      <p className="flex items-start gap-2 rounded-2xl border border-dashed border-primary/50 bg-accent/60 px-4 py-3 text-xs leading-relaxed text-accent-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-brand-ink" aria-hidden />
        刮卡點數寫入與每日簽到相同的正式點數帳本。商家授權的券會進入券包；沒有可發的券才改入帳點數。創始券仍只入帳點數。
      </p>
    </div>
  )
}
