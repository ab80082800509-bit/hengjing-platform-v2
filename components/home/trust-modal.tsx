'use client'

import { BadgeCheck, Banknote, PackageCheck, ShieldCheck, Truck, Wallet } from 'lucide-react'
import { SheetModal } from '@/components/sheet-modal'

const STEPS = [
  { icon: Wallet, title: '買家付款', body: '透過綠界金流付款，款項不會直接進入賣家帳戶，也不經過本平台。' },
  { icon: ShieldCheck, title: '綠界信託代收', body: '款項暫留於綠界科技安全信託專戶，由綠界代為保管。' },
  { icon: Truck, title: '賣家出貨', body: '賣家收到訂單通知後出貨，買家可在買家中心追蹤物流。' },
  { icon: PackageCheck, title: '買家確認收貨', body: '商品確認無誤後，買家在買家中心按下確認收貨。' },
  { icon: Banknote, title: '綠界撥款給賣家', body: '收到確認後，綠界才把款項撥付給賣家，完成代收代付。' },
]

export function TrustModal({ onClose }: { onClose: () => void }) {
  return (
    <SheetModal
      title="綠界履約保障"
      onClose={onClose}
      size="md"
      z={95}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="inline-flex w-full items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition hover:brightness-95 active:scale-[0.98]"
        >
          我知道了
        </button>
      }
    >
      <div className="space-y-4 p-5">
        <div className="flex items-start gap-3 rounded-2xl border border-blue-500/35 bg-blue-500/10 p-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-black text-blue-300">綠界科技 7 天信託代收代付</p>
            <p className="mt-0.5 text-pretty text-sm leading-relaxed text-muted-foreground">
              買家確認收貨後，款項才會撥給賣家。商品沒收到或與描述不符，錢還在信託專戶裡。
            </p>
          </div>
        </div>

        <ol className="space-y-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-primary">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-bold text-foreground">
                  <span className="mr-1.5 text-xs font-black text-muted-foreground">{i + 1}.</span>
                  {title}
                </p>
                <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>
            買個 Pay 服是 SaaS 平台，不經手、不保管買賣款項，也沒有現金或購物金折抵。簽到點數只能兌換各賣家自行發行的折價券或優惠碼。
          </span>
        </p>
      </div>
    </SheetModal>
  )
}
