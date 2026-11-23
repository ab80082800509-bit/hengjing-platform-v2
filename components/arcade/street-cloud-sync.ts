'use client'

/**
 * 夢想商店街雲端同步。本機存檔照舊每幾秒寫一次，這裡負責把它安全送到資料庫：
 * - 每次送出都根據「目前認得的雲端 revision」，資料庫版本較新就回 conflict，改用雲端版本，本機那份另存備份。
 * - 送出中的內容與請求鍵先寫進本機同步紀錄；斷線或重新整理後原封不動重送，資料庫回放，不會重算或重複入帳。
 * - 第一次登入雲端時，瀏覽器舊存檔要玩家按下「轉移」才上傳，而且舊存檔另存一份備份，不刪除、不覆蓋。
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { newSim, snapshot, type StreetProgress, type StreetState } from '@/lib/arcade/street-rules'
import {
  EMPTY_CLOUD_CACHE,
  IMPORT_BLOCKED,
  cloudReasonText,
  parseCloudCache,
  progressSig,
  rebaseProgress,
  type CloudCache,
  type CloudRow,
} from '@/lib/arcade/street-cloud'
import { fetchMyStreetSave, importMyStreetSave, saveMyStreet, type CloudReply } from '@/lib/arcade/street-cloud-client'

export type CloudPhase = 'off' | 'loading' | 'synced' | 'saving' | 'pending' | 'offline' | 'conflict' | 'unavailable' | 'migrate' | 'blocked'
export type CloudView = { phase: CloudPhase; note: string | null; at: number | null; migrating: boolean }

const CLOUD_KEY = 'hengjing:street:cloud:v1:'
/** 第一次被雲端版本取代或轉移前的瀏覽器舊存檔，只寫一次、永不刪除。 */
const BACKUP_KEY = 'hengjing:street:backup:v1:'
/** 最近一次因版本衝突或拒收而被取代的本機存檔。 */
const CONFLICT_KEY = 'hengjing:street:conflict:v1:'
const SYNC_EVERY_MS = 15_000
const RETRY_MS = 20_000

const readJson = (key: string): unknown => {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
const writeJson = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 無痕模式或空間不足時，同步紀錄只留在這次頁面。
  }
}

type Options = {
  saveKey: string
  stateRef: MutableRefObject<StreetState | null>
  visitLockRef: MutableRefObject<boolean>
  onChanged: () => void
  flash: (text: string, tone?: 'ok' | 'warn' | 'up') => void
}

export function useStreetCloud({ saveKey, stateRef, visitLockRef, onChanged, flash }: Options) {
  const [view, setView] = useState<CloudView>({ phase: 'off', note: null, at: null, migrating: false })
  const userRef = useRef<string | null>(null)
  const cacheRef = useRef<CloudCache>(EMPTY_CLOUD_CACHE)
  const phaseRef = useRef<CloudPhase>('off')
  const busyRef = useRef(false)
  const resolvedRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const optsRef = useRef({ onChanged, flash })
  optsRef.current = { onChanged, flash }

  const setPhase = useCallback((phase: CloudPhase, note: string | null = null, migrating = false) => {
    phaseRef.current = phase
    setView({ phase, note, at: phase === 'synced' ? Date.now() : null, migrating })
  }, [])

  const putCache = useCallback((next: Partial<CloudCache>) => {
    cacheRef.current = { ...cacheRef.current, ...next }
    const user = userRef.current
    if (user) writeJson(CLOUD_KEY + user, cacheRef.current)
  }, [])

  const clearTimer = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const backup = useCallback((user: string, progress: StreetProgress | null, conflict: boolean) => {
    if (!progress) return
    if (readJson(BACKUP_KEY + user) == null) writeJson(BACKUP_KEY + user, { at: Date.now(), progress })
    if (conflict) writeJson(CONFLICT_KEY + user, { at: Date.now(), progress })
  }, [])

  /** 改用雲端版本：本機那份先備份，再覆寫本機存檔。 */
  const adopt = useCallback((user: string, row: CloudRow, conflict: boolean) => {
    const cur = stateRef.current
    backup(user, cur ? snapshot(cur) : (readJson(saveKey + user) as StreetProgress | null), conflict)
    if (!visitLockRef.current) stateRef.current = { progress: row.progress, sim: newSim(row.progress) }
    writeJson(saveKey + user, row.progress)
    putCache({ rev: row.revision, dirty: false, sig: progressSig(row.progress), inflight: null, importKey: null })
    optsRef.current.onChanged()
  }, [backup, putCache, saveKey, stateRef, visitLockRef])

  /** 資料庫接受後對帳：資產以資料庫為準，送出之後的變動保留。 */
  const accept = useCallback((user: string, row: CloudRow, sent: StreetProgress) => {
    const cur = stateRef.current
    let dirty = false
    if (cur && !visitLockRef.current) {
      const progress = rebaseProgress(cur.progress, sent, row.progress)
      stateRef.current = { progress, sim: cur.sim }
      const now = snapshot(stateRef.current)
      writeJson(saveKey + user, now)
      dirty = progressSig(now) !== progressSig(sent)
    }
    putCache({ rev: row.revision, dirty, sig: progressSig(sent), inflight: null, importKey: null })
    optsRef.current.onChanged()
    return dirty
  }, [putCache, saveKey, stateRef, visitLockRef])

  const syncRef = useRef<() => Promise<void>>(async () => {})
  const recheckRef = useRef<() => Promise<void>>(async () => {})

  const schedule = useCallback((ms: number) => {
    if (timerRef.current) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      if (resolvedRef.current) void syncRef.current()
      else void recheckRef.current()
    }, ms)
  }, [])

  const offline = useCallback((note: string) => {
    setPhase('offline', note)
    clearTimer()
    schedule(RETRY_MS)
  }, [schedule, setPhase])

  syncRef.current = async () => {
    const user = userRef.current
    const cur = stateRef.current
    const phase = phaseRef.current
    if (!user || busyRef.current || visitLockRef.current || !cur) return
    if (cacheRef.current.rev == null || phase === 'unavailable' || phase === 'migrate' || phase === 'loading' || phase === 'blocked') return
    let fly = cacheRef.current.inflight
    if (!fly) {
      if (!cacheRef.current.dirty) {
        if (phase !== 'synced') setPhase('synced')
        return
      }
      fly = { key: crypto.randomUUID(), base: cacheRef.current.rev, payload: snapshot(cur) }
      putCache({ inflight: fly, sig: progressSig(fly.payload), dirty: false })
    }
    busyRef.current = true
    clearTimer()
    setPhase('saving')
    const reply = await saveMyStreet(fly.base, fly.payload, fly.key, user)
    busyRef.current = false
    if (userRef.current !== user) return
    handleSave(user, reply, fly.payload)
  }

  const handleSave = (user: string, reply: CloudReply, sent: StreetProgress) => {
    if (reply.kind === 'ok' && reply.row) {
      const dirty = accept(user, reply.row, sent) || cacheRef.current.dirty
      if (dirty) {
        putCache({ dirty: true })
        setPhase('pending')
        schedule(SYNC_EVERY_MS)
      } else {
        setPhase('synced')
      }
      return
    }
    if (reply.kind === 'rejected') {
      if (reply.reason === 'missing') {
        putCache({ rev: null, inflight: null })
        setPhase('migrate', '雲端還沒有你的存檔，請把這台裝置的進度轉移上去')
        return
      }
      if (reply.row) {
        adopt(user, reply.row, true)
        const note = cloudReasonText(reply.reason)
        setPhase('conflict', `${note}。這台裝置原本的進度已另存備份。`)
        optsRef.current.flash(note, 'warn')
        return
      }
      putCache({ inflight: null })
      setPhase('blocked', cloudReasonText(reply.reason))
      return
    }
    if (reply.kind === 'unavailable') return setPhase('unavailable', '雲端存檔尚未啟用，進度先存在這台裝置')
    offline(reply.kind === 'auth' ? '登入已過期，重新登入後會自動同步' : '網路中斷，進度先存在這台裝置，恢復連線後自動同步')
  }

  /** 決定這次要用哪一份進度：本機或雲端。只在讀檔與離線恢復時呼叫。 */
  const resolve = useCallback((user: string, reply: CloudReply, local: StreetProgress | null): StreetProgress | null => {
    const cache = cacheRef.current
    if (reply.kind === 'unavailable') {
      resolvedRef.current = true
      setPhase('unavailable', '雲端存檔尚未啟用，進度先存在這台裝置')
      return local
    }
    if (reply.kind === 'offline' || reply.kind === 'auth' || reply.kind === 'rejected') {
      offline(reply.kind === 'auth' ? '登入已過期，重新登入後會自動同步' : '暫時連不上雲端，進度先存在這台裝置，恢復連線後自動同步')
      return local
    }
    resolvedRef.current = true
    const row = reply.row
    if (!row) {
      putCache({ rev: null, inflight: null })
      setPhase('migrate', local ? null : '接手第一間店後會自動建立雲端存檔')
      return local
    }
    if (cache.inflight && local) {
      setPhase('pending')
      window.setTimeout(() => void syncRef.current(), 0)
      return local
    }
    if (cache.rev === row.revision && local) {
      setPhase(cache.dirty ? 'pending' : 'synced')
      if (cache.dirty) schedule(1500)
      return local
    }
    const conflict = Boolean(local && cache.dirty && cache.rev != null)
    const otherDevice = Boolean(local && cache.rev == null)
    adopt(user, row, conflict || otherDevice)
    if (conflict) setPhase('conflict', `${cloudReasonText('conflict')}。這台裝置還沒同步的進度已另存備份。`)
    else if (otherDevice) setPhase('conflict', '這個帳號已經有雲端進度，已載入雲端進度。這台裝置原本的瀏覽器存檔已另存備份，不會刪除。')
    else setPhase('synced')
    return row.progress
  }, [adopt, offline, putCache, schedule, setPhase])

  recheckRef.current = async () => {
    const user = userRef.current
    if (!user || busyRef.current) return
    busyRef.current = true
    const reply = await fetchMyStreetSave(user)
    busyRef.current = false
    if (userRef.current !== user || visitLockRef.current) return
    const cur = stateRef.current
    resolve(user, reply, cur ? snapshot(cur) : null)
  }

  /** 讀檔：登入會員先問雲端，再決定用本機還是雲端進度。 */
  const open = useCallback(async (user: string, local: StreetProgress | null): Promise<StreetProgress | null> => {
    userRef.current = user
    cacheRef.current = parseCloudCache(readJson(CLOUD_KEY + user))
    resolvedRef.current = false
    busyRef.current = false
    clearTimer()
    setPhase('loading')
    const reply = await fetchMyStreetSave(user)
    if (userRef.current !== user) return local
    return resolve(user, reply, local)
  }, [resolve, setPhase])

  const close = useCallback(() => {
    clearTimer()
    userRef.current = null
    resolvedRef.current = false
    phaseRef.current = 'off'
    setView({ phase: 'off', note: null, at: null, migrating: false })
  }, [])

  /** 本機存檔寫完後呼叫：有實質變更才標記待同步。 */
  const touch = useCallback(() => {
    const cur = stateRef.current
    if (!userRef.current || !cur || visitLockRef.current) return
    const sig = progressSig(snapshot(cur))
    if (sig === cacheRef.current.sig && !cacheRef.current.dirty) return
    if (!cacheRef.current.dirty && sig !== cacheRef.current.sig) putCache({ dirty: true })
    if (phaseRef.current === 'synced') setPhase('pending')
    schedule(SYNC_EVERY_MS)
  }, [putCache, schedule, setPhase, stateRef, visitLockRef])

  const flush = useCallback(() => {
    if (!userRef.current) return
    clearTimer()
    if (resolvedRef.current) void syncRef.current()
    else void recheckRef.current()
  }, [])

  /** 一次性轉移：玩家按下才上傳；請求鍵先存起來，回覆遺失時重送不會轉兩次。 */
  const migrate = useCallback(async () => {
    const user = userRef.current
    const cur = stateRef.current
    if (!user || !cur || busyRef.current || visitLockRef.current) return
    if (phaseRef.current !== 'migrate') return
    const payload = snapshot(cur)
    backup(user, payload, false)
    const key = cacheRef.current.importKey ?? crypto.randomUUID()
    putCache({ importKey: key })
    busyRef.current = true
    setView((v) => ({ ...v, migrating: true }))
    const reply = await importMyStreetSave(payload, key, user)
    busyRef.current = false
    if (userRef.current !== user) return
    if (reply.kind === 'ok' && reply.row) {
      const dirty = accept(user, reply.row, payload)
      setPhase(dirty ? 'pending' : 'synced')
      if (dirty) {
        putCache({ dirty: true })
        schedule(SYNC_EVERY_MS)
      }
      const fresh = reply.row.importSource === 'fresh'
      optsRef.current.flash(
        fresh ? '已建立雲端存檔，換裝置登入也能接著玩' : reply.row.importAdjusted ? '已轉移到雲端。部分金幣超出可驗證的營收，已依紀錄調整' : '已把這台裝置的進度轉移到雲端',
        reply.row.importAdjusted ? 'warn' : 'up',
      )
      return
    }
    if (reply.kind === 'rejected' && reply.reason === 'exists' && reply.row) {
      adopt(user, reply.row, true)
      setPhase('conflict', `${cloudReasonText('exists')}。這台裝置的進度已另存備份。`)
      return
    }
    if (reply.kind === 'rejected') {
      putCache({ importKey: null })
      setPhase(IMPORT_BLOCKED.has(reply.reason) ? 'blocked' : 'migrate', cloudReasonText(reply.reason))
      return
    }
    if (reply.kind === 'unavailable') return setPhase('unavailable', '雲端存檔尚未啟用，進度先存在這台裝置')
    setPhase('migrate', '網路不穩，轉移沒有完成。進度仍在這台裝置，稍後再按一次即可（不會重複轉移）')
  }, [accept, adopt, backup, putCache, schedule, setPhase, stateRef, visitLockRef])

  /** 新玩家接手第一間店：雲端還沒有存檔時直接建立。 */
  const created = useCallback(() => {
    if (phaseRef.current === 'migrate') void migrate()
  }, [migrate])

  useEffect(() => {
    const onOnline = () => {
      if (phaseRef.current === 'offline') flush()
    }
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      clearTimer()
    }
  }, [flush])

  return { cloud: view, open, close, touch, flush, migrate, created }
}
