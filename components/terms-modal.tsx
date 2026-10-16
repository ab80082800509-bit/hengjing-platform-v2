'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ExternalLink, ShieldCheck, Video } from 'lucide-react'
import { SheetModal } from './sheet-modal'

type TermsTab = 'tos' | 'privacy'

const TOS_SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '一、平台定位',
    body: [
      '本平台為純 SaaS 垂直媒合軟體，提供賣家開店、商品展示與訂單管理工具，並結合綠界科技提供代收代付與虛擬帳號履約保證。',
      '買賣契約成立於買家與賣家之間，平台不是商品的販售方，也不保證商品品質。',
    ],
  },
  {
    title: '二、金流與履約保證',
    body: [
      '買家可透過綠界科技產生專屬 ATM 虛擬帳號，或使用線上付款。款項會暫留於綠界安全信託專戶。',
      '買家於訂單列表按下「確認收貨」後，系統才會觸發撥款給賣家，訂單狀態更新為「已完成撥款」。',
    ],
  },
  {
    title: '三、物流與免運',
    body: [
      '單一店家消費滿 NT$ 299 享免運，各店家獨立計算。物流由超商或宅配業者執行，延誤、遺失依各物流業者規範處理。',
    ],
  },
  {
    title: '四、高單價商品安全規範',
    body: [
      '商品價格高於 NT$ 15,000 時，商品頁會顯示高單價防詐提示。價格超過 NT$ 30,000 的商品會先進入「審核中」，經平台管理員審查後才會公開。',
      '高單價商品開箱請全程錄影，並建議實體面交看貨。拆封過程的錄影是日後申請退款或報案的重要證據。',
    ],
  },
  {
    title: '五、詐騙與爭議處理',
    body: [
      '若遭遇詐騙，平台將提供交易歷程資料（訂單、付款、聊天與出貨紀錄）協助買家報案，並對涉案賣家停權、列入黑名單。',
    ],
  },
]

const PRIVACY_SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '一、蒐集範圍',
    body: ['為完成交易，我們會蒐集姓名、聯絡電話、收件地址與訂單資料；賣家另需提供實名審核所需文件。'],
  },
  {
    title: '二、使用目的',
    body: ['僅用於訂單處理、物流配送、金流對帳、客服與風險控管。未經同意，不會將個人資料出售或提供給無關第三方。'],
  },
  {
    title: '三、第三方服務',
    body: ['金流資料由綠界科技處理，平台不儲存完整信用卡號。物流資訊會提供給合作物流業者以完成配送。'],
  },
  {
    title: '四、您的權利',
    body: ['您可隨時查詢、更正或刪除個人資料，也可聯絡客服申請停止使用。'],
  },
]

export function TermsModal({ onClose, initialTab = 'tos' }: { onClose: () => void; initialTab?: TermsTab }) {
  const [tab, setTab] = useState<TermsTab>(initialTab)
  const sections = tab === 'tos' ? TOS_SECTIONS : PRIVACY_SECTIONS

  return (
    <SheetModal
      title="服務條款與隱私政策"
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href={tab === 'tos' ? '/legal/tos' : '/legal/privacy'}
            target="_blank"
            className="inline-flex items-center gap-1 text-xs font-bold text-brand-ink hover:underline"
          >
            <ExternalLink className="size-3.5" />開啟完整條款頁面
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98]"
          >
            我已了解
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <div role="tablist" aria-label="條款類型" className="inline-flex rounded-full bg-muted p-1">
          {(
            [
              ['tos', '服務條款'],
              ['privacy', '隱私政策'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${tab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'tos' && (
          <div className="flex gap-3 rounded-2xl border border-blue-500/35 bg-blue-500/10 p-4 text-sm leading-relaxed text-blue-300">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-blue-400" />
            <p className="text-pretty">
              <b>重點摘要：</b>本平台為純 SaaS 垂直媒合軟體，結合綠界科技提供代收代付與虛擬帳號履約保證。
            </p>
          </div>
        )}
        {tab === 'tos' && (
          <div className="flex gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm font-bold leading-relaxed text-destructive">
            <Video className="mt-0.5 size-5 shrink-0" />
            <p className="text-pretty">高單價商品開箱請全程錄影。若遭遇詐騙，平台將提供歷程資料協助買家報案並封鎖賣家。</p>
          </div>
        )}

        <div className="space-y-4">
          {sections.map((s) => (
            <section key={s.title} className="space-y-1.5">
              <h3 className="text-sm font-black">{s.title}</h3>
              {s.body.map((p) => (
                <p key={p} className="text-pretty text-sm leading-relaxed text-muted-foreground">{p}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </SheetModal>
  )
}
