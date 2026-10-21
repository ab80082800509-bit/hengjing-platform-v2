'use client'

import { BadgeCheck, Banknote, PackageCheck, ShieldCheck, Truck, Wallet } from 'lucide-react'
import { SheetModal } from '@/components/sheet-modal'

const STEPS = [
  { icon: Wallet, title: '金流尚未串接', body: '目前不能用信用卡或 ATM 完成真實付款，頁面也不會把訂單標成已付款。' },
  { icon: ShieldCheck, title: '不會代收貨款', body: '買個 Pay 服現在不經手商品貨款，也沒有綠界信託帳戶。' },
  { icon: Truck, title: '物流尚未開放', body: '7-11、全家與宅配都還沒有串接，不能模擬物流前進。' },
  { icon: PackageCheck, title: '賣家審核是真的', body: '賣家仍須上傳證件，由平台管理員審核後才能上架。' },
  { icon: Banknote, title: '成交數字來自真實資料', body: '銷量、評價與追蹤數只顯示已寫入的資料，沒有資料就保持空白。' },
]

export function TrustModal({ onClose }: { onClose: () => void }) {
  return (
    <SheetModal
      title="交易說明"
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
            <p className="text-sm font-black text-blue-300">金流與物流尚未開放</p>
            <p className="mt-0.5 text-pretty text-sm leading-relaxed text-muted-foreground">
              可以瀏覽已上架商品、加入購物車，以及聯繫已審核的賣家。結帳不會成立訂單。
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
