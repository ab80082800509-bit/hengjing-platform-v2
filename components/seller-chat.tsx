'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Camera, FileText, ImageIcon, Loader2, MessageCircle, Send, Smile, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fetchPublicEquippedPerks } from '@/lib/rewards/perk-client'
import type { PublicLoadout } from '@/lib/rewards/perk-snapshot'
import { STICKERS, parseStickerMessage, stickerById, stickerPreviewText, stickerToken, stickerUsable } from '@/lib/rewards/stickers'
import { CHAT_FILE_LIMIT_TEXT, CHAT_FILE_MAX_COUNT, chatFileIsImage, chatFileRefusal, formatChatFileSize, resolveChatFileMime } from '@/lib/chat-files'
import { PerkAvatar, PerkTags } from './home/perks-shop'
import { GameBadgeChip } from './arcade/achievement-wall'
import { fetchPublicGameBadges } from '@/lib/arcade/arcade-client'
import { AnimatedSticker, bubbleClass } from './home/perk-visuals'
import {
  fetchSellerChatMessages,
  fetchSellerChats,
  markSellerChatRead,
  openSellerChat,
  removeUnsentChatFile,
  sendSellerChatFile,
  sendSellerChatMessage,
  signedChatFileUrl,
  uploadSellerChatFile,
  type SellerChatFile,
  type SellerChatMessage,
  type SellerChatThread,
} from '@/lib/marketplace-features'

export type ChatProductPreview = {
  id: string
  name: string
  priceLabel: string
  image: string
}

type PendingFile = {
  key: string
  file: File
  name: string
  mime: string
  preview: string | null
  path: string | null
  status: 'ready' | 'uploading' | 'failed'
  error: string
}

function when(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function releasePending(items: PendingFile[], cancelKeys: Set<string>) {
  for (const item of items) {
    cancelKeys.add(item.key)
    if (item.preview) URL.revokeObjectURL(item.preview)
    if (item.path && item.status !== 'uploading') void removeUnsentChatFile(item.path)
  }
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
  const [loadouts, setLoadouts] = useState<Record<string, PublicLoadout>>({})
  const [badges, setBadges] = useState<Record<string, string>>({})
  const [stickerOpen, setStickerOpen] = useState(false)
  const [pending, setPending] = useState<PendingFile[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderDone, setOlderDone] = useState(false)
  const [zoom, setZoom] = useState<{ name: string; url: string } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const activeIdRef = useRef<string | null>(null)
  const userIdRef = useRef('')
  const pendingRef = useRef<PendingFile[]>([])
  const stickRef = useRef(true)
  const inflight = useRef(new Set<string>())
  const cancelledKeys = useRef(new Set<string>())
  const albumRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)

  const rememberPending = (next: PendingFile[] | ((current: PendingFile[]) => PendingFile[])) => {
    setPending((current) => {
      const resolved = typeof next === 'function' ? next(current) : next
      pendingRef.current = resolved
      return resolved
    })
  }

  const visibleChats = useMemo(
    () => chats.filter((chat) => (role === 'seller' ? chat.sellerUserId === userId : chat.buyerId === userId)),
    [chats, role, userId],
  )
  const active = visibleChats.find((chat) => chat.id === activeId) ?? chats.find((chat) => chat.id === activeId) ?? null
  const peerId = active ? (role === 'seller' ? active.buyerId : active.sellerUserId) : ''

  useEffect(() => {
    const ids = new Set<string>()
    if (userId) ids.add(userId)
    for (const chat of visibleChats) {
      if (chat.buyerId) ids.add(chat.buyerId)
      if (chat.sellerUserId) ids.add(chat.sellerUserId)
    }
    for (const message of messages) if (message.senderId) ids.add(message.senderId)
    const list = [...ids]
    if (!list.length) return
    let cancelled = false
    void fetchPublicEquippedPerks(list).then((rows) => {
      if (!cancelled && rows) setLoadouts(rows)
    })
    void fetchPublicGameBadges(list).then((rows) => {
      if (!cancelled && rows) setBadges(rows)
    })
    return () => {
      cancelled = true
    }
  }, [userId, visibleChats, messages])

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
    stickRef.current = true
    setOlderDone(false)
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
    if (stickRef.current) endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  useEffect(() => {
    setOlderDone(false)
    setZoom(null)
    const leftover = pendingRef.current
    if (leftover.length) {
      pendingRef.current = []
      setPending([])
      releasePending(leftover, cancelledKeys.current)
    }
  }, [activeId])

  useEffect(() => () => {
    releasePending(pendingRef.current, cancelledKeys.current)
  }, [])

  useEffect(() => {
    if (!zoom) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoom(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  const choose = (chatId: string) => {
    setActiveId(chatId)
    onActiveChange?.(chatId)
    setError('')
    void loadMessages(chatId)
  }

  const loadOlder = async () => {
    if (!activeId || loadingOlder || olderDone || messages.length === 0) return
    setLoadingOlder(true)
    stickRef.current = false
    const result = await fetchSellerChatMessages(activeId, messages[0].createdAt)
    setLoadingOlder(false)
    if (result.error) {
      setError(result.error)
      return
    }
    if (result.messages.length === 0) {
      setOlderDone(true)
      return
    }
    setMessages((current) => {
      const ids = new Set(current.map((item) => item.id))
      return [...result.messages.filter((item) => !ids.has(item.id)), ...current]
    })
  }

  const addFiles = (list: File[]) => {
    if (!list.length) return
    const room = CHAT_FILE_MAX_COUNT - pendingRef.current.length
    if (room <= 0) {
      setError('一次最多選取 3 個檔案')
      return
    }
    const accepted: PendingFile[] = []
    let reason = ''
    for (const file of list) {
      if (accepted.length >= room) {
        reason = '一次最多選取 3 個檔案'
        break
      }
      const refusal = chatFileRefusal(file)
      if (refusal) {
        reason = `${file.name || '未命名檔案'}：${refusal}`
        continue
      }
      const mime = resolveChatFileMime(file)
      accepted.push({
        key: crypto.randomUUID(),
        file,
        name: file.name || (mime === 'application/pdf' ? '附件.pdf' : '照片'),
        mime,
        preview: chatFileIsImage(mime) ? URL.createObjectURL(file) : null,
        path: null,
        status: 'ready',
        error: '',
      })
    }
    setError(reason)
    if (!accepted.length) return
    setStickerOpen(false)
    rememberPending((current) => [...current, ...accepted])
  }

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    addFiles(files)
  }

  const cancelPending = async (key: string) => {
    const item = pendingRef.current.find((row) => row.key === key)
    if (!item || item.status === 'uploading') return
    cancelledKeys.current.add(key)
    if (item.preview) URL.revokeObjectURL(item.preview)
    rememberPending((current) => current.filter((row) => row.key !== key))
    if (item.path) await removeUnsentChatFile(item.path)
  }

  const deliverFile = async (key: string) => {
    const chatId = activeIdRef.current
    const item = pendingRef.current.find((row) => row.key === key)
    if (!chatId || !item || item.status === 'uploading' || inflight.current.has(key)) return
    inflight.current.add(key)
    rememberPending((current) => current.map((row) => (row.key === key ? { ...row, status: 'uploading', error: '' } : row)))
    let path = item.path
    try {
      if (!path) {
        const uploaded = await uploadSellerChatFile(chatId, item.file)
        const abandoned = cancelledKeys.current.has(key) || activeIdRef.current !== chatId
        if (abandoned) {
          if (uploaded.path) await removeUnsentChatFile(uploaded.path)
          return
        }
        if (!uploaded.path) {
          rememberPending((current) => current.map((row) => (row.key === key ? { ...row, status: 'failed', error: uploaded.error || '上傳失敗', path: null } : row)))
          return
        }
        path = uploaded.path
        rememberPending((current) => current.map((row) => (row.key === key ? { ...row, path } : row)))
      }
      if (cancelledKeys.current.has(key) || activeIdRef.current !== chatId) {
        await removeUnsentChatFile(path)
        return
      }
      const sent = await sendSellerChatFile(chatId, path, item.name, item.key)
      if (sent.error || !sent.message) {
        if (cancelledKeys.current.has(key) || activeIdRef.current !== chatId) return
        rememberPending((current) => current.map((row) => (row.key === key ? { ...row, status: 'failed', error: sent.error || '傳送失敗', path } : row)))
        return
      }
      if (sent.message.file?.path && sent.message.file.path !== path) await removeUnsentChatFile(path)
      if (item.preview) URL.revokeObjectURL(item.preview)
      rememberPending((current) => current.filter((row) => row.key !== key))
      if (activeIdRef.current !== chatId) return
      stickRef.current = true
      setMessages((current) => (current.some((row) => row.id === sent.message?.id) ? current : [...current, sent.message as SellerChatMessage]))
      void loadChats()
    } finally {
      inflight.current.delete(key)
    }
  }

  const downloadFile = async (file: SellerChatFile) => {
    const result = await signedChatFileUrl(file.path, file.name)
    if (!result.url) {
      setError(result.error || '無法下載附件')
      return
    }
    const link = document.createElement('a')
    link.href = result.url
    link.download = file.name
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const openPhoto = async (file: SellerChatFile, currentUrl: string) => {
    if (currentUrl) {
      setZoom({ name: file.name, url: currentUrl })
      return
    }
    const result = await signedChatFileUrl(file.path)
    if (!result.url) {
      setError(result.error || '無法開啟照片')
      return
    }
    setZoom({ name: file.name, url: result.url })
  }

  const send = async (sticker?: string) => {
    if (sticker && !stickerById.has(sticker)) return
    const body = sticker ? stickerToken(sticker) : text.trim()
    if (!activeId || !body || sending) return
    setSending(true)
    const result = await sendSellerChatMessage(activeId, body)
    setSending(false)
    if (result.error || !result.message) {
      setError(result.error || '傳送失敗')
      return
    }
    if (sticker) setStickerOpen(false)
    else setText('')
    setMessages((current) => current.some((item) => item.id === result.message?.id) ? current : [...current, result.message as SellerChatMessage])
    void loadChats()
  }

  return (
    <div className="flex h-[32rem] max-h-[calc(100dvh-3.5rem)] min-h-0 min-w-0 max-w-full overflow-hidden rounded-2xl border border-border bg-card md:h-[36rem] md:max-h-[36rem]">
      <aside className={`${active ? 'hidden md:flex' : 'flex'} min-h-0 w-full shrink-0 flex-col border-border md:w-72 md:border-r`}>
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
              <PerkAvatar
                viewer={{ name: chat.peerName, tone: 0, avatar: chat.peerAvatar ?? undefined }}
                equipped={loadouts[role === 'seller' ? chat.buyerId : chat.sellerUserId]}
                size="size-10"
                textSize="text-xs"
                thickness={2}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-sm font-bold">{chat.peerName}</span>
                    <PerkTags equipped={loadouts[role === 'seller' ? chat.buyerId : chat.sellerUserId]} />
                  </span>
                  {chat.unread > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-black text-primary-foreground">{chat.unread}</span>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{chat.lastBody ? stickerPreviewText(chat.lastBody) : '尚無訊息'}</span>
                <span className="text-[10px] text-muted-foreground">{when(chat.lastAt)}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className={`${active ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col`}>
        {active ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-3 py-3">
              <button type="button" className="rounded-lg px-2 py-1 text-xs font-bold md:hidden" onClick={() => { setActiveId(null); onActiveChange?.(null) }}>返回</button>
              <PerkAvatar
                viewer={{ name: active.peerName, tone: 0, avatar: active.peerAvatar ?? undefined }}
                equipped={loadouts[peerId]}
                size="size-9"
                textSize="text-xs"
                thickness={2}
              />
              <div className="min-w-0">
                <p className="flex min-w-0 flex-wrap items-center gap-1 truncate text-sm font-black">
                  <span className="truncate">{active.peerName}</span>
                  <PerkTags equipped={loadouts[peerId]} />
                  <GameBadgeChip achievementId={badges[peerId]} />
                </p>
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
            {(loadouts[userId]?.title || loadouts[userId]?.badge || badges[userId]) && (
              <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2 text-xs text-muted-foreground">
                你的頭銜
                <PerkTags equipped={loadouts[userId]} />
                <GameBadgeChip achievementId={badges[userId]} />
              </div>
            )}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
              {messages.length > 0 && (
                <div className="pb-1 text-center">
                  {olderDone ? (
                    <p className="text-[11px] text-muted-foreground">沒有更早的訊息</p>
                  ) : (
                    <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="text-[11px] font-bold text-muted-foreground disabled:opacity-50">
                      {loadingOlder ? '載入中' : '載入較早的訊息'}
                    </button>
                  )}
                </div>
              )}
              {messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">可以直接詢問價格、庫存、規格或出貨。</p>}
              {messages.map((message) => {
                const mine = message.senderId === userId
                const sender = message.senderId ? loadouts[message.senderId] : undefined
                const sticker = message.file ? null : parseStickerMessage(message.body)
                if (message.file) {
                  return (
                    <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                        <ChatAttachment file={message.file} onOpen={openPhoto} onDownload={downloadFile} />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{when(message.createdAt)}</p>
                      </div>
                    </div>
                  )
                }
                if (sticker) {
                  const playable = stickerUsable(sticker)
                  return (
                    <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                        {playable ? <AnimatedSticker sticker={sticker} /> : <span className="rounded-2xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">［貼圖］{sticker.caption}</span>}
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{when(message.createdAt)}</p>
                      </div>
                    </div>
                  )
                }
                const skin = bubbleClass(sender?.bubble)
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border border-border bg-background'} ${skin}`}>
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                      <p className={`mt-1 text-[10px] ${mine ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{when(message.createdAt)}</p>
                    </div>
                  </div>
                )
              })}
              <div ref={endRef} />
            </div>
            {error && <p className="px-3 text-xs font-bold text-destructive" role="alert">{error}</p>}
            {(stickerOpen || pending.length > 0) && (
              <div className="max-h-56 shrink-0 overflow-y-auto border-t border-border" aria-label="聊天附加面板">
                {pending.length > 0 && (
                  <div className="space-y-2 px-3 py-2" aria-label="待送出的附件">
                    {pending.map((item) => (
                      <div key={item.key} className="flex items-center gap-2">
                        {item.preview ? (
                          <img src={item.preview} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileText className="size-4" /></span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold">{item.name}</span>
                          <span className="block text-[10px] text-muted-foreground">
                            {formatChatFileSize(item.file.size)}
                            {item.status === 'uploading' ? '・上傳中' : item.status === 'failed' ? `・${item.error || '上傳失敗'}` : ''}
                          </span>
                        </span>
                        {item.status === 'failed' && (
                          <button type="button" onClick={() => void deliverFile(item.key)} className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] font-bold" aria-label={`重試傳送：${item.name}`}>重試</button>
                        )}
                        <button type="button" onClick={() => void cancelPending(item.key)} disabled={item.status === 'uploading'} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-muted-foreground disabled:opacity-40" aria-label={`取消選取：${item.name}`}>取消</button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => void (async () => {
                        for (const item of [...pendingRef.current]) {
                          if (item.status !== 'uploading') await deliverFile(item.key)
                        }
                      })()}
                      disabled={pending.every((item) => item.status === 'uploading')}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
                    >
                      傳送附件
                    </button>
                  </div>
                )}
                {stickerOpen && (
                  <div className="px-3 py-2" aria-label="動態貼圖">
                    <p className="mb-1 text-[11px] text-muted-foreground">30 張原創動態貼圖・含 Pay 袋仔・登入即可使用</p>
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                      {STICKERS.map((sticker) => (
                        <button
                          key={sticker.id}
                          type="button"
                          disabled={sending}
                          onClick={() => void send(sticker.id)}
                          className="relative flex justify-center rounded-xl p-0.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`傳送貼圖：${sticker.caption}`}
                        >
                          <AnimatedSticker sticker={sticker} small />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <form className="shrink-0 border-t border-border p-3" onSubmit={(event) => { event.preventDefault(); void send() }}>
              <p className="mb-2 text-[10px] leading-4 text-muted-foreground">{CHAT_FILE_LIMIT_TEXT}</p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => albumRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-bold" aria-label="從相簿選取照片">
                  <ImageIcon className="size-3.5" />相簿
                </button>
                <button type="button" onClick={() => cameraRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-bold" aria-label="拍照">
                  <Camera className="size-3.5" />拍照
                </button>
                <button type="button" onClick={() => docRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-bold" aria-label="選取檔案">
                  <FileText className="size-3.5" />檔案
                </button>
              </div>
              <input ref={albumRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={onPick} />
              <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={onPick} />
              <input ref={docRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={onPick} />
              <div className="flex gap-2">
                <button type="button" onClick={() => setStickerOpen((open) => !open)} aria-expanded={stickerOpen} className={`rounded-xl border border-border px-2.5 ${stickerOpen ? 'bg-primary/10 text-brand-ink' : 'text-muted-foreground'}`} aria-label="動態貼圖">
                  <Smile className="size-4" />
                </button>
                <input value={text} maxLength={500} onChange={(event) => setText(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm" placeholder="輸入訊息" aria-label="聊天訊息" />
                <button type="submit" disabled={sending || !text.trim()} className="rounded-xl bg-primary px-4 text-primary-foreground disabled:opacity-50" aria-label="送出訊息">
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </button>
              </div>
            </form>
            {zoom && (
              <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={zoom.name} onClick={() => setZoom(null)}>
                <button type="button" className="absolute right-4 top-4 rounded-full bg-white px-3 py-1 text-sm font-bold text-black" onClick={() => setZoom(null)} aria-label="關閉照片">關閉</button>
                <img src={zoom.url} alt={zoom.name} className="max-h-[85dvh] max-w-full rounded-xl object-contain" onClick={(event) => event.stopPropagation()} />
              </div>
            )}
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

function ChatAttachment({
  file,
  onOpen,
  onDownload,
}: {
  file: SellerChatFile
  onOpen: (file: SellerChatFile, url: string) => void
  onDownload: (file: SellerChatFile) => void
}) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  const image = chatFileIsImage(file.mime)

  useEffect(() => {
    if (!image) return
    let cancelled = false
    let timer = 0
    const load = () => {
      void signedChatFileUrl(file.path).then((result) => {
        if (cancelled) return
        if (!result.url) {
          setFailed(true)
          return
        }
        setUrl(result.url)
        setFailed(false)
        timer = window.setTimeout(load, 90_000)
      })
    }
    load()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [file.path, image])

  if (!image) {
    return (
      <div className="rounded-2xl border border-border bg-background px-3 py-2 text-sm">
        <p className="break-all font-bold">{file.name}</p>
        <p className="text-[10px] text-muted-foreground">{formatChatFileSize(file.bytes)}・PDF</p>
        <button type="button" onClick={() => onDownload(file)} className="mt-1 text-xs font-bold underline" aria-label={`下載檔案：${file.name}`}>下載</button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-background p-1.5">
      {url && !failed ? (
        <button type="button" onClick={() => onOpen(file, url)} className="block" aria-label={`放大照片：${file.name}`}>
          <img src={url} alt={file.name} className="max-h-40 max-w-full rounded-xl object-cover" onError={() => setFailed(true)} />
        </button>
      ) : (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">{failed ? '無法讀取照片' : '照片讀取中'}</p>
      )}
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <p className="min-w-0 truncate text-[10px] text-muted-foreground">{file.name}・{formatChatFileSize(file.bytes)}</p>
        <span className="flex shrink-0 gap-2">
          {failed && <button type="button" onClick={() => { setFailed(false); setUrl(''); void signedChatFileUrl(file.path).then((result) => result.url ? setUrl(result.url) : setFailed(true)) }} className="text-[11px] font-bold">重試</button>}
          <button type="button" onClick={() => onDownload(file)} className="text-[11px] font-bold underline" aria-label={`下載檔案：${file.name}`}>下載</button>
        </span>
      </div>
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
