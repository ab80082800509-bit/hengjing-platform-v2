'use client'

import './merge-shop.css'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { ArrowLeft, Music, Volume2, VolumeX } from 'lucide-react'
import type { EquippedPerks } from '@/lib/rewards/perk-catalog'
import { SceneBackdrop } from '@/components/home/perk-visuals'
import { applyMyMergeAction, fetchMyMergeShop, type MergeActionName, type MergeActionPayload } from '@/lib/arcade/merge-client'
import { mergeSaveUnavailable, type MergeSnapshot } from '@/lib/arcade/merge-snapshot'
import {
  MERGE_CELLS,
  MERGE_CHAINS,
  MERGE_ERRORS,
  MERGE_QUEST_TARGET,
  MERGE_REGEN_SECONDS,
  MERGE_TUNING_CONFIRMED,
  cellsForOrder,
  clerkRank,
  firstEmptyCell,
  itemName,
  itemParts,
  nextItem,
  producerCap,
  regenCharges,
  type MergeOrder,
} from '@/lib/arcade/merge-rules'
import { FESTIVAL_THEMES } from '@/lib/arcade/festival-theme'
import { FestivalBanner, FestivalShopDecor } from './festival-banner'
import { GameRewardHud } from './reward-hud'
import { LiveEventsBoard } from './live-events-board'
import { AchievementToastWatcher } from './achievement-wall'
import { MERGE_ART_SVG } from './merge-art'
import { MergeAudio, readAudioPrefs, type MergeAudioPrefs, type MergeSfx } from './merge-audio'

const CUSTOMERS = [
  { id: 'atao', name: '阿桃' },
  { id: 'aming', name: '阿明' },
  { id: 'xiaoan', name: '小安' },
  { id: 'chen', name: '陳媽媽' },
] as const
const CHAIN_LABEL: Record<string, string> = { tea: '茶飲', snack: '點心', gift: '禮品', fruit: '水果' }
const RANK_STEPS = [0, 20, 60, 140, 300]
const QUEST_HEADS = ['atao', 'xiaoan', 'chen']
const SPARK = '<svg viewBox="0 0 20 20"><path d="M10 0L12.5 7.5L20 10L12.5 12.5L10 20L7.5 12.5L0 10L7.5 7.5Z" fill="currentColor"/></svg>'

function customerSeed(orderId: string) {
  return Array.from(orderId).reduce((sum, char) => sum + char.charCodeAt(0), 0) % CUSTOMERS.length
}

function Art({ id, viewBox = '0 0 100 100', w = 100, h = 100 }: { id: string; viewBox?: string; w?: number; h?: number }) {
  return <svg viewBox={viewBox} aria-hidden="true"><use href={`#${id}`} width={w} height={h} /></svg>
}

function artMarkup(id: string) {
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><use href="#${id}" width="100" height="100"/></svg>`
}

function calm() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, calm() ? 0 : ms))
}

function pulse(el: Element | null | undefined, cls: string) {
  if (!(el instanceof HTMLElement)) return
  el.classList.remove(cls)
  void el.offsetWidth
  el.classList.add(cls)
}

type Box = { x: number; y: number; w: number; h: number }

function box(root: HTMLElement, target: Element | DOMRect): Box {
  const r = root.getBoundingClientRect()
  const rect = target instanceof DOMRect ? target : target.getBoundingClientRect()
  return { x: rect.left - r.left, y: rect.top - r.top, w: rect.width, h: rect.height }
}

function fly(
  root: HTMLElement,
  fx: HTMLElement,
  svgId: string,
  from: Element | DOMRect,
  to: Element | DOMRect,
  { dur = 400, arc = 0, startScale = 1, toScale = 1 } = {},
) {
  const a = box(root, from)
  const b = box(root, to)
  const w = Math.max(a.w, 24)
  const h = Math.max(a.h, 24)
  const el = document.createElement('div')
  el.className = 'flyer'
  el.innerHTML = artMarkup(svgId)
  el.style.cssText = `left:${a.x + a.w / 2 - w / 2}px;top:${a.y + a.h / 2 - h / 2}px;width:${w}px;height:${h}px`
  fx.appendChild(el)
  const dx = b.x + b.w / 2 - (a.x + a.w / 2)
  const dy = b.y + b.h / 2 - (a.y + a.h / 2)
  const end = (b.w / w) * toScale
  const anim = el.animate([
    { transform: `translate(0,0) scale(${startScale})` },
    { transform: `translate(${dx / 2}px,${dy / 2 - arc}px) scale(${((startScale + end) / 2) * 1.18}) rotate(${arc ? -10 : 0}deg)`, offset: 0.5 },
    { transform: `translate(${dx}px,${dy}px) scale(${end})` },
  ], { duration: calm() ? 1 : dur, easing: 'cubic-bezier(.45,0,.55,1)' })
  return anim.finished.catch(() => undefined).then(() => el.remove())
}

function burst(root: HTMLElement, fx: HTMLElement, target: Element, big: boolean, count = 12) {
  const r = box(root, target)
  const el = document.createElement('div')
  el.className = 'burst' + (big ? ' big' : '')
  el.style.left = r.x + r.w / 2 + 'px'
  el.style.top = r.y + r.h / 2 + 'px'
  const colors = ['#ffd23f', '#ffffff', '#ff8fab', '#7dd3fc', '#b5f57a', '#ffa24c']
  const n = big ? count + 8 : count
  let html = '<div class="flash"></div><div class="ring"></div>'
  for (let i = 0; i < n; i += 1) {
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4
    const dist = (big ? 80 : 50) + Math.random() * (big ? 50 : 26)
    html += `<span class="p" style="--c:${colors[i % colors.length]};--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist}px;--r:${Math.random() * 360}deg;--s:${0.7 + Math.random() * 0.8}">${SPARK}</span>`
  }
  el.innerHTML = html
  fx.appendChild(el)
  setTimeout(() => el.remove(), 900)
}

function floatText(root: HTMLElement, fx: HTMLElement, target: Element, text: string, gold: boolean) {
  const r = box(root, target)
  const el = document.createElement('div')
  el.className = 'ftext outline' + (gold ? ' gold' : '')
  el.textContent = text
  el.style.left = r.x + r.w / 2 + 'px'
  el.style.top = r.y + r.h / 3 + 'px'
  fx.appendChild(el)
  setTimeout(() => el.remove(), 1150)
}

function hearts(root: HTMLElement, fx: HTMLElement, slot: Element) {
  const r = box(root, slot)
  const el = document.createElement('div')
  el.className = 'hearts'
  el.style.left = r.x + r.w / 2 + 'px'
  el.style.top = r.y + r.h - 40 + 'px'
  el.style.bottom = 'auto'
  el.innerHTML = [-24, 0, 22].map((dx, n) => `<i style="--dx:${dx}px;animation-delay:${n * 0.12}s"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-heart" width="24" height="24"/></svg></i>`).join('')
  fx.appendChild(el)
  setTimeout(() => el.remove(), 1500)
}

type Phase = 'boot' | 'guest' | 'loading' | 'ready' | 'unavailable' | 'error'
type Overlay =
  | { kind: 'unlock'; itemId: string }
  | { kind: 'level'; level: number; confetti: { left: number; color: string; r: number; dur: number; delay: number }[] }

export function MergeShop({
  authResolved,
  authUserId,
  previewId,
  onNeedLogin,
  onBack,
  equippedPerks,
}: {
  authResolved: boolean
  authUserId: string | null
  previewId: string | null
  onNeedLogin: () => void
  onBack: () => void
  /** 點數商城的遊戲場景；只是外觀，不影響規則。 */
  equippedPerks?: EquippedPerks
}) {
  const [phase, setPhase] = useState<Phase>('boot')
  const [snapshot, setSnapshotState] = useState<MergeSnapshot | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [cellOverride, setCellOverride] = useState<Record<number, string | null> | null>(null)
  const [ordersOverride, setOrdersOverride] = useState<MergeOrder[] | null>(null)
  const [coinHold, setCoinHold] = useState<number | null>(null)
  const [happyOrder, setHappyOrder] = useState<string | null>(null)
  const [leavingOrder, setLeavingOrder] = useState<string | null>(null)
  const [enteringOrders, setEnteringOrders] = useState<string[]>([])
  const [sheet, setSheet] = useState<'quest' | 'codex' | null>(null)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [freshCodex, setFreshCodex] = useState<string | null>(null)
  const [codexDot, setCodexDot] = useState(false)
  const [hint, setHint] = useState<number[]>([])
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null)
  const [chestOpening, setChestOpening] = useState(false)
  const [audioPrefs, setAudioPrefs] = useState<MergeAudioPrefs>({ music: false, sfx: true })
  const [dockPin, setDockPin] = useState<{ left: number; width: number; height: number } | null>(null)
  const slotRef = useRef<HTMLDivElement | null>(null)

  const audioRef = useRef<MergeAudio | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const fxRef = useRef<HTMLDivElement | null>(null)
  const snapRef = useRef<MergeSnapshot | null>(null)
  const authRef = useRef<string | null>(authUserId)
  const busyRef = useRef(false)
  const selectedRef = useRef<number | null>(null)
  const idleRef = useRef(0)
  const overlayDone = useRef<(() => void) | null>(null)
  const customerMap = useRef(new Map<string, number>())
  const dragRef = useRef<{ from: number; x: number; y: number; moved: boolean; ghost: HTMLDivElement | null; size: number } | null>(null)

  const setSnap = useCallback((next: MergeSnapshot | null) => {
    snapRef.current = next
    setSnapshotState(next)
  }, [])

  const showToast = useCallback((text: string) => {
    setToast({ id: Date.now() + Math.random(), text })
  }, [])

  const sfx = useCallback((name: MergeSfx) => {
    audioRef.current?.play(name)
  }, [])

  const warn = useCallback((text: string) => {
    showToast(text)
    audioRef.current?.play('error')
  }, [showToast])

  useEffect(() => {
    const audio = new MergeAudio(readAudioPrefs())
    audioRef.current = audio
    setAudioPrefs(audio.prefs)
    const onVisibility = () => audio.setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      audio.dispose()
      audioRef.current = null
    }
  }, [])

  const hasGame = snapshot != null
  useEffect(() => {
    if (!hasGame) return
    const narrow = window.matchMedia('(max-width: 767px)')
    let frame = 0
    let naturalHeight = 0
    const measure = () => {
      frame = 0
      const root = rootRef.current
      const slot = slotRef.current
      const dock = slot?.querySelector<HTMLElement>('.dock')
      const board = root?.querySelector('.board')
      if (!root || !slot || !dock || !board || !narrow.matches) {
        setDockPin(null)
        return
      }
      if (!dock.classList.contains('pinned')) naturalHeight = dock.offsetHeight
      const line = window.innerHeight - (parseFloat(getComputedStyle(dock).bottom) || 0)
      const game = root.getBoundingClientRect()
      const pin = slot.getBoundingClientRect().top + naturalHeight > line + 1 && board.getBoundingClientRect().top < line - naturalHeight
      setDockPin((prev) => {
        if (!pin) return null
        if (prev && prev.left === game.left && prev.width === game.width && prev.height === naturalHeight) return prev
        return { left: game.left, width: game.width, height: naturalHeight }
      })
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    schedule()
    const resized = new ResizeObserver(schedule)
    if (rootRef.current) resized.observe(rootRef.current)
    window.addEventListener('scroll', schedule, { passive: true, capture: true })
    window.addEventListener('resize', schedule)
    narrow.addEventListener('change', schedule)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      resized.disconnect()
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      narrow.removeEventListener('change', schedule)
      setDockPin(null)
    }
  }, [hasGame])

  function unlockAudio() {
    audioRef.current?.unlock()
  }

  function toggleAudio(kind: keyof MergeAudioPrefs) {
    const audio = audioRef.current
    if (!audio) return
    const next = { ...audio.prefs, [kind]: !audio.prefs[kind] }
    audio.setPrefs(next)
    audio.unlock()
    setAudioPrefs(next)
    if (kind === 'sfx' && next.sfx) window.setTimeout(() => audio.play('tap'), 30)
  }

  useEffect(() => {
    authRef.current = authUserId
  }, [authUserId])

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 1850)
    return () => window.clearTimeout(timer)
  }, [toast])

  const reload = useCallback(async (userId: string) => {
    const result = await fetchMyMergeShop(userId)
    if (authRef.current !== userId) return
    if (!result.data) {
      setSnap(null)
      setPhase(mergeSaveUnavailable(result.error ?? '') ? 'unavailable' : 'error')
      setErrorText(result.error)
      return
    }
    setSnap(result.data.exists ? result.data : null)
    setPhase('ready')
    setErrorText(null)
  }, [setSnap])

  useEffect(() => {
    if (!authResolved) return
    setSelected(null)
    setSheet(null)
    setOverlay(null)
    setCellOverride(null)
    setOrdersOverride(null)
    setCoinHold(null)
    customerMap.current.clear()
    if (!authUserId) {
      setSnap(null)
      setPhase('guest')
      return
    }
    let cancelled = false
    setPhase('loading')
    void fetchMyMergeShop(authUserId).then((result) => {
      if (cancelled) return
      if (!result.data) {
        setSnap(null)
        setPhase(mergeSaveUnavailable(result.error ?? '') ? 'unavailable' : 'error')
        setErrorText(result.error)
        return
      }
      setSnap(result.data.exists ? result.data : null)
      setPhase('ready')
      setErrorText(null)
    })
    return () => {
      cancelled = true
    }
  }, [authResolved, authUserId, setSnap])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
      if (busyRef.current || dragRef.current || selectedRef.current != null || !snapRef.current) {
        idleRef.current = 0
        return
      }
      idleRef.current += 1
      if (idleRef.current !== 6) return
      idleRef.current = -4
      const seen = new Map<string, number>()
      const cells = snapRef.current.cells
      for (let i = 0; i < cells.length; i += 1) {
        const cell = cells[i]
        if (!cell || !nextItem(cell)) continue
        const first = seen.get(cell)
        if (first != null) {
          setHint([first, i])
          window.setTimeout(() => setHint([]), 2600)
          return
        }
        seen.set(cell, i)
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const regen = useMemo(() => {
    if (!snapshot) return { charges: 0, anchorMs: nowMs }
    return regenCharges({
      producerCharges: snapshot.producerCharges,
      producerAnchorMs: Date.parse(snapshot.producerAnchor),
      shopLevel: snapshot.shopLevel,
    }, nowMs)
  }, [snapshot, nowMs])
  const charges = regen.charges

  const cells = useMemo(() => {
    if (!snapshot) return []
    if (!cellOverride) return snapshot.cells
    return snapshot.cells.map((cell, index) => (index in cellOverride ? cellOverride[index] ?? null : cell))
  }, [snapshot, cellOverride])
  const orders = ordersOverride ?? snapshot?.orders ?? []

  const customers = useMemo(() => {
    const map = customerMap.current
    const taken = new Set<number>()
    orders.forEach((order) => {
      const known = map.get(order.id)
      if (known != null) taken.add(known)
    })
    orders.forEach((order) => {
      if (map.has(order.id)) return
      let pick = customerSeed(order.id)
      for (let step = 0; step < CUSTOMERS.length && taken.has(pick); step += 1) pick = (pick + 1) % CUSTOMERS.length
      map.set(order.id, pick)
      taken.add(pick)
    })
    return orders.map((order) => CUSTOMERS[map.get(order.id) ?? 0] ?? CUSTOMERS[0])
  }, [orders])

  function fxParts() {
    const root = rootRef.current
    const fx = fxRef.current
    return root && fx ? { root, fx } : null
  }

  function el(selector: string) {
    return rootRef.current?.querySelector(selector) ?? null
  }

  function itemEl(index: number) {
    return el(`[data-cell="${index}"] .item`)
  }

  async function run(task: () => Promise<void>) {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    idleRef.current = 0
    setHint([])
    try {
      await task()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
    return true
  }

  async function commit(type: MergeActionName, payload: MergeActionPayload): Promise<MergeSnapshot | null> {
    const userId = authRef.current
    const current = snapRef.current
    if (!userId || (!current && type !== 'start')) return null
    const result = await applyMyMergeAction(crypto.randomUUID(), type, {
      ...payload,
      expectedRevision: type === 'start' ? undefined : current?.revision,
    }, userId)
    if (authRef.current !== userId) return null
    if (!result.data || !result.data.exists) {
      const message = result.error ?? '遊戲進度沒有變更'
      setLastError(message)
      warn(message)
      if (message.includes('重新整理')) void reload(userId)
      return null
    }
    setLastError(null)
    return result.data
  }

  function showOverlay(next: Overlay) {
    return new Promise<void>((resolve) => {
      overlayDone.current = resolve
      setOverlay(next)
    })
  }

  function closeOverlay() {
    setOverlay(null)
    const done = overlayDone.current
    overlayDone.current = null
    done?.()
  }

  useEffect(() => {
    if (overlay?.kind !== 'unlock') return
    const timer = window.setTimeout(closeOverlay, 1900)
    return () => window.clearTimeout(timer)
  }, [overlay])

  useEffect(() => {
    if (overlay?.kind !== 'level') return
    const timer = window.setTimeout(() => {
      const parts = fxParts()
      const hero = el('.overlay .ov-hero')
      if (parts && hero) burst(parts.root, parts.fx, hero, true, 16)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [overlay])

  function tickCoins(from: number, to: number, dur = 600) {
    return new Promise<void>((resolve) => {
      if (calm() || from === to) {
        setCoinHold(to)
        resolve()
        return
      }
      const t0 = performance.now()
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / dur)
        setCoinHold(Math.round(from + (to - from) * p))
        if (p < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
  }

  async function coinRain(from: Element, before: number, after: number, n: number) {
    const parts = fxParts()
    const pill = el('[data-coinpill]')
    const target = pill?.querySelector('svg')
    if (!parts || !pill || !target) return
    const jobs: Promise<void>[] = []
    for (let i = 0; i < n; i += 1) {
      jobs.push(sleep(i * 70)
        .then(() => fly(parts.root, parts.fx, 'ic-coin', from, target, { dur: 560, arc: 60 + Math.random() * 60, startScale: 0.5 }))
        .then(() => {
          pulse(pill, 'bump')
          sfx('coin')
        }))
    }
    await sleep(400)
    const ticking = tickCoins(before, after, n * 70 + 300)
    await Promise.all([...jobs, ticking])
  }

  async function doMerge(from: number, to: number, ghost: HTMLDivElement | null) {
    const before = snapRef.current
    const source = before?.cells[from]
    if (!before || !source) return
    const fromRect = (ghost ?? itemEl(from))?.getBoundingClientRect()
    const next = await commit('merge', { from, to })
    ghost?.remove()
    if (!next) return
    const parts = fxParts()
    flushSync(() => setCellOverride({ [from]: null, [to]: source }))
    const target = itemEl(to)
    pulse(target, 'squish')
    if (parts && fromRect && target) await fly(parts.root, parts.fx, `it-${source}`, fromRect, target, { dur: 260 })
    const produced = next.cells[to] ?? nextItem(source)
    flushSync(() => {
      setCellOverride(null)
      setSnap(next)
    })
    const tile = el(`[data-cell="${to}"]`)
    pulse(itemEl(to), 'pop')
    const big = (produced ? itemParts(produced)?.level ?? 0 : 0) >= 5
    sfx(big ? 'mergeMax' : 'merge')
    if (parts && tile && produced) {
      burst(parts.root, parts.fx, tile, big)
      floatText(parts.root, parts.fx, tile, itemName(produced) + (big ? '！最高階' : '！'), big)
    }
    if (produced && !before.catalog.includes(produced) && next.catalog.includes(produced)) {
      setFreshCodex(produced)
      setCodexDot(true)
      await sleep(350)
      sfx('unlock')
      await showOverlay({ kind: 'unlock', itemId: produced })
    }
  }

  async function doMove(from: number, to: number, ghost: HTMLDivElement | null) {
    const before = snapRef.current
    const a = before?.cells[from]
    const b = before?.cells[to] ?? null
    if (!before || !a) return
    const fromRect = (ghost ?? itemEl(from))?.getBoundingClientRect()
    const next = await commit('move', { from, to })
    ghost?.remove()
    if (!next) return
    const parts = fxParts()
    const fromTile = itemEl(from)
    const toTile = itemEl(to)
    flushSync(() => setCellOverride({ [from]: null, [to]: null }))
    if (parts && fromRect && fromTile && toTile) {
      const flights = [fly(parts.root, parts.fx, `it-${a}`, fromRect, toTile, { dur: 200 })]
      if (b) flights.push(fly(parts.root, parts.fx, `it-${b}`, toTile, fromTile, { dur: 200 }))
      await Promise.all(flights)
    }
    flushSync(() => {
      setCellOverride(null)
      setSnap(next)
    })
    pulse(itemEl(to), 'squish')
  }

  async function doSpawn() {
    const before = snapRef.current
    if (!before) return
    const target = selected != null && before.cells[selected] == null ? selected : firstEmptyCell(before.cells)
    if (target == null) {
      warn(MERGE_ERRORS.full)
      return
    }
    if (charges < 1) {
      warn(MERGE_ERRORS.noCharge)
      return
    }
    setSelected(null)
    const next = await commit('spawn', { to: target })
    if (!next) return
    const item = next.cells[target]
    const parts = fxParts()
    pulse(el('[data-spawn]'), 'shake')
    sfx('spawn')
    flushSync(() => {
      setCellOverride({ [target]: null })
      setSnap(next)
    })
    const crate = el('.crate-art')
    const dest = itemEl(target)
    if (parts && crate && dest && item) {
      await fly(parts.root, parts.fx, `it-${item}`, crate, dest, { dur: 520, arc: 110, startScale: 0.55 })
    }
    flushSync(() => setCellOverride(null))
    pulse(itemEl(target), 'pop')
    sfx('pop')
    const tile = el(`[data-cell="${target}"]`)
    if (parts && tile) burst(parts.root, parts.fx, tile, false, 6)
  }

  async function doServe(order: MergeOrder) {
    const before = snapRef.current
    if (!before) return
    const picked = cellsForOrder(before.cells, order.itemId, order.qty)
    if (!picked) {
      warn(MERGE_ERRORS.serveItem)
      return
    }
    setSelected(null)
    const next = await commit('serve', { orderId: order.id, cells: picked })
    if (!next) return
    const parts = fxParts()
    const rects = picked.map((index) => itemEl(index)?.getBoundingClientRect() ?? null)
    flushSync(() => {
      setOrdersOverride(before.orders)
      setCoinHold(before.coins)
      setCellOverride(Object.fromEntries(picked.map((index) => [index, order.itemId])))
      setSnap(next)
    })
    const art = el(`[data-bubart="${order.id}"]`)
    const slot = el(`[data-slot="${order.id}"]`)
    if (parts && art) {
      await Promise.all(picked.map((index, n) => sleep(n * 90).then(() => {
        const rect = rects[n]
        setCellOverride((prev) => {
          if (!prev) return prev
          const rest = { ...prev }
          delete rest[index]
          return rest
        })
        return rect ? fly(parts.root, parts.fx, `it-${order.itemId}`, rect, art, { dur: 480, arc: 70 }) : undefined
      })))
    }
    setCellOverride(null)
    setHappyOrder(order.id)
    sfx('serve')
    if (parts && slot) hearts(parts.root, parts.fx, slot)
    if (parts && art) {
      floatText(parts.root, parts.fx, art, `+${order.coins} 金幣`, true)
      await coinRain(art, before.coins, next.coins, Math.min(8, 3 + Math.round(order.coins / 8)))
    }
    setCoinHold(null)
    pulse(el('[data-xppill]'), 'bump')
    await sleep(350)
    setLeavingOrder(order.id)
    await sleep(420)
    flushSync(() => {
      setOrdersOverride(null)
      setHappyOrder(null)
      setLeavingOrder(null)
      setEnteringOrders(next.orders.filter((entry) => !before.orders.some((old) => old.id === entry.id)).map((entry) => entry.id))
    })
    if (next.ordersCompletedToday >= MERGE_QUEST_TARGET && before.ordersCompletedToday < MERGE_QUEST_TARGET && !next.questClaimed) {
      showToast('今日任務完成！寶箱可以領了')
    }
  }

  async function doUpgrade() {
    const before = snapRef.current
    if (!before) return
    if (before.upgradeCost == null) {
      warn(MERGE_ERRORS.maxShop)
      return
    }
    if (before.coins < before.upgradeCost) {
      warn(MERGE_ERRORS.coins)
      return
    }
    const next = await commit('upgrade', {})
    if (!next) return
    setSheet(null)
    flushSync(() => {
      setCoinHold(before.coins)
      setSnap(next)
    })
    void tickCoins(before.coins, next.coins).then(() => setCoinHold(null))
    const colors = ['#f97316', '#ffd23f', '#fb7185', '#7dd3fc', '#b5f57a', '#fff']
    sfx('upgrade')
    await showOverlay({
      kind: 'level',
      level: next.shopLevel,
      confetti: Array.from({ length: 46 }, (_, i) => ({
        left: Math.random() * 100,
        color: colors[i % colors.length] ?? '#fff',
        r: 360 + Math.random() * 720,
        dur: 1.6 + Math.random() * 1.6,
        delay: Math.random() * 0.6,
      })),
    })
  }

  async function doClaim() {
    const before = snapRef.current
    if (!before) return
    if (before.questClaimed) {
      warn(MERGE_ERRORS.questDone)
      return
    }
    if (before.ordersCompletedToday < MERGE_QUEST_TARGET) {
      warn(MERGE_ERRORS.quest)
      return
    }
    const next = await commit('claim_quest', {})
    if (!next) return
    setChestOpening(true)
    sfx('chest')
    await sleep(280)
    flushSync(() => {
      setCoinHold(before.coins)
      setSnap(next)
    })
    const parts = fxParts()
    const chest = el('[data-chest]')
    if (parts && chest) {
      burst(parts.root, parts.fx, chest, true)
      floatText(parts.root, parts.fx, chest, `+${next.questRewardCoins} 金幣  +${next.questRewardXp} 經驗`, true)
      await coinRain(chest, before.coins, next.coins, 8)
    }
    setChestOpening(false)
    setCoinHold(null)
  }

  async function doStart() {
    const next = await commit('start', {})
    if (!next) return
    setSnap(next)
    setPhase('ready')
    setEnteringOrders(next.orders.map((order) => order.id))
  }

  function pair(from: number, to: number, ghost: HTMLDivElement | null) {
    const current = snapRef.current
    const a = current?.cells[from]
    const b = current?.cells[to]
    const finish = () => {
      ghost?.remove()
      setDrag(null)
    }
    if (!current || !a) {
      finish()
      setSelected(to)
      return
    }
    setSelected(null)
    if (a === b && !nextItem(a)) {
      finish()
      warn(MERGE_ERRORS.maxItem)
      return
    }
    const task = a === b ? () => doMerge(from, to, ghost) : () => doMove(from, to, ghost)
    void run(task).then((ran) => {
      if (!ran) ghost?.remove()
      setDrag(null)
    })
  }

  function tapCell(index: number) {
    if (busyRef.current) return
    idleRef.current = 0
    if (selected != null && selected !== index) {
      pair(selected, index, null)
      return
    }
    if (selected !== index && cells[index]) sfx('tap')
    setSelected(selected === index ? null : index)
  }

  function tileAt(x: number, y: number) {
    const hit = document.elementFromPoint(x, y)?.closest('[data-cell]')
    if (!hit || !rootRef.current?.contains(hit)) return null
    const index = Number(hit.getAttribute('data-cell'))
    return Number.isInteger(index) ? index : null
  }

  function onBoardPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (busyRef.current) return
    const tile = (event.target as Element).closest('[data-cell]')
    if (!tile) return
    idleRef.current = 0
    setHint([])
    dragRef.current = { from: Number(tile.getAttribute('data-cell')), x: event.clientX, y: event.clientY, moved: false, ghost: null, size: 0 }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 指標已經結束時瀏覽器會拒絕捕捉，拖曳仍以 pointerup 的座標判斷落點。
    }
  }

  function onBoardPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    const current = snapRef.current
    if (!d || !current) return
    const item = current.cells[d.from]
    if (!d.moved && item && Math.hypot(event.clientX - d.x, event.clientY - d.y) > 10) {
      const parts = fxParts()
      const source = itemEl(d.from)
      if (!parts || !source) return
      d.moved = true
      setSelected(d.from)
      const r = box(parts.root, source)
      const ghost = document.createElement('div')
      ghost.className = 'flyer'
      ghost.innerHTML = artMarkup(`it-${item}`)
      d.size = r.w * 1.15
      ghost.style.cssText = `width:${d.size}px;height:${d.size}px;`
      parts.fx.appendChild(ghost)
      d.ghost = ghost
      setDrag({ from: d.from, over: null })
    }
    if (d.moved && d.ghost && rootRef.current) {
      const r = rootRef.current.getBoundingClientRect()
      d.ghost.style.left = event.clientX - r.left - d.size / 2 + 'px'
      d.ghost.style.top = event.clientY - r.top - d.size / 2 + 'px'
      const over = tileAt(event.clientX, event.clientY)
      setDrag((prev) => (prev && prev.over === over ? prev : { from: d.from, over }))
    }
  }

  function onBoardPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (d.moved) {
      const to = tileAt(event.clientX, event.clientY)
      if (to != null && to !== d.from) {
        setDrag({ from: d.from, over: null })
        pair(d.from, to, d.ghost)
        return
      }
      d.ghost?.remove()
      setDrag(null)
      setSelected(null)
      return
    }
    tapCell(d.from)
  }

  function onBoardPointerCancel() {
    const d = dragRef.current
    dragRef.current = null
    d?.ghost?.remove()
    setDrag(null)
  }

  function openSheet(name: 'quest' | 'codex') {
    setSheet(name)
    if (name === 'codex') setCodexDot(false)
    const root = rootRef.current
    if (!root || !window.matchMedia('(max-width: 767px)').matches) return
    const bottom = root.getBoundingClientRect().bottom
    const scrollMargin = parseFloat(getComputedStyle(root).scrollMarginBottom) || 0
    if (bottom > window.innerHeight - scrollMargin) root.scrollIntoView({ block: 'end', behavior: calm() ? 'auto' : 'smooth' })
  }

  const themeName = FESTIVAL_THEMES.find((theme) => theme.id === previewId)?.name

  return (
    <section
      aria-label="Pay 服合成小舖"
      className="mt-6"
      onPointerUpCapture={unlockAudio}
      onClickCapture={unlockAudio}
      onKeyDownCapture={unlockAudio}
    >
      <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: MERGE_ART_SVG }} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium">
          <ArrowLeft className="size-4" />返回遊樂園
        </button>
        <p className="text-xs font-bold text-muted-foreground">{themeName ? `畫面主題：${themeName}` : '畫面主題跟隨今天的節慶'}</p>
      </div>
      <div className="mt-4">
        <FestivalBanner previewId={previewId} />
      </div>
      <header className="mt-4">
        <p className="text-xs font-black text-brand-ink">第六階段第一批</p>
        <h1 className="text-2xl font-black">Pay 服合成小舖</h1>
        <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">
          合成相同商品、完成虛擬顧客訂單，再用遊戲金幣升級商店。遊戲金幣和經驗跟 Pay 點數分開，這局不會發放 Pay 點。
          {MERGE_TUNING_CONFIRMED ? '' : ' 商品種類與升級成本尚未正式簽核。'}
        </p>
      </header>

      {phase === 'guest' && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <p className="font-black">請先登入再開始營業</p>
          <p className="mt-2 text-sm text-muted-foreground">進度記在這個會員的資料庫紀錄。重新整理或換裝置登入後會讀回來，不會只用這台裝置保存。</p>
          <button type="button" onClick={onNeedLogin} className="mt-4 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground">登入 / 註冊</button>
        </div>
      )}

      {phase === 'loading' || phase === 'boot' ? <p className="mt-6 text-sm font-bold text-muted-foreground">正在讀取遊戲進度…</p> : null}

      {phase === 'unavailable' && (
        <div role="status" className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm">
          <p className="font-black">進度保存尚未套用到目前資料庫</p>
          <p className="mt-2 text-muted-foreground">這次不會開局，也不會把棋盤記在這台裝置上。正式 migration 完成後，同一個帳號才能保存進度。</p>
        </div>
      )}

      {phase === 'error' && <p role="alert" className="mt-6 text-sm font-bold text-destructive">{errorText}</p>}

      {phase === 'ready' && !snapshot && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <p className="font-black">小舖還沒開張</p>
          <p className="mt-2 text-sm text-muted-foreground">開始後會拿到三份茶葉、兩張顧客訂單，以及可補貨的原料。初始內容由資料庫建立。</p>
          <button type="button" disabled={busy} onClick={() => { void run(doStart) }} className="mt-4 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">開始營業</button>
          {lastError ? <p role="alert" className="mt-2 text-sm font-bold text-destructive">{lastError}</p> : null}
        </div>
      )}

      {snapshot && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2" role="group" aria-label="聲音設定">
            <button
              type="button"
              aria-pressed={audioPrefs.music}
              onClick={() => toggleAudio('music')}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${audioPrefs.music ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground'}`}
            >
              <Music className="size-4" />背景音樂：{audioPrefs.music ? '開' : '關'}
            </button>
            <button
              type="button"
              aria-pressed={audioPrefs.sfx}
              onClick={() => toggleAudio('sfx')}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${audioPrefs.sfx ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground'}`}
            >
              {audioPrefs.sfx ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}音效：{audioPrefs.sfx ? '開' : '關'}
            </button>
          </div>
          <div
            ref={rootRef}
            className={`ms-game mt-2${sheet ? ' sheet-open' : ''}${busy ? ' is-busy' : ''}`}
            data-sheet={sheet ?? undefined}
          >
            <Hud snapshot={snapshot} coins={coinHold ?? snapshot.coins} />
            <div className={`scene${equippedPerks?.scene ? ' pv-scene-host has-perk-scene' : ''}`}>
              <SceneBackdrop id={equippedPerks?.scene} />
              <svg className="scene-bg" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMin slice" aria-hidden="true"><use href="#scene-shop" width="1200" height="300" /></svg>
              <FestivalShopDecor previewId={previewId} />
              <section className="customers" aria-label="顧客訂單">
                {orders.map((order, index) => {
                  const customer = customers[index] ?? CUSTOMERS[0]
                  const have = cells.filter((cell) => cell === order.itemId).length
                  const ready = !ordersOverride && !!cellsForOrder(snapshot.cells, order.itemId, order.qty)
                  const classes = ['cust']
                  if (enteringOrders.includes(order.id)) classes.push('enter')
                  if (happyOrder === order.id) classes.push('happy')
                  if (leavingOrder === order.id) classes.push('leave')
                  return (
                    <div key={order.id} className={classes.join(' ')} data-slot={order.id}>
                      <div className="bubble">
                        <div className="bub-art" data-bubart={order.id}><Art id={`it-${order.itemId}`} /><span className="qty">×{order.qty}</span></div>
                        <div>
                          <div className="bub-name">{itemName(order.itemId)}</div>
                          <div className="bub-reward">
                            <span><Art id="ic-coin" />+{order.coins}</span>
                            <span><Art id="ic-star" />+{order.xp}</span>
                          </div>
                          <button
                            type="button"
                            className={`btn-serve${ready || happyOrder === order.id ? ' ready' : ''}`}
                            aria-label={`${customer.name}想要${itemName(order.itemId)} ${order.qty} 件，${ready ? '交付訂單' : '商品還不夠'}`}
                            onClick={() => {
                              if (!ready) return
                              void run(() => doServe(order))
                            }}
                          >
                            {ready || happyOrder === order.id ? '交付' : `還差 ${Math.max(1, order.qty - have)}`}
                          </button>
                        </div>
                      </div>
                      <div className="cust-avatar"><Art id={`cu-${customer.id}`} viewBox="0 0 120 130" w={120} h={130} /></div>
                      <span className="cust-name">{customer.name}</span>
                    </div>
                  )
                })}
              </section>
              <div className="counter">
                <svg className="register" viewBox="0 0 80 60" aria-hidden="true"><use href="#deco-register" width="80" height="60" /></svg>
                <svg className="jar" viewBox="0 0 60 60" aria-hidden="true"><use href="#deco-jar" width="60" height="60" /></svg>
              </div>
            </div>
            <div className="g-main">
              <div className="g-center">
                <div className="tray">
                  <div
                    className="board"
                    role="grid"
                    aria-label="合成棋盤"
                    onPointerDown={onBoardPointerDown}
                    onPointerMove={onBoardPointerMove}
                    onPointerUp={onBoardPointerUp}
                    onPointerCancel={onBoardPointerCancel}
                  >
                    {cells.map((cell, index) => {
                      const parts = cell ? itemParts(cell) : null
                      const selectedItem = selected != null ? cells[selected] : null
                      const classes = ['tile']
                      if (!cell) classes.push('empty')
                      if (parts?.level === 5) classes.push('lv5')
                      if (selected === index) classes.push('sel')
                      if (selectedItem && selected !== index && cell === selectedItem && nextItem(cell)) classes.push('match')
                      if (cell && orders.some((order) => order.itemId === cell)) classes.push('wanted')
                      if (hint.includes(index)) classes.push('hint')
                      if (drag?.over === index && drag.from !== index) classes.push('over')
                      if (drag?.from === index) classes.push('dragging')
                      return (
                        <button
                          key={index}
                          type="button"
                          className={classes.join(' ')}
                          data-cell={index}
                          data-chain={parts?.chain ?? ''}
                          aria-label={cell ? `${index + 1} 號，${itemName(cell)}，第 ${parts?.level} 階` : `${index + 1} 號，空位`}
                          aria-pressed={selected === index}
                          onClick={(event) => {
                            if (event.detail === 0) tapCell(index)
                          }}
                        >
                          <div className="plate" />
                          <div className="item">{cell ? <Art id={`it-${cell}`} /> : null}</div>
                          <div className="pips">{parts ? Array.from({ length: parts.level }, (_, pip) => <i key={pip} />) : null}</div>
                          <span className="want"><Art id="ic-check" viewBox="0 0 24 24" w={24} h={24} /></span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
              <div className="dock-slot" ref={slotRef} style={dockPin ? { height: dockPin.height } : undefined}>
                <Dock
                  snapshot={snapshot}
                  charges={charges}
                  anchorMs={regen.anchorMs}
                  nowMs={nowMs}
                  codexDot={codexDot}
                  pinned={dockPin}
                  onOpen={openSheet}
                  onSpawn={() => { void run(doSpawn) }}
                  onUpgrade={() => { void run(doUpgrade) }}
                />
              </div>
              <div className="sheet-backdrop" onClick={() => setSheet(null)} />
              <aside className="g-side">
                <div className="sheet-head"><i /></div>
                <QuestPanel snapshot={snapshot} opening={chestOpening} onClaim={() => { void run(doClaim) }} />
                <CodexPanel catalog={snapshot.catalog} shopLevel={snapshot.shopLevel} contentVersion={snapshot.contentVersion} fresh={freshCodex} />
              </aside>
            </div>
            <div className="fx" ref={fxRef} />
            {toast ? <div key={toast.id} className="toast" role="alert">{toast.text}</div> : null}
            {overlay?.kind === 'unlock' ? <UnlockOverlay itemId={overlay.itemId} onClose={closeOverlay} /> : null}
            {overlay?.kind === 'level' ? <LevelOverlay level={overlay.level} nextCost={snapshot.upgradeCost} confetti={overlay.confetti} onClose={closeOverlay} /> : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            點選商品後再點另一格，或直接拖到另一格。相同商品會合成，不同商品或空位會移動。Pay 點數這局 +0。已寫入會員紀錄，修訂 {snapshot.revision}。
          </p>
          {lastError ? <p role="status" className="mt-1 text-xs font-bold text-destructive">上一個動作沒有完成：{lastError}</p> : null}
          <div className="mt-5">
            <GameRewardHud authUserId={authUserId} refreshKey={snapshot.revision} focusGame="merge_shop" onNeedLogin={onNeedLogin} />
          </div>
          <AchievementToastWatcher authUserId={authUserId} refreshKey={snapshot.revision} />
        </>
      )}
      {phase !== 'boot' && phase !== 'loading' ? (
        <div className="mt-5">
          <LiveEventsBoard authUserId={authUserId} onNeedLogin={onNeedLogin} game="merge_shop" />
        </div>
      ) : null}
      <p className="sr-only">棋盤共 {MERGE_CELLS} 格</p>
    </section>
  )
}

function Hud({ snapshot, coins }: { snapshot: MergeSnapshot; coins: number }) {
  const xp = snapshot.xp
  const idx = RANK_STEPS.findIndex((step) => xp < step)
  const lo = idx === -1 ? 300 : RANK_STEPS[idx - 1] ?? 0
  const hi = idx === -1 ? 300 : RANK_STEPS[idx] ?? 300
  const pct = idx === -1 ? 100 : ((xp - lo) / (hi - lo)) * 100
  return (
    <div className="g-hud">
      <div className="hud-shop">
        <div className="lv-badge"><Art id="ic-shop" /><b>Lv.{snapshot.shopLevel}</b></div>
        <div>
          <div className="hud-title outline">Pay 服合成小舖</div>
          <div className="xpbar" aria-label={`經驗 ${xp}，${clerkRank(xp)}`}>
            <i style={{ width: `${Math.max(8, pct)}%` }} />
            <span>{idx === -1 ? clerkRank(xp) : `${clerkRank(xp)} ${xp}/${hi}`}</span>
          </div>
        </div>
      </div>
      <div className="hud-right">
        <div className="pill" data-coinpill aria-label={`遊戲金幣 ${coins}`}><Art id="ic-coin" /><b>{coins}</b></div>
        <div className="pill" data-xppill aria-label={`經驗 ${xp}`}><Art id="ic-star" /><b>{xp}</b></div>
      </div>
    </div>
  )
}

function Dock({
  snapshot,
  charges,
  anchorMs,
  nowMs,
  codexDot,
  pinned,
  onOpen,
  onSpawn,
  onUpgrade,
}: {
  snapshot: MergeSnapshot
  charges: number
  anchorMs: number
  nowMs: number
  codexDot: boolean
  pinned: { left: number; width: number } | null
  onOpen: (name: 'quest' | 'codex') => void
  onSpawn: () => void
  onUpgrade: () => void
}) {
  const cap = snapshot.producerCap
  const left = MERGE_REGEN_SECONDS - (Math.floor(Math.max(0, nowMs - anchorMs) / 1000) % MERGE_REGEN_SECONDS)
  const cost = snapshot.upgradeCost
  const canUpgrade = cost != null && snapshot.coins >= cost
  const done = Math.min(snapshot.ordersCompletedToday, MERGE_QUEST_TARGET)
  const questReady = done >= MERGE_QUEST_TARGET && !snapshot.questClaimed
  return (
    <div className={`dock${pinned ? ' pinned' : ''}`} style={pinned ? { left: pinned.left, width: pinned.width } : undefined}>
      <button type="button" className="dock-btn" data-open="quest" onClick={() => onOpen('quest')}>
        <Art id="ic-quest" />任務
        {snapshot.questClaimed ? null : <span className={`badge-dot${questReady ? ' glow' : ''}`}>{questReady ? '!' : `${done}/${MERGE_QUEST_TARGET}`}</span>}
      </button>
      <button type="button" className="crate-btn" data-spawn onClick={onSpawn} aria-label={`原料箱，補一件原料，剩 ${charges} 份`}>
        <span className="crate-art"><Art id="ic-crate" /></span>原料箱
        <span className="charges">{Array.from({ length: cap }, (_, i) => <i key={i} className={i < charges ? 'on' : ''} />)}</span>
        <span className="crate-timer">{charges >= cap ? `${charges}/${cap} 已補滿` : `${charges}/${cap}・${left} 秒後補 1`}</span>
      </button>
      <button
        type="button"
        className={`dock-btn${canUpgrade ? ' can' : ' off'}`}
        onClick={onUpgrade}
        aria-label={cost == null ? '商店已滿級' : `升級商店到 Lv.${snapshot.shopLevel + 1}，需要 ${cost} 遊戲金幣`}
      >
        <Art id="ic-up" />
        <span>{cost == null ? '已滿級' : `升級 Lv.${snapshot.shopLevel + 1}`}</span>
        {cost == null ? null : <small><Art id="ic-coin" />{cost}</small>}
      </button>
      <button type="button" className="dock-btn" data-open="codex" onClick={() => onOpen('codex')}>
        <Art id="ic-book" />圖鑑
        {codexDot ? <span className="badge-dot">新</span> : null}
      </button>
      <div className="tip">拖曳兩件相同商品合成；顧客想要的商品會出現綠色勾勾。</div>
    </div>
  )
}

function QuestPanel({ snapshot, opening, onClaim }: { snapshot: MergeSnapshot; opening: boolean; onClaim: () => void }) {
  const done = Math.min(snapshot.ordersCompletedToday, MERGE_QUEST_TARGET)
  const ready = done >= MERGE_QUEST_TARGET && !snapshot.questClaimed
  return (
    <section className="panel" data-panel="quest" aria-label="今日顧客任務">
      <div className="ribbon outline">今日顧客任務<small>{done}/{MERGE_QUEST_TARGET}</small></div>
      <div className="quest-track">
        <div className="quest-line"><i style={{ width: `${(done / MERGE_QUEST_TARGET) * 100}%` }} /></div>
        {QUEST_HEADS.map((head, i) => (
          <div key={head} className={`q-node${i < done ? ' done' : ''}`}>
            <Art id={`cu-${head}`} viewBox="22 16 76 76" w={120} h={130} />
            <span className="chk"><Art id="ic-check" viewBox="0 0 24 24" w={24} h={24} /></span>
          </div>
        ))}
        <div className={`q-chest${ready && !opening ? ' ready' : ''}${opening ? ' opening' : ''}`} data-chest>
          <Art id={snapshot.questClaimed ? 'ic-chest-open' : 'ic-chest'} />
        </div>
      </div>
      <p className="q-desc">
        完成 {MERGE_QUEST_TARGET} 張顧客訂單，獎勵 <Art id="ic-coin" /><b>{snapshot.questRewardCoins}</b> 遊戲金幣、<Art id="ic-star" /><b>{snapshot.questRewardXp}</b> 經驗
      </p>
      <button type="button" className={`btn-big${ready ? '' : ' disabled'}`} onClick={onClaim}>
        {snapshot.questClaimed ? '今天已領取' : ready ? '領取寶箱' : `再完成 ${MERGE_QUEST_TARGET - done} 張訂單`}
      </button>
      <small className="fineprint">遊戲金幣與經驗只在合成小舖使用，和 Pay 點數分開，這局不會發放 Pay 點。</small>
    </section>
  )
}

function CodexPanel({ catalog, shopLevel, contentVersion, fresh }: { catalog: string[]; shopLevel: number; contentVersion: number; fresh: string | null }) {
  const owned = new Set(catalog)
  const live = MERGE_CHAINS.filter((chain) => chain.since <= contentVersion)
  return (
    <section className="panel" data-panel="codex" aria-label="商品圖鑑">
      <div className="ribbon outline">商品圖鑑<small>{owned.size}/{live.length * 5}</small></div>
      <div>
        {MERGE_CHAINS.map((chain) => {
          const pending = chain.since > contentVersion
          const locked = pending || shopLevel < chain.unlockLevel
          return (
            <div key={chain.id} className={`codex-row${locked ? ' chain-locked' : ''}`}>
              <div className="lbl">
                {CHAIN_LABEL[chain.id]}
                {locked ? <div className="lockmsg">{pending ? '即將開放' : `Lv.${chain.unlockLevel} 開放`}</div> : null}
              </div>
              <div className="cells">
                {[1, 2, 3, 4, 5].map((level) => {
                  const id = `${chain.id}-${level}`
                  const own = owned.has(id)
                  return (
                    <div key={id} className={`cx${own ? '' : ' locked'}${fresh === id ? ' fresh' : ''}`} title={own ? itemName(id) : '尚未解鎖'}>
                      <Art id={`it-${id}`} />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function UnlockOverlay({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const parts = itemParts(itemId)
  return (
    <div className="overlay unlock" role="dialog" aria-label="新商品解鎖" onClick={onClose}>
      <div className="rays" />
      <div className="ov-card">
        <span className="unlock-tag">新商品解鎖！</span>
        <div className="ov-hero"><Art id={`it-${itemId}`} /></div>
        <div className="unlock-name outline">{itemName(itemId)}</div>
        <div className="unlock-meta">{CHAIN_LABEL[parts?.chain ?? '']}・第 {parts?.level} 階・已收進圖鑑</div>
      </div>
    </div>
  )
}

function LevelOverlay({
  level,
  nextCost,
  confetti,
  onClose,
}: {
  level: number
  nextCost: number | null
  confetti: { left: number; color: string; r: number; dur: number; delay: number }[]
  onClose: () => void
}) {
  const perks = [`原料箱上限 ${producerCap(level - 1)} → ${producerCap(level)} 份`]
  const unlocked = MERGE_CHAINS.find((chain) => chain.unlockLevel === level)
  if (unlocked) perks.push(`解鎖「${CHAIN_LABEL[unlocked.id]}」商品線：${unlocked.names[0]} → ${unlocked.names[unlocked.names.length - 1]}`)
  perks.push(`顧客會訂到第 ${Math.min(5, level + 1)} 階商品，金幣與經驗更多`)
  perks.push(nextCost == null ? '已達目前開放的最高等級' : `下一級需要 ${nextCost} 遊戲金幣`)
  return (
    <div className="overlay" role="dialog" aria-label={`商店升級到 Lv.${level}`}>
      <div className="rays" />
      <div className="confetti">
        {confetti.map((piece, i) => (
          <i
            key={i}
            style={{
              left: `${piece.left}%`,
              background: piece.color,
              ['--r' as string]: `${piece.r}deg`,
              animationDuration: `${piece.dur}s`,
              animationDelay: `${piece.delay}s`,
            }}
          />
        ))}
      </div>
      <div className="ov-card">
        <div className="ov-title outline">商店升級！</div>
        <div className="ov-sub">小舖擴建完成</div>
        <div className="ov-hero"><Art id="ic-shop" /><span className="lvtag">Lv.{level}</span></div>
        <ul className="ov-perks">
          {perks.map((perk) => <li key={perk}><Art id="ic-star" /><span>{perk}</span></li>)}
        </ul>
        <button type="button" className="btn-big" onClick={onClose} autoFocus>太好了！</button>
      </div>
    </div>
  )
}
