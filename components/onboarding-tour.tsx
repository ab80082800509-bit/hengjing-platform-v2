'use client'

import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'

type TourRole = 'buyer' | 'seller'

const STEPS: Record<TourRole, { title: string; body: string }[]> = {
  buyer: [
    { title: '搜尋與分類', body: '用上方搜尋框找商品或店家，分類列可以快速切換。商品價格超過 NT$ 15,000 會顯示防詐安全提示。' },
    { title: '購物車與免運', body: '購物車依店家分組，可針對單一店家勾選結帳。單一店家滿 NT$ 299 自動免運。' },
    { title: '履約保證', body: '付款後款項暫留於綠界安全信託專戶，到「買家中心」確認收貨後才會撥款給賣家。' },
    { title: '收藏與關注', body: '點商品上的愛心加入收藏，也可以關注喜歡的店家，到買家中心集中管理。' },
  ],
  seller: [
    { title: '商品與規格', body: '在「商品管理」上架商品，可設定多種尺寸或規格的庫存與售價。超過 NT$ 30,000 的商品會先進入審核。' },
    { title: '方案與月費', body: '「方案與月費管理」可查看到期日、設定簡訊提醒、下載發票，也能取消或恢復訂閱。' },
    { title: '訂單與出貨', body: '買家確認收貨後，款項會由綠界信託專戶撥給您。請依承諾天數出貨以維護商譽。' },
    { title: '客服與通知', body: '有問題可到「客服中心」送出回報，客服回覆時會自動通知您。' },
  ],
}

export function OnboardingTour({ role, onDone }: { role: TourRole; onDone: () => void }) {
  const steps = STEPS[role]
  const [i, setI] = useState(0)
  const last = i === steps.length - 1
  const step = steps[i]

  return (
    <aside
      role="dialog"
      aria-label="新手引導"
      className="fixed bottom-24 left-3 right-3 z-[80] mx-auto max-w-sm rounded-3xl border border-border/70 bg-card p-4 shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-300 sm:bottom-6 sm:left-auto sm:right-6 sm:mx-0 sm:w-80"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-black text-brand-ink">
          新手引導・{role === 'buyer' ? '買家' : '賣家'} {i + 1}/{steps.length}
        </p>
        <button
          type="button"
          onClick={onDone}
          aria-label="略過新手引導"
          className="-mr-1 -mt-1 rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <h3 className="mt-1 text-base font-black">{step.title}</h3>
      <p className="mt-1 text-pretty text-sm leading-relaxed text-muted-foreground">{step.body}</p>

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {steps.map((s, idx) => (
            <span key={s.title} className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-5 bg-primary' : 'w-1.5 bg-border'}`} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {i > 0 && (
            <button
              type="button"
              onClick={() => setI(i - 1)}
              aria-label="上一步"
              className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-card transition hover:bg-muted"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => (last ? onDone() : setI(i + 1))}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98]"
          >
            {last ? (
              <>
                <Check className="size-4" />完成
              </>
            ) : (
              <>
                下一步<ArrowRight className="size-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  )
}
