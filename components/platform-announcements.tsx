'use client'

import { useEffect, useState } from 'react'
import { Loader2, Megaphone, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export type PublicAnnouncement = { id: string; body: string }

type AdminAnnouncement = PublicAnnouncement & {
  enabled: boolean
  sortOrder: number
}

const inputCls =
  'w-full rounded-xl border border-input bg-card px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/30'
const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'

export function AnnouncementMarquee({ items }: { items: PublicAnnouncement[] }) {
  if (!items.length) return null
  const line = items.map((item) => item.body).join('   ·   ')
  return (
    <div className="border-b border-orange-500/35 bg-zinc-950 text-orange-100" role="region" aria-label="平台公告">
      <div className="mx-auto flex max-w-[100rem] items-center gap-3 px-4 py-2">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-black text-primary-foreground">
          <Megaphone className="size-3.5" aria-hidden />
          公告
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="announcement-track">
            <p className="px-6 text-sm font-bold">{line}</p>
            <p className="px-6 text-sm font-bold motion-reduce:hidden" aria-hidden>{line}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function AdminAnnouncementsPanel() {
  const [rows, setRows] = useState<AdminAnnouncement[]>([])
  const [body, setBody] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [sortOrder, setSortOrder] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)

  const load = async () => {
    const { data, error: loadError } = await supabase.rpc('admin_list_announcements')
    if (loadError) {
      setError(loadError.message || '讀取公告失敗。若尚未建立資料表，請先執行公告 SQL。')
      setReady(true)
      return
    }
    const list = Array.isArray(data) ? data : []
    setRows(list.map((row) => ({
      id: String(row.id),
      body: String(row.body ?? ''),
      enabled: row.enabled === true,
      sortOrder: Number(row.sort_order ?? 0),
    })))
    setError('')
    setReady(true)
  }

  useEffect(() => {
    void load()
  }, [])

  const resetForm = () => {
    setEditing(null)
    setBody('')
    setEnabled(true)
    setSortOrder(0)
  }

  const save = async () => {
    const text = body.trim()
    if (!text || text.length > 180 || /[<>]/.test(text)) {
      setError('公告需為 1 到 180 個純文字，不能包含 HTML。')
      return
    }
    setBusy(true)
    setError('')
    const { error: saveError } = await supabase.rpc('admin_upsert_announcement', {
      p_id: editing,
      p_body: text,
      p_enabled: enabled,
      p_sort: sortOrder,
    })
    setBusy(false)
    if (saveError) {
      setError(saveError.message || '儲存失敗')
      return
    }
    resetForm()
    await load()
  }

  const remove = async (id: string) => {
    setBusy(true)
    setError('')
    const { error: deleteError } = await supabase.rpc('admin_delete_announcement', { p_id: id })
    setBusy(false)
    if (deleteError) {
      setError(deleteError.message || '刪除失敗')
      return
    }
    if (editing === id) resetForm()
    await load()
  }

  return (
    <section className="space-y-4" aria-label="公告管理">
      <div>
        <h2 className="text-base font-black">首頁跑馬燈公告</h2>
        <p className="text-sm text-muted-foreground">只會在首頁顯示已啟用的純文字公告。停用或刪除後，重新整理就不會再出現。</p>
      </div>
      <form
        className="space-y-3 rounded-2xl border border-border/70 bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label className="block space-y-1 text-xs font-bold">
          公告文字
          <textarea
            className={`${inputCls} min-h-20`}
            maxLength={180}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="例如：本週系統維護時間"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="size-4 accent-primary" />
            啟用
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-bold">
            排序
            <input
              type="number"
              min={0}
              max={999}
              className={`${inputCls} w-24`}
              value={sortOrder}
              onChange={(event) => setSortOrder(Number(event.target.value) || 0)}
            />
          </label>
        </div>
        {error && <p role="alert" className="text-xs font-bold text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {editing ? '儲存修改' : '新增公告'}
          </button>
          {editing && (
            <button type="button" onClick={resetForm} className={btnGhost}>取消編輯</button>
          )}
        </div>
      </form>
      {!ready ? (
        <p className="text-sm text-muted-foreground">正在讀取公告</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">目前沒有公告。沒有啟用中的公告時，首頁不會顯示空白跑馬燈。</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card p-3">
              <p className="min-w-0 flex-1 text-sm font-bold">{row.body}</p>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${row.enabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                {row.enabled ? '啟用中' : '已停用'}
              </span>
              <span className="text-xs text-muted-foreground">排序 {row.sortOrder}</span>
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  setEditing(row.id)
                  setBody(row.body)
                  setEnabled(row.enabled)
                  setSortOrder(row.sortOrder)
                }}
              >
                修改
              </button>
              <button type="button" className={btnGhost} disabled={busy} onClick={() => void remove(row.id)}>
                <Trash2 className="size-3.5" />刪除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
