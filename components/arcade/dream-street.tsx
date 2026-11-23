'use client'

import './dream-street.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Cloud, CloudAlert, CloudCheck, CloudOff, CloudUpload, Compass, Maximize2, Minimize2, Music, RefreshCw, Trophy, Volume2, VolumeX, X } from 'lucide-react'
import {
  MAX_SHOP_LEVEL,
  QUICK_TIP_FRACTION,
  QUICK_TIP_RATE,
  STREAK_BONUS,
  STREAK_EVERY,
  STREET_BUILDINGS,
  STREET_DECORS,
  STREET_PRODUCTS,
  beginHelpClaim,
  beginStealClaim,
  buyDecor,
  buildingCheck,
  canFill,
  clearDecor,
  countOrder,
  customerLane,
  customerX,
  decorCheck,
  decorFits,
  decorSpec,
  equipDecor,
  liveDecors,
  liveProducts,
  openShops,
  shopDecor,
  shopMenu,
  shopName,
  makeDuration,
  newSim,
  newStreet,
  orderValue,
  parseStreet,
  productSpec,
  rankOf,
  serve,
  setOpen,
  settleHelpClaim,
  settleStealClaim,
  shelfCap,
  shopSpec,
  snapshot,
  startJob,
  stationCap,
  unlockedProducts,
  taipeiDay,
  tick,
  unlockBuilding,
  upgrade,
  upgradeCheck,
  type ActionResult,
  type BuildingId,
  type DecorId,
  type ProductCategory,
  type ProductId,
  type ShopId,
  type StreetEvent,
  type StreetState,
} from '@/lib/arcade/street-rules'
import { festivalStyle, useFestivalTheme } from './festival-banner'
import { LiveEventsBoard } from './live-events-board'
import { DEFAULT_STREET_AUDIO, StreetAudio, parseStreetAudio, type StreetAudioPrefs, type StreetSfx } from './street-audio'
import { useStreetCloud, type CloudPhase } from './street-cloud-sync'
import { PetBuddy, STREET_PERK_BOX, StreetPerkDecor } from '@/components/home/perk-visuals'
import { fetchPublicEquippedPerks } from '@/lib/rewards/perk-client'
import { fetchPublicGameBadges } from '@/lib/arcade/arcade-client'
import { GameBadgeChip } from './achievement-wall'
import type { PublicLoadout } from '@/lib/rewards/perk-snapshot'
import { progressSummary } from '@/lib/arcade/street-cloud'
import { exhibitSig, exhibitStreet, projectStreetExhibit, streetVisitHref, type MyStreetSocial, type PublicStreet } from '@/lib/arcade/street-public'
import {
  claimStreetHelpRewards,
  claimStreetStealRewards,
  exploreStreets,
  fetchMyStreetFriends,
  fetchMyStreetSocial,
  fetchMyStreetSteal,
  fetchPublicStreet,
  fetchStealTarget,
  fetchStreetBoard,
  helpStreetFriend,
  publishMyStreet,
  removeStreetFriend,
  requestStreetFriend,
  respondStreetFriend,
  setMyStreetSteal,
  stealStreetGoods,
  toggleStreetLike,
} from '@/lib/arcade/street-social-client'
import { friendStateOf, helpGate, type MyStreetFriends } from '@/lib/arcade/street-help'
import { stealGate, type ExploreStreet, type MyStreetSteal, type StealTarget } from '@/lib/arcade/street-steal'
import {
  BOARD_KINDS,
  BOARD_PERIODS,
  BOARD_SCOPES,
  BOARD_TEXT,
  shortDay,
  type BoardKind,
  type BoardPeriod,
  type BoardScope,
  type StreetBoard,
} from '@/lib/arcade/street-board'
import {
  CUSTOMER_NAMES,
  CurbProps,
  CustomerBubble,
  CustomerFace,
  CustomerSprite,
  DecorCurb,
  DecorOverhead,
  DecorShop,
  FloatLayer,
  Foreground,
  GiftCorner,
  NorthRow,
  ProductIcon,
  SCENE_H,
  SCENE_W,
  SHOP_FX,
  StreetDefs,
  StreetGround,
  Traffic,
  artFile,
  customerPoint,
  decorSpot,
  lotSpot,
  type CustomerView,
  type FloatFx,
  type ShopBadge,
} from './street-scene'

const SAVE_KEY = 'hengjing:street:save:v1:'
const AUDIO_KEY = 'hengjing:street:audio:v1:'
const SAVE_EVERY_MS = 4000
const PAINT_MS = 16
/** HUD 倒數與進度條的刷新間隔；每次都會重畫整個 HUD，不需要比秒數更密。 */
const PULSE_MS = 500
const FLOAT_MS = 1500
const UPGRADE_FX_MS = 1700
const HEAD_Y = 96
const icon = (name: string) => artFile(`i-${name}`)

function streetSig(state: StreetState | null) {
  if (!state) return 'none'
  const p = state.progress
  const sim = state.sim
  const stock = STREET_PRODUCTS.map((item) => p.stock[item.id]).join(',')
  const jobs = sim.jobs.map((job) => `${job.product}:${job.count}:${job.t0}:${job.t1}`).join(',')
  const people = sim.customers.map((c) => `${c.id}:${c.kind}:${c.shop ?? ''}:${c.phase}:${c.look}:${c.order.join('.')}:${c.mood ?? ''}:${c.slot}`).join(';')
  return [
    p.coins, p.xp, p.shopLevel, p.open ? 1 : 0, p.tutorial,
    p.buildings.join(','), JSON.stringify(p.equipped.shops), p.equipped.street ?? '', p.ownedDecors.join(','),
    stock, jobs, people, p.stats.streak, p.stats.served, p.today.served, p.today.earned, p.today.missed, p.log.length,
  ].join('|')
}

function setIfChanged(node: Element, name: string, value: string) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value)
}

function syncStreetMotion(root: HTMLElement, state: StreetState) {
  const t = state.sim.t
  for (const c of state.sim.customers) {
    const node = root.querySelector(`[data-cid="${c.id}"]`)
    if (!(node instanceof SVGGElement)) continue
    const [x, y] = customerPoint(c, customerX(c, t))
    const scale = node.getAttribute('data-scale') || '1'
    // 同值也重寫屬性會讓瀏覽器重繪整片街景；等候中的顧客不動，跳過才不會隨店數變卡。
    setIfChanged(node, 'transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${scale})`)
    if (c.phase !== 'wait' || c.patienceMs <= 0) continue
    const bar = root.querySelector(`[data-bubble="${c.id}"] [data-patience]`)
    if (!(bar instanceof SVGRectElement)) continue
    const full = Number(bar.getAttribute('data-full') || '0')
    const patience = Math.max(0, Math.min(1, (c.waitUntil - t) / c.patienceMs))
    setIfChanged(bar, 'width', (full * patience).toFixed(1))
    setIfChanged(bar, 'fill', patienceTone(patience))
  }
}

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
    // 無痕模式或空間不足時只保留在這次頁面。
  }
}

const clockText = (at: number) => new Date(at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })

const HINTS = [
  '第一步：按「開始營業」翻開門牌，顧客就會沿著商店街走過來。',
  '顧客走到門口會冒出訂單泡泡。貨架上有貨時泡泡變綠色，點顧客或下方「結帳」完成服務。',
  '貨架會越賣越少。在備貨區按「製作」，做好的商品會自動擺上櫥窗。',
]

type Toast = { id: number; text: string; tone: 'ok' | 'warn' | 'up' }
type StreetTab = 'stock' | 'street' | 'decor' | 'log'
const TABS: { id: StreetTab; label: string }[] = [
  { id: 'stock', label: '備貨' },
  { id: 'street', label: '街邊店' },
  { id: 'decor', label: '裝潢' },
  { id: 'log', label: '紀錄' },
]
const CATEGORIES: { id: 'all' | ProductCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'bake', label: '烘焙' },
  { id: 'drink', label: '飲品' },
  { id: 'sweet', label: '甜點' },
  { id: 'gift', label: '禮盒' },
]
/** 訂單卡與裝潢頁的店家標籤，顏色與街景招牌一致。 */
const SHOP_TAG: Record<ShopId, { label: string; short: string; tone: string }> = {
  main: { label: '主店', short: '主', tone: '#f06595' },
  tea: { label: '茶飲館', short: '茶', tone: '#3f9e72' },
  gift: { label: '禮盒坊', short: '禮', tone: '#8e6cd1' },
}
/** 抽屜從右側展開，越靠右的店越容易被蓋住，顧客列就從右邊的店排起。 */
const STRIP_ORDER: readonly ShopId[] = ['gift', 'main', 'tea']
const patienceTone = (p: number) => (p > 0.5 ? '#22c55e' : p > 0.25 ? '#f59e0b' : '#ef4444')

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z" />
    </svg>
  )
}

type SocialView =
  | { phase: 'idle' | 'loading' }
  | { phase: 'unavailable' | 'error'; message: string }
  | { phase: 'ready'; mine: MyStreetSocial }

type VisitGate = 'own' | 'loading' | 'login' | 'closed' | 'unavailable' | 'open'

type ExploreView = { rows: ExploreStreet[]; hasMore: boolean; loading: boolean; note: string | null }
const EXPLORE_EMPTY: ExploreView = { rows: [], hasMore: false, loading: false, note: null }

const FRIEND_TAG: Record<ExploreStreet['friend'], string | null> = { accepted: '好友', outgoing: '等待對方同意', incoming: '想加你好友', none: null }

type BoardView = { loading: boolean; data: StreetBoard | null; note: string | null }
const BOARD_EMPTY: BoardView = { loading: false, data: null, note: null }

const CLOUD_LABEL: Record<CloudPhase, string> = {
  off: '',
  loading: '讀取雲端…',
  synced: '已存雲端',
  saving: '同步中…',
  pending: '待同步',
  offline: '離線暫存',
  conflict: '已載入最新',
  unavailable: '僅存本機',
  migrate: '尚未轉移',
  blocked: '無法同步',
}

function CloudIcon({ phase }: { phase: CloudPhase }) {
  if (phase === 'synced') return <CloudCheck />
  if (phase === 'saving' || phase === 'loading') return <RefreshCw className="ds-spin" />
  if (phase === 'offline' || phase === 'unavailable') return <CloudOff />
  if (phase === 'migrate') return <CloudUpload />
  if (phase === 'conflict' || phase === 'blocked') return <CloudAlert />
  return <Cloud />
}

export function DreamStreet({
  authResolved,
  authUserId,
  previewId,
  visitOwnerId = null,
  onNeedLogin,
  onBack,
  onLeaveVisit,
  onVisitStreet,
}: {
  authResolved: boolean
  authUserId: string | null
  previewId: string | null
  visitOwnerId?: string | null
  onNeedLogin: () => void
  onBack: () => void
  onLeaveVisit?: () => void
  onVisitStreet?: (ownerId: string) => void
}) {
  const { theme } = useFestivalTheme(previewId)
  const owner = authUserId ?? 'guest'
  const visitingOther = Boolean(visitOwnerId && visitOwnerId !== authUserId)
  const stateRef = useRef<StreetState | null>(null)
  const ownerKeyRef = useRef<string | null>(null)
  const audioRef = useRef<StreetAudio | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const eventsRef = useRef<(events: StreetEvent[]) => void>(() => {})
  const seqRef = useRef(1)
  const timers = useRef<number[]>([])
  const sigRef = useRef('')
  const portraitRef = useRef(false)
  /** 轉移雲端的對話框蓋住街景時暫停營業，顧客不會在背後等到失望離開。 */
  const pausedRef = useRef(false)
  const [, setFrame] = useState(0)
  /** 街道主人公開裝備的商店街裝潢與寵物（點數商城收藏）；訪客看到的也是主人的。 */
  const [ownerLook, setOwnerLook] = useState<PublicLoadout | null>(null)
  const [hostBadge, setHostBadge] = useState<string | null>(null)
  const streetOwnerId = visitingOther ? visitOwnerId : authUserId
  useEffect(() => {
    if (!streetOwnerId) {
      setOwnerLook(null)
      setHostBadge(null)
      return
    }
    let cancelled = false
    void fetchPublicGameBadges([streetOwnerId]).then((rows) => {
      if (!cancelled) setHostBadge(rows?.[streetOwnerId] ?? null)
    })
    void fetchPublicEquippedPerks([streetOwnerId]).then((rows) => {
      if (!cancelled) setOwnerLook(rows?.[streetOwnerId] ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [streetOwnerId])
  const [pulse, setPulse] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [floats, setFloats] = useState<FloatFx[]>([])
  const [toast, setToast] = useState<Toast | null>(null)
  const [audio, setAudio] = useState<StreetAudioPrefs>(DEFAULT_STREET_AUDIO)
  const [audioOpen, setAudioOpen] = useState(false)
  const [upgradingUntil, setUpgradingUntil] = useState(0)
  const [drawer, setDrawer] = useState<StreetTab | null>(null)
  const [focusId, setFocusId] = useState<ProductId | null>(null)
  const [goodsFilter, setGoodsFilter] = useState<(typeof CATEGORIES)[number]['id']>('all')
  const [decorPreview, setDecorPreview] = useState<DecorId | null>(null)
  const [decorShop, setDecorShop] = useState<ShopId>('main')
  const [pickCid, setPickCid] = useState<number | null>(null)
  const chipsRef = useRef<HTMLDivElement | null>(null)
  const [openingLot, setOpeningLot] = useState<BuildingId | null>(null)
  const [madeNote, setMadeNote] = useState<string | null>(null)
  const [full, setFull] = useState(false)
  const [canFull, setCanFull] = useState(false)
  const [social, setSocial] = useState<SocialView>({ phase: 'idle' })
  const [host, setHost] = useState<PublicStreet | null>(null)
  const [visitNote, setVisitNote] = useState<string | null>(null)
  const [likePop, setLikePop] = useState(false)
  const [socialBusy, setSocialBusy] = useState(false)
  const [visitGate, setVisitGate] = useState<VisitGate>('own')
  const [friends, setFriends] = useState<MyStreetFriends | null>(null)
  const [friendsNote, setFriendsNote] = useState<string | null>(null)
  const [friendsTick, setFriendsTick] = useState(0)
  const [friendBusy, setFriendBusy] = useState(false)
  const claimingRef = useRef(false)
  const [mySteal, setMySteal] = useState<MyStreetSteal | null>(null)
  const [myStealNote, setMyStealNote] = useState<string | null>(null)
  const [stealTarget, setStealTarget] = useState<StealTarget | null>(null)
  const [stealNote, setStealNote] = useState<string | null>(null)
  const [stealTick, setStealTick] = useState(0)
  const [stealBusy, setStealBusy] = useState(false)
  const [stealRetry, setStealRetry] = useState(false)
  const stealKeyRef = useRef<{ owner: string; key: string } | null>(null)
  const stealClaimingRef = useRef(false)
  const [exploreOpen, setExploreOpen] = useState(false)
  const [explore, setExplore] = useState<ExploreView>(EXPLORE_EMPTY)
  const exploreSeq = useRef(0)
  const [boardOpen, setBoardOpen] = useState(false)
  const [boardPick, setBoardPick] = useState<{ kind: BoardKind; scope: BoardScope; period: BoardPeriod }>({ kind: 'help', scope: 'global', period: 'week' })
  const [board, setBoard] = useState<BoardView>(BOARD_EMPTY)
  const boardSeq = useRef(0)
  const socialRef = useRef<SocialView>({ phase: 'idle' })
  const ackedSigRef = useRef<string | null>(null)
  const sentSigRef = useRef<string | null>(null)
  const syncTimer = useRef<number | null>(null)
  const visitLockRef = useRef(false)
  const syncRef = useRef<(delay: number) => void>(() => {})
  const visitKey = visitingOther ? visitOwnerId ?? '' : ''
  const [seenVisit, setSeenVisit] = useState(visitKey)
  if (seenVisit !== visitKey) {
    setSeenVisit(visitKey)
    setVisitGate(visitKey ? (authUserId ? 'loading' : 'login') : 'own')
    setHost(null)
    setVisitNote(null)
    setLoaded(false)
    setDrawer(null)
    setDecorPreview(null)
    setAudioOpen(false)
    setExploreOpen(false)
    setBoardOpen(false)
    setStealTarget(null)
    setStealNote(null)
    setStealRetry(false)
  }
  const sheetListRef = useRef<HTMLUListElement | null>(null)
  const sheetRowRef = useRef(new Map<ProductId, HTMLLIElement>())

  const repaint = useCallback(() => setFrame((n) => (n + 1) % 1_000_000), [])
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  syncRef.current = (delay: number) => {
    if (syncTimer.current) window.clearTimeout(syncTimer.current)
    const run = () => {
      syncTimer.current = null
      const key = ownerKeyRef.current
      const cur = stateRef.current
      const socialNow = socialRef.current
      if (visitLockRef.current || !key || !cur || !authUserId) return
      if (socialNow.phase !== 'ready' || !socialNow.mine.published) return
      const exhibit = projectStreetExhibit(cur.progress)
      if (!exhibit) return
      const sig = exhibitSig(exhibit)
      if (sig === ackedSigRef.current || sig === sentSigRef.current) return
      sentSigRef.current = sig
      void publishMyStreet(true, exhibit, authUserId).then((result) => {
        if (!result.data) {
          if (sentSigRef.current === sig) sentSigRef.current = null
          return
        }
        ackedSigRef.current = result.data.exhibit ? exhibitSig(result.data.exhibit) : sig
        const next: SocialView = { phase: 'ready', mine: result.data }
        socialRef.current = next
        if (!visitLockRef.current) setSocial(next)
      })
    }
    if (delay <= 0) run()
    else syncTimer.current = window.setTimeout(run, delay)
  }

  const cloudRef = useRef({ touch: () => {}, flush: () => {} })
  const saveNow = useCallback(() => {
    const cur = stateRef.current
    const key = ownerKeyRef.current
    if (!cur || !key || visitLockRef.current) return
    writeJson(SAVE_KEY + key, snapshot(cur))
    cloudRef.current.touch()
    syncRef.current(800)
  }, [])

  const sfx = useCallback((name: StreetSfx) => {
    audioRef.current?.play(name)
  }, [])

  const flash = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = seqRef.current++
    setToast({ id, text, tone })
    later(() => setToast((cur) => (cur?.id === id ? null : cur)), 2400)
  }, [later])

  const { cloud, open: cloudOpen, close: cloudClose, touch: cloudTouch, flush: cloudFlush, migrate: cloudMigrate, created: cloudCreated } = useStreetCloud({
    saveKey: SAVE_KEY,
    stateRef,
    visitLockRef,
    onChanged: repaint,
    flash,
  })
  cloudRef.current = { touch: cloudTouch, flush: cloudFlush }
  const cloudOpenRef = useRef(cloudOpen)
  cloudOpenRef.current = cloudOpen
  const cloudCloseRef = useRef(cloudClose)
  cloudCloseRef.current = cloudClose
  const [migrateHidden, setMigrateHidden] = useState(false)
  const [cloudInfo, setCloudInfo] = useState(false)

  const addFloats = useCallback((items: Omit<FloatFx, 'id'>[]) => {
    const made = items.map((item) => ({ ...item, id: seqRef.current++ }))
    setFloats((cur) => [...cur, ...made].slice(-16))
    later(() => setFloats((cur) => cur.filter((item) => !made.some((m) => m.id === item.id))), FLOAT_MS)
  }, [later])

  /* ---------- 音訊：只建立一個實例，卸載時關閉 ---------- */
  useEffect(() => {
    const instance = new StreetAudio(DEFAULT_STREET_AUDIO)
    audioRef.current = instance
    const onVis = () => instance.setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      instance.dispose()
      if (audioRef.current === instance) audioRef.current = null
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    }
  }, [])

  /* ---------- 讀檔：自己的 v3 存檔留在本機。參觀別人時不寫入、也不覆蓋屋主。 ---------- */
  useEffect(() => {
    if (!authResolved) return
    let cancel = false
    const visiting = Boolean(visitOwnerId && visitOwnerId !== authUserId)
    if (visiting) {
      visitLockRef.current = true
      ownerKeyRef.current = null
      stateRef.current = null
      sigRef.current = ''
      const prefs = parseStreetAudio(readJson(AUDIO_KEY + (authUserId ?? 'guest')))
      setAudio(prefs)
      audioRef.current?.setPrefs(prefs)
      setFloats([])
      if (!authUserId || !visitOwnerId) {
        setVisitGate('login')
        setLoaded(true)
        return () => {
          cancel = true
          visitLockRef.current = false
        }
      }
      setVisitGate('loading')
      void fetchPublicStreet(visitOwnerId, authUserId).then((result) => {
        if (cancel) return
        if (result.unavailable) {
          setVisitGate('unavailable')
          setVisitNote(result.error)
          setLoaded(true)
          return
        }
        if (!result.data) {
          setVisitGate('closed')
          setVisitNote(result.error)
          setLoaded(true)
          return
        }
        const progress = exhibitStreet(result.data.exhibit)
        stateRef.current = { progress, sim: newSim(progress) }
        setHost(result.data)
        setVisitGate('open')
        setLoaded(true)
        repaint()
      })
      return () => {
        cancel = true
        visitLockRef.current = false
        stateRef.current = null
        ownerKeyRef.current = null
        if (syncTimer.current) window.clearTimeout(syncTimer.current)
      }
    }

    visitLockRef.current = false
    setVisitGate('own')
    setHost(null)
    setVisitNote(null)
    const saved = parseStreet(readJson(SAVE_KEY + owner))
    ownerKeyRef.current = owner
    const prefs = parseStreetAudio(readJson(AUDIO_KEY + owner))
    setAudio(prefs)
    audioRef.current?.setPrefs(prefs)
    setFloats([])
    const begin = (progress: typeof saved) => {
      stateRef.current = progress ? { progress, sim: newSim(progress) } : null
      setLoaded(true)
      repaint()
    }
    // 登入會員先問雲端，決定用這台裝置還是雲端的進度；讀到之前不開始營業，避免玩到一半被換掉。
    stateRef.current = null
    if (authUserId) {
      void cloudOpenRef.current(authUserId, saved).then((progress) => {
        if (!cancel && ownerKeyRef.current === owner) begin(progress)
      })
    } else {
      begin(saved)
    }
    const onHide = () => {
      saveNow()
      cloudRef.current.flush()
      syncRef.current(0)
    }
    const onVis = () => {
      if (document.hidden) onHide()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancel = true
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVis)
      saveNow()
      cloudRef.current.flush()
      cloudCloseRef.current()
      syncRef.current(0)
      if (syncTimer.current) window.clearTimeout(syncTimer.current)
      ownerKeyRef.current = null
      stateRef.current = null
      setLoaded(false)
    }
  }, [authResolved, owner, authUserId, visitOwnerId, repaint, saveNow])

  /* ---------- 遊戲迴圈 ---------- */
  // 用計時器推進而非 requestAnimationFrame：部分內嵌瀏覽器在頁面可見時也會暫停動畫幀，遊戲時間不能跟著停。
  useEffect(() => {
    let last = performance.now()
    let lastSave = last
    const timer = window.setInterval(() => {
      const now = performance.now()
      const dt = now - last
      last = now
      const cur = stateRef.current
      if (!cur || document.hidden || portraitRef.current || pausedRef.current) return
      const res = tick(cur, dt, Math.random, Date.now())
      stateRef.current = res.state
      if (res.events.length) eventsRef.current(res.events)
      if (rootRef.current) syncStreetMotion(rootRef.current, res.state)
      const sig = streetSig(res.state)
      if (sig !== sigRef.current) {
        sigRef.current = sig
        repaint()
      }
      if (now - lastSave >= SAVE_EVERY_MS) {
        lastSave = now
        saveNow()
      }
    }, PAINT_MS)
    return () => window.clearInterval(timer)
  }, [repaint, saveNow])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer(null)
    }
    const onFs = () => setFull(Boolean(document.fullscreenElement))
    const mq = window.matchMedia('(orientation: portrait) and (max-width: 820px)')
    const applyPortrait = () => { portraitRef.current = mq.matches }
    applyPortrait()
    setCanFull(Boolean(document.fullscreenEnabled))
    document.addEventListener('fullscreenchange', onFs)
    window.addEventListener('keydown', onKey)
    mq.addEventListener('change', applyPortrait)
    const pulseTimer = window.setInterval(() => setPulse((n) => (n + 1) % 1_000_000), PULSE_MS)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('fullscreenchange', onFs)
      window.removeEventListener('keydown', onKey)
      mq.removeEventListener('change', applyPortrait)
      window.clearInterval(pulseTimer)
    }
  }, [])

  useLayoutEffect(() => {
    if (drawer !== 'stock' || !focusId) return
    const list = sheetListRef.current
    const row = sheetRowRef.current.get(focusId)
    if (!list || !row) return
    list.scrollTop = Math.max(0, row.offsetTop - 8)
  }, [drawer, focusId, goodsFilter])

  useLayoutEffect(() => {
    const strip = chipsRef.current
    const chip = pickCid == null ? null : strip?.querySelector<HTMLElement>(`[data-cid="${pickCid}"]`)
    if (!strip || !chip) return
    const left = chip.offsetLeft - strip.offsetLeft
    if (left < strip.scrollLeft || left + chip.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, left - 8)
  }, [drawer, pickCid])

  eventsRef.current = (events) => {
    let changed = false
    for (const ev of events) {
      if (ev.type === 'arrive') sfx('arrive')
      if (ev.type === 'made') {
        changed = true
        sfx('done')
        const name = productSpec(ev.product).name
        addFloats([{ x: SHOP_FX[0], y: SHOP_FX[1], text: `${name} +${ev.count}`, tone: 'make' }])
        setMadeNote(`${name} 做好了`)
        later(() => setMadeNote((cur) => (cur === `${name} 做好了` ? null : cur)), 2200)
      }
      if (ev.type === 'missed') {
        changed = true
        sfx('miss')
        const [x, y] = customerPoint(ev.customer, ev.customer.x1)
        addFloats([{ x, y: y - HEAD_Y - 20, text: '等太久了…', tone: 'miss' }])
      }
    }
    if (changed) saveNow()
  }

  const act = (fn: (state: StreetState) => ActionResult): Extract<ActionResult, { ok: true }> | null => {
    if (visitLockRef.current) return null
    const cur = stateRef.current
    if (!cur) return null
    const res = fn(cur)
    if (!res.ok) {
      sfx('error')
      flash(res.error, 'warn')
      return null
    }
    stateRef.current = res.state
    saveNow()
    repaint()
    return res
  }

  const onServe = (id: number) => {
    const res = act((s) => serve(s, id, Date.now()))
    if (!res) return
    for (const ev of res.events) {
      if (ev.type === 'served') {
        const [x, y] = customerPoint(ev.customer, customerX(ev.customer, res.state.sim.t))
        const top = y - HEAD_Y
        sfx('serve')
        later(() => sfx('coin'), 260)
        const items: Omit<FloatFx, 'id'>[] = [
          { x, y: top - 10, text: `+${ev.coins}`, tone: 'coin' },
          { x: x + 6, y: top + 20, text: `+${ev.xp} 經驗`, tone: 'xp' },
        ]
        if (ev.tip) items.push({ x, y: top - 40, text: `快速小費 +${ev.tip}`, tone: 'tip' })
        if (ev.bonus) items.push({ x, y: top - 68, text: `連續好評 +${ev.bonus}`, tone: 'tip' })
        addFloats(items)
      }
      if (ev.type === 'rankUp') {
        later(() => sfx('rank'), 500)
        addFloats([{ x: SCENE_W / 2, y: 190, text: `店長升到 Lv.${ev.rank}！`, tone: 'rank' }])
        flash(`店長升到 Lv.${ev.rank}`, 'up')
      }
    }
  }

  const onMake = (product: ProductId) => {
    if (act((s) => startJob(s, product))) sfx('make')
  }

  const onUpgrade = () => {
    const res = act((s) => upgrade(s, Date.now()))
    if (!res) return
    sfx('upgrade')
    const level = res.state.progress.shopLevel
    setUpgradingUntil(Date.now() + UPGRADE_FX_MS)
    later(() => setUpgradingUntil(0), UPGRADE_FX_MS)
    addFloats([{ x: SHOP_FX[0], y: SHOP_FX[1] - 40, text: `店面 Lv.${level}`, tone: 'spark' }])
    flash(`升級完成！店面變成 Lv.${level}「${shopSpec(level).name}」`, 'up')
  }

  const onToggleOpen = () => {
    if (visitLockRef.current) return
    const cur = stateRef.current
    if (!cur) return
    stateRef.current = setOpen(cur, !cur.progress.open, Date.now())
    sfx(stateRef.current.progress.open ? 'open' : 'tap')
    saveNow()
    repaint()
  }

  const onUnlockLot = (id: BuildingId) => {
    const res = act((s) => unlockBuilding(s, id, Date.now()))
    if (!res) return
    sfx('upgrade')
    setOpeningLot(id)
    later(() => setOpeningLot((cur) => (cur === id ? null : cur)), UPGRADE_FX_MS)
    const [x, y] = lotSpot(id)
    addFloats([{ x, y, text: '開幕！', tone: 'spark' }])
    flash(`${STREET_BUILDINGS.find((item) => item.id === id)?.name ?? '新店'}開幕了`, 'up')
  }

  const onConfirmDecor = () => {
    if (!decorPreview) return
    const shop = decorShop
    const owned = stateRef.current?.progress.ownedDecors.includes(decorPreview) ?? false
    const res = act((s) => (owned ? equipDecor(s, decorPreview, Date.now(), shop) : buyDecor(s, decorPreview, Date.now(), shop)))
    if (!res) return
    sfx('tap')
    const [x, y] = decorSpot(decorPreview, shop)
    addFloats([{ x, y, text: owned ? '套用完成' : '收藏成功', tone: 'spark' }])
    setDecorPreview(null)
    flash(owned ? '裝潢已套用' : '已收藏並套用')
  }

  const onClearDecor = (slot: 'shop' | 'street') => {
    if (act((s) => clearDecor(s, slot, Date.now(), decorShop))) {
      sfx('tap')
      setDecorPreview(null)
    }
  }

  const onPickDecorShop = (shop: ShopId) => {
    setDecorShop(shop)
    setDecorPreview(null)
  }

  const openDrawer = (next: StreetTab, focus: ProductId | null = null) => {
    if (visitLockRef.current) return
    if (focus) setGoodsFilter('all')
    setFocusId(focus)
    setPickCid(null)
    setDrawer(next)
  }

  const closeDrawer = () => {
    setDrawer(null)
    setFocusId(null)
    setPickCid(null)
  }

  const openNeed = (id: ProductId) => openDrawer('stock', id)

  /** 選顧客：備貨清單跳到他還缺的第一項，全都有貨就跳到第一項。 */
  const focusGuest = (c: { id: number; order: ProductId[] }, product?: ProductId) => {
    const cur = stateRef.current
    const need = countOrder(c.order)
    const ids = Object.keys(need) as ProductId[]
    const short = cur ? ids.find((id) => cur.progress.stock[id] < (need[id] ?? 0)) : undefined
    setGoodsFilter('all')
    setFocusId(product ?? short ?? ids[0] ?? null)
    setPickCid(c.id)
    setDrawer('stock')
  }

  /** 點已開幕的店：打開備貨並篩到這間店接的商品類別。 */
  const onShop = (shop: ShopId) => {
    if (visitLockRef.current) return
    const cur = stateRef.current
    if (!cur) return
    const menu = shopMenu(cur.progress, shop)
    const cats = new Set(menu.map((item) => item.category))
    const short = menu.find((item) => cur.progress.stock[item.id] === 0) ?? null
    setFocusId(short?.id ?? null)
    setGoodsFilter(cats.size === 1 ? [...cats][0] : 'all')
    setDrawer('stock')
  }

  const onPreviewDecor = (id: DecorId) => setDecorPreview(id)

  const toggleFull = async () => {
    const el = rootRef.current
    if (!el || !document.fullscreenEnabled) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await el.requestFullscreen()
    } catch {
      // 瀏覽器不支援或使用者取消時，維持原本的橫向畫面。
    }
  }

  const onCreate = () => {
    if (visitLockRef.current) return
    const progress = newStreet(Date.now())
    stateRef.current = { progress, sim: newSim(progress) }
    sfx('open')
    saveNow()
    cloudCreated()
    repaint()
  }

  const onCloudChip = () => {
    if (cloud.phase === 'migrate') {
      setMigrateHidden(false)
      return
    }
    setCloudInfo((v) => !v)
  }

  const onCloudSync = () => {
    saveNow()
    cloudFlush()
  }

  const changeAudio = (next: StreetAudioPrefs) => {
    setAudio(next)
    const inst = audioRef.current
    inst?.setPrefs(next)
    inst?.unlock()
    if (ownerKeyRef.current) writeJson(AUDIO_KEY + ownerKeyRef.current, next)
  }

  useEffect(() => {
    if (!authResolved || !authUserId || visitingOther) return
    let cancel = false
    const loading: SocialView = { phase: 'loading' }
    socialRef.current = loading
    setSocial(loading)
    void fetchMyStreetSocial(authUserId).then((result) => {
      if (cancel) return
      if (result.unavailable) {
        const next: SocialView = { phase: 'unavailable', message: result.error ?? '公開街景尚未啟用' }
        socialRef.current = next
        setSocial(next)
        return
      }
      if (!result.data) {
        const next: SocialView = { phase: 'error', message: result.error ?? '人氣資料無法讀取' }
        socialRef.current = next
        setSocial(next)
        return
      }
      const next: SocialView = { phase: 'ready', mine: result.data }
      socialRef.current = next
      ackedSigRef.current = result.data.exhibit ? exhibitSig(result.data.exhibit) : null
      sentSigRef.current = ackedSigRef.current
      setSocial(next)
      syncRef.current(0)
    })
    return () => { cancel = true }
  }, [authResolved, authUserId, visitingOther])

  const onTogglePublish = () => {
    if (visitLockRef.current) return
    if (!authUserId) return onNeedLogin()
    if (social.phase === 'unavailable') return flash(social.message, 'warn')
    const cur = stateRef.current
    if (!cur) return flash('請先接手第一間店', 'warn')
    const exhibit = projectStreetExhibit(cur.progress)
    if (!exhibit) return flash('這條街還不能公開', 'warn')
    const nextPublished = !(social.phase === 'ready' && social.mine.published)
    setSocialBusy(true)
    void publishMyStreet(nextPublished, exhibit, authUserId).then((result) => {
      setSocialBusy(false)
      if (visitLockRef.current) return
      if (!result.data) return flash(result.error ?? '公開設定沒有完成', 'warn')
      const next: SocialView = { phase: 'ready', mine: result.data }
      socialRef.current = next
      ackedSigRef.current = result.data.exhibit ? exhibitSig(result.data.exhibit) : exhibitSig(exhibit)
      sentSigRef.current = ackedSigRef.current
      setSocial(next)
      flash(nextPublished ? '商店街已公開，可以把連結給朋友' : '商店街已改回不公開')
    })
  }

  const onCopyVisit = () => {
    if (!authUserId || social.phase !== 'ready' || !social.mine.published) return
    const url = `${window.location.origin}${streetVisitHref(window.location.pathname, authUserId)}`
    void navigator.clipboard.writeText(url).then(() => flash('拜訪連結已複製'), () => flash('請手動複製網址列的連結', 'warn'))
  }

  const onLike = () => {
    if (!host || !authUserId || socialBusy) return
    setSocialBusy(true)
    setLikePop(true)
    window.setTimeout(() => setLikePop(false), 450)
    void toggleStreetLike(host.ownerId, authUserId).then((result) => {
      setSocialBusy(false)
      if (!result.data) return flash(result.error ?? '按讚沒有完成', 'warn')
      setHost((cur) => (cur && cur.ownerId === host.ownerId ? { ...cur, likes: result.data!.likes, likedByMe: result.data!.likedByMe } : cur))
    })
  }

  /* ---------- 好友互助：名單、次數與獎勵都以資料庫回覆為準 ---------- */
  useEffect(() => {
    if (!authResolved || !authUserId) {
      setFriends(null)
      setFriendsNote(null)
      return
    }
    let cancel = false
    void fetchMyStreetFriends(authUserId).then((result) => {
      if (cancel) return
      setFriends(result.data)
      setFriendsNote(result.data ? null : result.error ?? '好友名單無法讀取')
    })
    return () => { cancel = true }
  }, [authResolved, authUserId, visitKey, friendsTick])

  // 回到自己的街且存檔在場時才領。領取鍵先寫進存檔再呼叫；回覆遺失就留著待領，
  // 下次用同一把鍵重領，資料庫回放同一筆，存檔記著已入帳的鍵所以不會加兩次。
  useEffect(() => {
    if (!authUserId || visitingOther || !loaded || !friends) return
    const start = stateRef.current
    if (claimingRef.current || !start || visitLockRef.current || ownerKeyRef.current !== authUserId) return
    if (friends.help.unclaimedCount === 0 && !start.progress.helpClaimPending) return
    const begun = beginHelpClaim(start.progress, crypto.randomUUID())
    if (begun.progress !== start.progress) {
      stateRef.current = { progress: begun.progress, sim: start.sim }
      saveNow()
    }
    claimingRef.current = true
    void claimStreetHelpRewards(begun.key, authUserId).then((result) => {
      claimingRef.current = false
      if (!result.data) return
      const claim = result.data
      setFriends((cur) => (cur ? { ...cur, help: claim.help } : cur))
      const cur = stateRef.current
      if (!cur || visitLockRef.current || ownerKeyRef.current !== authUserId) return
      const who = claim.names.slice(0, 3).join('、')
      const res = settleHelpClaim(cur, claim.claimKey, claim.coins, claim.xp, `好友互助 ${claim.count} 筆・${who}`, Date.now())
      stateRef.current = res.state
      saveNow()
      if (!res.applied) return
      repaint()
      sfx('coin')
      flash(`好友互助入帳：+${claim.coins} 金幣${claim.xp ? `、+${claim.xp} 經驗` : ''}`, 'up')
    })
  }, [authUserId, visitingOther, loaded, friends, saveNow, repaint, sfx, flash])

  const refreshFriends = () => setFriendsTick((n) => n + 1)

  const onFriendAction = (run: () => Promise<{ data: unknown; error: string | null }>, done: string) => {
    if (!authUserId || friendBusy) return
    setFriendBusy(true)
    void run().then((result) => {
      setFriendBusy(false)
      if (result.error) flash(result.error, 'warn')
      else flash(done)
      refreshFriends()
    })
  }

  const onAddFriend = (id: string) => onFriendAction(() => requestStreetFriend(id, authUserId), '好友邀請已送出')
  const onRespondFriend = (id: string, accept: boolean) => onFriendAction(() => respondStreetFriend(id, accept, authUserId), accept ? '已成為好友' : '已婉拒邀請')
  const onRemoveFriend = (id: string) => onFriendAction(() => removeStreetFriend(id, authUserId), '已移除')

  const onHelp = () => {
    if (!host || !authUserId || friendBusy) return
    const gate = helpGate(friends, host.ownerId, Date.now())
    if (!gate.ok) return flash(gate.reason, 'warn')
    setFriendBusy(true)
    void helpStreetFriend(host.ownerId, crypto.randomUUID(), authUserId).then((result) => {
      setFriendBusy(false)
      refreshFriends()
      if (!result.data) return flash(result.error ?? '幫忙沒有完成', 'warn')
      if (result.data.duplicate) return flash('這次幫忙已經記過了')
      const h = result.data.help
      sfx('coin')
      flash(`幫忙完成！回到自己的街會領到 +${h.helperCoins} 金幣、+${h.helperXp} 經驗`, 'up')
    })
  }

  /* ---------- 趣味偷貨：不需要好友，次數、冷卻與獎勵都以資料庫回覆為準 ---------- */
  const hostId = visitGate === 'open' ? host?.ownerId ?? null : null
  useEffect(() => {
    if (!authResolved || !authUserId) return
    let cancel = false
    if (hostId) {
      void fetchStealTarget(hostId, authUserId).then((result) => {
        if (cancel) return
        setStealTarget(result.data)
        setStealNote(result.data ? null : result.error ?? '偷貨狀態無法讀取')
      })
    } else if (!visitingOther) {
      void fetchMyStreetSteal(authUserId).then((result) => {
        if (cancel) return
        setMySteal(result.data)
        setMyStealNote(result.data ? null : result.error ?? '偷貨紀錄無法讀取')
      })
    }
    return () => { cancel = true }
  }, [authResolved, authUserId, hostId, visitingOther, stealTick])

  // 偷到的金幣跟好友互助一樣，回到自己的街才入帳；領取鍵先寫進存檔，回覆遺失時用同一把鍵重領。
  useEffect(() => {
    if (!authUserId || visitingOther || !loaded || !mySteal) return
    const start = stateRef.current
    if (stealClaimingRef.current || !start || visitLockRef.current || ownerKeyRef.current !== authUserId) return
    if (mySteal.steal.unclaimedCount === 0 && !start.progress.stealClaimPending) return
    const begun = beginStealClaim(start.progress, crypto.randomUUID())
    if (begun.progress !== start.progress) {
      stateRef.current = { progress: begun.progress, sim: start.sim }
      saveNow()
    }
    stealClaimingRef.current = true
    void claimStreetStealRewards(begun.key, authUserId).then((result) => {
      stealClaimingRef.current = false
      if (!result.data) return
      const claim = result.data
      setMySteal((cur) => (cur ? { ...cur, steal: claim.steal } : cur))
      const cur = stateRef.current
      if (!cur || visitLockRef.current || ownerKeyRef.current !== authUserId) return
      const who = claim.names.slice(0, 3).join('、')
      const res = settleStealClaim(cur, claim.claimKey, claim.coins, claim.xp, `趣味偷貨 ${claim.count} 筆・${who}`, Date.now())
      stateRef.current = res.state
      saveNow()
      if (!res.applied) return
      repaint()
      sfx('coin')
      flash(`趣味偷貨入帳：+${claim.coins} 金幣${claim.xp ? `、+${claim.xp} 經驗` : ''}`, 'up')
    })
  }, [authUserId, visitingOther, loaded, mySteal, saveNow, repaint, sfx, flash])

  const onToggleSteal = () => {
    if (!authUserId || !mySteal || stealBusy) return
    const next = !mySteal.allowSteal
    setStealBusy(true)
    void setMyStreetSteal(next, authUserId).then((result) => {
      setStealBusy(false)
      if (result.data == null) return flash(result.error ?? '偷貨設定沒有完成', 'warn')
      setMySteal((cur) => (cur ? { ...cur, allowSteal: next } : cur))
      flash(next ? '已開放其他玩家趣味偷貨' : '已關閉趣味偷貨，好友互助不受影響')
    })
  }

  /** 資料庫要先有自己的商店街列才算參與。用本機存檔建一列「不公開」的展示，不會把街公開出去。 */
  const registerPlayer = async () => {
    if (!authUserId) return false
    const saved = parseStreet(readJson(SAVE_KEY + authUserId))
    const exhibit = saved ? projectStreetExhibit(saved) : null
    if (!exhibit) return false
    const result = await publishMyStreet(false, exhibit, authUserId)
    return Boolean(result.data)
  }

  const onSteal = () => {
    if (!host || !authUserId || stealBusy) return
    const gate = stealGate(stealTarget, Date.now())
    if (!gate.ok) return flash(gate.reason, 'warn')
    const owner = host.ownerId
    // 上一次沒有拿到回覆時沿用同一把鍵，資料庫會回放那一次的結果，不會多偷一次。
    const key = stealKeyRef.current?.owner === owner ? stealKeyRef.current.key : crypto.randomUUID()
    stealKeyRef.current = { owner, key }
    setStealBusy(true)
    const attempt = async (registered: boolean): Promise<void> => {
      const result = await stealStreetGoods(owner, key, authUserId)
      if (result.reason === 'not_player' && !registered) {
        if (await registerPlayer()) return attempt(true)
        stealKeyRef.current = null
        setStealBusy(false)
        return flash('先回到自己的商店街接手第一間店，才能去偷貨', 'warn')
      }
      setStealBusy(false)
      if (!result.data && !result.reason && !result.unavailable) {
        setStealRetry(true)
        return flash('網路不穩，再按一次會用同一筆重試，不會多偷', 'warn')
      }
      stealKeyRef.current = null
      setStealRetry(false)
      setStealTick((n) => n + 1)
      if (!result.data) return flash(result.error ?? '偷貨沒有完成', 'warn')
      const r = result.data
      setStealTarget((cur) => (cur ? { ...cur, steal: r.steal, triedToday: cur.triedToday + (r.replay ? 0 : 1), ownerToday: cur.ownerToday + (r.replay ? 0 : 1) } : cur))
      if (r.outcome === 'miss') {
        sfx('miss')
        return flash('被店長發現了，空手而回！明天再來', 'warn')
      }
      sfx('coin')
      flash(`偷到 +${r.coins} 金幣${r.xp ? `、+${r.xp} 經驗` : ''}！回到自己的街就會入帳`, 'up')
    }
    void attempt(false)
  }

  /* ---------- 探索商店街：只列出已公開的街 ---------- */
  const loadExplore = (offset: number) => {
    if (!authUserId) return
    const seq = ++exploreSeq.current
    setExplore((cur) => ({ ...(offset === 0 ? EXPLORE_EMPTY : cur), loading: true, note: null }))
    void exploreStreets(offset, authUserId).then((result) => {
      if (seq !== exploreSeq.current) return
      if (!result.data) return setExplore((cur) => ({ ...cur, loading: false, note: result.error ?? '探索列表無法讀取' }))
      const page = result.data
      setExplore((cur) => {
        const base = offset === 0 ? [] : cur.rows
        const seen = new Set(base.map((row) => row.ownerId))
        return { rows: [...base, ...page.streets.filter((row) => !seen.has(row.ownerId))], hasMore: page.hasMore, loading: false, note: null }
      })
    })
  }

  const onOpenExplore = () => {
    if (!authUserId) return onNeedLogin()
    setAudioOpen(false)
    setDrawer(null)
    setBoardOpen(false)
    setExploreOpen(true)
    loadExplore(0)
  }

  const onExploreVisit = (ownerId: string) => {
    if (!onVisitStreet) return
    setExploreOpen(false)
    onVisitStreet(ownerId)
  }

  /* ---------- 社交排行榜：名次與成績都由資料庫統計，前端只選要看哪一種榜 ---------- */
  const loadBoard = (pick: typeof boardPick, keep = false) => {
    const seq = ++boardSeq.current
    if (pick.kind === 'business' || !authUserId) return setBoard(BOARD_EMPTY)
    setBoard((cur) => ({ data: keep ? cur.data : null, loading: true, note: null }))
    void fetchStreetBoard(pick.kind, pick.scope, pick.period, authUserId).then((result) => {
      if (seq !== boardSeq.current) return
      setBoard(result.data ? { loading: false, data: result.data, note: null } : { loading: false, data: null, note: result.error ?? '排行榜暫時無法讀取' })
    })
  }

  const pickBoard = (next: Partial<typeof boardPick>) => {
    const pick = { ...boardPick, ...next }
    setBoardPick(pick)
    loadBoard(pick)
  }

  const onOpenBoard = () => {
    if (!authUserId) return onNeedLogin()
    setAudioOpen(false)
    setDrawer(null)
    setExploreOpen(false)
    setBoardOpen(true)
    loadBoard(boardPick)
  }

  const onBoardVisit = (ownerId: string) => {
    if (!onVisitStreet) return
    setBoardOpen(false)
    onVisitStreet(ownerId)
  }

  /* ---------- 畫面資料 ---------- */
  const st = stateRef.current
  const p = st?.progress ?? newStreet(0)
  const t = st?.sim.t ?? 0
  const spec = shopSpec(p.shopLevel)
  const up = upgradeCheck(p)
  const rank = rankOf(p.xp)
  const today = p.today.day === taipeiDay(Date.now()) ? p.today : { served: 0, missed: 0, earned: 0 }
  const jobs = st?.sim.jobs ?? []
  const customers = st?.sim.customers ?? []
  const views: CustomerView[] = customers
    .map((c) => ({ c, x: customerX(c, t), servable: c.phase === 'wait' && canFill(p, c.order), patience: c.phase === 'wait' ? Math.max(0, (c.waitUntil - t) / c.patienceMs) : 1 }))
    .sort((a, b) => (a.c.kind === b.c.kind ? a.x - b.x : a.c.kind === 'passer' ? 1 : -1))
  const guests = views.filter((v) => v.c.kind === 'guest' && v.c.phase !== 'leave' && v.c.phase !== 'sad').sort((a, b) => a.c.slot - b.c.slot)
  const waiting = guests.filter((v) => v.c.phase === 'wait')
  const waitingCount = waiting.length
  const urgent = waiting.slice().sort((a, b) => a.patience - b.patience)[0] ?? null
  const unlockedGoods = unlockedProducts(p.shopLevel)
  const emptyGoods = unlockedGoods.filter((item) => p.stock[item.id] === 0)
  const lowGoods = unlockedGoods.filter((item) => p.stock[item.id] > 0 && p.stock[item.id] <= 1)
  const stockAlert = emptyGoods[0] ?? lowGoods[0] ?? null
  const nextJob = jobs.slice().sort((a, b) => a.t1 - b.t1)[0] ?? null
  const craftLeft = nextJob ? Math.max(0, Math.ceil((nextJob.t1 - t) / 1000)) : 0
  const craftProgress = nextJob && nextJob.t1 > nextJob.t0 ? Math.min(1, Math.max(0, (t - nextJob.t0) / (nextJob.t1 - nextJob.t0))) : 0
  const upgrading = upgradingUntil > Date.now()
  const shelf = shelfCap(p)
  const stations = stationCap(p)
  const shops = openShops(p)
  const pickShop: ShopId = shops.includes(decorShop) ? decorShop : 'main'
  const previewSpec = decorPreview ? STREET_DECORS.find((item) => item.id === decorPreview) ?? null : null
  /** 預覽只蓋在目前選的那間店上，其他店照存檔顯示。 */
  const shownShopDecor = (shop: ShopId) => (previewSpec?.slot === 'shop' && shop === pickShop ? previewSpec.id : shopDecor(p, shop))
  const shownStreet = previewSpec?.slot === 'street' ? previewSpec.id : p.equipped.street
  const equippedHere = (id: DecorId) => (decorSpec(id).slot === 'street' ? p.equipped.street === id : shopDecor(p, pickShop) === id)
  const decorGate = decorPreview ? decorCheck(p, decorPreview, pickShop) : null
  const shopBadges: Partial<Record<ShopId, ShopBadge>> = {}
  for (const shop of shops) {
    const mine = waiting.filter((v) => v.c.shop === shop)
    const blocked = mine.filter((v) => !v.servable).length
    const menu = shopMenu(p, shop)
    shopBadges[shop] = !p.open
      ? { text: '休息中', tone: 'closed' }
      : blocked
        ? { text: `缺貨 ${blocked} 位`, tone: 'short' }
        : mine.length
          ? { text: `${mine.length} 位等待`, tone: 'busy' }
          : menu.length && menu.every((item) => p.stock[item.id] === 0)
            ? { text: '貨架空了', tone: 'short' }
            : { text: '營業中', tone: 'open' }
  }
  const hint = p.tutorial < 3 ? HINTS[p.tutorial] : p.tutorial === 3 ? (up.ok ? '金幣與經驗都夠了，到「店面升級」把小店升級吧！' : '持續服務顧客累積金幣與經驗，達到條件就能升級店面。') : null
  const status = !p.open ? { text: '休息中', tone: 'closed' } : waitingCount ? { text: `${waitingCount} 位顧客等待中`, tone: 'busy' } : { text: '營業中・等待顧客', tone: 'open' }
  const showSetup = loaded && !st && !visitingOther
  const showMigrate = loaded && Boolean(st) && !visitingOther && cloud.phase === 'migrate' && !migrateHidden
  pausedRef.current = showMigrate
  const describeGood = (id: ProductId) => {
    const item = productSpec(id)
    const locked = item.unlock > p.shopLevel
    const job = jobs.find((row) => row.product === id)
    const stock = p.stock[id]
    const full = stock >= shelf
    const progress = job && job.t1 > job.t0 ? Math.min(1, Math.max(0, (t - job.t0) / (job.t1 - job.t0))) : 0
    const batch = Math.min(spec.batch, Math.max(0, shelf - stock))
    const remain = job ? Math.max(0, Math.ceil((job.t1 - t) / 1000)) : 0
    const seconds = (makeDuration(p, id) / 1000).toFixed(1)
    return { item, locked, job, stock, full, progress, batch, remain, seconds }
  }
  const focusGood = focusId ? describeGood(focusId) : null
  const focusWaiters = focusId ? waiting.filter((view) => view.c.order.includes(focusId)) : []
  const focusReady = focusWaiters.some((view) => canFill(p, view.c.order))
  const focusLineOk = focusId ? focusWaiters.some((view) => p.stock[focusId] >= (countOrder(view.c.order)[focusId] ?? 1)) : false
  const focusHint = !focusId || focusWaiters.length === 0
    ? null
    : focusReady
      ? '庫存足夠，點上方顧客頭像即可直接結帳。'
      : focusLineOk
        ? '這項庫存夠了。訂單還缺其他商品，補齊後再回去服務。'
        : '庫存不足。按製作會走原本的工作台與貨架規則，不會直接扣款或結帳。'

  const shopRank = (v: CustomerView) => {
    const at = STRIP_ORDER.indexOf(v.c.shop ?? 'main')
    return at < 0 ? STRIP_ORDER.length : at
  }
  const stripGuests = guests.slice().sort((a, b) => shopRank(a) - shopRank(b) || a.c.slot - b.c.slot)
  const picked = pickCid == null ? null : guests.find((v) => v.c.id === pickCid) ?? null

  const orderCard = (v: CustomerView, onNeed: (id: ProductId) => void, extra = '') => {
    const need = countOrder(v.c.order)
    const pay = orderValue(v.c.order, p.shopLevel, p.buildings)
    const name = CUSTOMER_NAMES[v.c.look % CUSTOMER_NAMES.length]
    const left = Math.max(0, Math.ceil((v.c.waitUntil - t) / 1000))
    return (
      <div key={v.c.id} data-cid={v.c.id} data-shop={v.c.shop ?? undefined} className={`ds-order ${extra} ${v.servable ? 'is-ready' : ''} ${v.c.phase === 'wait' && v.patience <= 0.28 ? 'is-late' : ''}`}>
        <CustomerFace look={v.c.look} />
        <div className="ds-order-main">
          <b>
            <span className="ds-order-who">
              {name}
              {v.c.shop ? <em className="ds-order-shop" style={{ background: SHOP_TAG[v.c.shop].tone }} title={shopName(p, v.c.shop)}>{extra ? SHOP_TAG[v.c.shop].label : SHOP_TAG[v.c.shop].short}</em> : null}
            </span>
            <small>{v.c.phase === 'walk' ? '走近中' : v.c.phase === 'happy' ? '結帳' : `${left} 秒`}</small>
          </b>
          <span className="ds-order-need">
            {(Object.keys(need) as ProductId[]).map((id) => (
              <button key={id} type="button" className={`${p.stock[id] >= (need[id] ?? 0) ? 'ok' : 'short'} ${extra && focusId === id ? 'is-focus' : ''}`} onClick={() => onNeed(id)} aria-label={`${productSpec(id).name}${p.stock[id] >= (need[id] ?? 0) ? '有貨' : '缺貨'}`}>
                <ProductIcon id={id} size={22} />
                {(need[id] ?? 0) > 1 ? <i>×{need[id]}</i> : null}
              </button>
            ))}
          </span>
          {v.c.phase === 'wait' ? <span className="ds-order-bar"><i style={{ width: `${v.patience * 100}%` }} /></span> : null}
        </div>
        <button type="button" className="ds-serve" disabled={!v.servable} onClick={() => onServe(v.c.id)}>
          {v.c.phase === 'happy' ? '完成' : v.servable ? <><img src={icon('coin')} alt="" />{pay}</> : v.c.phase === 'wait' ? '缺貨' : '等待'}
        </button>
      </div>
    )
  }

  const structural = streetSig(st)
  sigRef.current = structural
  const showcase = visitingOther && visitGate === 'open'
  const badgeSig = JSON.stringify(showcase ? {} : shopBadges)
  const scene = useMemo(() => {
    const depth = (v: CustomerView) => customerPoint(v.c, v.x)[1]
    const byDepth = (a: CustomerView, b: CustomerView) => depth(a) - depth(b)
    const tea = p.buildings.includes('tea')
    const gift = p.buildings.includes('gift')
    const sideGuest = (v: CustomerView) => v.c.kind === 'guest' && customerLane(v.c) === 'side'
    const northGuest = (v: CustomerView) => v.c.kind === 'guest' && customerLane(v.c) === 'north'
    return (
      <svg className="ds-scene" viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} preserveAspectRatio="xMidYMid slice" role="application" aria-label={showcase ? `正在參觀${host?.nickname ?? '朋友'}的夢想商店街，${spec.name}` : `夢想商店街，${spec.name}${p.open ? '營業中' : '休息中'}`}>
        <NorthRow
          level={p.shopLevel}
          name={spec.name}
          open={showcase ? true : p.open}
          baking={showcase ? false : jobs.length > 0}
          canUpgrade={!showcase && up.ok && !upgrading}
          upgrading={showcase ? false : upgrading}
          tea={tea}
          opening={showcase ? null : openingLot}
          badges={showcase ? {} : shopBadges}
          onOpen={() => onShop('main')}
          onLot={() => openDrawer('street')}
          onShop={onShop}
        />
        <DecorShop shop="main" decor={shownShopDecor('main')} preview={pickShop === 'main' && previewSpec?.slot === 'shop'} />
        {tea ? <DecorShop shop="tea" decor={shownShopDecor('tea')} preview={pickShop === 'tea' && previewSpec?.slot === 'shop'} /> : null}
        {views.filter(northGuest).sort(byDepth).map((v) => <CustomerSprite key={v.c.id} view={v} onServe={onServe} />)}
        <CurbProps />
        <DecorCurb street={shownStreet} preview={decorPreview} />
        <Traffic />
        {views.filter((v) => v.c.kind === 'passer').sort(byDepth).map((v) => <CustomerSprite key={v.c.id} view={v} onServe={onServe} />)}
        <GiftCorner gift={gift} opening={showcase ? null : openingLot} badge={showcase ? undefined : shopBadges.gift} onLot={() => openDrawer('street')} onShop={onShop} />
        {gift ? <DecorShop shop="gift" decor={shownShopDecor('gift')} preview={pickShop === 'gift' && previewSpec?.slot === 'shop'} /> : null}
        {views.filter(sideGuest).sort(byDepth).map((v) => <CustomerSprite key={v.c.id} view={v} onServe={onServe} />)}
        <Foreground />
        <DecorOverhead street={shownStreet} preview={decorPreview} />
        {views.filter((v) => v.c.kind === 'guest' && v.c.phase === 'wait').sort(byDepth).map((v) => <CustomerBubble key={v.c.id} view={v} onServe={onServe} onWant={openNeed} />)}
        {ownerLook?.decor && STREET_PERK_BOX[ownerLook.decor] ? <StreetPerkDecor id={ownerLook.decor} box={STREET_PERK_BOX[ownerLook.decor]} /> : null}
        <FloatLayer items={floats} />
      </svg>
    )
  }, [structural, decorPreview, pickShop, badgeSig, floats, upgrading, openingLot, showcase, host?.nickname, ownerLook?.decor])

  const muted = !audio.music && !audio.sfx
  const lotReady = STREET_BUILDINGS.some((item) => !p.buildings.includes(item.id) && buildingCheck(p, item.id).ok)
  const badges: Record<StreetTab, string | null> = {
    stock: emptyGoods.length ? String(emptyGoods.length) : null,
    street: up.ok || lotReady ? '!' : null,
    decor: null,
    log: null,
  }
  const urgentLeft = urgent ? Math.max(0, Math.ceil((urgent.c.waitUntil - t) / 1000)) : 0
  const tabIcon: Record<StreetTab, string> = { stock: 'stock', street: 'street', decor: 'decor', log: 'log' }

  return (
    <div ref={rootRef} className={`ds-app ${drawer ? 'is-drawer' : ''} ${visitingOther ? 'is-visit' : ''}`} data-festival={theme.id} data-pulse={pulse} data-visit={visitingOther ? visitGate : 'own'} style={festivalStyle(theme)} onPointerUpCapture={() => audioRef.current?.unlock()}>
      <StreetDefs />
      <div className="ds-rotate">
        <div className="ds-phone" aria-hidden="true"><i /></div>
        <b>請把手機橫過來</b>
        <p>夢想商店街以橫向畫面遊玩。轉正之後，店面、顧客和金幣都會留在原地。</p>
        <button type="button" onClick={onBack}>離開遊戲</button>
      </div>
      <div className="ds-world">
        <div className="ds-stage">
          <StreetGround />
          {visitingOther && visitGate !== 'open' ? null : scene}
          {!loaded ? <div className="ds-cover"><p>{visitingOther ? '正在打開朋友的商店街…' : cloud.phase === 'loading' ? '正在讀取雲端存檔…' : '讀取商店街中…'}</p></div> : null}
          {showMigrate ? (
            <div className="ds-cover">
              <div className="ds-setup ds-migrate" role="dialog" aria-modal="true" aria-label="把進度存到雲端">
                <CloudUpload className="ds-migrate-icon" />
                <h2>把進度存到雲端</h2>
                <p>這台裝置上的商店街：<b>{progressSummary(p)}</b></p>
                <p>轉移後，換手機或電腦登入同一個帳號都能接著玩。每個帳號只能轉移一次，伺服器會核對營收紀錄，前後對不上的金幣會調整；原本的瀏覽器存檔會另外備份，不會刪除。</p>
                {cloud.note ? <p className="ds-migrate-note" role="status">{cloud.note}</p> : null}
                <button type="button" className="ds-cta" disabled={cloud.migrating} onClick={() => void cloudMigrate()}>{cloud.migrating ? '轉移中…' : '轉移到雲端'}</button>
                <button type="button" className="ds-cta ds-cta-ghost" disabled={cloud.migrating} onClick={() => setMigrateHidden(true)}>稍後再說</button>
              </div>
            </div>
          ) : null}
          {loaded && visitingOther && visitGate !== 'open' ? (
            <div className="ds-cover">
              <div className="ds-setup">
                <HeartIcon />
                <h2>{visitGate === 'login' ? '登入後才能拜訪' : visitGate === 'unavailable' ? '拜訪還沒啟用' : '這條商店街沒有公開'}</h2>
                <p>{visitGate === 'login' ? '朋友的商店街只開放給已登入會員參觀。' : visitNote ?? '屋主尚未同意公開，或連結不正確。'}</p>
                {visitGate === 'login' ? <button type="button" className="ds-cta" onClick={onNeedLogin}>登入</button> : null}
                <button type="button" className="ds-cta ds-cta-ghost" onClick={onLeaveVisit ?? onBack}>返回我的商店街</button>
              </div>
            </div>
          ) : null}
          {showSetup ? (
            <div className="ds-cover">
              <div className="ds-setup">
                <img src={icon('street')} alt="" />
                <h2>歡迎來到夢想商店街</h2>
                <p>街角有一間甜點小舖等你接手。貨架上已經放了幾個可頌和奶茶。</p>
                <button type="button" className="ds-cta" onClick={onCreate}>接手第一間店</button>
              </div>
            </div>
          ) : null}
        </div>

        <header className="ds-hud-tl">
          <button type="button" className="ds-round" onClick={onBack} aria-label="離開遊戲">
            <img src={icon('exit')} alt="" />
          </button>
          {visitingOther && !host ? (
            <div className="ds-profile ds-host" aria-label="正在查看朋友的商店街">
              <span className="ds-avatar"><HeartIcon /></span>
              <span className="ds-profile-main"><b>朋友的商店街</b></span>
            </div>
          ) : showcase && host ? (
            <div className="ds-profile ds-host" aria-label={`正在參觀${host.nickname}的商店街`}>
              <span className="ds-avatar">
                {host.avatarUrl ? <img className="ds-photo" src={host.avatarUrl} alt="" /> : <b>{host.nickname.slice(0, 1)}</b>}
              </span>
              <span className="ds-profile-main">
                <b>參觀 {host.nickname}</b>
                <small>{spec.name}</small>
              </span>
            </div>
          ) : (
            <div className="ds-profile" aria-label={`店長 Lv.${rank.rank}，經驗 ${rank.into} / ${rank.need}`}>
              <span className="ds-avatar">
                <img src={icon('star')} alt="" />
                <b>{rank.rank}</b>
              </span>
              <span className="ds-profile-main">
                <b>店長 Lv.{rank.rank}</b>
                <span className="ds-xp"><i style={{ width: `${rank.need ? (rank.into / rank.need) * 100 : 100}%` }} /><em>{rank.into}/{rank.need}</em></span>
              </span>
            </div>
          )}
          {ownerLook?.pet ? <span className="ds-pet"><PetBuddy id={ownerLook.pet} size={44} title="店長的寵物夥伴" /></span> : null}
          {visitingOther ? null : (
            <div className="ds-res" aria-label={`夢想金幣 ${p.coins}`}>
              <img src={icon('coin')} alt="" />
              <b key={p.coins} className="ds-pop">{p.coins.toLocaleString()}</b>
            </div>
          )}
          {!visitingOther && cloud.phase !== 'off' ? (
            <button type="button" className={`ds-cloud is-${cloud.phase}`} onClick={onCloudChip} aria-expanded={cloud.phase === 'migrate' ? undefined : cloudInfo} aria-label={`雲端存檔：${CLOUD_LABEL[cloud.phase]}${cloud.note ? `。${cloud.note}` : ''}`}>
              <CloudIcon phase={cloud.phase} />
              <span>{CLOUD_LABEL[cloud.phase]}</span>
            </button>
          ) : null}
          {cloudInfo && !visitingOther && cloud.phase !== 'off' && cloud.phase !== 'migrate' ? (
            <div className="ds-cloud-info" role="status">
              <div className="ds-settings-head">
                <b>雲端存檔</b>
                <button type="button" className="ds-x" onClick={() => setCloudInfo(false)} aria-label="關閉雲端存檔說明"><X className="size-4" /></button>
              </div>
              <p>
                {cloud.note ?? (cloud.phase === 'synced'
                  ? `進度已存到雲端${cloud.at ? `（${clockText(cloud.at)}）` : ''}。換手機或電腦登入同一個帳號，都會接著這份進度。`
                  : cloud.phase === 'pending' || cloud.phase === 'saving'
                    ? '最新的經營進度正在送到雲端，遊戲可以照常進行。'
                    : '正在確認雲端進度。')}
              </p>
              <p className="ds-cloud-fine">金幣與經驗由伺服器依營業紀錄、升級花費與好友互助／偷貨紀錄重新計算，每筆獎勵只入帳一次。夢想金幣不能兌換 Pay 點數。</p>
              {cloud.phase === 'unavailable' || cloud.phase === 'blocked' ? null : (
                <button type="button" className="ds-switch" disabled={cloud.phase === 'saving' || cloud.phase === 'loading'} onClick={onCloudSync}>
                  <RefreshCw className="size-4" />立即同步
                </button>
              )}
            </div>
          ) : null}
        </header>

        <div className="ds-hud-tr">
          {showcase && host ? (
            <div className="ds-visitbar" role="status">
              <b>正在參觀朋友的街</b>
              <GameBadgeChip achievementId={hostBadge} />
              <small>今日 {host.todayVisitors} 位不同會員・累計 {host.visitors}</small>
            </div>
          ) : visitingOther ? null : (
            <div className={`ds-biz is-${status.tone}`} role="status">
              <img src={icon('clock')} alt="" />
              <span>
                <b>{status.text}</b>
                <small>今日 {today.served} 位・{today.earned.toLocaleString()} 金</small>
              </span>
            </div>
          )}
          {showcase && host ? (
            <button type="button" className={`ds-round ds-heart ${host.likedByMe ? 'is-on' : ''} ${likePop ? 'is-pop' : ''}`} onClick={onLike} disabled={socialBusy} aria-pressed={host.likedByMe} aria-label={host.likedByMe ? `取消讚，目前 ${host.likes}` : `按讚，目前 ${host.likes}`}>
              <HeartIcon />
              <i className="ds-badge">{host.likes > 99 ? '99+' : host.likes}</i>
            </button>
          ) : null}
          {authUserId && (!visitingOther || showcase) ? (
            <button type="button" className={`ds-round ds-explore-btn ${exploreOpen ? 'is-on' : ''}`} onClick={onOpenExplore} aria-expanded={exploreOpen} aria-label="探索商店街">
              <Compass />
              <span>探索</span>
            </button>
          ) : null}
          {authUserId && (!visitingOther || showcase) ? (
            <button type="button" className={`ds-round ds-explore-btn ds-board-btn ${boardOpen ? 'is-on' : ''}`} onClick={onOpenBoard} aria-expanded={boardOpen} aria-label="社交排行榜">
              <Trophy />
              <span>排行</span>
            </button>
          ) : null}
          {showcase ? (
            <button type="button" className="ds-back-mine" onClick={onLeaveVisit ?? onBack}>返回我的商店街</button>
          ) : null}
          <button type="button" className={`ds-round ${muted ? 'is-off' : ''}`} onClick={() => changeAudio({ ...audio, music: muted, sfx: muted })} aria-label={muted ? '開啟聲音' : '關閉聲音'} aria-pressed={!muted}>
            <img src={icon('sound')} alt="" />
          </button>
          {visitingOther ? null : (
          <button type="button" className={`ds-round ${audioOpen ? 'is-on' : ''}`} onClick={() => setAudioOpen((v) => !v)} aria-expanded={audioOpen} aria-label="設定">
            <img src={icon('gear')} alt="" />
            {social.phase === 'ready' && social.mine.published ? <i className="ds-badge">{social.mine.likes > 99 ? '99+' : social.mine.likes}</i> : null}
          </button>
          )}
          {audioOpen && !visitingOther ? (
            <div className="ds-settings" role="group" aria-label="設定">
              <div className="ds-settings-head"><b>設定</b><button type="button" className="ds-x" onClick={() => setAudioOpen(false)} aria-label="關閉設定"><X className="size-4" /></button></div>
              <div className="ds-social">
                <div className="ds-social-head">
                  <HeartIcon />
                  <b>好友拜訪</b>
                </div>
                {!authUserId && authResolved ? <p>登入後可以把商店街公開給其他會員參觀。</p> : null}
                {social.phase === 'loading' ? <p>正在讀取人氣…</p> : null}
                {social.phase === 'unavailable' || social.phase === 'error' ? <p>{social.message}</p> : null}
                {social.phase === 'ready' ? (
                  <>
                    <p className="ds-social-count" aria-label={`收到 ${social.mine.likes} 個讚，今日 ${social.mine.todayVisitors} 位不同會員，累計 ${social.mine.visitors} 位`}>
                      <b>{social.mine.likes}</b> 個讚
                      <span>今日 {social.mine.todayVisitors} 位</span>
                      <span>累計 {social.mine.visitors} 位</span>
                    </p>
                    <button type="button" className={`ds-switch ${social.mine.published ? 'is-on' : ''}`} aria-pressed={social.mine.published} disabled={socialBusy || !st} onClick={onTogglePublish}>
                      {social.mine.published ? '已公開商店街' : '公開我的商店街'}
                    </button>
                    <button type="button" className="ds-switch" disabled={!social.mine.published} onClick={onCopyVisit}>複製拜訪連結</button>
                  </>
                ) : null}
                <p>公開後，朋友只看得到已開幕的店面與裝潢，以及你的公開暱稱和頭像。金幣、庫存和訂單不會公開。每位會員每天只算一次人氣，自己進出不算；讚可以再按一次取消。</p>
              </div>
              <div className="ds-social ds-friends">
                <div className="ds-social-head">
                  <HeartIcon />
                  <b>好友互助</b>
                </div>
                {friendsNote ? <p>{friendsNote}</p> : !friends ? <p>正在讀取好友…</p> : (
                  <>
                    <p className="ds-social-count">
                      <span>今日幫忙 {friends.help.usedToday}/{friends.help.dailyLimit}</span>
                      <span>收到 {friends.help.receivedToday}/{friends.help.receiveLimit}</span>
                      <span>每次間隔 {friends.help.cooldownSeconds} 秒</span>
                    </p>
                    {friends.incoming.map((row) => (
                      <div key={row.userId} className="ds-friend-row">
                        <span><b>{row.nickname}</b> 想加你為好友</span>
                        <button type="button" className="ds-mini" disabled={friendBusy} onClick={() => onRespondFriend(row.userId, true)}>接受</button>
                        <button type="button" className="ds-mini" disabled={friendBusy} onClick={() => onRespondFriend(row.userId, false)}>婉拒</button>
                      </div>
                    ))}
                    {friends.friends.length === 0 ? (
                      <p>還沒有好友。按右上「探索」逛其他玩家的商店街，進去按「加好友」，對方同意後就能互相拜訪、幫忙。</p>
                    ) : (
                      <ul className="ds-friend-list" aria-label={`好友 ${friends.friends.length} 位`}>
                        {friends.friends.map((row) => (
                          <li key={row.userId} className="ds-friend-row">
                            <span>
                              <b>{row.nickname}</b>
                              <small>{row.helpedToday ? '今天已幫忙' : row.published ? '可以拜訪幫忙' : '尚未公開商店街'}{row.helpedMeToday ? '・今天幫過你' : ''}</small>
                            </span>
                            <button type="button" className="ds-mini" disabled={!row.published || !onVisitStreet} onClick={() => onVisitStreet?.(row.userId)}>拜訪</button>
                            <button type="button" className="ds-mini" disabled={friendBusy} onClick={() => onRemoveFriend(row.userId)}>移除</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {friends.outgoing.map((row) => (
                      <div key={row.userId} className="ds-friend-row">
                        <span><b>{row.nickname}</b><small>等待對方回覆</small></span>
                        <button type="button" className="ds-mini" disabled={friendBusy} onClick={() => onRemoveFriend(row.userId)}>收回</button>
                      </div>
                    ))}
                    <p>每幫好友打理一次，你得到 {friends.help.helperCoins} 金幣與 {friends.help.helperXp} 經驗，好友得到 {friends.help.ownerCoins} 金幣。同一位好友每天一次，只在夢想商店街使用，不能兌換 Pay 點數。</p>
                  </>
                )}
              </div>
              <div className="ds-social ds-steal">
                <div className="ds-social-head">
                  <HeartIcon />
                  <b>趣味偷貨</b>
                </div>
                {myStealNote ? <p>{myStealNote}</p> : !mySteal ? <p>正在讀取偷貨紀錄…</p> : (
                  <>
                    <p className="ds-social-count">
                      <span>今天被偷 {mySteal.stolenToday} 次</span>
                      <span>我今天偷 {mySteal.steal.usedToday}/{mySteal.steal.dailyLimit}</span>
                    </p>
                    <button type="button" className={`ds-switch ${mySteal.allowSteal ? 'is-on' : ''}`} aria-pressed={mySteal.allowSteal} disabled={stealBusy} onClick={onToggleSteal}>
                      {mySteal.allowSteal ? '允許其他玩家趣味偷貨' : '已關閉趣味偷貨'}
                    </button>
                    {mySteal.log.length === 0 ? <p>還沒有人來偷過貨。</p> : (
                      <ul className="ds-friend-list" aria-label="最近的偷貨紀錄">
                        {mySteal.log.map((row, i) => (
                          <li key={`${row.at}-${i}`} className="ds-friend-row ds-steal-row">
                            <span>
                              <b>{row.nickname}</b>
                              <small>{row.outcome === 'success' ? `偷走一份趣味獎勵（系統另發 ${row.coins} 金幣）` : '想偷但被你發現了'}</small>
                            </span>
                            <small>{clockText(row.at)}</small>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p>其他玩家不必是好友也能來偷貨，偷到的是系統另外送的夢想金幣，你的商品、金幣與經驗都不會減少。關閉後別人就不能偷，好友互助照常。每人每天 {mySteal.steal.dailyLimit} 次，同一條街每天 {mySteal.steal.pairLimit} 次，不能換 Pay 點數。</p>
                  </>
                )}
              </div>
              <div className="ds-audio-row">
                <button type="button" className={`ds-switch ${audio.music ? 'is-on' : ''}`} aria-pressed={audio.music} onClick={() => changeAudio({ ...audio, music: !audio.music })}>
                  <Music className="size-4" />音樂{audio.music ? '開' : '關'}
                </button>
                <label className="ds-slider">
                  <span>{Math.round(audio.musicVol * 100)}</span>
                  <input type="range" min={0} max={100} step={5} value={Math.round(audio.musicVol * 100)} aria-label="背景音樂音量" onChange={(e) => changeAudio({ ...audio, musicVol: Number(e.target.value) / 100 })} />
                </label>
              </div>
              <div className="ds-audio-row">
                <button type="button" className={`ds-switch ${audio.sfx ? 'is-on' : ''}`} aria-pressed={audio.sfx} onClick={() => changeAudio({ ...audio, sfx: !audio.sfx })}>
                  {audio.sfx ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}音效{audio.sfx ? '開' : '關'}
                </button>
                <label className="ds-slider">
                  <span>{Math.round(audio.sfxVol * 100)}</span>
                  <input type="range" min={0} max={100} step={5} value={Math.round(audio.sfxVol * 100)} aria-label="音效音量" onChange={(e) => changeAudio({ ...audio, sfxVol: Number(e.target.value) / 100 })} />
                </label>
              </div>
              <div className="ds-audio-row">
                {canFull ? <button type="button" className="ds-switch" onClick={toggleFull} aria-pressed={full}>{full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}{full ? '離開全螢幕' : '全螢幕'}</button> : null}
                {!authUserId && authResolved ? <button type="button" className="ds-switch is-on" onClick={onNeedLogin}>登入保存進度</button> : null}
              </div>
            </div>
          ) : null}
        </div>

        {st ? (
          <nav className="ds-hud-left" aria-label="營業狀態">
            <button type="button" className={`ds-widget ${urgent && urgent.patience <= 0.28 ? 'is-bad' : waitingCount ? 'is-hot' : ''}`} style={{ '--p': urgent ? urgent.patience : 0 } as CSSProperties} onClick={() => urgent && openNeed(urgent.c.order[0])} aria-label={`等待中顧客 ${waitingCount} 位`}>
              <span className="ds-widget-ring"><img src={icon('bubble')} alt="" /></span>
              {waitingCount ? <b className="ds-badge">{waitingCount}</b> : null}
              <small>{urgent ? `${urgentLeft} 秒` : '無人等'}</small>
            </button>
            <button type="button" className={`ds-widget ${emptyGoods.length ? 'is-bad' : lowGoods.length ? 'is-hot' : ''}`} onClick={() => openDrawer('stock', stockAlert?.id ?? null)} aria-label={stockAlert ? `${stockAlert.name}庫存不足` : '庫存足夠'}>
              <span className="ds-widget-ring"><img src={icon('flour')} alt="" /></span>
              {emptyGoods.length ? <b className="ds-badge">缺{emptyGoods.length}</b> : lowGoods.length ? <b className="ds-badge is-warn">低{lowGoods.length}</b> : null}
              <small>{stockAlert ? stockAlert.name : '庫存足'}</small>
            </button>
            <button type="button" className={`ds-widget ${jobs.length ? 'is-make' : ''}`} style={{ '--p': craftProgress } as CSSProperties} onClick={() => openDrawer('stock', nextJob?.product ?? null)} aria-label={`工作台 ${jobs.length}/${stations}`}>
              <span className="ds-widget-ring"><img src={icon('oven')} alt="" /></span>
              {jobs.length ? <b className="ds-badge is-make">{jobs.length}/{stations}</b> : null}
              <small>{nextJob ? `${craftLeft} 秒` : '空閒'}</small>
            </button>
          </nav>
        ) : null}

        {hint && st && !drawer ? (
          <p className="ds-hint"><img src={icon('bubble')} alt="" /><span>{hint}</span></p>
        ) : null}
        {showcase && host ? (
          <div className="ds-visit-actions" role="group" aria-label={`和${host.nickname}互動`}>
            {(() => {
              const relation = friendStateOf(friends, host.ownerId)
              if (friendsNote) return <span className="ds-friend-note" role="status">{friendsNote}</span>
              if (relation === 'accepted') {
                const gate = helpGate(friends, host.ownerId, Date.now())
                return (
                  <>
                    <span className="ds-visit-tag">已是好友</span>
                    <button type="button" className="ds-back-mine ds-help" onClick={onHelp} disabled={friendBusy || !gate.ok} title={gate.ok ? undefined : gate.reason}>
                      {gate.ok ? '幫忙打理' : gate.reason}
                    </button>
                  </>
                )
              }
              if (relation === 'incoming') return <button type="button" className="ds-back-mine ds-help" disabled={friendBusy} onClick={() => onRespondFriend(host.ownerId, true)}>接受邀請</button>
              if (relation === 'outgoing') return <button type="button" className="ds-back-mine" disabled>等待對方同意</button>
              return <button type="button" className="ds-back-mine ds-help" disabled={friendBusy || !friends} onClick={() => onAddFriend(host.ownerId)}>加好友</button>
            })()}
            {(() => {
              if (stealNote) return <span className="ds-friend-note" role="status">{stealNote}</span>
              const gate = stealGate(stealTarget, Date.now())
              const label = stealBusy ? '偷偷摸摸中…' : stealRetry ? '重試偷貨' : gate.ok ? `趣味偷貨（剩 ${gate.left} 次）` : gate.reason
              return (
                <button type="button" className="ds-back-mine ds-steal-btn" onClick={onSteal} disabled={stealBusy || (!gate.ok && !stealRetry)} title={gate.ok ? '偷到的是系統另外送的夢想金幣，屋主不會少任何東西' : gate.reason}>
                  {label}
                </button>
              )
            })()}
          </div>
        ) : null}

        {exploreOpen ? (
          <div className="ds-explore" role="dialog" aria-modal="true" aria-label="探索商店街">
            <div className="ds-explore-card">
              <div className="ds-settings-head">
                <b>探索商店街</b>
                <button type="button" className="ds-x" onClick={() => setExploreOpen(false)} aria-label="關閉探索"><X className="size-4" /></button>
              </div>
              <p className="ds-explore-sub">逛逛其他玩家公開的商店街。不用分享連結，直接進去按讚、加好友或趣味偷貨。</p>
              {explore.rows.length === 0 && explore.loading ? <p className="ds-explore-sub">正在找附近的商店街…</p> : null}
              {explore.rows.length === 0 && !explore.loading && !explore.note ? <p className="ds-explore-sub">目前還沒有其他公開的商店街。</p> : null}
              <ul className="ds-explore-list">
                {explore.rows.map((row) => {
                  const tag = FRIEND_TAG[row.friend]
                  const level = shopSpec(row.shopLevel)
                  return (
                    <li key={row.ownerId} className={row.ownerId === host?.ownerId ? 'is-here' : undefined}>
                      <span className="ds-explore-avatar">
                        {row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : <b>{row.nickname.slice(0, 1)}</b>}
                      </span>
                      <span className="ds-explore-main">
                        <b>{row.nickname}</b>
                        <small>Lv.{row.shopLevel}「{level.name}」・{1 + row.buildings.length} 間店</small>
                        <span className="ds-explore-tags">
                          <i>讚 {row.likes}</i>
                          <i>今日 {row.todayVisitors} 人逛</i>
                          {tag ? <i className="is-friend">{tag}</i> : null}
                          <i className={row.allowSteal ? 'is-steal' : 'is-off'}>{!row.allowSteal ? '不開放偷貨' : row.triedToday ? '今天偷過' : '可趣味偷貨'}</i>
                        </span>
                      </span>
                      <button type="button" className="ds-mini" disabled={!onVisitStreet || row.ownerId === host?.ownerId} onClick={() => onExploreVisit(row.ownerId)}>
                        {row.ownerId === host?.ownerId ? '正在這裡' : '拜訪'}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {explore.note ? <p className="ds-explore-sub">{explore.note}</p> : null}
              <div className="ds-audio-row">
                {explore.hasMore ? <button type="button" className="ds-switch" disabled={explore.loading} onClick={() => loadExplore(explore.rows.length)}>{explore.loading ? '讀取中…' : '再看更多'}</button> : null}
                <button type="button" className="ds-switch" disabled={explore.loading} onClick={() => loadExplore(0)}>重新整理</button>
              </div>
            </div>
          </div>
        ) : null}

        {boardOpen ? (
          <div className="ds-explore" role="dialog" aria-modal="true" aria-label="社交排行榜">
            <div className="ds-explore-card ds-board">
              <div className="ds-settings-head">
                <b>社交排行榜</b>
                <button type="button" className="ds-x" onClick={() => setBoardOpen(false)} aria-label="關閉排行榜"><X className="size-4" /></button>
              </div>
              <div className="ds-board-tabs" role="tablist" aria-label="排行種類">
                {BOARD_KINDS.map((item) => (
                  <button key={item.id} type="button" role="tab" aria-selected={boardPick.kind === item.id} className={boardPick.kind === item.id ? 'is-on' : undefined} onClick={() => pickBoard({ kind: item.id })}>
                    {item.label}
                  </button>
                ))}
              </div>
              {boardPick.kind === 'business' ? (
                <div className="ds-board-gap" role="status">
                  <b>經營排行暫不開放</b>
                  <p className="ds-explore-sub">經營進度已經可以存到雲端，伺服器也會檢查金幣與等級是否符合遊戲規則。但顧客與營收仍是在各自的裝置上計算，伺服器只能擋掉超出上限的數字，還不足以公平排名，所以暫時不用任何人自己回報的數字排名。</p>
                  <p className="ds-explore-sub">好友互助與趣味偷貨都有資料庫確認的紀錄，可以先看這兩個排行。</p>
                </div>
              ) : (() => {
                const kind = boardPick.kind
                const text = BOARD_TEXT[kind]
                const data = board.data
                const me = data?.me ?? null
                return (
                  <>
                    <div className="ds-board-filters">
                      <div className="ds-board-seg" role="group" aria-label="範圍">
                        {BOARD_SCOPES.map((item) => (
                          <button key={item.id} type="button" aria-pressed={boardPick.scope === item.id} className={boardPick.scope === item.id ? 'is-on' : undefined} onClick={() => pickBoard({ scope: item.id })}>{item.label}</button>
                        ))}
                      </div>
                      <div className="ds-board-seg" role="group" aria-label="期間">
                        {BOARD_PERIODS.map((item) => (
                          <button key={item.id} type="button" aria-pressed={boardPick.period === item.id} className={boardPick.period === item.id ? 'is-on' : undefined} onClick={() => pickBoard({ period: item.id })}>{item.label}</button>
                        ))}
                      </div>
                    </div>
                    {data ? (
                      <p className="ds-explore-sub">
                        {data.period === 'all'
                          ? '累計所有有效紀錄'
                          : data.period === 'week'
                            ? `本週 ${shortDay(data.weekStart)}–${shortDay(data.weekEnd)}・每週一 00:00（台灣時間）換新一週`
                            : `上週 ${shortDay(data.weekStart)}–${shortDay(data.weekEnd)}・已結算`}
                        {data.scope === 'friends' ? '・只列你和已互相確認的好友' : '・只列已公開商店街的玩家'}
                      </p>
                    ) : null}
                    {me ? (
                      <p className="ds-board-me" role="status">
                        {me.listed && me.rank != null
                          ? <>我的名次 <b>第 {me.rank} 名</b><span>{text.score} {me.score} 次・{text.extra} {me.extra} 次</span></>
                          : boardPick.scope === 'global' && !me.published && me.score > 0
                            ? <>你的商店街尚未公開，不列入全站榜<span>{text.score} {me.score} 次・{text.extra} {me.extra} 次</span></>
                            : <>這段期間還沒有成績<span>{kind === 'help' ? '去幫好友打理一下吧' : '去探索別人的街試試身手吧'}</span></>}
                      </p>
                    ) : null}
                    {board.loading && !data ? <p className="ds-explore-sub">正在讀取排行榜…</p> : null}
                    {board.note ? <p className="ds-explore-sub">{board.note}</p> : null}
                    {data && data.rows.length === 0 ? <p className="ds-explore-sub">{data.scope === 'friends' ? '還沒有好友上榜。' : '這段期間還沒有人上榜。'}</p> : null}
                    {data && data.rows.length > 0 ? (
                      <ol className={`ds-explore-list ds-board-list ${board.loading ? 'is-stale' : ''}`} aria-label={`${text.score}排行，共 ${data.total} 位`}>
                        {data.rows.map((row) => (
                          <li key={`${row.rank}-${row.userId ?? row.nickname}`} className={row.me ? 'is-me' : undefined}>
                            <span className={`ds-board-rank is-${row.rank <= 3 ? row.rank : 'n'}`}>{row.rank}</span>
                            <span className="ds-explore-avatar">
                              {row.avatarUrl ? <img src={row.avatarUrl} alt="" /> : <b>{row.nickname.slice(0, 1)}</b>}
                            </span>
                            <span className="ds-explore-main">
                              <b>{row.nickname}{row.me ? '（我）' : ''}</b>
                              <span className="ds-explore-tags">
                                <i className="is-friend">{text.score} {row.score}</i>
                                <i>{text.extra} {row.extra}</i>
                                {!row.published ? <i className="is-off">未公開商店街</i> : null}
                              </span>
                            </span>
                            {row.me || !row.userId ? <span /> : (
                              <button type="button" className="ds-mini" disabled={!onVisitStreet || row.userId === host?.ownerId} onClick={() => onBoardVisit(row.userId as string)}>
                                {row.userId === host?.ownerId ? '正在這裡' : '拜訪'}
                              </button>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    <p className="ds-explore-sub">
                      {kind === 'help'
                        ? '成績只算資料庫確認的有效互助：同一位好友每天最多算一次，重送或重複點擊不會多算。'
                        : '成功與失手分開計算，只有成功次數決定名次；同一筆偷貨重送不會多算。'}
                      同分時先達到該成績的排前面。排行榜只供展示，不發放 Pay 點數、金幣或其他獎勵。
                    </p>
                    <div className="ds-audio-row">
                      <button type="button" className="ds-switch" disabled={board.loading} onClick={() => loadBoard(boardPick, true)}>{board.loading ? '讀取中…' : '重新整理'}</button>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        ) : null}

        {toast ? <div key={toast.id} className={`ds-toast is-${toast.tone}`} role="status">{toast.text}</div> : null}

        {st && guests.length > 0 && !drawer ? (
          <div className="ds-orders" aria-label="顧客訂單">
            {guests.map((v) => orderCard(v, (id) => focusGuest(v.c, id)))}
          </div>
        ) : null}

        <footer className="ds-dock">
          {TABS.map((item) => (
            <button key={item.id} type="button" className={`ds-tab ${drawer === item.id ? 'is-on' : ''}`} onClick={() => drawer === item.id ? closeDrawer() : openDrawer(item.id, item.id === 'stock' ? stockAlert?.id ?? nextJob?.product ?? null : null)} aria-pressed={drawer === item.id}>
              <img src={icon(tabIcon[item.id])} alt="" />
              <b>{item.label}</b>
              {badges[item.id] ? <i className="ds-badge">{badges[item.id]}</i> : null}
            </button>
          ))}
        </footer>
        <button type="button" className={`ds-open ${p.open ? 'is-open' : ''}`} onClick={onToggleOpen} disabled={!st}>
          <img src={icon('sign')} alt="" />
          <b>{p.open ? '暫停營業' : '開始營業'}</b>
        </button>

        {drawer && st ? (
          <aside className="ds-drawer" role="dialog" aria-label={TABS.find((item) => item.id === drawer)?.label}>
            <div className="ds-sheet-head">
              <img src={icon(tabIcon[drawer])} alt="" />
              <span className="ds-sheet-title">
                <b>{TABS.find((item) => item.id === drawer)?.label}</b>
                <small>{drawer === 'stock' ? `工作台 ${jobs.length}/${stations}・貨架 ${shelf}` : drawer === 'street' ? `店面 Lv.${p.shopLevel}・${spec.name}` : drawer === 'decor' ? `已收藏 ${p.ownedDecors.length}/${liveDecors().length}` : `今日 ${today.served} 位`}</small>
              </span>
              <button type="button" className="ds-x" onClick={closeDrawer} aria-label="關閉"><X className="size-5" /></button>
            </div>
            {drawer === 'stock' && stripGuests.length ? (
              <div className="ds-guestbar">
                <div className="ds-chips" ref={chipsRef} role="group" aria-label={`顧客訂單 ${stripGuests.length} 位`}>
                  {stripGuests.map((v, i) => {
                    const shop = v.c.shop ?? 'main'
                    const need = countOrder(v.c.order)
                    const name = CUSTOMER_NAMES[v.c.look % CUSTOMER_NAMES.length]
                    const gap = i > 0 && stripGuests[i - 1].c.shop !== v.c.shop
                    return (
                      <button
                        key={v.c.id}
                        type="button"
                        data-cid={v.c.id}
                        data-shop={shop}
                        className={`ds-chip ${v.servable ? 'is-ready' : ''} ${v.c.phase === 'walk' || v.c.phase === 'happy' ? 'is-walk' : ''} ${gap ? 'is-gap' : ''}`}
                        style={{ '--tone': SHOP_TAG[shop].tone, '--p': v.patience, '--ring': patienceTone(v.patience) } as CSSProperties}
                        aria-pressed={picked?.c.id === v.c.id}
                        aria-label={`${SHOP_TAG[shop].label}・${name}${v.servable ? '・可結帳' : v.c.phase === 'walk' ? '・走近中' : v.c.phase === 'happy' ? '・已結帳' : '・缺貨'}`}
                        onClick={() => focusGuest(v.c)}
                      >
                        <span className="ds-chip-face"><CustomerFace look={v.c.look} /></span>
                        <em>{SHOP_TAG[shop].short}</em>
                        {v.servable ? <img className="ds-chip-ok" src={icon('coin')} alt="" /> : null}
                        <span className="ds-chip-need">
                          {(Object.keys(need) as ProductId[]).map((id) => (
                            <i key={id} className={p.stock[id] >= (need[id] ?? 0) ? 'ok' : 'short'}><ProductIcon id={id} size={13} /></i>
                          ))}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {picked ? orderCard(picked, (id) => { setGoodsFilter('all'); setFocusId(id) }, 'is-pick') : null}
              </div>
            ) : null}
            <div className="ds-drawer-body">
              {drawer === 'stock' ? (
                <>
                  {madeNote ? <p className="ds-sheet-note is-done" role="status">{madeNote}</p> : null}
                  {focusGood && !picked ? (
                    <p className={`ds-sheet-note ${focusReady ? 'is-ok' : ''}`}>
                      {focusGood.item.name}・庫存 {focusGood.stock}/{shelf}
                      {focusGood.job ? `・製作中，剩 ${focusGood.remain} 秒` : `・製作約 ${focusGood.seconds} 秒`}
                      {focusHint ? ` ${focusHint}` : ''}
                    </p>
                  ) : null}
                  <div className="ds-filters">
                    {CATEGORIES.map((item) => (
                      <button key={item.id} type="button" className={goodsFilter === item.id ? 'is-on' : ''} onClick={() => setGoodsFilter(item.id)}>{item.label}</button>
                    ))}
                  </div>
                  <ul className="ds-sheet-list" ref={sheetListRef}>
                    {liveProducts().filter((item) => goodsFilter === 'all' || item.category === goodsFilter).map((item) => {
                      const row = describeGood(item.id)
                      return (
                        <li key={item.id} ref={(el) => { if (el) sheetRowRef.current.set(item.id, el); else sheetRowRef.current.delete(item.id) }} className={`${row.locked ? 'is-locked' : ''} ${row.job ? 'is-making' : ''} ${focusId === item.id ? 'is-focus' : ''}`}>
                          <span className="ds-pic"><ProductIcon id={item.id} size={40} /></span>
                          <div>
                            <b>{item.name}</b>
                            <small>{row.locked ? `店面 Lv.${item.unlock} 解鎖` : `庫存 ${row.stock}/${shelf}・${row.seconds} 秒・可做 ${row.batch}`}</small>
                            {row.locked ? null : <span className="ds-stockpips">{Array.from({ length: shelf }, (_, i) => <i key={i} data-on={i < row.stock} />)}</span>}
                            {row.job ? <span className="ds-k-bar"><i style={{ width: `${row.progress * 100}%` }} /></span> : null}
                          </div>
                          {row.locked ? <span className="ds-lock">Lv.{item.unlock}</span> : (
                            <button type="button" className="ds-make" disabled={Boolean(row.job) || row.full} onClick={() => onMake(item.id)}>
                              {row.job ? `${row.remain} 秒` : row.full ? '已滿' : `製作 ×${row.batch}`}
                            </button>
                          )}
                        </li>
                      )
                    })}
                    <li className="ds-sheet-foot"><p className="ds-note">耐心剩 {Math.round(QUICK_TIP_FRACTION * 100)}% 以上，小費為售價的 {Math.round(QUICK_TIP_RATE * 100)}%。連續每 {STREAK_EVERY} 位 +{STREAK_BONUS}。目前連續 {p.stats.streak} 位。</p></li>
                  </ul>
                </>
              ) : null}

              {drawer === 'street' ? (
                <>
                  <section className={`ds-upgrade ${up.ok ? 'is-ready' : ''}`} aria-label="店面升級">
                    <h3>店面升級<small>Lv.{p.shopLevel} / {MAX_SHOP_LEVEL}</small></h3>
                    {up.spec ? (
                      <>
                        <p className="ds-up-title">下一級：<b>{up.spec.name}</b></p>
                        <ul className="ds-up-list">
                          {[
                            ['貨架容量', `${spec.shelf}`, `${up.spec.shelf}`],
                            ['每批製作', `${spec.batch}`, `${up.spec.batch}`],
                            ['工作台', `${spec.stations}`, `${up.spec.stations}`],
                            ['製作速度', `${Math.round(100 / spec.speed)}%`, `${Math.round(100 / up.spec.speed)}%`],
                            ['顧客耐心', `${spec.patienceMs / 1000} 秒`, `${up.spec.patienceMs / 1000} 秒`],
                            ['排隊位置', `${spec.queue}`, `${up.spec.queue}`],
                            ['售價加成', `×${spec.priceMul.toFixed(1)}`, `×${up.spec.priceMul.toFixed(1)}`],
                          ].map(([label, a, b]) => (
                            <li key={label} data-diff={a !== b}><span>{label}</span><b>{a}</b><em>{b}</em></li>
                          ))}
                        </ul>
                        {liveProducts().filter((item) => item.unlock === up.spec!.level).map((item) => (
                          <p key={item.id} className="ds-up-new"><ProductIcon id={item.id} size={26} />新商品：{item.name}</p>
                        ))}
                        <ul className="ds-up-req">
                          <li data-ok={rank.rank >= up.spec.needRank}>店長 Lv.{up.spec.needRank}（目前 Lv.{rank.rank}）</li>
                          <li data-ok={p.coins >= up.spec.cost}>{up.spec.cost.toLocaleString()} 金幣（目前 {p.coins.toLocaleString()}）</li>
                        </ul>
                        <button type="button" className="ds-cta" disabled={!up.ok} onClick={onUpgrade}>
                          {up.ok ? `花 ${up.spec.cost.toLocaleString()} 金幣升級` : up.reason === 'rank' ? `店長需要 Lv.${up.spec.needRank}` : `還差 ${(up.spec.cost - p.coins).toLocaleString()} 金幣`}
                        </button>
                      </>
                    ) : <p className="ds-empty">已經是最高等級的夢想旗艦店。</p>}
                  </section>
                  <ul className="ds-lots">
                    {STREET_BUILDINGS.map((item) => {
                      const owned = p.buildings.includes(item.id)
                      const gate = buildingCheck(p, item.id)
                      return (
                        <li key={item.id} className={owned ? 'is-owned' : ''}>
                          <img src={icon(item.id === 'tea' ? 'cake' : 'gift')} alt="" />
                          <div>
                            <b>{item.name}</b>
                            <p>{item.bonus}</p>
                            {owned ? null : <span className="ds-k-lock">店面 Lv.{item.needShop}・店長 Lv.{item.needRank}・{item.cost} 金幣</span>}
                          </div>
                          {owned ? <span className="ds-equipped">{shopBadges[item.id]?.text ?? '已開幕'}</span> : (
                            <button type="button" className="ds-make" disabled={!gate.ok} onClick={() => onUnlockLot(item.id)}>
                              {gate.ok ? '開幕' : gate.reason}
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </>
              ) : null}

              {drawer === 'decor' ? (
                <>
                  <div className="ds-decor-shops" role="group" aria-label="選擇要裝潢的店">
                    {shops.map((shop) => (
                      <button key={shop} type="button" className={pickShop === shop ? 'is-on' : ''} aria-pressed={pickShop === shop} style={{ '--tone': SHOP_TAG[shop].tone } as CSSProperties} onClick={() => onPickDecorShop(shop)}>
                        {shopName(p, shop)}
                        <small>{shopDecor(p, shop) ? decorSpec(shopDecor(p, shop)!).name : '尚未裝潢'}</small>
                      </button>
                    ))}
                  </div>
                  {previewSpec ? (
                    <div className="ds-preview-bar">
                      <span>預覽「{previewSpec.name}」{previewSpec.slot === 'shop' ? `→ ${shopName(p, pickShop)}` : '→ 整條街'}{p.ownedDecors.includes(previewSpec.id) ? '・已收藏，套用免費' : `・${previewSpec.cost} 金幣`}</span>
                      <button type="button" className="ds-mini" onClick={() => setDecorPreview(null)}>取消預覽</button>
                      <button type="button" className="ds-make" disabled={equippedHere(previewSpec.id) || (decorGate ? !decorGate.ok : true)} onClick={onConfirmDecor}>
                        {equippedHere(previewSpec.id) ? '使用中' : p.ownedDecors.includes(previewSpec.id) ? '套用' : decorGate?.ok ? '收藏並套用' : decorGate?.reason ?? '無法套用'}
                      </button>
                    </div>
                  ) : <p className="ds-sheet-note">先選店，再點「預覽」看效果；確認後才扣金幣。每間店的店面裝潢各自保存，已收藏的裝潢套到別間店免費。</p>}
                  <ul className="ds-decors">
                    {STREET_DECORS.filter((item) => decorFits(item.id, pickShop)).map((item) => {
                      const owned = p.ownedDecors.includes(item.id)
                      const equipped = equippedHere(item.id)
                      const previewing = decorPreview === item.id
                      const gate = decorCheck(p, item.id, pickShop)
                      return (
                        <li key={item.id} className={previewing ? 'is-preview' : equipped ? 'is-on' : owned ? 'is-owned' : ''}>
                          <span className="ds-decor-slot">{item.slot === 'shop' ? SHOP_TAG[pickShop].label : '整條街'}</span>
                          <b>{item.name}</b>
                          <small>{item.blurb}</small>
                          <span className="ds-k-lock">{owned ? (equipped ? '使用中' : '已收藏') : gate.ok ? <><img src={icon('coin')} alt="" />{item.cost}</> : gate.reason}</span>
                          <div className="ds-decor-actions">
                            <button type="button" className="ds-mini" aria-pressed={previewing} onClick={() => (previewing ? setDecorPreview(null) : onPreviewDecor(item.id))}>{previewing ? '取消' : '預覽'}</button>
                            {equipped ? <button type="button" className="ds-mini" onClick={() => onClearDecor(item.slot)}>卸下</button> : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </>
              ) : null}

              {drawer === 'log' ? (
                <>
                  {!visitingOther ? (
                    <div className="ds-live">
                      <LiveEventsBoard authUserId={authUserId} onNeedLogin={onNeedLogin} game="dream_street" />
                    </div>
                  ) : null}
                  <dl className="ds-stats">
                    <div><dt>今日服務</dt><dd>{today.served}</dd></div>
                    <div><dt>今日收入</dt><dd>{today.earned.toLocaleString()}</dd></div>
                    <div><dt>今日錯過</dt><dd>{today.missed}</dd></div>
                    <div><dt>累計服務</dt><dd>{p.stats.served}</dd></div>
                    <div><dt>累計收入</dt><dd>{p.stats.earned.toLocaleString()}</dd></div>
                    <div><dt>最佳連續</dt><dd>{p.stats.bestStreak}</dd></div>
                  </dl>
                  {p.log.length ? (
                    <ol className="ds-loglist">
                      {p.log.map((entry, i) => (
                        <li key={`${entry.at}-${i}`} data-kind={entry.kind}>
                          <time>{clockText(entry.at)}</time>
                          <span>{entry.text}</span>
                          {entry.coins ? <b>{entry.kind === 'serve' || entry.kind === 'help' ? '+' : '-'}{entry.coins.toLocaleString()}</b> : null}
                        </li>
                      ))}
                    </ol>
                  ) : <p className="ds-empty">開始營業後，這裡會記錄每筆交易。</p>}
                  <p className="ds-footnote">夢想金幣與經驗值只在夢想商店街內使用，不能兌換 Pay 點數、優惠券或任何商品，也不影響真實訂單與庫存。經營進度只保存在此瀏覽器。公開給朋友的是另外一份店面與裝潢，不會覆蓋這份存檔。{!authUserId ? ' 你目前是訪客。' : ''}</p>
                </>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
