import { BadgeCheck, Handshake, Landmark, ShieldAlert, ShieldCheck, Video } from 'lucide-react'

export const HIGH_PRICE_LIMIT = 15000
export const REVIEW_PRICE_LIMIT = 30000

export function EcpayEscrowNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div
      role="note"
      className="flex gap-3 rounded-2xl border border-blue-500/35 bg-blue-500/10 p-3.5 text-blue-300"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-card">
        <ShieldCheck className="size-5" />
      </span>
      <div className="min-w-0 text-sm leading-relaxed">
        <p className="font-black">綠界科技履約保證</p>
        <p className="text-pretty text-xs sm:text-sm">
          款項將暫留於綠界安全信託專戶，確認收貨無誤後才會撥款給賣家，提供完整履約保證。
        </p>
        {!compact && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-blue-300">
            <Landmark className="size-3.5" />
            選擇 ATM 時，系統會透過綠界產生專屬虛擬帳號
          </p>
        )}
      </div>
    </div>
  )
}

export function HighPriceSafetyTags({ price }: { price: number }) {
  if (price <= HIGH_PRICE_LIMIT) return null
  const tags = [
    { icon: ShieldCheck, text: '享有綠界履約保證專戶保障' },
    { icon: Handshake, text: '建議實體面交看貨' },
    { icon: Video, text: '拆封請務必全程錄影' },
  ]
  return (
    <section
      aria-label="高單價防詐安全提示"
      className="space-y-2.5 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3.5 text-amber-300"
    >
      <p className="flex items-center gap-1.5 text-sm font-black">
        <ShieldAlert className="size-4 text-amber-400" />
        高單價防詐安全提示
      </p>
      <ul className="flex flex-wrap gap-2">
        {tags.map(({ icon: Icon, text }) => (
          <li
            key={text}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/35 bg-card px-3 py-1 text-xs font-bold"
          >
            <Icon className="size-3.5 text-amber-400" />
            {text}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function PayoutStatus({ released, paid }: { released: boolean; paid: boolean }) {
  if (released) {
    return (
      <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-300">
        <BadgeCheck className="mt-0.5 size-4 shrink-0" />
        <p>
          <b>已完成撥款</b>：您已確認收貨，綠界信託專戶已將款項撥付給賣家。
        </p>
      </div>
    )
  }
  if (!paid) return null
  return (
    <div role="status" className="flex items-start gap-2 rounded-xl border border-blue-500/35 bg-blue-500/10 p-3 text-xs leading-relaxed text-blue-300">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-blue-400" />
      <p>
        <b>款項保管中</b>：款項暫留於綠界安全信託專戶，確認收貨後才會撥款給賣家。
      </p>
    </div>
  )
}
