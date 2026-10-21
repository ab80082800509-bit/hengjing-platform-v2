'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MessageCircle, Send, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  fetchSellerChatMessages,
  fetchSellerChats,
  markSellerChatRead,
  openSellerChat,
  sendSellerChatMessage,
  type SellerChatMessage,
  type SellerChatThread,
} from '@/lib/marketplace-features'

export type ChatProductPreview = {
  id: string
  name: string
  priceLabel: string
  image: string
}

function when(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function SellerChatPanel({
  role,
  focusSellerUserId,
  focusProduct,
  restoreChatId,
  onActiveChange,
  onOpenProduct,
  onUnread,
}: {
  role: 'buyer' | 'seller'
  focusSellerUserId?: string | null
  focusProduct?: ChatProductPreview | null
  restoreChatId?: string | null
  onActiveChange?: (chatId: string | null) => void
  onOpenProduct?: (id: string) => void
  onUnread?: (count: number) => void
}) {
  const [chats, setChats] = useState<SellerChatThread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SellerChatMessage[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [userId, setUserId] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const activeIdRef = useRef<string | null>(null)
  const userIdRef = useRef('')

  const visibleChats = useMemo(
    () => chats.filter((chat) => (role === 'seller' ? chat.sellerUserId === userId : chat.buyerId === userId)),
    [chats, role, userId],
  )
  const active = visibleChats.find((chat) => chat.id === activeId) ?? chats.find((chat) => chat.id === activeId) ?? null

  const loadChats = async () => {
    const result = await fetchSellerChats()
    if (result.error) setError(result.error)
    const uid = userIdRef.current
    const mine = result.chats.filter((chat) => (role === 'seller' ? chat.sellerUserId === uid : chat.buyerId === uid))
    setChats(mine)
    onUnread?.(mine.reduce((sum, chat) => sum + chat.unread, 0))
    return mine
  }

  const loadMessages = async (chatId: string) => {
    const result = await fetchSellerChatMessages(chatId)
    if (result.error) {
      setError(result.error)
      return
    }
    setMessages(result.messages)
    const readError = await markSellerChatRead(chatId)
    if (readError) setError(readError)
    setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)))
  }

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      const { data } = await supabase.auth.getUser()
      if (cancelled) return
      const uid = data.user?.id ?? ''
      userIdRef.current = uid
      setUserId(uid)
      setLoading(true)
      const rows = await loadChats()
      if (cancelled) return
      const restored = restoreChatId ? rows.find((chat) => chat.id === restoreChatId) : undefined
      if (restored) {
        setActiveId(restored.id)
        onActiveChange?.(restored.id)
        await loadMessages(restored.id)
      } else if (restoreChatId) {
        setError('找不到這則對話，或您不是參與者。沒有另外建立新對話。')
        onActiveChange?.(null)
      } else if (role === 'buyer' && focusSellerUserId) {
        const opened = await openSellerChat(focusSellerUserId, focusProduct?.id ?? null)
        if (opened.error) setError(opened.error)
        if (opened.id) {
          setActiveId(opened.id)
          onActiveChange?.(opened.id)
          await loadMessages(opened.id)
          await loadChats()
        }
      } else if (rows[0] && role === 'seller') {
        setActiveId(rows[0].id)
        onActiveChange?.(rows[0].id)
        await loadMessages(rows[0].id)
      }
      if (!cancelled) setLoading(false)
    }
    void start()
    const timer = window.setInterval(() => { void loadChats() }, 12000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
    // Opening by seller only happens when there is no conversation to restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, focusSellerUserId, focusProduct?.id, restoreChatId])

  useEffect(() => {
    if (!activeId) return
    const channel = supabase
      .channel(`seller-chat-${activeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'seller_chat_messages', filter: `chat_id=eq.${activeId}` }, () => {
        if (activeIdRef.current === activeId) void loadMessages(activeId)
        void loadChats()
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const choose = (chatId: string) => {
    setActiveId(chatId)
    onActiveChange?.(chatId)
    setError('')
    void loadMessages(chatId)
  }

  const send = async () => {
    const body = text.trim()
    if (!activeId || !body || sending) return
    setSending(true)
    const result = await sendSellerChatMessage(activeId, body)
    setSending(false)
    if (result.error || !result.message) {
      setError(result.error || '傳送失敗')
      return
    }
    setText('')
    setMessages((current) => current.some((item) => item.id === result.message?.id) ? current : [...current, result.message as SellerChatMessage])
    void loadChats()
  }

  return (
    <div className="flex h-[32rem] overflow-hidden rounded-2xl border border-border bg-card md:h-[36rem]">
      <aside className={`${active ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-border md:w-72 md:border-r`}>
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-black">{role === 'seller' ? '買家訊息' : '賣場訊息'}</p>
          <p className="text-xs text-muted-foreground">與平台客服工單分開。LINE 通知尚未開放。</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && visibleChats.length === 0 && <p className="px-4 pt-4 text-xs font-bold text-destructive" role="alert">{error}</p>}
          {loading && visibleChats.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />讀取對話</p>
          ) : visibleChats.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-muted-foreground">尚無對話</p>
          ) : visibleChats.map((chat) => (
            <button key={chat.id} type="button" onClick={() => choose(chat.id)} className={`flex w-full items-start gap-3 border-b border-border/70 px-3 py-3 text-left ${chat.id === activeId ? 'bg-primary/10' : 'hover:bg-muted/60'}`}>
              <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-bold">
                {chat.peerAvatar ? <img src={chat.peerAvatar} alt="" className="h-full w-full object-cover" /> : chat.peerName.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold">{chat.peerName}</span>
                  {chat.unread > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-black text-primary-foreground">{chat.unread}</span>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{chat.lastBody || '尚無訊息'}</span>
                <span className="text-[10px] text-muted-foreground">{when(chat.lastAt)}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className={`${active ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {active ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-3 py-3">
              <button type="button" className="rounded-lg px-2 py-1 text-xs font-bold md:hidden" onClick={() => { setActiveId(null); onActiveChange?.(null) }}>返回</button>
              <div className="min-w-0">
                <p className="truncate text-sm font-black">{active.peerName}</p>
                <p className="text-[10px] text-muted-foreground">{active.unread > 0 ? `${active.unread} 則未讀` : '已讀狀態會在開啟對話後更新'}</p>
              </div>
            </div>
            {active.productVisible && active.productName ? (
              <button type="button" onClick={() => active.productId && onOpenProduct?.(active.productId)} className="m-3 flex items-center gap-3 rounded-2xl border border-border bg-muted/40 p-2 text-left">
                <span className="size-12 overflow-hidden rounded-xl bg-muted">
                  {active.productImage && <img src={active.productImage} alt="" className="h-full w-full object-cover" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{active.productName}</span>
                  <span className="text-xs text-muted-foreground">{active.productPrice == null ? '查看商品' : `NT$ ${active.productPrice.toLocaleString('en-US')}`}</span>
                </span>
              </button>
            ) : active.productId ? (
              <p className="mx-3 mt-3 rounded-2xl border border-dashed border-border p-3 text-xs text-muted-foreground">此商品目前無法公開查看</p>
            ) : null}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
              {messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">可以直接詢問價格、庫存、規格或出貨。</p>}
              {messages.map((message) => {
                const mine = message.senderId === userId
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border border-border bg-background'}`}>
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                      <p className={`mt-1 text-[10px] ${mine ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{when(message.createdAt)}</p>
                    </div>
                  </div>
                )
              })}
              <div ref={endRef} />
            </div>
            {error && <p className="px-3 text-xs font-bold text-destructive" role="alert">{error}</p>}
            <form className="flex gap-2 border-t border-border p-3" onSubmit={(event) => { event.preventDefault(); void send() }}>
              <input value={text} maxLength={500} onChange={(event) => setText(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm" placeholder="輸入訊息" aria-label="聊天訊息" />
              <button type="submit" disabled={sending || !text.trim()} className="rounded-xl bg-primary px-4 text-primary-foreground disabled:opacity-50" aria-label="送出訊息">
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </form>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageCircle className="size-8" />
            <p className="text-sm">選擇一則對話</p>
          </div>
        )}
      </section>
    </div>
  )
}

export function SellerChatDialog({
  sellerName,
  sellerUserId,
  product,
  restoreChatId,
  onActiveChange,
  onClose,
  onOpenProduct,
}: {
  sellerName: string
  sellerUserId: string
  product?: ChatProductPreview | null
  restoreChatId?: string | null
  onActiveChange?: (chatId: string | null) => void
  onClose: () => void
  onOpenProduct?: (id: string) => void
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`與 ${sellerName} 聊聊`}>
      <div className="flex max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-black">聯繫 {sellerName}</p>
            <p className="text-xs text-muted-foreground">{product ? `關於商品：${product.name}` : '賣場客服'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-muted" aria-label="關閉聊天">
            <X className="size-4" />
          </button>
        </div>
        <SellerChatPanel role="buyer" focusSellerUserId={restoreChatId ? null : sellerUserId} focusProduct={restoreChatId ? null : product} restoreChatId={restoreChatId} onActiveChange={onActiveChange} onOpenProduct={onOpenProduct} />
      </div>
    </div>
  )
}
