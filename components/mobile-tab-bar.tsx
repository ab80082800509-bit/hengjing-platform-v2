'use client'

import type { LucideIcon } from 'lucide-react'
import { ClipboardList, Coins, ShoppingCart, Store } from 'lucide-react'

type TabId = 'market' | 'rewards' | 'cart' | 'center'

type Props = {
  active: 'market' | 'rewards'
  points: number
  cartCount: number
  centerBadge: number
  onMarket: () => void
  onRewards: () => void
  onCart: () => void
  onCenter: () => void
}

type Tab = {
  id: TabId
  label: string
  icon: LucideIcon
  onClick: () => void
  badge?: { value: number; tone: 'alert' | 'dark' | 'brand' }
  ariaLabel?: string
}

const BADGE_TONE = {
  alert: 'bg-destructive text-white',
  dark: 'bg-foreground text-card',
  brand: 'bg-primary/15 text-brand-ink',
} as const

export function MobileTabBar({ active, points, cartCount, centerBadge, onMarket, onRewards, onCart, onCenter }: Props) {
  const tabs: Tab[] = [
    { id: 'market', label: '市集', icon: Store, onClick: onMarket },
    {
      id: 'rewards',
      label: '簽到兌換',
      icon: Coins,
      onClick: onRewards,
      badge: { value: points, tone: 'brand' },
      ariaLabel: `簽到兌換，目前 ${points} 點`,
    },
    {
      id: 'cart',
      label: '購物車',
      icon: ShoppingCart,
      onClick: onCart,
      badge: cartCount > 0 ? { value: cartCount, tone: 'dark' } : undefined,
      ariaLabel: `購物車，${cartCount} 件商品`,
    },
    {
      id: 'center',
      label: '買家中心',
      icon: ClipboardList,
      onClick: onCenter,
      badge: centerBadge > 0 ? { value: centerBadge, tone: 'alert' } : undefined,
      ariaLabel: `買家中心，${centerBadge} 筆待處理訂單`,
    },
  ]

  return (
    <nav
      aria-label="買家快速導覽"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border/70 bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4 px-1 pt-1.5">
        {tabs.map((tab) => {
          const isActive = tab.id === active
          return (
            <li key={tab.id}>
              <button
                type="button"
                onClick={tab.onClick}
                aria-label={tab.ariaLabel}
                aria-current={isActive ? 'page' : undefined}
                className="group flex w-full flex-col items-center gap-0.5 pb-1.5 text-xs font-bold transition active:scale-95"
              >
                <span
                  className={`relative flex h-8 w-14 items-center justify-center rounded-full transition ${
                    isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground group-hover:bg-muted'
                  }`}
                >
                  <tab.icon className="size-5" aria-hidden />
                  {tab.badge && (
                    <span
                      className={`absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-black leading-5 ring-2 ring-card ${BADGE_TONE[tab.badge.tone]}`}
                    >
                      {tab.badge.value}
                    </span>
                  )}
                </span>
                <span className={isActive ? 'text-foreground' : 'text-muted-foreground'}>{tab.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
