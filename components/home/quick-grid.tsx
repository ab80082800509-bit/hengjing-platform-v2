'use client'

import { Crown, Flame, Gift, ShieldCheck, Ticket, Truck, Zap, type LucideIcon } from 'lucide-react'

export type QuickKey = 'freeShip' | 'hot' | 'founder' | 'trust' | 'new' | 'checkin' | 'scratch'

interface QuickItem {
  key: QuickKey
  label: string
  hint: string
  icon: LucideIcon
  chip: string
}

const ITEMS: QuickItem[] = [
  { key: 'freeShip', label: '全站免運專區', hint: '單件即享免運', icon: Truck, chip: 'from-emerald-500 to-teal-600' },
  { key: 'hot', label: '熱銷發燒榜', hint: '銷量與評價熱度', icon: Flame, chip: 'from-orange-500 to-red-500' },
  { key: 'founder', label: '創始特約店', hint: '早期進駐優質賣家', icon: Crown, chip: 'from-amber-400 to-yellow-600' },
  { key: 'trust', label: '綠界履約保障', hint: '收貨後才撥款', icon: ShieldCheck, chip: 'from-sky-500 to-blue-600' },
  { key: 'new', label: '新上架商品', hint: '最新上架牆', icon: Zap, chip: 'from-yellow-400 to-orange-500' },
  { key: 'checkin', label: '簽到兌換專區', hint: '兌換賣家優惠券', icon: Gift, chip: 'from-pink-500 to-rose-600' },
  { key: 'scratch', label: '幸運刮刮卡', hint: '每日免費刮一次', icon: Ticket, chip: 'from-violet-500 to-fuchsia-600' },
]

export function QuickGrid({ active, onSelect }: { active: QuickKey | null; onSelect: (key: QuickKey) => void }) {
  return (
    <nav aria-label="快捷功能" className="mt-4 md:mt-5">
      <ul className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:grid md:grid-cols-7 md:gap-3 md:overflow-visible md:px-0 md:pb-0">
        {ITEMS.map(({ key, label, hint, icon: Icon, chip }) => {
          const on = active === key
          return (
            <li key={key} className="min-w-[104px] shrink-0 snap-start md:min-w-0">
              <button
                type="button"
                aria-pressed={key === 'freeShip' || key === 'hot' || key === 'founder' || key === 'new' ? on : undefined}
                onClick={() => onSelect(key)}
                className={`group flex h-full w-full flex-col items-center gap-2 rounded-2xl border px-2 py-3.5 text-center transition active:scale-[0.97] md:py-4 ${
                  on
                    ? 'border-primary/70 bg-accent shadow-[0_0_0_1px_var(--primary)]'
                    : 'border-border bg-card hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted'
                }`}
              >
                <span className={`flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg shadow-black/30 transition group-hover:scale-105 ${chip}`}>
                  <Icon className="size-6" aria-hidden />
                </span>
                <span className="text-[13px] font-black leading-tight text-foreground md:text-sm">{label}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">{hint}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
