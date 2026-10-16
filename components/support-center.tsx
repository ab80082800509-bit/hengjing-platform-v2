'use client'

import { useState, type FormEvent } from 'react'
import { BellRing, CircleAlert, Headset, Inbox, Send } from 'lucide-react'

export interface SupportTicket {
  id: string
  role: 'buyer' | 'seller'
  author: string
  category: string
  subject: string
  body: string
  at: string
  status: 'open' | 'replied'
  reply?: string
  repliedAt?: string
  unread?: boolean
}

export const SUPPORT_CATEGORIES = ['訂單與物流', '付款與撥款', '帳號與安全', '商品與上架', '系統錯誤回報', '其他']

const inputCls =
  'w-full rounded-xl border border-input bg-card px-3 py-2.5 text-base outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/30 sm:text-sm'
const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'

function StatusPill({ t }: { t: SupportTicket }) {
  return t.status === 'replied' ? (
    <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-bold text-emerald-300">客服已回覆</span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-300">處理中</span>
  )
}

export function SupportCenter({
  role,
  author,
  tickets,
  onSubmit,
  onRead,
}: {
  role: 'buyer' | 'seller'
  author: string
  tickets: SupportTicket[]
  onSubmit: (t: { category: string; subject: string; body: string }) => void
  onRead: (id: string) => void
}) {
  const [category, setCategory] = useState(SUPPORT_CATEGORIES[0])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const mine = tickets.filter((t) => t.role === role && t.author === author)
  const unread = mine.filter((t) => t.unread).length

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (subject.trim().length < 2) return setError('請填寫問題主旨')
    if (body.trim().length < 5) return setError('請描述問題內容（至少 5 個字）')
    setError('')
    onSubmit({ category, subject: subject.trim(), body: body.trim() })
    setSubject('')
    setBody('')
  }

  const toggle = (t: SupportTicket) => {
    const next = openId === t.id ? null : t.id
    setOpenId(next)
    if (next && t.unread) onRead(t.id)
  }

  return (
    <section aria-label="客服中心" className="space-y-5">
      {unread > 0 && (
        <div role="status" className="flex items-center gap-2.5 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-300">
          <BellRing className="size-4 shrink-0" />
          客服已回覆您 {unread} 則回報，請在下方紀錄查看
        </div>
      )}

      <form onSubmit={submit} noValidate className="space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <h3 className="flex items-center gap-2 text-base font-black">
          <Headset className="size-5 text-brand-ink" />客服與系統回報
        </h3>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <div className="space-y-1.5">
            <label htmlFor={`sc-cat-${role}`} className="text-xs font-bold text-muted-foreground">問題類型</label>
            <select id={`sc-cat-${role}`} value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
              {SUPPORT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`sc-sub-${role}`} className="text-xs font-bold text-muted-foreground">主旨</label>
            <input id={`sc-sub-${role}`} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={60} className={inputCls} placeholder="簡短描述您遇到的問題" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`sc-body-${role}`} className="text-xs font-bold text-muted-foreground">問題內容</label>
          <textarea id={`sc-body-${role}`} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={500} className={inputCls} placeholder="請提供訂單編號、發生時間與操作步驟，方便客服盡快處理" />
        </div>
        {error && (
          <p role="alert" className="flex items-center gap-1 text-xs font-bold text-destructive">
            <CircleAlert className="size-3.5" />{error}
          </p>
        )}
        <button type="submit" className={`${btnPrimary} w-full sm:w-auto`}>
          <Send className="size-4" />送出回報
        </button>
      </form>

      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-base font-black">
          我的客服回報紀錄
          <span className="text-xs font-medium text-muted-foreground">（{mine.length}）</span>
        </h3>
        {mine.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
            <Inbox className="size-10 text-border" />
            <p className="text-sm text-muted-foreground">還沒有回報紀錄，送出後可在這裡追蹤處理狀態</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {mine.map((t) => {
              const open = openId === t.id
              return (
                <li key={t.id} className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${t.unread ? 'border-emerald-400' : 'border-border/70'}`}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggle(t)}
                    className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-left transition hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-bold">{t.subject}</span>
                    {t.unread && <span className="size-2 rounded-full bg-destructive" aria-label="未讀回覆" />}
                    <StatusPill t={t} />
                    <span className="w-full text-xs text-muted-foreground">{t.category}・{t.id}・{t.at}</span>
                  </button>
                  {open && (
                    <div className="space-y-3 border-t border-border/60 bg-muted/30 px-4 py-3 text-sm">
                      <div>
                        <p className="text-xs font-bold text-muted-foreground">我的問題</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-pretty leading-relaxed">{t.body}</p>
                      </div>
                      {t.reply ? (
                        <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3 text-emerald-300">
                          <p className="text-xs font-black">客服回覆・{t.repliedAt}</p>
                          <p className="mt-0.5 whitespace-pre-wrap text-pretty leading-relaxed">{t.reply}</p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">客服將於 1 個工作天內回覆，回覆時會主動通知您。</p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

export function AdminTicketsPanel({ tickets, onReply }: { tickets: SupportTicket[]; onReply: (id: string, text: string) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const open = tickets.filter((t) => t.status === 'open')
  const sorted = [...tickets].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'))

  return (
    <section aria-label="客服工單" className="space-y-3">
      <h2 className="text-base font-black">客服工單（待處理 {open.length} / 共 {tickets.length}）</h2>
      {sorted.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">目前沒有客服回報</p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((t) => (
            <li key={t.id} className="space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-black">{t.subject}</span>
                <StatusPill t={t} />
                <span className="ml-auto text-xs text-muted-foreground">
                  {t.role === 'buyer' ? '買家' : '賣家'}・{t.author}・{t.category}・{t.at}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-pretty text-sm leading-relaxed text-muted-foreground">{t.body}</p>
              {t.reply ? (
                <p className="rounded-xl bg-muted px-3 py-2 text-sm">已回覆：{t.reply}</p>
              ) : (
                <div className="space-y-2">
                  <label htmlFor={`reply-${t.id}`} className="sr-only">回覆 {t.subject}</label>
                  <textarea
                    id={`reply-${t.id}`}
                    rows={2}
                    value={drafts[t.id] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                    className={inputCls}
                    placeholder="輸入回覆內容，送出後會自動通知對方"
                  />
                  <button
                    type="button"
                    disabled={!(drafts[t.id] ?? '').trim()}
                    onClick={() => {
                      onReply(t.id, (drafts[t.id] ?? '').trim())
                      setDrafts((d) => ({ ...d, [t.id]: '' }))
                    }}
                    className={btnPrimary}
                  >
                    <Send className="size-4" />回覆並通知
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
