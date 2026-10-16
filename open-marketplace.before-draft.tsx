'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AdminAuthModal, AdminSecurityBanner, ADMIN_MAX_ATTEMPTS } from './admin-security'
import { InstallAppButton } from './install-app-guide'
import { MobileTabBar } from './mobile-tab-bar'
import { SellerGateModal } from './seller-gate-modal'
import { WelcomePromoModal } from './welcome-promo-modal'
import { TermsModal } from './terms-modal'
import { EcpayEscrowNotice, HighPriceSafetyTags, PayoutStatus, HIGH_PRICE_LIMIT, REVIEW_PRICE_LIMIT } from './escrow-notice'
import { SecurityPanel, ForgotPasswordModal } from './account-security'
import { SupportCenter, AdminTicketsPanel, type SupportTicket } from './support-center'
import { OnboardingTour } from './onboarding-tour'
import { BuyerProfileHeader, BuyerProfilePanel, FavoritesPanel, FollowingPanel, UserAvatar, type FollowPrefs } from './buyer-profile'
import { EvidenceThumbs, EvidenceUploader } from './evidence-uploader'
import { SubscriptionManager } from './subscription-cancel'
import {
  Baby,
  BadgeCheck,
  Ban,
  Banknote,
  Bell,
  BookOpen,
  CalendarCheck,
  Check,
  ArrowLeft,
  Coins,
  Copy,
  Gift,
  Headset,
  Medal,
  Ticket,
  Timer,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Footprints,
  House,
  Mail,
  PawPrint,
  Shirt,
  Camera,
  Wrench,
  UtensilsCrossed,
  CircleAlert,
  ClipboardList,
  Clock,
  CreditCard,
  Download,
  Eye,
  FileText,
  Flag,
  Heart,
  ImageOff,
  Landmark,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogIn,
  LogOut,
  MapPin,
  Megaphone,
  MessageCircle,
  Minus,
  Package,
  Pencil,
  Plus,
  Receipt,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Star,
  Store,
  Trash2,
  TriangleAlert,
  TrendingUp,
  Truck,
  Undo2,
  Upload,
  Crown,
  Sparkles,
  FileSpreadsheet,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { VariantEditor, parseOptions, isSizeName } from '@/components/variant-editor'

/* ----------------------------------------------------------------------------
 * 型別
 * -------------------------------------------------------------------------- */

type Role = 'buyer' | 'seller' | 'admin'
type VerifyStatus = 'approved' | 'pending' | 'rejected'
type PlanStatus = 'active' | 'trial' | 'due' | 'verifying' | 'overdue' | 'grace' | 'suspended'
type PayMethod = 'card' | 'atm'
type ShipKey = 'home' | 'seven' | 'family'

interface Plan {
  status: PlanStatus
  periodStart: string
  nextDate: string
  method: PayMethod
  cardLast4?: string
  autoPay: boolean
  failedAt?: string
  graceElapsed?: number
  trialLeft?: number
  cancelAtPeriodEnd?: boolean
}

interface BusinessInfo {
  kind: 'individual' | 'company'
  legalName: string
  taxId: string
  address: string
  phone: string
  email: string
  line: string
  hours: string
}

interface InvoiceOpt {
  type: 'personal' | 'company'
  carrier: string
  email: string
  taxId: string
  title: string
}

interface Coupon {
  id: string
  sellerId: string
  code: string
  amount: number
  minSpend: number
  qty: number
  redeemed: number
  usedOrders: number
  listed: boolean
  cost: number
  active: boolean
}

interface WalletEntry {
  id: string
  couponId: string
  code: string
  sellerId: string
  amount: number
  minSpend: number
  claimedAt: string
  expiresAt: string
  usedAt?: string
  orderId?: string
}

type WalletStatus = 'unused' | 'used' | 'expired'

interface RemitProof {
  last5: string
  fileName?: string
  at: string
  ref: string
}

interface PaymentSettings {
  bankCode: string
  bankAccount: string
  bankHolder: string
  linePayQr?: string
  jkoQr?: string
  gateway?: { provider: 'ecpay' | 'newebpay'; merchantId: string; hashKey: string; hashIv: string }
}

interface KycInfo {
  kind: 'individual' | 'company'
  idVerified: boolean
  phone: string
  phoneVerified: boolean
  bankVerified: boolean
}

interface ScamReport {
  id: string
  orderId: string
  sellerId: string
  buyer: string
  at: string
  reason: string
}

interface BlacklistEntry {
  id: string
  sellerId: string
  storeName: string
  idNo: string
  bankAccount: string
  phone: string
  at: string
}

interface LedgerEntry {
  id: string
  delta: number
  label: string
  at: string
}

interface ExportLog {
  id: string
  sellerId: string
  kind: 'products' | 'orders'
  rows: number
  at: string
}

interface PayResult {
  amount: number
  invoiceNo: string
  invoice: InvoiceOpt
  wasClosed: boolean
  wasTrial: boolean
  method: PayMethod
}

type RefundType = 'return' | 'refundOnly'
type RefundStatus = 'pending' | 'accepted' | 'rejected'

interface RefundRequest {
  type: RefundType
  reason: string
  note: string
  at: string
  status: RefundStatus
}

interface Seller {
  id: string
  name: string
  owner: string
  idNo: string
  docName: string
  docUrl?: string
  verify: VerifyStatus
  rejectReason?: string
  appliedAt: string
  rating: number
  followers: number
  tagline: string
  city: string
  logoClass: string
  logo?: string
  bannerClass: string
  gmvBase: number
  plan: Plan
  suspended?: boolean
  suspendReason?: string
  business?: BusinessInfo
  payment?: PaymentSettings
  kyc?: KycInfo
  shipDays?: number
  banned?: boolean
  founderNo?: number
}

interface Viewer {
  name: string
  tone: number
  avatar?: string
}

interface Review {
  owner?: string
  user: string
  rating: number
  text: string
  date: string
}

interface VariantGroup {
  name: string
  options: string[]
}

interface Product {
  id: string
  sellerId: string
  name: string
  category: string
  subCategory?: string
  price: number
  image: string
  variants: VariantGroup[]
  stock: number
  sold: number
  specs: [string, string][]
  desc: string
  reviews: Review[]
  active: boolean
  flagged?: boolean
  flagReason?: string
  reviewHold?: boolean
  reviewApproved?: boolean
  optionStock?: Record<string, number>
  optionPrice?: Record<string, number>
  comboStock?: Record<string, number>
  comboPrice?: Record<string, number>
}

interface CartLine {
  key: string
  productId: string
  variant: Record<string, string>
  qty: number
}

interface OrderItem {
  productId?: string
  name: string
  variant: string
  qty: number
  price: number
}

interface SmsMessage {
  id: string
  sellerId: string
  kind: 'order' | 'paid' | 'report'
  text: string
  at: string
  }

  interface SellerNotice {
  id: string
  sellerId: string
  kind: 'reported' | 'dismissed' | 'confirmed' | 'appeal_approved' | 'appeal_rejected'
  productId?: string
  productName: string
  title: string
  text: string
  at: string
  read: boolean
  }

type AppealStatus = 'pending' | 'approved' | 'rejected'

interface Appeal {
  id: string
  sellerId: string
  kind: 'product' | 'ban' | 'seller'
  productId?: string
  productName: string
  text: string
  at: string
  status: AppealStatus
  reply?: string
}

interface ReviewInput {
  rating: number
  text: string
}

type ReportReason = 'prohibited' | 'fake' | 'price' | 'ip' | 'mismatch' | 'other'
type ReportStatus = 'open' | 'dismissed' | 'confirmed'

interface Report {
  id: string
  productId: string
  sellerId: string
  productName: string
  productImage: string
  reason: ReportReason
  note: string
  reporter: string
  at: string
  status: ReportStatus
  reporterType?: 'buyer' | 'brand'
  contact?: string
  targetType?: 'product' | 'seller'
  evidence?: string[]
  reporterAccount?: string
  ts?: number
}

interface Order {
  id: string
  sellerId: string
  buyer: string
  items: OrderItem[]
  subtotal: number
  shipping: number
  total: number
  pay: PayMethod
  payStatus: '已付款' | '待匯款'
  status: '待出貨' | '已出貨' | '已完成'
  date: string
  shipMethod: ShipKey
  shipTo: string
  tracking?: string
  live?: boolean
  owner?: string
  stage?: number
  reviewed?: boolean
  refund?: RefundRequest
  discount?: number
  couponCode?: string
  remit?: RemitProof
  nudgedAt?: string
  scamReported?: boolean
}

interface Payment {
  id: string
  sellerId: string
  date: string
  amount: number
  method: PayMethod
  status: '已付款' | '核銷中'
  invoice: string
  invoiceMeta?: string
}

interface CardForm {
  number: string
  holder: string
  exp: string
  cvc: string
}

interface CheckoutPayload {
  pay: PayMethod
  ship: ShipKey
  shipTo: string
  buyer: string
  coupon?: { id: string; code: string; sellerId: string; discount: number }
  sellerIds?: string[]
}

/* ----------------------------------------------------------------------------
 * 常數與種子資料
 * -------------------------------------------------------------------------- */

const PLAN_PRICE = 599
const FREE_SHIP = 299
const GRACE_DAYS = 3

interface CategoryMain {
  label: string
  subs: string[]
}
interface CategoryFamily {
  id: string
  label: string
  icon: typeof Shirt
  mains: CategoryMain[]
}

const CATEGORY_FAMILIES: CategoryFamily[] = [
  {
    id: 'fashion',
    label: '服飾美妝',
    icon: Shirt,
    mains: [
      { label: '女生衣著', subs: ['上衣 / T 恤', '洋裝 / 裙子', '褲裝', '外套', '內著 / 睡衣'] },
      { label: '男生衣著', subs: ['上衣 / T 恤', '襯衫', '褲裝', '外套', '內著 / 睡衣'] },
      { label: '美妝保健', subs: ['臉部保養', '彩妝', '香氛身體', '保健食品', '個人清潔'] },
    ],
  },
  {
    id: 'digital',
    label: '3C 家電',
    icon: Smartphone,
    mains: [
      { label: '3C 數位', subs: ['耳機 / 喇叭', '鍵盤 / 滑鼠', '電腦週邊', '相機 / 空拍機', '遊戲主機'] },
      { label: '手機配件', subs: ['手機殼 / 保護貼', '充電線 / 充電器', '行動電源', '藍牙配件'] },
      { label: '家電館', subs: ['廚房家電', '生活家電', '個人家電', '影音家電'] },
    ],
  },
  {
    id: 'home',
    label: '居家百貨',
    icon: House,
    mains: [
      { label: '居家生活', subs: ['餐廚用品', '花瓶 / 擺飾', '寢具 / 家飾', '衛浴用品'] },
      { label: '日用百貨', subs: ['清潔用品', '收納小物', '雨具 / 傘', '五金工具'] },
      { label: '家具收納', subs: ['桌椅', '櫃架', '收納箱 / 收納盒', '床架 / 床墊'] },
    ],
  },
  {
    id: 'bags',
    label: '鞋包運動',
    icon: Footprints,
    mains: [
      { label: '鞋包配飾', subs: ['女鞋', '男鞋', '包包', '帽子 / 配件', '飾品 / 手錶'] },
      { label: '運動戶外', subs: ['登山露營', '健身重訓', '球類運動', '單車 / 路跑', '運動服飾'] },
    ],
  },
  {
    id: 'food',
    label: '美食伴手禮',
    icon: UtensilsCrossed,
    mains: [
      { label: '美食美味', subs: ['茶飲沖泡', '咖啡', '米麵糧油', '調味醬料', '冷凍食品'] },
      { label: '零食伴手禮', subs: ['餅乾 / 糖果', '堅果果乾', '禮盒', '在地名產'] },
    ],
  },
  {
    id: 'kids',
    label: '母嬰玩具',
    icon: Baby,
    mains: [
      { label: '母嬰用品', subs: ['奶瓶餵食', '尿布 / 濕巾', '嬰兒推車', '孕婦用品'] },
      { label: '玩具童裝', subs: ['積木 / 桌遊', '玩偶公仔', '童裝', '童鞋'] },
    ],
  },
  {
    id: 'pets',
    label: '寵物',
    icon: PawPrint,
    mains: [
      { label: '寵物用品', subs: ['貓咪用品', '狗狗用品', '水族 / 小動物', '清潔用品'] },
      { label: '寵物食品', subs: ['貓飼料 / 罐頭', '狗飼料 / 罐頭', '零食點心', '保健品'] },
    ],
  },
  {
    id: 'media',
    label: '文娛汽機車',
    icon: BookOpen,
    mains: [
      { label: '圖書文具', subs: ['書籍', '雜誌 / 漫畫', '筆記本 / 手帳', '辦公文具'] },
      { label: '娛樂影音', subs: ['CD / 黑膠', '電影 / 影集', '遊戲軟體', '樂器'] },
      { label: '汽機車零件', subs: ['汽車百貨', '機車配件', '安全帽', '保養油品'] },
    ],
  },
  {
    id: 'hardware',
    label: '五金',
    icon: Wrench,
    mains: [
      { label: '五金工具', subs: ['手工具', '電動工具', '螺絲 / 五金零件', '測量工具'] },
      { label: '水電建材', subs: ['水電材料', '門窗鎖具', '油漆 / 黏著劑', '燈具 / 開關'] },
    ],
  },
  {
    id: 'photo',
    label: '攝影影音',
    icon: Camera,
    mains: [
      { label: '相機鏡頭', subs: ['數位相機', '鏡頭', '底片 / 即可拍', '空拍機 / 運動相機'] },
      { label: '攝影配件', subs: ['腳架 / 雲台', '記憶卡 / 電池', '相機包', '補光燈 / 麥克風'] },
    ],
  },
]

const ALL_MAINS = CATEGORY_FAMILIES.flatMap((f) => f.mains.map((m) => ({ ...m, familyId: f.id })))
const CATEGORIES: string[] = ALL_MAINS.map((m) => m.label)
const subsOfMain = (main: string) => ALL_MAINS.find((m) => m.label === main)?.subs ?? []
const familyOfMain = (main: string) => CATEGORY_FAMILIES.find((f) => f.mains.some((m) => m.label === main))
const DEFAULT_MAIN = '居家生活'

interface CategorySel {
  family: string | null
  main: string | null
  sub: string | null
}
const NO_CATEGORY: CategorySel = { family: null, main: null, sub: null }
const matchCategory = (p: Product, sel: CategorySel) => {
  if (sel.main && sel.sub) return p.category === sel.main && p.subCategory === sel.sub
  if (sel.main) return p.category === sel.main
  if (sel.family) return familyOfMain(p.category)?.id === sel.family
  return true
}
const categoryOfProduct = (p: Product): CategorySel => ({
  family: familyOfMain(p.category)?.id ?? null,
  main: p.category,
  sub: null,
})
const VIEWS = [
  { label: '主圖', cls: '' },
  { label: '細節一', cls: 'scale-[1.8] origin-top-left' },
  { label: '細節二', cls: 'scale-[1.8] origin-bottom-right' },
]
const SHIP: Record<ShipKey, { label: string; fee: number; hint: string }> = {
  home: { label: '宅配到府', fee: 100, hint: '2-3 個工作天送達' },
  seven: { label: '7-11 超商取貨', fee: 60, hint: '到店後 7 天內取貨' },
  family: { label: '全家超商取貨', fee: 60, hint: '到店後 7 天內取貨' },
}
const STORES: Record<'seven' | 'family', { id: string; name: string; addr: string }[]> = {
  seven: [
    { id: '7-1', name: '信義威秀門市', addr: '台北市信義區松壽路 20 號' },
    { id: '7-2', name: '忠孝復興門市', addr: '台北市大安區忠孝東路四段 101 號' },
    { id: '7-3', name: '板橋文化門市', addr: '新北市板橋區文化路一段 188 號' },
    { id: '7-4', name: '台中逢甲門市', addr: '台中市西屯區文華路 85 號' },
    { id: '7-5', name: '高雄巨蛋門市', addr: '高雄市左營區博愛二路 777 號' },
  ],
  family: [
    { id: 'f-1', name: '南京松江店', addr: '台北市中山區南京東路二段 96 號' },
    { id: 'f-2', name: '公館水源店', addr: '台北市中正區羅斯福路四段 136 號' },
    { id: 'f-3', name: '桃園中壢店', addr: '桃園市中壢區中正路 220 號' },
    { id: 'f-4', name: '台南成大店', addr: '台南市東區大學路 1 號' },
    { id: 'f-5', name: '新竹竹北店', addr: '新竹縣竹北市光明六路 55 號' },
  ],
}

const IMAGE_OPTIONS = [
  { id: 'mug', label: '陶瓷杯', src: '/products/mug.png' },
  { id: 'bowl', label: '陶瓷碗', src: '/products/bowl.png' },
  { id: 'vase', label: '花瓶', src: '/products/vase.png' },
  { id: 'earbuds', label: '耳機', src: '/products/earbuds.png' },
  { id: 'keyboard', label: '鍵盤', src: '/products/keyboard.png' },
  { id: 'speaker', label: '喇叭', src: '/products/speaker.png' },
  { id: 'backpack', label: '背包', src: '/products/backpack.png' },
  { id: 'lantern', label: '營燈', src: '/products/lantern.png' },
  { id: 'tea', label: '茶葉', src: '/products/tea.png' },
]

const RETURN_POLICY = [
  '享 7 天鑑賞期（非試用期），商品需保持全新、包裝與配件完整。',
  '客製化商品、已拆封食品及貼身用品恕不接受退換。',
  '商品有瑕疵或寄送錯誤，賣家負擔來回運費並於 3 個工作天內處理。',
  '退款將依原付款方式退回，信用卡約 7-14 個工作天，ATM 轉帳約 3-5 個工作天。',
]

const REVIEW_POOL: Review[] = [
  { user: '小鹿***', rating: 5, text: '質感比照片更好，包裝也很用心，會回購！', date: '2026-10-02' },
  { user: 'Ken_L', rating: 5, text: '出貨快速，賣家回覆也很親切，整體體驗很棒。', date: '2026-09-27' },
  { user: '阿梅', rating: 4, text: '整體滿意，顏色和照片略有色差，但可以接受。', date: '2026-09-19' },
  { user: 'Joyce W.', rating: 5, text: '買來送人，朋友收到很喜歡，包裝直接就能送禮。', date: '2026-09-11' },
  { user: '大衛', rating: 4, text: 'CP 值不錯，物流稍慢了一天，但商品沒問題。', date: '2026-08-30' },
  { user: 'Mia', rating: 5, text: '客服解答很詳細，商品拿到手比預期更紮實。', date: '2026-08-21' },
]
const pickReviews = (offset: number, count = 3): Review[] =>
  Array.from({ length: count }, (_, i) => REVIEW_POOL[(offset + i) % REVIEW_POOL.length])

const SEED_SELLERS: Seller[] = [
  {
    id: 's1',
    name: '森日手作陶坊',
    owner: '林佳穎',
    idNo: 'A223456789',
    docName: 'id-front-lin.jpg',
    verify: 'approved',
    appliedAt: '2025-11-02',
    founderNo: 1,
    rating: 4.9,
    followers: 12840,
    tagline: '每一件都是手拉坯，日常用得到的溫度。',
    city: '台中',
    logoClass: 'bg-primary text-primary-foreground',
    bannerClass: 'from-orange-400 via-orange-300 to-amber-200',
    gmvBase: 418600,
    plan: { status: 'active', periodStart: '2026-10-03', nextDate: '2026-11-03', method: 'card', cardLast4: '4242', autoPay: true },
    business: { kind: 'individual', legalName: '林佳穎', taxId: '', address: '台中市西區向上路一段 88 號', phone: '04-2222-8800', email: 'service@senri-pottery.example', line: '@senri', hours: '週一至週五 10:00–18:00' },
  },
  {
    id: 's2',
    name: '光速數位站',
    owner: '陳冠宇',
    idNo: '53218764',
    docName: 'company-reg-chen.pdf',
    verify: 'approved',
    appliedAt: '2025-12-14',
    founderNo: 2,
    rating: 4.7,
    followers: 8420,
    tagline: '嚴選 3C 配件，原廠保固、七天到貨。',
    city: '台北',
    logoClass: 'bg-foreground text-card',
    bannerClass: 'from-slate-700 via-slate-500 to-orange-300',
    gmvBase: 672300,
    plan: { status: 'due', periodStart: '2026-09-10', nextDate: '2026-10-10', method: 'card', cardLast4: '1881', autoPay: false },
    business: { kind: 'company', legalName: '光速數位股份有限公司', taxId: '53218764', address: '台北市內湖區瑞光路 512 號 6 樓', phone: '02-2790-1188', email: 'cs@lightspeed.example', line: '@lightspeed', hours: '週一至週六 09:30–19:00' },
  },
  {
    id: 's3',
    name: '山嵐戶外選物',
    owner: '王建宏',
    idNo: 'H123987654',
    docName: 'id-front-wang.jpg',
    verify: 'approved',
    appliedAt: '2026-02-20',
    founderNo: 3,
    rating: 4.8,
    followers: 5316,
    tagline: '從城市到山頂，裝備替你準備好。',
    city: '新竹',
    logoClass: 'bg-emerald-700 text-card',
    bannerClass: 'from-emerald-600 via-emerald-400 to-orange-200',
    gmvBase: 195400,
    plan: { status: 'active', periodStart: '2026-10-20', nextDate: '2026-11-20', method: 'atm', autoPay: false },
    business: { kind: 'individual', legalName: '王建宏', taxId: '', address: '新竹市東區光復路二段 101 號', phone: '03-571-2200', email: 'hello@shanlan.example', line: '@shanlan', hours: '每日 10:00–21:00' },
  },
  {
    id: 's4',
    name: '青禾茶舖',
    owner: '張雅婷',
    idNo: '28764513',
    docName: 'company-reg-chang.pdf',
    verify: 'pending',
    appliedAt: '2026-10-12',
    rating: 0,
    followers: 0,
    tagline: '阿里山自家茶園直送。',
    city: '嘉義',
    logoClass: 'bg-amber-600 text-card',
    bannerClass: 'from-amber-500 via-yellow-300 to-orange-100',
    gmvBase: 0,
    plan: { status: 'trial', periodStart: '2026-10-12', nextDate: '2026-11-11', method: 'card', autoPay: false, trialLeft: 27 },
  },
]

const SEED_COUPONS: Coupon[] = [
  { id: 'c1', sellerId: 's1', code: 'SHOP50', amount: 50, minSpend: 500, qty: 50, redeemed: 38, usedOrders: 21, listed: true, cost: 100, active: true },
  { id: 'c2', sellerId: 's2', code: 'LIGHT100', amount: 100, minSpend: 1200, qty: 30, redeemed: 27, usedOrders: 14, listed: true, cost: 100, active: true },
  { id: 'c3', sellerId: 's3', code: 'GO80', amount: 80, minSpend: 800, qty: 100, redeemed: 21, usedOrders: 9, listed: true, cost: 100, active: true },
  { id: 'c4', sellerId: 's1', code: 'CLAY30', amount: 30, minSpend: 300, qty: 80, redeemed: 0, usedOrders: 6, listed: false, cost: 100, active: true },
  { id: 'c5', sellerId: 's2', code: 'WELCOME60', amount: 60, minSpend: 600, qty: 40, redeemed: 12, usedOrders: 8, listed: false, cost: 100, active: true },
]

const SEED_LEDGER: LedgerEntry[] = [
  { id: 'l2', delta: 10, label: '每日簽到（第 2 天）', at: '2026-10-14' },
  { id: 'l1', delta: 10, label: '每日簽到（第 1 天）', at: '2026-10-13' },
  { id: 'l0', delta: 100, label: '新手註冊禮', at: '2026-10-13' },
]

const CHECKIN_REWARDS = [10, 10, 15, 15, 20, 20, 50]
const MAX_LISTED_COUPONS = 3
const COUPON_DISCLAIMER =
  '本店鋪與簽到專區優惠券均由該賣家自主發行、履約與售後。本平台為獨立 SaaS 技術服務託管商，不經手交易金流與物流，亦不承擔履約與商品售後責任。'
const TAX_NOTE =
  '賣家於本平台之營業行為，應依中華民國稅法規定自行辦理稅籍登記與報稅，平台依法提供綠界月費發票。'
const couponRemain = (c: Coupon) => Math.max(0, c.qty - c.redeemed)
const WALLET_VALID_DAYS = 30
const addDays = (dateStr: string, n: number) => {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
const walletStatus = (w: WalletEntry): WalletStatus => (w.usedAt ? 'used' : w.expiresAt < new Date().toISOString().slice(0, 10) ? 'expired' : 'unused')
const SEED_WALLET: WalletEntry[] = [
  { id: 'w1', couponId: 'c5', code: 'WELCOME60', sellerId: 's2', amount: 60, minSpend: 600, claimedAt: '2026-09-20', expiresAt: '2026-10-20', usedAt: '2026-10-02', orderId: 'OD20261002008' },
  { id: 'w2', couponId: 'c4', code: 'CLAY30', sellerId: 's1', amount: 30, minSpend: 300, claimedAt: '2026-08-30', expiresAt: '2026-09-29' },
]

const SEED_PRODUCTS: Product[] = [
  {
    id: 'p1',
    sellerId: 's1',
    name: '手拉坯斑點陶瓷馬克杯',
    category: '居家生活',
    subCategory: '餐廚用品',
    price: 680,
    image: '/products/mug.png',
    variants: [
      { name: '顏色', options: ['奶油白', '燕麥灰'] },
      { name: '容量', options: ['300ml', '420ml'] },
    ],
    stock: 24,
    sold: 1280,
    specs: [
      ['材質', '高溫石陶（1250°C 燒製）'],
      ['產地', '台灣・台中'],
      ['保養', '可微波、可洗碗機'],
      ['重量', '約 320g'],
      ['注意', '每件手作略有差異，屬正常現象'],
    ],
    desc: '每件都經過手拉坯與兩次施釉，杯緣圓潤好入口，是晨間咖啡最好的搭檔。',
    reviews: pickReviews(0),
    active: true,
  },
  {
    id: 'p2',
    sellerId: 's1',
    name: '藍釉深口拉麵碗',
    category: '居家生活',
    subCategory: '餐廚用品',
    price: 520,
    image: '/products/bowl.png',
    variants: [{ name: '尺寸', options: ['6 吋', '7.5 吋'] }],
    stock: 18,
    optionStock: { '尺寸|6 吋': 18, '尺寸|7.5 吋': 0 },
    sold: 764,
    specs: [
      ['材質', '高溫石陶'],
      ['產地', '台灣・台中'],
      ['保養', '可微波、可洗碗機'],
      ['重量', '約 480g'],
    ],
    desc: '深口設計鎖住湯溫，藍色帶有自然流動的層次，端上桌就是風景。',
    reviews: pickReviews(2),
    active: true,
  },
  {
    id: 'p3',
    sellerId: 's1',
    name: '赤陶霧面花瓶',
    category: '居家生活',
    subCategory: '花瓶 / 擺飾',
    price: 1280,
    image: '/products/vase.png',
    variants: [{ name: '高度', options: ['20cm', '30cm'] }],
    stock: 9,
    sold: 212,
    specs: [
      ['材質', '赤陶（未上亮釉）'],
      ['產地', '台灣・台中'],
      ['防水', '內層已防水處理，可直接插花'],
      ['重量', '約 900g'],
    ],
    desc: '霧面質地吸光、不反光，搭配乾燥花或單枝綠葉都好看。',
    reviews: pickReviews(4),
    active: true,
  },
  {
    id: 'p4',
    sellerId: 's2',
    name: '降噪真無線藍牙耳機',
    category: '3C 數位',
    subCategory: '耳機 / 喇叭',
    price: 2490,
    image: '/products/earbuds.png',
    variants: [{ name: '顏色', options: ['霧白', '石墨黑'] }],
    stock: 36,
    sold: 2145,
    specs: [
      ['藍牙版本', '5.3'],
      ['降噪', '主動式降噪 ANC 40dB'],
      ['續航', '單次 8 小時 / 含充電盒 32 小時'],
      ['防水', 'IPX4'],
      ['保固', '原廠 1 年'],
    ],
    desc: '通勤降噪、通話清晰，Type-C 快充 10 分鐘可聽 2 小時。',
    reviews: pickReviews(1),
    active: true,
  },
  {
    id: 'p5',
    sellerId: 's2',
    name: '75% 無線機械鍵盤',
    category: '3C 數位',
    subCategory: '鍵盤 / 滑鼠',
    price: 3290,
    image: '/products/keyboard.png',
    variants: [{ name: '軸體', options: ['紅軸', '茶軸', '青軸'] }],
    stock: 12,
    sold: 689,
    specs: [
      ['配列', '75%（84 鍵）'],
      ['連線', '藍牙 5.1 / 2.4G / USB-C 有線'],
      ['熱插拔', '支援 5-pin 軸座'],
      ['電池', '4000mAh，約 120 小時'],
      ['保固', '原廠 1 年'],
    ],
    desc: '雙層消音棉與 gasket 結構，打字聲音沉穩，辦公室也能安心使用。',
    reviews: pickReviews(3),
    active: true,
  },
  {
    id: 'p6',
    sellerId: 's2',
    name: '圓筒防水藍牙喇叭',
    category: '3C 數位',
    subCategory: '耳機 / 喇叭',
    price: 1590,
    image: '/products/speaker.png',
    variants: [{ name: '顏色', options: ['炭灰'] }],
    stock: 5,
    sold: 431,
    specs: [
      ['輸出', '20W 雙單體'],
      ['防水', 'IP67'],
      ['續航', '約 14 小時'],
      ['保固', '原廠 1 年'],
    ],
    desc: '防水防塵、可串聯雙喇叭立體聲，戶外與浴室都適用。',
    reviews: pickReviews(5),
    active: true,
  },
  {
    id: 'p7',
    sellerId: 's3',
    name: '30L 防潑水登山後背包',
    category: '運動戶外',
    subCategory: '登山露營',
    price: 2380,
    image: '/products/backpack.png',
    variants: [{ name: '顏色', options: ['橄欖綠', '岩石灰'] }],
    stock: 15,
    sold: 536,
    specs: [
      ['容量', '30L'],
      ['材質', '210D 防潑水尼龍'],
      ['背負', '透氣背板 + 胸扣 + 腰扣'],
      ['重量', '約 980g'],
    ],
    desc: '附防雨罩與水袋隔層，一日行程與兩天一夜都能勝任。',
    reviews: pickReviews(0),
    active: true,
  },
  {
    id: 'p8',
    sellerId: 's3',
    name: '復古露營 LED 營燈',
    category: '運動戶外',
    subCategory: '登山露營',
    price: 890,
    image: '/products/lantern.png',
    variants: [{ name: '色溫', options: ['暖黃光', '白光'] }],
    stock: 40,
    sold: 1492,
    specs: [
      ['亮度', '最高 300 流明，三段調光'],
      ['續航', '低亮 50 小時 / 高亮 8 小時'],
      ['充電', 'USB-C，可當行動電源'],
      ['防水', 'IPX4'],
    ],
    desc: '提把可掛、底座可立，暖光營造營地氣氛，也是停電備用光源。',
    reviews: pickReviews(2),
    active: true,
  },
  {
    id: 'p9',
    sellerId: 's4',
    name: '阿里山高山烏龍茶',
    category: '美食美味',
    subCategory: '茶飲沖泡',
    price: 780,
    image: '/products/tea.png',
    variants: [{ name: '規格', options: ['150g 罐裝', '300g 兩入組'] }],
    stock: 50,
    sold: 0,
    specs: [
      ['產地', '嘉義・阿里山 1200m'],
      ['焙火', '輕焙'],
      ['保存期限', '24 個月'],
    ],
    desc: '自家茶園春茶，茶湯清甜、回甘明顯。',
    reviews: [],
    active: true,
  },
  {
    id: 'p10',
    sellerId: 's3',
    name: '家用五金工具組 42 件（附收納工具箱）',
    category: '五金工具',
    subCategory: '手工具',
    price: 690,
    image: '/products/toolset.png',
    variants: [{ name: '組合', options: ['基礎 42 件', '進階 68 件'] }],
    stock: 32,
    sold: 318,
    specs: [
      ['內容', '螺絲起子、鉗類、活動扳手、六角扳手、捲尺'],
      ['材質', '鉻釩鋼，表面防鏽處理'],
      ['收納', '耐衝擊塑膠工具箱'],
    ],
    desc: '組裝家具、修繕居家小物一次到位，附螺絲與壁虎分類盒。',
    reviews: pickReviews(3),
    active: true,
  },
  {
    id: 'p11',
    sellerId: 's2',
    name: '復古無反光鏡數位相機（含 35mm 定焦鏡頭）',
    category: '相機鏡頭',
    subCategory: '數位相機',
    price: 12800,
    image: '/products/camera.png',
    variants: [{ name: '機身顏色', options: ['經典黑', '銀黑雙色'] }],
    stock: 8,
    sold: 64,
    specs: [
      ['畫素', '2400 萬畫素 APS-C'],
      ['鏡頭', '35mm F1.8 定焦'],
      ['錄影', '4K 30p'],
      ['保固', '原廠 1 年'],
    ],
    desc: '復古外型搭配直覺轉盤操作，隨手拍出底片質感。',
    reviews: pickReviews(1),
    active: true,
  },
]

const DEMO_OWNER = '__demo_buyer__'

const SEED_ORDERS: Order[] = [
  {
    id: 'OD20261012001',
    sellerId: 's1',
    buyer: '小鹿***',
    items: [{ name: '手拉坯斑點陶瓷馬克杯', variant: '奶油白 / 300ml', qty: 2, price: 680 }],
    subtotal: 1360,
    shipping: 0,
    total: 1360,
    pay: 'card',
    payStatus: '已付款',
    status: '待出貨',
    date: '2026-10-12',
    shipMethod: 'home',
    shipTo: '台北市大安區和平東路 1 段 ***',
  },
  {
    id: 'OD20261011004',
    sellerId: 's1',
    buyer: 'Joyce W.',
    items: [{ name: '赤陶霧面花瓶', variant: '30cm', qty: 1, price: 1280 }],
    subtotal: 1280,
    shipping: 0,
    total: 1280,
    pay: 'atm',
    payStatus: '待匯款',
    status: '待出貨',
    date: '2026-10-11',
    shipMethod: 'seven',
    shipTo: '7-11 信義威秀門市',
  },
  {
    id: 'OD20261008002',
    sellerId: 's1',
    buyer: 'Mia',
    items: [{ name: '藍釉深口拉麵碗', variant: '7.5 吋', qty: 2, price: 520 }],
    subtotal: 1040,
    shipping: 0,
    total: 1040,
    pay: 'card',
    payStatus: '已付款',
    status: '已完成',
    date: '2026-10-08',
    shipMethod: 'home',
    shipTo: '新北市板橋區文化路 ***',
    tracking: 'TW4410288731',
  },
  {
    id: 'OD20261013003',
    sellerId: 's2',
    buyer: 'Ken_L',
    items: [{ name: '75% 無線機械鍵盤', variant: '茶軸', qty: 1, price: 3290 }],
    subtotal: 3290,
    shipping: 0,
    total: 3290,
    pay: 'card',
    payStatus: '已付款',
    status: '待出貨',
    date: '2026-10-13',
    shipMethod: 'family',
    shipTo: '全家 南京松江店',
  },
  {
    id: 'OD20261009006',
    sellerId: 's2',
    buyer: '大衛',
    items: [{ name: '降噪真無線藍牙耳機', variant: '石墨黑', qty: 1, price: 2490 }],
    subtotal: 2490,
    shipping: 0,
    total: 2490,
    pay: 'card',
    payStatus: '已付款',
    status: '已出貨',
    date: '2026-10-09',
    shipMethod: 'home',
    shipTo: '台中市西屯區文華路 ***',
    tracking: 'TW4410299120',
  },
  {
    id: 'OD20261010007',
    sellerId: 's3',
    buyer: '阿梅',
    items: [
      { name: '30L 防潑水登山後背包', variant: '橄欖綠', qty: 1, price: 2380 },
      { name: '復古露營 LED 營燈', variant: '暖黃光', qty: 1, price: 890 },
    ],
    subtotal: 3270,
    shipping: 0,
    total: 3270,
    pay: 'card',
    payStatus: '已付款',
    status: '待出貨',
    date: '2026-10-10',
    shipMethod: 'home',
    shipTo: '新竹縣竹北市光明六路 ***',
  },
  {
    id: 'OD20261014108',
    sellerId: 's2',
    owner: DEMO_OWNER,
    buyer: '測試買家',
    items: [{ productId: 'p6', name: '圓筒防水藍牙喇叭', variant: '深海藍', qty: 1, price: 1590 }],
    subtotal: 1590,
    shipping: 0,
    total: 1590,
    pay: 'atm',
    payStatus: '待匯款',
    status: '待出貨',
    date: '2026-10-14',
    shipMethod: 'home',
    shipTo: '台北市中山區南京東路 2 段 ***',
  },
  {
    id: 'OD20261013109',
    sellerId: 's1',
    owner: DEMO_OWNER,
    buyer: '測試買家',
    items: [{ productId: 'p2', name: '藍釉深口拉麵碗', variant: '7.5 吋', qty: 2, price: 520 }],
    subtotal: 1040,
    shipping: 0,
    total: 1040,
    pay: 'card',
    payStatus: '已付款',
    status: '待出貨',
    date: '2026-10-13',
    shipMethod: 'seven',
    shipTo: '7-11 台北車站門市',
  },
  {
    id: 'OD20261010110',
    sellerId: 's3',
    owner: DEMO_OWNER,
    buyer: '測試買家',
    items: [{ productId: 'p7', name: '30L 防潑水登山後背包', variant: '岩灰', qty: 1, price: 2380 }],
    subtotal: 2380,
    shipping: 0,
    total: 2380,
    pay: 'card',
    payStatus: '已付款',
    status: '已出貨',
    date: '2026-10-10',
    shipMethod: 'seven',
    shipTo: '7-11 板橋文化門市',
    tracking: 'TW4410305512',
    stage: 2,
  },
  {
    id: 'OD20261005111',
    sellerId: 's2',
    owner: DEMO_OWNER,
    buyer: '測試買家',
    items: [{ productId: 'p4', name: '降噪真無線藍牙耳機', variant: '石墨黑', qty: 1, price: 2490 }],
    subtotal: 2490,
    shipping: 0,
    total: 2490,
    pay: 'card',
    payStatus: '已付款',
    status: '已完成',
    date: '2026-10-05',
    shipMethod: 'home',
    shipTo: '台北市大安區和平東路 1 段 ***',
    tracking: 'TW4410271208',
    stage: 3,
  },
  {
    id: 'OD20261001112',
    sellerId: 's1',
    owner: DEMO_OWNER,
    buyer: '測試買家',
    items: [{ productId: 'p1', name: '手拉坯斑點陶瓷馬克杯', variant: '奶油白 / 300ml', qty: 2, price: 680 }],
    subtotal: 1360,
    shipping: 0,
    total: 1360,
    pay: 'card',
    payStatus: '已付款',
    status: '已完成',
    date: '2026-10-01',
    shipMethod: 'family',
    shipTo: '全家 南京松江店',
    tracking: 'TW4410260377',
    stage: 3,
    reviewed: true,
  },
]

const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`
function genPayments(sellerId: string, from: [number, number], to: [number, number], method: PayMethod, day: number): Payment[] {
  const out: Payment[] = []
  let [y, m] = from
  while (y < to[0] || (y === to[0] && m <= to[1])) {
    const ym = monthKey(y, m)
    out.push({
      id: `${sellerId}-${ym}`,
      sellerId,
      date: `${ym}-${String(day).padStart(2, '0')}`,
      amount: PLAN_PRICE,
      method,
      status: '已付款',
      invoice: `QJ${ym.replace('-', '')}${sellerId.replace('s', '')}${String(day).padStart(2, '0')}`,
    })
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out.reverse()
}

const SEED_PAYMENTS: Payment[] = [
  ...genPayments('s1', [2025, 11], [2026, 10], 'card', 3),
  ...genPayments('s2', [2025, 12], [2026, 9], 'card', 10),
  ...genPayments('s3', [2026, 2], [2026, 10], 'atm', 20),
]

const TREND = [18200, 22400, 19800, 26500, 31200, 28700, 24600]
const TREND_LABELS = ['10/08', '10/09', '10/10', '10/11', '10/12', '10/13', '今日']

/* ----------------------------------------------------------------------------
 * 工具函式與樣式常數
 * -------------------------------------------------------------------------- */

const money = (n: number) => `NT$ ${n.toLocaleString('en-US')}`
const pad = (n: number) => String(n).padStart(2, '0')
const todayStr = () => new Date().toISOString().slice(0, 10)
const maskId = (s: string) => (s.length > 6 ? `${s.slice(0, 3)}****${s.slice(-3)}` : s)
const addMonth = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  return `${ny}-${pad(nm)}-${pad(Math.min(d, 28))}`
}
const subMonth = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-').map(Number)
  const ny = m === 1 ? y - 1 : y
  const nm = m === 1 ? 12 : m - 1
  return `${ny}-${pad(nm)}-${pad(Math.min(d, 28))}`
}
const fmtDate = (s: string) => s.replace(/-/g, '/')
const periodText = (p: Plan) =>
  p.periodStart === p.nextDate ? '尚未開通本期方案' : `${fmtDate(p.periodStart)} ~ ${fmtDate(p.nextDate)}`
const isClosed = (s: Seller) => s.plan.status === 'overdue' || s.plan.status === 'suspended'
const graceLeft = (p: Plan) => Math.max(0, GRACE_DAYS - (p.graceElapsed ?? 0))
const isOffline = (s: Seller) => isClosed(s) || !!s.suspended

const MAX_PRICE = 200000
const PRICE_LIMIT_MSG = '商品金額超過平台規範上限！如需刊登高單價特殊商品，請先向平台提交實名特約審核。'
const BANNED_WORDS = [
  '毒品', '槍械', '刀具', '煙彈', '電子煙', '仿冒', '原單', '犀利士',
  '威爾鋼', '減肥藥', '大麻', '帳號出售', '幽靈卡', '代刷', '套現',
]
const normalizeText = (s: string) => s.toLowerCase().replace(/[\s\u3000.,，。、!！?？\-_*|\\/·~`'"“”‘’:：;；()（）[\]【】]/g, '')
const scanBanned = (...texts: string[]) =>
  Array.from(
    new Set(
      texts.flatMap((t) => {
        const n = normalizeText(t)
        return BANNED_WORDS.filter((w) => n.includes(w))
      }),
    ),
  )

const REPORT_REASONS: { id: ReportReason; label: string; hint: string; icon: typeof Flag }[] = [
  { id: 'fake', label: '疑似詐騙 / 假貨', hint: '仿冒品、盜版或疑似詐騙行為', icon: ShieldAlert },
  { id: 'mismatch', label: '商品描述不符', hint: '圖片、規格或說明與實際內容不一致', icon: ImageOff },
  { id: 'price', label: '價格異常 / 誘導私下交易', hint: '價格明顯不合理，或引導買家脫離平台交易', icon: Banknote },
  { id: 'prohibited', label: '違禁品', hint: '疑似販售法令禁止或管制的物品', icon: Ban },
  { id: 'ip', label: '侵權 / 圖片盜用', hint: '未經授權使用品牌商標、圖片或著作內容', icon: Flag },
  { id: 'other', label: '其他', hint: '以上皆不符，請在詳細說明中描述', icon: CircleAlert },
]
const REPORT_LIMIT = 3
const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000
const REPORT_NOTE_MIN = 15
const REPORT_WARNING = '⚠️ 請如實回報。若經查證屬惡意捏造或濫用檢舉功能，平台將永久取消檢舉權限並凍結帳號。'
const reportStatusMeta: Record<ReportStatus, { text: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'brand' }> = {
  open: { text: '待審核', tone: 'warn' },
  dismissed: { text: '已駁回', tone: 'neutral' },
  confirmed: { text: '已確認違規', tone: 'bad' },
}
const appealStatusMeta: Record<AppealStatus, { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  pending: { text: '申訴審核中', tone: 'warn' },
  approved: { text: '申訴成立', tone: 'ok' },
  rejected: { text: '申訴駁回', tone: 'bad' },
}
const DEMO_EXPIRED = { start: '2026-09-15', end: '2026-10-15' }
const DEMO_ACTIVE = { start: '2026-10-15', end: '2026-11-15' }
const shipFee = (method: ShipKey, subtotal: number) => (subtotal >= FREE_SHIP ? 0 : SHIP[method].fee)

const optKey = (group: string, option: string) => `${group}|${option}`
const optionSoldOut = (p: Product, group: string, option: string) => p.optionStock?.[optKey(group, option)] === 0
const MAX_COMBOS = 100
const comboKey = (p: Product, sel: Record<string, string>) => p.variants.map((g) => optKey(g.name, sel[g.name] ?? '')).join('::')
const isCombo = (p: Product) => p.variants.length > 1 && !!p.comboStock
const comboList = (p: Product) =>
  p.variants.reduce<Record<string, string>[]>((acc, g) => acc.flatMap((a) => g.options.map((o) => ({ ...a, [g.name]: o }))), [{}])
const comboMatches = (p: Product, sel: Record<string, string>) =>
  comboList(p).filter((c) => Object.entries(sel).every(([g, o]) => c[g] === undefined || c[g] === o))
const stockFor = (p: Product, sel: Record<string, string>) => {
  if (isCombo(p)) return comboMatches(p, sel).reduce((s, c) => s + (p.comboStock?.[comboKey(p, c)] ?? 0), 0)
  return Object.entries(sel).reduce((m, [g, o]) => {
    const st = p.optionStock?.[optKey(g, o)]
    return st === undefined ? m : Math.min(m, st)
  }, p.stock)
}
const unitPrice = (p: Product, sel: Record<string, string>) => {
  if (isCombo(p)) {
    const v = p.comboPrice?.[comboKey(p, sel)]
    if (v !== undefined) return v
  }
  return Object.entries(sel).reduce((pr, [g, o]) => p.optionPrice?.[optKey(g, o)] ?? pr, p.price)
}
const topPrice = (p: Product) => Math.max(p.price, ...Object.values(p.optionPrice ?? {}), ...Object.values(p.comboPrice ?? {}))
const priceSpan = (p: Product, sel: Record<string, string>): [number, number] => {
  if (!isCombo(p)) {
    const v = unitPrice(p, sel)
    return [v, v]
  }
  const ps = comboMatches(p, sel).map((c) => p.comboPrice?.[comboKey(p, c)] ?? p.price)
  return ps.length ? [Math.min(...ps), Math.max(...ps)] : [p.price, p.price]
}
const optionUnavailable = (p: Product, sel: Record<string, string>, group: string, option: string) =>
  isCombo(p) ? stockFor(p, { ...sel, [group]: option }) === 0 : optionSoldOut(p, group, option)
const optionStockHint = (p: Product, sel: Record<string, string>, group: string, option: string): number | undefined =>
  isCombo(p) ? stockFor(p, { ...sel, [group]: option }) : p.optionStock?.[optKey(group, option)]
const pickMessage = (names: string[]) =>
  `請先選擇${[...names].sort((a, b) => Number(isSizeName(b)) - Number(isSizeName(a))).join('與')}`
const fmtOpt = (o: string) => (/^(XXS|XS|S|M|L|XL|[2-5]XL)$/i.test(o) ? `${o.toUpperCase()}號` : o)
const readOptionMap = (p: Product | null, key: 'optionStock' | 'optionPrice'): Record<string, string> => {
  const g = p?.variants[0]
  if (!p || !g) return {}
  const out: Record<string, string> = {}
  g.options.forEach((o) => {
    const v = p[key]?.[optKey(g.name, o)]
    if (v !== undefined) out[o] = String(v)
  })
  return out
}

type BuyerStage = 'unpaid' | 'toShip' | 'shipping' | 'done'
const buyerStage = (o: Order): BuyerStage =>
  o.payStatus === '待匯款' ? 'unpaid' : o.status === '待出貨' ? 'toShip' : o.status === '已出貨' ? 'shipping' : 'done'
const LAST_STAGE = 3
const BUYER_PHONE_MASKED = '0909-***-832'
const OTP_CODE = '123456'
const BANKS = ['國泰世華銀行', '中國信託銀行', '台新銀行', '玉山銀行', '富邦銀行']
const maskName = (s: string) => (s.length > 1 ? `${s.slice(0, 1)}***` : s)
const shiftDate = (dateStr: string, days: number) => {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}
const atmAccount = (o: Order) => `玉山銀行(808) 0${o.id.slice(-6)}${o.sellerId.replace(/\D/g, '').padStart(2, '0')}`

function trackSteps(o: Order, sellerName: string): { label: string; detail: string; time: string }[] {
  const cvs = o.shipMethod !== 'home'
  const base = [
    { label: '賣家已出貨', detail: `${sellerName} 已將包裹交付物流業者` },
    { label: '物流中心處理中', detail: '包裹已抵達物流轉運中心，分揀處理中' },
    cvs
      ? { label: `已到達 ${o.shipTo}`, detail: '包裹已送達取貨門市，等待店員上架' }
      : { label: '配送員派送中', detail: '包裹已由配送員攜帶出發，今日預計送達' },
    cvs
      ? { label: '待取件', detail: '請於 7 日內攜帶證件至門市取件' }
      : { label: '已送達，待簽收', detail: `已送達 ${o.shipTo}` },
  ]
  const offsets = [1, 1, 2, 2]
  const clocks = ['09:12', '18:40', '07:55', '10:30']
  return base.map((s, i) => ({ ...s, time: `${shiftDate(o.date, offsets[i])} ${clocks[i]}` }))
}
const avg = (reviews: Review[]) =>
  reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0

const inputCls =
  'w-full rounded-xl border border-input bg-card px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/30'
const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const btnDanger =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-destructive px-5 py-2.5 text-sm font-bold text-card shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const panelCls = 'rounded-2xl border border-border/70 bg-card shadow-sm'
const hoverPanelCls = `${panelCls} transition duration-300 hover:-translate-y-1 hover:shadow-xl`

const modalStack: number[] = []
let modalSeq = 0

/* ----------------------------------------------------------------------------
 * 共用小元件
 * -------------------------------------------------------------------------- */

function Modal({
  title,
  onClose,
  children,
  size = 'lg',
  z = 50,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'store'
  z?: number
}) {
  const idRef = useRef(0)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    modalSeq += 1
    const id = modalSeq
    idRef.current = id
    modalStack.push(id)
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const idx = modalStack.indexOf(id)
      if (idx >= 0) modalStack.splice(idx, 1)
      if (modalStack.length === 0) document.body.style.overflow = ''
    }
  }, [])

  const isStore = size === 'store'
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl', store: 'max-w-2xl' }[size]
  const header = (
    <div
      className={`flex items-center justify-between gap-3 border-b border-border/70 bg-card px-5 py-3.5 ${isStore ? 'sticky top-0 z-20' : ''}`}
    >
      <h2 className="text-balance text-base font-black">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="關閉視窗"
        className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <X className="size-5" />
      </button>
    </div>
  )
  return (
    <div
      className={`fixed inset-0 flex justify-center bg-foreground/40 backdrop-blur-sm ${
        isStore ? 'items-center p-0 py-2 sm:p-4' : 'items-end p-0 sm:items-center sm:p-4'
      }`}
      style={{ zIndex: z }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {isStore ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`w-full ${width} mx-2 max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-3xl border border-border/70 bg-card shadow-2xl sm:mx-auto`}
        >
          {header}
          {children}
        </div>
      ) : (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`flex max-h-[94vh] w-full ${width} flex-col overflow-hidden rounded-t-3xl border border-border/70 bg-card shadow-2xl sm:rounded-3xl`}
        >
          {header}
          <div className="overflow-y-auto">{children}</div>
        </div>
      )}
    </div>
  )
}

function Stars({ value, size = 'size-3.5', showValue = true }: { value: number; size?: string; showValue?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`評價 ${value.toFixed(1)} 顆星`}>
      <span className="inline-flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={`${size} ${i <= Math.round(value) ? 'fill-primary text-primary' : 'fill-muted text-border'}`}
          />
        ))}
      </span>
      {showValue && <span className="text-xs font-bold text-foreground">{value ? value.toFixed(1) : '新店'}</span>}
    </span>
  )
}

function VerifiedBadge({ label = false }: { label?: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-verified" title="已通過平台實名認證">
      <BadgeCheck className="size-4 fill-verified text-card" aria-hidden />
      {label ? <span className="text-xs font-bold">實名認證</span> : <span className="sr-only">已通過平台實名認證</span>}
    </span>
  )
}

type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'brand'
function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const map: Record<Tone, string> = {
    ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-700 ring-amber-200',
    bad: 'bg-red-50 text-red-700 ring-red-200',
    neutral: 'bg-muted text-muted-foreground ring-border',
    brand: 'bg-accent text-accent-foreground ring-orange-200',
  }
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${map[tone]}`}>
      {children}
    </span>
  )
}

function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-muted-foreground">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
      {error && (
        <span className="mt-1 flex items-center gap-1 text-xs font-medium text-destructive" role="alert">
          <CircleAlert className="size-3.5" />
          {error}
        </span>
      )}
    </label>
  )
}

function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; icon?: ReactNode; badge?: number }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-full border border-border/70 bg-card p-1 shadow-sm">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${
            value === t.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          {t.icon}
          {t.label}
          {!!t.badge && (
            <span className="rounded-full bg-destructive px-1.5 text-[10px] font-black leading-4 text-card">{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  )
}

function Avatar({ seller, size = 'size-10' }: { seller: Seller; size?: string }) {
  if (seller.logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={seller.logo} alt="" aria-hidden="true" className={`${size} shrink-0 rounded-2xl border border-border/60 object-cover shadow-sm`} />
    )
  }
  return (
    <span className={`${size} ${seller.logoClass} inline-flex shrink-0 items-center justify-center rounded-2xl text-base font-black shadow-sm`} aria-hidden>
      {seller.name.slice(0, 1)}
    </span>
  )
}

function ProductImage({ src, alt, view = '' }: { src: string; alt: string; view?: string }) {
  return (
    <div className="aspect-square w-full overflow-hidden bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src || '/placeholder.svg'} alt={alt} className={`h-full w-full object-cover transition duration-500 ${view}`} />
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * 信用卡欄位
 * -------------------------------------------------------------------------- */

function validateCard(c: CardForm): Partial<Record<keyof CardForm, string>> {
  const e: Partial<Record<keyof CardForm, string>> = {}
  if (c.number.replace(/\s/g, '').length !== 16) e.number = '請輸入 16 碼卡號'
  if (!c.holder.trim()) e.holder = '請輸入持卡人姓名'
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(c.exp)) e.exp = '格式 MM/YY'
  if (!/^\d{3}$/.test(c.cvc)) e.cvc = '3 碼安全碼'
  return e
}

function CardFields({
  value,
  onChange,
  errors,
}: {
  value: CardForm
  onChange: (v: CardForm) => void
  errors: Partial<Record<keyof CardForm, string>>
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Field label="信用卡號" error={errors.number}>
          <input
            inputMode="numeric"
            autoComplete="cc-number"
            className={inputCls}
            placeholder="4242 4242 4242 4242"
            value={value.number}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 16)
              onChange({ ...value, number: digits.replace(/(.{4})/g, '$1 ').trim() })
            }}
          />
        </Field>
      </div>
      <div className="col-span-2">
        <Field label="持卡人姓名" error={errors.holder}>
          <input
            autoComplete="cc-name"
            className={inputCls}
            placeholder="WANG DA MING"
            value={value.holder}
            onChange={(e) => onChange({ ...value, holder: e.target.value })}
          />
        </Field>
      </div>
      <Field label="有效期限" error={errors.exp}>
        <input
          inputMode="numeric"
          autoComplete="cc-exp"
          className={inputCls}
          placeholder="MM/YY"
          value={value.exp}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, '').slice(0, 4)
            onChange({ ...value, exp: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d })
          }}
        />
      </Field>
      <Field label="安全碼 CVC" error={errors.cvc}>
        <input
          inputMode="numeric"
          autoComplete="cc-csc"
          className={inputCls}
          placeholder="123"
          value={value.cvc}
          onChange={(e) => onChange({ ...value, cvc: e.target.value.replace(/\D/g, '').slice(0, 3) })}
        />
      </Field>
    </div>
  )
}

const emptyCard: CardForm = { number: '', holder: '', exp: '', cvc: '' }

/* ----------------------------------------------------------------------------
 * 登入 / 註冊 Modal
 * -------------------------------------------------------------------------- */

interface SellerRegisterData {
  storeName: string
  owner: string
  idNo: string
  docName: string
  docUrl?: string
}

function AuthModal({
  onClose,
  onLogin,
  onBuyer,
  onSeller,
  initialTab = 'buyer',
  onForgot,
}: {
  onForgot: () => void
  onClose: () => void
  onLogin: (name: string) => void
  onBuyer: (name: string) => void
  onSeller: (d: SellerRegisterData) => void
  initialTab?: 'buyer' | 'seller'
}) {
  const [tab, setTab] = useState<'buyer' | 'seller' | 'login'>(initialTab)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [buyer, setBuyer] = useState({ name: '', email: '', password: '' })
  const [login, setLogin] = useState({ email: '', password: '' })
  const [seller, setSeller] = useState({ storeName: '', owner: '', idNo: '' })
  const [doc, setDoc] = useState<{ name: string; url?: string } | null>(null)
  const [kycAgreed, setKycAgreed] = useState(false)

  const emailOk = (v: string) => /^\S+@\S+\.\S+$/.test(v)

  const submitBuyer = () => {
    const e: Record<string, string> = {}
    if (!buyer.name.trim()) e.name = '請輸入暱稱'
    if (!emailOk(buyer.email)) e.email = '請輸入有效的 Email'
    if (buyer.password.length < 6) e.password = '密碼至少 6 碼'
    setErrors(e)
    if (Object.keys(e).length === 0) onBuyer(buyer.name.trim())
  }

  const submitLogin = () => {
    const e: Record<string, string> = {}
    if (!emailOk(login.email)) e.email = '請輸入有效的 Email'
    if (login.password.length < 6) e.password = '密碼至少 6 碼'
    setErrors(e)
    if (Object.keys(e).length === 0) onLogin(login.email.split('@')[0])
  }

  const submitSeller = () => {
    const e: Record<string, string> = {}
    if (!seller.storeName.trim()) e.storeName = '請輸入店家名稱'
    if (!seller.owner.trim()) e.owner = '請輸入負責人姓名'
    if (!/^([A-Z][12]\d{8}|\d{8})$/.test(seller.idNo.trim().toUpperCase()))
      e.idNo = '請輸入正確身分證字號（如 A123456789）或 8 碼統編'
    if (!doc) e.doc = '請上傳證件影本'
    if (!kycAgreed) e.kycAgreed = '請先勾選同意個資搜集告知條款與 SLA 免責聲明，才能送出申請'
    setErrors(e)
    if (Object.keys(e).length === 0 && doc)
      onSeller({
        storeName: seller.storeName.trim(),
        owner: seller.owner.trim(),
        idNo: seller.idNo.trim().toUpperCase(),
        docName: doc.name,
        docUrl: doc.url,
      })
  }

  const switchTab = (t: typeof tab) => {
    setTab(t)
    setErrors({})
  }

  return (
    <Modal title={tab === 'login' ? '登入買個 Pay 服' : '加入買個 Pay 服'} onClose={onClose} size="md" z={90}>
      <div className="space-y-5 p-5">
        {tab !== 'login' && (
          <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1" role="tablist">
            {(
              [
                ['buyer', '買家註冊', UserRound],
                ['seller', '賣家實名註冊', ShieldCheck],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                type="button"
                onClick={() => switchTab(id)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-full py-2 text-sm font-bold transition ${
                  tab === id ? 'bg-card text-brand-ink shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === 'buyer' && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              submitBuyer()
            }}
          >
            <Field label="暱稱" error={errors.name}>
              <input className={inputCls} value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} placeholder="例如：小橘" />
            </Field>
            <Field label="Email" error={errors.email}>
              <input type="email" className={inputCls} value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} placeholder="you@example.com" />
            </Field>
            <Field label="密碼" error={errors.password}>
              <input type="password" className={inputCls} value={buyer.password} onChange={(e) => setBuyer({ ...buyer, password: e.target.value })} placeholder="至少 6 碼" />
            </Field>
            <button type="submit" className={`${btnPrimary} w-full`}>
              建立買家帳號
            </button>
          </form>
        )}

        {tab === 'seller' && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              submitSeller()
            }}
          >
            <div className="flex items-start gap-2 rounded-xl bg-secondary p-3 text-xs leading-relaxed text-secondary-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              賣家需通過平台實名審核才能於前台上架，審核通過後會顯示藍勾勾認證標章。
            </div>
            <Field label="店家名稱" error={errors.storeName}>
              <input className={inputCls} value={seller.storeName} onChange={(e) => setSeller({ ...seller, storeName: e.target.value })} placeholder="例如：青禾茶舖" />
            </Field>
            <Field label="負責人姓名" error={errors.owner}>
              <input className={inputCls} value={seller.owner} onChange={(e) => setSeller({ ...seller, owner: e.target.value })} placeholder="與證件相同的姓名" />
            </Field>
            <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/50 p-3 text-xs leading-relaxed">
              <LockKeyhole className="mt-0.5 size-4 shrink-0 text-brand-ink" />
              <p className="text-pretty">
                <span className="font-bold">本平台採用 256-bit AES 加密儲存您的實名認證資料，僅供司法機關調閱與平台身分核對使用。</span>
                我們絕不將證件資料用於行銷或提供給無關第三方。
              </p>
            </div>
            <Field label="身分證字號 / 統一編號" error={errors.idNo}>
              <input className={inputCls} value={seller.idNo} onChange={(e) => setSeller({ ...seller, idNo: e.target.value })} placeholder="A123456789 或 12345678" autoComplete="off" />
            </Field>
            <Field label="上傳證件影本" error={errors.doc} hint="支援 JPG / PNG / PDF，送出後狀態為「待平台審核」">
              <span
                className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm transition hover:border-primary hover:bg-secondary ${
                  errors.doc ? 'border-destructive' : 'border-input'
                }`}
              >
                <Upload className="size-5 shrink-0 text-brand-ink" />
                <span className="min-w-0 flex-1 truncate font-medium">{doc ? doc.name : '點擊選擇檔案'}</span>
                {doc && <Check className="size-4 text-emerald-600" />}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    setDoc({ name: f.name, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined })
                  }}
                />
              </span>
            </Field>
            <div>
              <label
                className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 text-sm leading-relaxed ${
                  errors.kycAgreed ? 'border-destructive bg-red-50' : 'border-border bg-muted/40'
                }`}
              >
                <input
                  type="checkbox"
                  checked={kycAgreed}
                  onChange={(e) => setKycAgreed(e.target.checked)}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <span className="text-pretty">
                  我已閱讀並同意
                  <Link href="/legal/pica" target="_blank" rel="noopener noreferrer" className="font-bold text-brand-ink underline underline-offset-2">《個人資料搜集告知條款》</Link>
                  與
                  <Link href="/legal/sla" target="_blank" rel="noopener noreferrer" className="font-bold text-brand-ink underline underline-offset-2">《平台服務層級（SLA）免責聲明》</Link>
                  。<span className="font-bold text-destructive">（必填）</span>
                </span>
              </label>
              {errors.kycAgreed && (
                <p role="alert" className="mt-1 flex items-center gap-1 text-xs font-medium text-destructive">
                  <CircleAlert className="size-3.5" />{errors.kycAgreed}
                </p>
              )}
            </div>
            <button type="submit" className={`${btnPrimary} w-full`}>
              送出實名審核申請
            </button>
          </form>
        )}

        {tab === 'login' && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              submitLogin()
            }}
          >
            <Field label="Email" error={errors.email}>
              <input type="email" className={inputCls} value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} placeholder="you@example.com" />
            </Field>
            <Field label="密碼" error={errors.password}>
              <input type="password" className={inputCls} value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} />
            </Field>
            <button type="button" onClick={onForgot} className="-mt-1 text-xs font-bold text-brand-ink hover:underline">
              忘記密碼？
            </button>
            <button type="submit" className={`${btnPrimary} w-full`}>
              登入
            </button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          {tab === 'login' ? (
            <>
              還沒有帳號？
              <button type="button" onClick={() => switchTab('buyer')} className="font-bold text-brand-ink hover:underline">
                立即註冊
              </button>
            </>
          ) : (
            <>
              已有帳號？
              <button type="button" onClick={() => switchTab('login')} className="font-bold text-brand-ink hover:underline">
                登入
              </button>
            </>
          )}
        </p>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------------------
 * 商品圖片
 * -------------------------------------------------------------------------- */

function CheckinBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-black text-amber-950 shadow-sm ${className}`}>
      <Medal className="size-3" />簽到福利店
    </span>
  )
}

const FOUNDER_LIMIT = 50
const isFounder = (s: Seller) => !!s.founderNo && s.verify === 'approved'

function FounderBadge({ seller, className = '', large = false }: { seller: Seller; className?: string; large?: boolean }) {
  if (!isFounder(seller)) return null
  return (
    <span
      title={`第 ${seller.founderNo} 位創始店長・資深認證優質賣家`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 font-black text-amber-950 shadow-sm ring-1 ring-amber-500/70 ${large ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'} ${className}`}
    >
      <Crown className={large ? 'size-3.5' : 'size-3'} />創始特約店
    </span>
  )
}

function CouponDisclaimer() {
  return (
    <p role="note" className="flex gap-2 rounded-2xl border border-destructive/40 bg-red-50 p-3 text-xs font-bold leading-relaxed text-red-800">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      <span className="text-pretty">{COUPON_DISCLAIMER}</span>
    </p>
  )
}

function BusinessBlock({ seller }: { seller: Seller }) {
  const b = seller.business
  return (
    <section className={`${panelCls} space-y-2 p-4 text-xs`} aria-label="賣家營業資訊揭露">
      <h4 className="flex items-center gap-1.5 text-sm font-black">
        <FileText className="size-4 text-brand-ink" />賣家營業資訊（消保法揭露）
      </h4>
      {b ? (
        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {(
            [
              [b.kind === 'company' ? '公司名稱' : '營業人姓名', b.legalName],
              ...(b.kind === 'company' ? ([['統一編號', b.taxId]] as [string, string][]) : []),
              ['營業地址', b.address],
              ['客服電話', b.phone],
              ['客服 Email', b.email],
              ['客服 LINE', b.line],
              ['客服時間', b.hours],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-20 shrink-0 font-bold text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted-foreground">此賣家尚未填寫營業資訊，請先透過聊聊聯繫賣家。</p>
      )}
    </section>
  )
}

function ProductCard({
  product,
  seller,
  onOpen,
  onOpenStore,
  checkin = false,
  faved = false,
  onFav,
}: {
  product: Product
  seller: Seller
  onOpen: () => void
  onOpenStore?: () => void
  checkin?: boolean
  faved?: boolean
  onFav?: () => void
}) {
  const rating = avg(product.reviews)
  return (
    <article className={`group relative overflow-hidden ${hoverPanelCls}`}>
      {onFav && (
        <button
          type="button"
          onClick={onFav}
          aria-pressed={faved}
          aria-label={faved ? `取消收藏 ${product.name}` : `收藏 ${product.name}`}
          className="absolute right-1.5 top-1.5 z-10 flex size-8 items-center justify-center rounded-full bg-card/90 text-muted-foreground shadow-sm transition hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Heart className={`size-4 ${faved ? 'fill-destructive text-destructive' : ''}`} />
        </button>
      )}
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="relative overflow-hidden">
          <div className="transition duration-500 group-hover:scale-105">
            <ProductImage src={product.image} alt={product.name} />
          </div>
          {checkin && <CheckinBadge className="absolute right-10 top-1.5" />}
          {onOpenStore && <FounderBadge seller={seller} className="absolute bottom-1.5 left-1.5" />}
          {product.stock === 0 && (
            <span className="absolute inset-0 flex items-center justify-center bg-foreground/50 text-sm font-black text-card">已售完</span>
          )}
          {product.stock > 0 && product.stock <= 5 && (
            <span className="absolute left-1.5 top-1.5 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-card">僅剩 {product.stock} 件</span>
          )}
        </div>
        <div className="space-y-1 px-2 pb-1.5 pt-2">
          <h3 className="line-clamp-2 min-h-9 text-[13px] font-medium leading-[18px]">{product.name}</h3>
          <div className="flex flex-wrap items-baseline justify-between gap-x-1">
            <p className="whitespace-nowrap text-[15px] font-black leading-5 text-brand-ink">{money(product.price)}</p>
            <p className="text-[11px] leading-5 text-muted-foreground">已售出 {product.sold.toLocaleString('en-US')}</p>
          </div>
          <Stars value={rating} size="size-3" />
        </div>
      </button>
      {onOpenStore && (
        <div className="border-t border-border/60 px-2 py-1.5">
          <button
            type="button"
            onClick={onOpenStore}
            className="flex w-full items-center gap-1 text-[11px] font-medium text-muted-foreground transition hover:text-brand-ink"
          >
            <Store className="size-3 shrink-0" />
            <span className="truncate">{seller.name}</span>
            {seller.verify === 'approved' && <VerifiedBadge />}
            <span className="hidden md:contents"><FounderBadge seller={seller} /></span>
            <ChevronRight className="ml-auto size-3 shrink-0" />
          </button>
        </div>
      )}
    </article>
  )
}

/* ----------------------------------------------------------------------------
 * 商品詳情 Modal
 * -------------------------------------------------------------------------- */

function ProductModal({
  product,
  seller,
  onClose,
  onAdd,
  onBuyNow,
  onOpenStore,
  onChat,
  onReport,
  viewer = null,
  reportsLeft = REPORT_LIMIT,
  onNeedLogin,
  checkin = false,
  faved = false,
  onFav,
  similar,
  onOpenSimilar,
  onNotify,
}: {
  product: Product
  seller: Seller
  onClose: () => void
  onAdd: (variant: Record<string, string>, qty: number) => void
  onBuyNow: (variant: Record<string, string>, qty: number) => void
  onOpenStore: () => void
  onChat: () => void
  onReport: (reason: ReportReason, note: string, evidence: string[]) => void
  viewer?: Viewer | null
  reportsLeft?: number
  onNeedLogin?: () => void
  checkin?: boolean
  faved?: boolean
  onFav?: () => void
  similar?: Product[]
  onOpenSimilar?: (id: string) => void
  onNotify?: (msg: string) => void
}) {
  const [reportOpen, setReportOpen] = useState(false)
  const [showSimilar, setShowSimilar] = useState(false)
  const [view, setView] = useState(0)
  const [qty, setQty] = useState(1)
  const [sel, setSel] = useState<Record<string, string>>(() =>
    Object.fromEntries(product.variants.filter((v) => v.options.length === 1).map((v) => [v.name, v.options[0]])),
  )
  const [needPick, setNeedPick] = useState(false)
  const variantsRef = useRef<HTMLDivElement>(null)
  const rating = avg(product.reviews)
  const missing = product.variants.filter((g) => !sel[g.name])
  const complete = missing.length === 0
  const limit = stockFor(product, sel)
  const soldOut = limit === 0
  const [priceMin, priceMax] = priceSpan(product, sel)
  const shownPrice = priceMin
  const pickedLabel = product.variants.map((g) => sel[g.name]).filter(Boolean).map(fmtOpt).join(' / ')
  const tryBuy = (action: (variant: Record<string, string>, qty: number) => void) => {
    if (!complete) {
      setNeedPick(true)
      onNotify?.(pickMessage(missing.map((g) => g.name)))
      variantsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    action(sel, qty)
  }

  return (
    <>
    <Modal title="商品詳情" onClose={onClose} size="xl" z={60}>
      <div className="grid gap-6 p-5 md:grid-cols-2">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-2xl border border-border/70">
            <ProductImage src={product.image} alt={product.name} view={VIEWS[view].cls} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {VIEWS.map((v, i) => (
              <button
                key={v.label}
                type="button"
                onClick={() => setView(i)}
                aria-label={`切換到${v.label}`}
                aria-pressed={view === i}
                className={`overflow-hidden rounded-xl border-2 transition ${view === i ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100'}`}
              >
                <ProductImage src={product.image} alt="" view={v.cls} />
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="brand">{product.category}</Pill>
              <FounderBadge seller={seller} large />
            </div>
            <div className="mt-2 flex items-start justify-between gap-3">
              <h3 className="text-balance text-xl font-black leading-snug">{product.name}</h3>
              {onFav && (
                <button
                  type="button"
                  onClick={onFav}
                  aria-pressed={faved}
                  aria-label={faved ? '取消收藏' : '加入收藏'}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Heart className={`size-5 ${faved ? 'fill-destructive text-destructive' : ''}`} />
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <Stars value={rating} />
              <span>{product.reviews.length} 則評價</span>
              <span>已售出 {product.sold.toLocaleString('en-US')}</span>
            </div>
          </div>
          <p className="rounded-2xl bg-secondary px-4 py-3 text-3xl font-black text-brand-ink">
            {!complete && priceMax > priceMin ? `${money(priceMin)} – ${money(priceMax)}` : money(shownPrice)}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">{product.desc}</p>
          <HighPriceSafetyTags price={topPrice(product)} />

          {product.variants.length > 0 && (
            <div ref={variantsRef} className="scroll-mt-4 space-y-3">
              {product.variants.map((g) => {
                const groupMissing = needPick && !sel[g.name]
                return (
                  <div key={g.name} role="group" aria-label={g.name}>
                    <p className={`mb-1.5 text-xs font-bold ${groupMissing ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {g.name}
                      {sel[g.name] ? (
                        <span className="ml-1.5 text-foreground">{fmtOpt(sel[g.name])}</span>
                      ) : (
                        <span className="ml-1.5 font-medium">（請選擇）</span>
                      )}
                    </p>
                    <div className={`flex flex-wrap gap-2 rounded-2xl ${groupMissing ? 'ring-2 ring-destructive/50 ring-offset-2 ring-offset-background' : ''}`}>
                      {g.options.map((o) => {
                        const out = optionUnavailable(product, sel, g.name, o)
                        const left = optionStockHint(product, sel, g.name, o)
                        const low = !out && left !== undefined && left <= 5
                        const active = sel[g.name] === o
                        return (
                          <button
                            key={o}
                            type="button"
                            disabled={out}
                            aria-pressed={active}
                            aria-label={out ? `${o}（缺貨）` : low ? `${o}（剩 ${left} 件）` : o}
                            onClick={() => {
                              setSel({ ...sel, [g.name]: o })
                              setQty(1)
                            }}
                            className={`flex min-w-14 flex-col items-center rounded-xl border-2 px-3.5 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              out
                                ? 'cursor-not-allowed border-dashed border-border bg-muted text-muted-foreground/60'
                                : active
                                  ? 'border-primary bg-accent text-accent-foreground'
                                  : 'border-border bg-card hover:border-primary/60'
                            }`}
                          >
                            <span className={out ? 'line-through' : ''}>{fmtOpt(o)}</span>
                            {out && <span className="text-[10px] font-bold">缺貨</span>}
                            {low && <span className="text-[10px] font-bold text-destructive">剩 {left} 件</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {needPick && !complete && (
                <p role="alert" className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-destructive">
                  <CircleAlert className="size-4 shrink-0" />
                  {pickMessage(missing.map((g) => g.name))}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <div>
              <p className="mb-1.5 text-xs font-bold text-muted-foreground">數量</p>
              <div className="inline-flex items-center rounded-full border border-border">
                <button type="button" aria-label="減少數量" className="p-2 hover:bg-muted disabled:opacity-40 rounded-l-full" disabled={qty <= 1} onClick={() => setQty(qty - 1)}>
                  <Minus className="size-4" />
                </button>
                <span className="w-10 text-center text-sm font-bold" aria-live="polite">{qty}</span>
                <button type="button" aria-label="增加數量" className="p-2 hover:bg-muted disabled:opacity-40 rounded-r-full" disabled={qty >= limit} onClick={() => setQty(qty + 1)}>
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
            <p className={`pt-5 text-sm font-bold ${limit <= 5 ? 'text-destructive' : 'text-muted-foreground'}`}>
              {soldOut
                ? `${pickedLabel ? `${pickedLabel} ` : ''}目前無庫存`
                : product.variants.length === 0 || complete
                  ? `${pickedLabel ? `${pickedLabel} ` : ''}庫存剩 ${limit} 件`
                  : pickedLabel
                    ? `${pickedLabel} 合計庫存剩 ${limit} 件`
                    : `總庫存 ${limit} 件，請先選擇規格`}
            </p>
          </div>

          <div className="flex gap-3">
            <button type="button" disabled={soldOut} onClick={() => tryBuy(onAdd)} className={`${btnGhost} flex-1 py-3 text-brand-ink`}>
              <ShoppingCart className="size-4" /> 加入購物車
            </button>
            <button type="button" disabled={soldOut} onClick={() => tryBuy(onBuyNow)} className={`${btnPrimary} flex-1`}>
              立即購買
            </button>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-bold text-accent-foreground">
            <Truck className="size-4 shrink-0" />
            <span className="text-pretty">本賣場滿 {money(FREE_SHIP)} 免運，7-11 / 全家 / 宅配皆可</span>
          </div>
          <EcpayEscrowNotice compact />
          {similar && similar.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                aria-expanded={showSimilar}
                onClick={() => setShowSimilar((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-bold transition hover:bg-muted"
              >
                <Search className="size-4" />找相似商品
                <ChevronDown className={`size-4 transition ${showSimilar ? 'rotate-180' : ''}`} />
              </button>
              {showSimilar && (
                <ul className="grid grid-cols-3 gap-2" aria-label="相似商品">
                  {similar.map((sp) => (
                    <li key={sp.id}>
                      <button type="button" onClick={() => onOpenSimilar?.(sp.id)} className="block w-full overflow-hidden rounded-xl border border-border/70 text-left transition hover:border-primary">
                        <ProductImage src={sp.image} alt={sp.name} />
                        <span className="line-clamp-1 px-2 pt-1.5 text-xs font-bold">{sp.name}</span>
                        <span className="block px-2 pb-1.5 text-xs font-black text-brand-ink">{money(sp.price)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => (viewer ? setReportOpen(true) : onNeedLogin?.())}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground transition hover:text-destructive"
          >
            <Flag className="size-3.5" /> 檢舉此商品
          </button>
        </div>
      </div>

      <div className="space-y-6 px-5 pb-6">
        <section className={`${panelCls} flex flex-wrap items-center gap-4 p-4`} aria-label="賣家資訊">
          <Avatar seller={seller} size="size-14" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={onOpenStore} className="text-base font-black hover:text-brand-ink hover:underline">
                {seller.name}
              </button>
              {seller.verify === 'approved' && <VerifiedBadge label />}
              <FounderBadge seller={seller} />
              {checkin && <CheckinBadge />}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <Stars value={seller.rating} />
              <span>{seller.followers.toLocaleString('en-US')} 位粉絲</span>
              <span>{seller.city}</span>
              {seller.business?.line && <span>LINE {seller.business.line}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onChat} className={`${btnPrimary} bg-emerald-600 hover:bg-emerald-700`}>
              <MessageCircle className="size-4" /> 聯繫賣家客服
            </button>
            <button type="button" onClick={onOpenStore} className={btnGhost}>
              <Store className="size-4" /> 進入賣家賣場
            </button>
          </div>
        </section>
        <CouponDisclaimer />

        <section aria-label="商品規格表">
          <h4 className="mb-2 text-sm font-black">商品規格表</h4>
          <dl className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 text-sm">
            {product.specs.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[7rem_1fr] bg-card even:bg-muted/50">
                <dt className="px-4 py-2.5 font-bold text-muted-foreground">{k}</dt>
                <dd className="px-4 py-2.5">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-label="退換貨政策">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-black">
            <Undo2 className="size-4 text-brand-ink" /> 退換貨政策
          </h4>
          <ul className="space-y-1.5 rounded-2xl bg-secondary p-4 text-sm leading-relaxed text-secondary-foreground">
            {RETURN_POLICY.map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="mt-1 size-3.5 shrink-0" />
                {t}
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="買家評價">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-black">
            買家評價 <span className="text-xs font-medium text-muted-foreground">（{product.reviews.length}）</span>
          </h4>
          {product.reviews.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">尚無評價，成為第一位買家吧！</p>
          ) : (
            <ul className="space-y-3">
              {product.reviews.map((r) => (
                <li key={r.user + r.date} className="rounded-2xl border border-border/70 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {viewer && r.owner === viewer.name ? (
                        <UserAvatar name={viewer.name} tone={viewer.tone} src={viewer.avatar} size="size-8" textSize="text-xs" />
                      ) : (
                        <span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-black text-accent-foreground">{r.user.slice(0, 1)}</span>
                      )}
                      <span className="text-sm font-bold">{r.user}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{r.date}</span>
                  </div>
                  <div className="mt-2"><Stars value={r.rating} showValue={false} /></div>
                  <p className="mt-1.5 text-sm leading-relaxed">{r.text}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
    {reportOpen && (
      <ReportModal
        title="檢舉此商品"
        target={{ name: product.name, image: product.image }}
        left={reportsLeft}
        onClose={() => setReportOpen(false)}
        onSubmit={(reason, note, evidence) => {
          setReportOpen(false)
          onReport(reason, note, evidence)
        }}
      />
    )}
    </>
  )
}

function AppealStatusBlock({ appeal }: { appeal: Appeal }) {
  const meta = appealStatusMeta[appeal.status]
  return (
    <div className="w-full space-y-1.5 rounded-2xl border border-border/70 bg-muted/50 p-3 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={meta.tone}>{meta.text}</Pill>
        <span className="ml-auto font-mono text-xs text-muted-foreground">{appeal.at}</span>
      </div>
      <p className="text-pretty text-xs leading-relaxed text-muted-foreground">申訴內容：{appeal.text}</p>
      {appeal.reply ? (
        <p className="text-pretty text-xs font-bold leading-relaxed">平台回覆：{appeal.reply}</p>
      ) : (
        <p className="text-xs text-muted-foreground">平台審核中，結果將以站內通知與簡訊告知。</p>
      )}
    </div>
  )
}

function AppealModal({
  kind,
  targetName,
  onClose,
  onSubmit,
}: {
  kind: 'product' | 'ban' | 'seller'
  targetName: string
  onClose: () => void
  onSubmit: (text: string) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  return (
    <Modal title={kind === 'ban' ? '申請解除封鎖' : kind === 'seller' ? '賣場檢舉申訴 / 回覆' : '商品申訴 / 回覆'} onClose={onClose} size="md" z={70}>
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim().length < 10) {
            setError('請至少輸入 10 個字說明申訴理由')
            return
          }
          onSubmit(text.trim())
        }}
      >
        <div className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-brand-ink">
            <Megaphone className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{kind === 'ban' ? '申訴對象：賣家帳號' : kind === 'seller' ? '申訴對象：被檢舉的賣場' : '申訴對象：被檢舉商品'}</p>
            <p className="text-sm font-black leading-snug">{targetName}</p>
          </div>
        </div>

        <Field label="申訴理由與佐證說明" error={error}>
          <textarea
            className={`${inputCls} min-h-28`}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError('')
            }}
            maxLength={300}
            placeholder={
              kind === 'ban'
                ? '請說明遭封鎖的原因是否有誤，並提供改善措施或相關證明'
                : '請說明商品來源、合法性或檢舉不實之處，例如進貨憑證、檢驗報告'
            }
          />
        </Field>

        <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
          每項處分僅能申訴一次，平台審核後的結果為最終決定。惡意或虛偽申訴將依平台規範處理。
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>取消</button>
          <button type="submit" className={btnPrimary}><Send className="size-4" />送出申訴</button>
        </div>
      </form>
    </Modal>
  )
}

function ReportModal({
  title,
  target,
  left,
  onClose,
  onSubmit,
}: {
  title: string
  target: { name: string; image?: string; seller?: Seller }
  left: number
  onClose: () => void
  onSubmit: (reason: ReportReason, note: string, evidence: string[]) => void
}) {
  const [reason, setReason] = useState<ReportReason | ''>('')
  const [note, setNote] = useState('')
  const [evidence, setEvidence] = useState<string[]>([])
  const [errors, setErrors] = useState<{ reason?: string; note?: string }>({})
  const blocked = left <= 0
  const noteLen = note.trim().length
  const hint = REPORT_REASONS.find((r) => r.id === reason)?.hint

  return (
    <Modal title={title} onClose={onClose} size="md" z={70}>
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (blocked) return
          const next: { reason?: string; note?: string } = {}
          if (!reason) next.reason = '請先選擇檢舉原因'
          if (noteLen < REPORT_NOTE_MIN) next.note = `詳細說明至少需 ${REPORT_NOTE_MIN} 字，請提供具體事證（目前 ${noteLen} 字）`
          setErrors(next)
          if (next.reason || next.note || !reason) return
          onSubmit(reason, note.trim(), evidence)
        }}
      >
        <div className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3">
          {target.image ? (
            <div className="size-14 shrink-0 overflow-hidden rounded-xl border border-border/70">
              <ProductImage src={target.image} alt={target.name} />
            </div>
          ) : target.seller ? (
            <Avatar seller={target.seller} size="size-14" />
          ) : null}
          <p className="min-w-0 text-sm font-bold leading-snug">{target.name}</p>
        </div>

        <p
          role="status"
          className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold ${blocked ? 'bg-red-50 text-destructive' : 'bg-muted text-muted-foreground'}`}
        >
          <CircleAlert className="size-3.5 shrink-0" />
          {blocked
            ? `您已達 24 小時內 ${REPORT_LIMIT} 次檢舉上限，請稍後再試`
            : `24 小時內最多可檢舉 ${REPORT_LIMIT} 次，目前還可提交 ${left} 次`}
        </p>

        <Field label="檢舉原因" error={errors.reason}>
          <select
            className={inputCls}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as ReportReason | '')
              setErrors((x) => ({ ...x, reason: undefined }))
            }}
          >
            <option value="">請選擇檢舉原因</option>
            {REPORT_REASONS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
        </Field>

        <Field label={`詳細說明（必填，至少 ${REPORT_NOTE_MIN} 字）`} error={errors.note}>
          <textarea
            className={`${inputCls} min-h-24`}
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              setErrors((x) => ({ ...x, note: undefined }))
            }}
            maxLength={500}
            placeholder="請具體描述您發現的問題，例如時間、對話內容或商品與實物的差異"
          />
          <p className={`mt-1 text-right text-xs ${noteLen >= REPORT_NOTE_MIN ? 'text-emerald-700' : 'text-muted-foreground'}`}>
            {noteLen} / {REPORT_NOTE_MIN} 字以上
          </p>
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-bold">佐證截圖（選填）</p>
          <EvidenceUploader value={evidence} onChange={setEvidence} />
        </div>

        <p role="note" className="text-pretty rounded-xl border border-destructive/30 bg-red-50 p-3 text-xs font-bold leading-relaxed text-destructive">
          {REPORT_WARNING}
        </p>
        <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
          檢舉不會直接下架，案件會進入後台待審區由人工審核；賣家可提出申訴與回覆，檢舉人資料依法保密。
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>取消</button>
          <button type="submit" disabled={blocked} className={`${btnDanger} disabled:opacity-50`}>
            <Flag className="size-4" />送出檢舉
          </button>
        </div>
      </form>
    </Modal>
  )
}

/* ----------------------------------------------------------------------------
 * 賣家專屬賣場 Modal
 * -------------------------------------------------------------------------- */

function StoreModal({
  seller,
  closed = false,
  suspended = false,
  products,
  followed,
  onFollow,
  onClose,
  onOpenProduct,
  onChat,
  viewer = null,
  reportsLeft = REPORT_LIMIT,
  onNeedLogin,
  onReport,
  checkin = false,
}: {
  seller: Seller
  closed?: boolean
  suspended?: boolean
  products: Product[]
  followed: boolean
  onFollow: () => void
  onClose: () => void
  onOpenProduct: (id: string) => void
  onChat: () => void
  viewer?: Viewer | null
  reportsLeft?: number
  onNeedLogin?: () => void
  onReport: (reason: ReportReason, note: string, evidence: string[]) => void
  checkin?: boolean
}) {
  const [reportOpen, setReportOpen] = useState(false)
  const [sort, setSort] = useState<'new' | 'hot' | 'price'>('hot')
  const list = useMemo(() => {
    const l = [...products]
    if (sort === 'hot') l.sort((a, b) => b.sold - a.sold)
    if (sort === 'price') l.sort((a, b) => a.price - b.price)
    return l
  }, [products, sort])

  return (
    <Modal title={`${seller.name} 的賣場`} onClose={onClose} size="store" z={50}>
      <div>
        <div className={`relative h-28 w-full bg-gradient-to-r ${seller.bannerClass} sm:h-36 ${closed ? 'grayscale' : ''}`}>
          <div
            aria-hidden
            className="absolute inset-0 opacity-30 [background-image:radial-gradient(#ffffff_1.2px,transparent_1.2px)] [background-size:18px_18px]"
          />
          <p className="absolute bottom-3 right-4 hidden max-w-[60%] text-right text-sm font-bold text-card drop-shadow sm:block">
            {seller.tagline}
          </p>
        </div>
        <div className="flex flex-col items-center gap-3 p-4 text-center sm:flex-row sm:items-start sm:text-left">
          <div className="relative z-10 -mt-12 size-20 shrink-0 overflow-hidden rounded-full border-4 border-card shadow-md">
            <Avatar seller={seller} size="size-full" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:items-start">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-start">
              <h3 className="min-w-0 whitespace-normal break-words text-lg font-black leading-snug sm:text-xl">{seller.name}</h3>
              {seller.verify === 'approved' && (
                <span className="inline-flex items-center gap-1">
                  <VerifiedBadge label />
                </span>
              )}
              <FounderBadge seller={seller} large />
              {checkin && !closed && <CheckinBadge />}
              {closed && (suspended ? <Pill tone="bad"><Ban className="size-3" />已停權</Pill> : <Pill tone="neutral"><Clock className="size-3" />系統維護中</Pill>)}
            </div>
            <p className="text-pretty text-xs font-medium text-muted-foreground sm:hidden">{seller.tagline}</p>
            <div className="flex flex-wrap justify-center gap-4 text-xs text-muted-foreground sm:justify-start sm:text-sm">
              <Stars value={seller.rating} />
              <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{(seller.followers + (followed ? 1 : 0)).toLocaleString('en-US')} 粉絲</span>
              <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{seller.city}</span>
              <span>商品 {products.length}</span>
            </div>
          </div>
          <div className="mt-2 flex w-full gap-2 sm:w-auto">
            <button type="button" onClick={onChat} className={`${btnPrimary} flex-1 bg-emerald-600 hover:bg-emerald-700 sm:flex-none`}>
              <MessageCircle className="size-4" /> 聯繫賣家客服
            </button>
            <button
              type="button"
              onClick={onFollow}
              aria-pressed={followed}
              className={`${followed ? btnGhost : btnPrimary} flex-1 sm:flex-none`}
            >
              {followed ? <><Heart className="size-4 fill-primary text-primary" /> 已關注</> : <><Plus className="size-4" /> 關注</>}
            </button>
            <button
              type="button"
              onClick={() => (viewer ? setReportOpen(true) : onNeedLogin?.())}
              aria-label="檢舉此賣家"
              className={`${btnGhost} px-3 hover:text-destructive`}
            >
              <Flag className="size-4" />
              <span className="hidden sm:inline">檢舉此賣家</span>
            </button>
          </div>
        </div>
      </div>

      {closed ? (
        <div className="border-t border-border/70 bg-muted/40 p-4">
          <div role="status" className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><Clock className="size-7" /></span>
            <h4 className="text-lg font-black">{suspended ? '賣場已停權 / 配合平台調查中' : '店鋪系統維護 / 結帳升級中'}</h4>
            <p className="max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
              {suspended
                ? `「${seller.name}」因違反平台規範已被停權，所有商品已下架，無法下單。`
                : `該店鋪正在進行系統維護或結帳升級中，暫時無法下單。商品會在升級完成後自動重新上架，歡迎稍後再來逛逛，也可以先按「關注」，不錯過「${seller.name}」的新品。`}
            </p>
          </div>
        </div>
      ) : (
      <div className="border-t border-border/70 bg-muted/40">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h4 className="text-sm font-black">全部商品（僅顯示本店上架）</h4>
          <div className="flex gap-1.5" role="group" aria-label="排序">
            {(
              [
                ['hot', '熱銷'],
                ['new', '最新'],
                ['price', '價格低到高'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={sort === id}
                onClick={() => setSort(id)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${sort === id ? 'bg-foreground text-card' : 'bg-card text-muted-foreground ring-1 ring-border hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <p className="m-4 rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">此賣場目前沒有上架商品</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
            {list.map((p) => (
              <ProductCard key={p.id} product={p} seller={seller} checkin={checkin} onOpen={() => onOpenProduct(p.id)} />
            ))}
          </div>
        )}
      </div>
      )}
      <div className="space-y-3 border-t border-border/70 p-4">
        <BusinessBlock seller={seller} />
        <CouponDisclaimer />
      </div>
      {reportOpen && (
        <ReportModal
          title="檢舉此賣家"
          target={{ name: seller.name, seller }}
          left={reportsLeft}
          onClose={() => setReportOpen(false)}
          onSubmit={(reason, note, evidence) => {
            setReportOpen(false)
            onReport(reason, note, evidence)
          }}
        />
      )}
    </Modal>
  )
}

/* ----------------------------------------------------------------------------
 * 聊聊 Modal
 * -------------------------------------------------------------------------- */

function ChatModal({ seller, viewer = null, onClose }: { seller: Seller; viewer?: Viewer | null; onClose: () => void }) {
  const [msgs, setMsgs] = useState<{ from: 'me' | 'seller'; text: string }[]>([
    { from: 'seller', text: `您好，歡迎來到「${seller.name}」，有任何問題都可以直接問我！` },
  ])
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [msgs, typing])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const send = () => {
    const t = text.trim()
    if (!t) return
    setMsgs((m) => [...m, { from: 'me', text: t }])
    setText('')
    setTyping(true)
    timer.current = setTimeout(() => {
      setTyping(false)
      setMsgs((m) => [...m, { from: 'seller', text: '收到！我確認一下庫存與出貨時間，稍後馬上回覆您。' }])
    }, 1100)
  }

  return (
    <Modal title={`與 ${seller.name} 聊聊`} onClose={onClose} size="sm" z={75}>
      <div className="flex h-[26rem] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto bg-muted/40 p-4">
          {msgs.map((m, i) => (
            <div key={i} className={`flex items-end gap-2 ${m.from === 'me' ? 'flex-row-reverse' : ''}`}>
              {m.from === 'me' ? (
                viewer ? <UserAvatar name={viewer.name} tone={viewer.tone} src={viewer.avatar} size="size-8" textSize="text-xs" /> : null
              ) : (
                <Avatar seller={seller} size="size-8" />
              )}
              <p
                className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  m.from === 'me' ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border border-border/70 bg-card'
                }`}
              >
                {m.text}
              </p>
            </div>
          ))}
          {typing && <p className="text-xs text-muted-foreground">賣家輸入中⋯</p>}
          <div ref={endRef} />
        </div>
        <form
          className="flex gap-2 border-t border-border/70 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="輸入訊息⋯" aria-label="聊天訊息" />
          <button type="submit" className={`${btnPrimary} px-4`} aria-label="送出訊息">
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------------------
 * 超商門市選擇器
 * -------------------------------------------------------------------------- */

function StorePicker({
  brand,
  onPick,
  onClose,
}: {
  brand: 'seven' | 'family'
  onPick: (label: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const list = STORES[brand].filter((s) => (s.name + s.addr).includes(q.trim()))
  const prefix = brand === 'seven' ? '7-11' : '全家'
  return (
    <Modal title={`選擇 ${prefix} 取貨門市`} onClose={onClose} size="md" z={85}>
      <div className="space-y-4 p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input className={`${inputCls} pl-9`} placeholder="搜尋門市名稱或地址" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋門市" />
        </div>
        <div
          aria-hidden
          className="relative h-28 overflow-hidden rounded-2xl border border-border/70 bg-secondary [background-image:linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] [background-size:28px_28px]"
        >
          {list.slice(0, 5).map((s, i) => (
            <MapPin
              key={s.id}
              className={`absolute size-6 fill-primary text-card ${chosen === s.id ? 'scale-125 drop-shadow' : ''}`}
              style={{ left: `${14 + i * 17}%`, top: `${20 + ((i * 37) % 50)}%` }}
            />
          ))}
        </div>
        <ul className="space-y-2" role="radiogroup" aria-label="門市列表">
          {list.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                role="radio"
                aria-checked={chosen === s.id}
                onClick={() => setChosen(s.id)}
                className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${chosen === s.id ? 'border-primary bg-accent' : 'border-border hover:border-primary/50'}`}
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-brand-ink" />
                <span>
                  <span className="block text-sm font-bold">{prefix} {s.name}</span>
                  <span className="block text-xs text-muted-foreground">{s.addr}</span>
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">找不到符合的門市</li>}
        </ul>
        <button
          type="button"
          disabled={!chosen}
          className={`${btnPrimary} w-full`}
          onClick={() => {
            const s = STORES[brand].find((x) => x.id === chosen)
            if (s) onPick(`${prefix} ${s.name}`)
          }}
        >
          確認門市
        </button>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------------------
 * 購物車（拆單）與結帳
 * -------------------------------------------------------------------------- */

function CartModal({
  cart,
  products,
  sellers,
  loggedIn,
  buyerName,
  onClose,
  onQty,
  onRemove,
  onOpenStore,
  onNeedLogin,
  onCheckout,
  coupons,
  ownedCodes,
  wallet,
  onFindSimilar,
  onMoveFollow,
}: {
  cart: CartLine[]
  products: Product[]
  sellers: Seller[]
  loggedIn: boolean
  buyerName: string
  onClose: () => void
  onQty: (key: string, delta: number) => void
  onRemove: (key: string) => void
  onOpenStore: (sellerId: string) => void
  onNeedLogin: () => void
  onCheckout: (p: CheckoutPayload) => Order[]
  coupons: Coupon[]
  ownedCodes: string[]
  wallet: WalletEntry[]
  onFindSimilar: (productId: string) => void
  onMoveFollow: (sellerId: string) => void
}) {
  const [codeInput, setCodeInput] = useState('')
  const [codeApplied, setCodeApplied] = useState<string | null>(null)
  const [codeError, setCodeError] = useState('')
  const [step, setStep] = useState<'cart' | 'checkout' | 'done'>('cart')
  const [ship, setShip] = useState<ShipKey>('seven')
  const [store, setStore] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<'seven' | 'family' | null>(null)
  const [pay, setPay] = useState<PayMethod>('card')
  const [recipient, setRecipient] = useState({ name: buyerName, phone: '', address: '' })
  const [card, setCard] = useState<CardForm>(emptyCard)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [created, setCreated] = useState<Order[]>([])
  const [secure, setSecure] = useState(false)
  const [payError, setPayError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [unpicked, setUnpicked] = useState<string[]>([])
  const [agreed, setAgreed] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)

  const groups = useMemo(() => {
    const map = new Map<string, { seller: Seller; lines: { line: CartLine; product: Product }[] }>()
    cart.forEach((line) => {
      const product = products.find((p) => p.id === line.productId)
      if (!product) return
      const seller = sellers.find((s) => s.id === product.sellerId)
      if (!seller) return
      const g = map.get(seller.id) ?? { seller, lines: [] }
      g.lines.push({ line, product })
      map.set(seller.id, g)
    })
    return Array.from(map.values()).map((g) => {
      const subtotal = g.lines.reduce((s, l) => s + unitPrice(l.product, l.line.variant) * l.line.qty, 0)
      return { ...g, subtotal }
    })
  }, [cart, products, sellers])

  const withShip = groups.filter((g) => !isOffline(g.seller)).map((g) => ({ ...g, shipping: shipFee(ship, g.subtotal) }))
  const offlineGroups = groups.filter((g) => isOffline(g.seller))
  const checked = withShip.filter((g) => !unpicked.includes(g.seller.id))
  const totalGoods = checked.reduce((s, g) => s + g.subtotal, 0)
  const totalShip = checked.reduce((s, g) => s + g.shipping, 0)
  const coupon = codeApplied ? coupons.find((c) => c.code === codeApplied) : undefined
  const couponGroup = coupon ? checked.find((g) => g.seller.id === coupon.sellerId) : undefined
  const shortage = coupon && couponGroup ? Math.max(0, coupon.minSpend - couponGroup.subtotal) : 0
  const discount = coupon && couponGroup && shortage === 0 ? Math.min(coupon.amount, couponGroup.subtotal) : 0
  const grand = totalGoods + totalShip - discount
  const count = cart.reduce((s, l) => s + l.qty, 0)

  const applyCode = (preset?: string) => {
    const code = (preset ?? codeInput).trim().toUpperCase()
    setCodeError('')
    if (!code) return setCodeError('請輸入折扣碼')
    const c = coupons.find((x) => x.code === code)
    if (!c || !c.active) return setCodeError('查無此折扣碼，請確認是否輸入正確')
    if (c.listed && !ownedCodes.includes(c.code)) return setCodeError('此券需先在「天天簽到專區」用點數兌換後才能使用（已使用或已過期的券無法再用）')
    const owner = sellers.find((s) => s.id === c.sellerId)
    if (!withShip.some((g) => g.seller.id === c.sellerId)) return setCodeError(`此券僅限「${owner?.name ?? '指定店家'}」的商品使用，購物車內沒有該店商品`)
    setCodeApplied(c.code)
  }
  const clearCode = () => {
    setCodeApplied(null)
    setCodeInput('')
    setCodeError('')
  }

  const selectShip = (k: ShipKey) => {
    setShip(k)
    setStore(null)
    if (k !== 'home') setPickerFor(k)
  }

  const submit = () => {
    const e: Record<string, string> = {}
    if (!recipient.name.trim()) e.name = '請輸入收件人姓名'
    if (!/^09\d{8}$/.test(recipient.phone)) e.phone = '請輸入 10 碼手機號碼（09 開頭）'
    if (ship === 'home' && !recipient.address.trim()) e.address = '請輸入收件地址'
    if (ship !== 'home' && !store) e.store = '請選擇取貨門市'
    if (!agreed) e.terms = '請先勾選同意服務條款與隱私政策'
    const cardErr = pay === 'card' ? validateCard(card) : {}
    setErrors({ ...e, ...cardErr })
    if (Object.keys(e).length || Object.keys(cardErr).length) return
    setPayError('')
    if (pay === 'card') {
      setSecure(true)
      return
    }
    placeOrder()
  }

  const placeOrder = () => {
    const result = onCheckout({
      pay,
      ship,
      shipTo: ship === 'home' ? recipient.address.trim() : (store as string),
      buyer: recipient.name.trim(),
      sellerIds: checked.map((g) => g.seller.id),
      coupon: coupon && discount > 0 ? { id: coupon.id, code: coupon.code, sellerId: coupon.sellerId, discount } : undefined,
    })
    setSecure(false)
    setCreated(result)
    setStep('done')
  }

  const title = step === 'cart' ? `購物車（${count}）` : step === 'checkout' ? '結帳' : '訂單已成立'

  return (
    <>
      <Modal title={title} onClose={onClose} size="lg" z={70}>
        {step === 'cart' && (
          <div className="space-y-4 p-5">
            {groups.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-14 text-center">
                <ShoppingCart className="size-12 text-border" />
                <p className="text-sm text-muted-foreground">購物車還是空的，去市集逛逛吧</p>
                <button type="button" onClick={onClose} className={btnPrimary}>繼續逛市集</button>
              </div>
            ) : (
              <>
                <p className="flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-xs text-secondary-foreground">
                  <Megaphone className="size-4 shrink-0" />
                  購物車已依賣家自動拆單，各賣家獨立計算運費（單一賣家滿 {money(FREE_SHIP)} 免運）
                </p>
                {withShip.map((g) => (
                  <section key={g.seller.id} className={`${panelCls} overflow-hidden`} aria-label={`${g.seller.name} 的商品`}>
                    <header className="flex items-center gap-2 border-b border-border/60 bg-muted/50 px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`勾選 ${g.seller.name} 的商品一起結帳`}
                        checked={!unpicked.includes(g.seller.id)}
                        onChange={() => setUnpicked((u) => (u.includes(g.seller.id) ? u.filter((x) => x !== g.seller.id) : [...u, g.seller.id]))}
                        className="size-[18px] shrink-0 accent-primary"
                      />
                      <Store className="size-4 text-brand-ink" />
                      <button type="button" onClick={() => onOpenStore(g.seller.id)} className="text-sm font-black hover:text-brand-ink hover:underline">
                        {g.seller.name}
                      </button>
                      {g.seller.verify === 'approved' && <VerifiedBadge />}
                      <span className="ml-auto text-xs text-muted-foreground">{unpicked.includes(g.seller.id) ? '未勾選・本次不結帳' : `訂單 ${checked.indexOf(g) + 1}`}</span>
                    </header>
                    <ul className="divide-y divide-border/60">
                      {g.lines.map(({ line, product }) => (
                        <li key={line.key} className="flex gap-3 p-4">
                          <div className="size-20 shrink-0 overflow-hidden rounded-xl border border-border/70">
                            <ProductImage src={product.image} alt={product.name} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-bold">{product.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{Object.values(line.variant).join(' / ')}</p>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                              <div className="inline-flex items-center rounded-full border border-border">
                                <button type="button" aria-label="減少數量" className="rounded-l-full p-1.5 hover:bg-muted" onClick={() => onQty(line.key, -1)}>
                                  <Minus className="size-3.5" />
                                </button>
                                <span className="w-8 text-center text-sm font-bold">{line.qty}</span>
                                <button type="button" aria-label="增加數量" className="rounded-r-full p-1.5 hover:bg-muted disabled:opacity-40" disabled={line.qty >= stockFor(product, line.variant)} onClick={() => onQty(line.key, 1)}>
                                  <Plus className="size-3.5" />
                                </button>
                              </div>
                              <p className="text-sm font-black text-brand-ink">{money(unitPrice(product, line.variant) * line.qty)}</p>
                            </div>
                          </div>
                          <button type="button" aria-label={`移除 ${product.name}`} onClick={() => onRemove(line.key)} className="self-start rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive">
                            <Trash2 className="size-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <footer className="space-y-1 border-t border-border/60 bg-muted/30 px-4 py-3 text-sm">
                      <div className="flex justify-between text-muted-foreground"><span>商品小計</span><span>{money(g.subtotal)}</span></div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>運費（{SHIP[ship].label}）</span>
                        <span className={g.shipping === 0 ? 'font-bold text-emerald-600' : ''}>{g.shipping === 0 ? '免運' : money(g.shipping)}</span>
                      </div>
                      {g.shipping > 0 && (
                        <p className="text-xs text-brand-ink">再買 {money(FREE_SHIP - g.subtotal)} 即享免運</p>
                      )}
                    </footer>
                  </section>
                ))}
                {offlineGroups.map((g) => (
                  <section key={g.seller.id} className="overflow-hidden rounded-2xl border-2 border-destructive/40 bg-red-50/60" aria-label={`${g.seller.name} 休館中`}>
                    <header className="flex flex-wrap items-center gap-2 border-b border-destructive/20 px-4 py-2.5">
                      <Store className="size-4 text-destructive" />
                      <button type="button" onClick={() => onOpenStore(g.seller.id)} className="text-sm font-black hover:underline">{g.seller.name}</button>
                      <Pill tone="bad">休館中</Pill>
                    </header>
                    <p className="flex items-start gap-1.5 px-4 pt-3 text-sm font-bold text-red-700" role="alert">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" />
                      該店鋪正在進行系統維護或結帳升級中，暫時無法下單
                    </p>
                    <ul className="divide-y divide-destructive/10">
                      {g.lines.map(({ line, product }) => (
                        <li key={line.key} className="flex gap-3 p-4">
                          <div className="size-16 shrink-0 overflow-hidden rounded-xl border border-border/70 opacity-50 grayscale">
                            <ProductImage src={product.image} alt={product.name} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-bold text-muted-foreground">{product.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{Object.values(line.variant).join(' / ')}・×{line.qty}</p>
                          </div>
                          <button type="button" aria-label={`移除 ${product.name}`} onClick={() => onRemove(line.key)} className="self-start rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive">
                            <Trash2 className="size-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2 border-t border-destructive/20 px-4 py-3">
                      <button type="button" className={btnGhost} onClick={() => onFindSimilar(g.lines[0].product.id)}>尋找類似商品</button>
                      <button type="button" className={btnGhost} onClick={() => onMoveFollow(g.seller.id)}>移至追蹤</button>
                    </div>
                  </section>
                ))}
                <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-card/95 px-5 py-4 backdrop-blur">
                  <div>
                    <p className="text-xs text-muted-foreground">已勾選 {checked.length} 筆訂單・合計（含運）</p>
                    <p className="text-2xl font-black text-brand-ink">{money(grand)}</p>
                  </div>
                  <button
                    type="button"
                    className={`${btnPrimary} disabled:cursor-not-allowed disabled:opacity-50`}
                    disabled={checked.length === 0}
                    onClick={() => (loggedIn ? setStep('checkout') : onNeedLogin())}
                  >
                    {loggedIn ? '前往結帳' : '登入後結帳'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'checkout' && (
          <div className="grid gap-6 p-5 md:grid-cols-[1fr_16rem]">
            <div className="space-y-6">
              <section className="space-y-3" aria-label="物流方式">
                <h3 className="flex items-center gap-1.5 text-sm font-black"><Truck className="size-4 text-brand-ink" />物流方式</h3>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
                  {(Object.keys(SHIP) as ShipKey[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={ship === k}
                      onClick={() => selectShip(k)}
                      className={`rounded-2xl border p-3 text-left transition ${ship === k ? 'border-primary bg-accent' : 'border-border hover:border-primary/50'}`}
                    >
                      <span className="block text-sm font-bold">{SHIP[k].label}</span>
                      <span className="block text-xs text-muted-foreground">{money(SHIP[k].fee)} / 賣家</span>
                    </button>
                  ))}
                </div>
                {ship !== 'home' && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setPickerFor(ship as 'seven' | 'family')}
                      className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition hover:bg-muted ${errors.store ? 'border-destructive' : 'border-input'}`}
                    >
                      <MapPin className="size-4 text-brand-ink" />
                      <span className="flex-1 font-medium">{store ?? '點擊選擇取件門市'}</span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                    {errors.store && <p className="mt-1 text-xs font-medium text-destructive">{errors.store}</p>}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="收件人" error={errors.name}>
                    <input className={inputCls} value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} />
                  </Field>
                  <Field label="手機號碼" error={errors.phone}>
                    <input inputMode="numeric" className={inputCls} placeholder="0912345678" value={recipient.phone} onChange={(e) => setRecipient({ ...recipient, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
                  </Field>
                  {ship === 'home' && (
                    <div className="sm:col-span-2">
                      <Field label="收件地址" error={errors.address}>
                        <input className={inputCls} value={recipient.address} onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} placeholder="縣市、區、路街、門牌" />
                      </Field>
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-3" aria-label="付款方式">
                <h3 className="flex items-center gap-1.5 text-sm font-black"><Wallet className="size-4 text-brand-ink" />付款方式</h3>
                <EcpayEscrowNotice />
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                  {(
                    [
                      ['card', '線上信用卡刷卡', CreditCard],
                      ['atm', '銀行轉帳 / ATM', Landmark],
                    ] as const
                  ).map(([k, label, Icon]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={pay === k}
                      onClick={() => setPay(k)}
                      className={`flex items-center gap-2 rounded-2xl border p-3 text-sm font-bold transition ${pay === k ? 'border-primary bg-accent' : 'border-border hover:border-primary/50'}`}
                    >
                      <Icon className="size-4 text-brand-ink" />
                      {label}
                    </button>
                  ))}
                </div>
                {pay === 'card' ? (
                  <>
                    <CardFields value={card} onChange={setCard} errors={errors} />
                    {payError && (
                      <p className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700" role="alert">
                        <CircleAlert className="size-4 shrink-0" />{payError}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="rounded-2xl bg-secondary p-4 text-sm leading-relaxed text-secondary-foreground">
                    <p className="font-bold">送出訂單後將產生各賣家專屬的虛擬帳號</p>
                    <p className="mt-1 text-xs">請於 3 日內完成轉帳，逾期訂單將自動取消；賣家確認收款後才會出貨。</p>
                  </div>
                )}
              </section>
            </div>

            <aside className={`${panelCls} h-fit space-y-3 p-4 text-sm`} aria-label="訂單摘要">
              <h3 className="font-black">訂單摘要</h3>
              {checked.map((g) => (
                <div key={g.seller.id} className="space-y-0.5 border-b border-border/60 pb-2">
                  <p className="text-xs font-bold">{g.seller.name}</p>
                  <div className="flex justify-between text-xs text-muted-foreground"><span>商品</span><span>{money(g.subtotal)}</span></div>
                  <div className="flex justify-between text-xs text-muted-foreground"><span>運費</span><span>{g.shipping === 0 ? '免運' : money(g.shipping)}</span></div>
                </div>
              ))}
              <div className="space-y-1.5 border-b border-border/60 pb-3">
                <label htmlFor="coupon-code" className="flex items-center gap-1 text-xs font-bold">
                  <Ticket className="size-3.5 text-brand-ink" />輸入折扣碼 / 優惠券
                </label>
                {coupon && couponGroup ? (
                  <div className="flex items-center justify-between rounded-xl bg-accent px-3 py-2 text-xs">
                    <span className="font-black">{coupon.code}</span>
                    <button type="button" onClick={clearCode} className="font-bold text-brand-ink hover:underline">移除</button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <input
                      id="coupon-code"
                      className={`${inputCls} min-w-0 uppercase`}
                      placeholder="輸入折扣碼，如 SHOP50"
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) applyCode()
                      }}
                    />
                    <button type="button" onClick={() => applyCode()} className={btnGhost}>套用</button>
                  </div>
                )}
                {!coupon && (
                  <button type="button" onClick={() => setPickerOpen(true)} className={`${btnGhost} w-full`}>
                    <Ticket className="size-4" />選擇我的優惠券（{wallet.filter((w) => walletStatus(w) === 'unused' && groups.some((g) => g.seller.id === w.sellerId)).length}）
                  </button>
                )}
                {codeError && <p className="text-xs font-bold text-destructive" role="alert">{codeError}</p>}
                {coupon && couponGroup && shortage > 0 && (
                  <p className="text-xs font-bold text-amber-700" role="alert">未達該券使用門檻（還差 {money(shortage)}）</p>
                )}
                {coupon && couponGroup && shortage === 0 && (
                  <p className="text-xs font-bold text-emerald-600">已折抵「{couponGroup.seller.name}」商品 {money(discount)}</p>
                )}
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-xs font-bold text-emerald-600"><span>優惠券折抵</span><span>-{money(discount)}</span></div>
              )}
              <div className="flex justify-between text-base font-black text-brand-ink"><span>應付總額</span><span>{money(grand)}</span></div>
              <div className="space-y-1">
                <label className="flex items-start gap-2 text-xs leading-relaxed">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => {
                      setAgreed(e.target.checked)
                      if (e.target.checked) setErrors((er) => ({ ...er, terms: '' }))
                    }}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span>
                    我已閱讀並同意
                    <button type="button" onClick={() => setTermsOpen(true)} className="mx-0.5 font-bold text-brand-ink underline">服務條款與隱私政策</button>
                  </span>
                </label>
                {errors.terms && <p role="alert" className="text-xs font-bold text-destructive">{errors.terms}</p>}
              </div>
              <button type="button" onClick={submit} className={`${btnPrimary} w-full`}>
                {pay === 'card' ? `確認刷卡 ${money(grand)}` : '送出訂單'}
              </button>
              <button type="button" onClick={() => setStep('cart')} className={`${btnGhost} w-full`}>返回購物車</button>
            </aside>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-5 p-5">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check className="size-8" /></span>
              <h3 className="text-lg font-black">已為您拆成 {created.length} 筆訂單</h3>
              <p className="text-sm text-muted-foreground">
                {created[0]?.pay === 'card' ? '銀行 3D 驗證通過，刷卡扣款成功。' : ''}各賣家將分別出貨，可至「買家中心」追蹤物流
              </p>
            </div>
            <ul className="space-y-3">
              {created.map((o) => {
                const s = sellers.find((x) => x.id === o.sellerId)
                return (
                  <li key={o.id} className={`${panelCls} p-4`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-black">{s?.name}</p>
                      <Pill tone={o.payStatus === '已付款' ? 'ok' : 'warn'}>{o.payStatus}</Pill>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">單號 {o.id}・{SHIP[o.shipMethod].label}・{o.shipTo}</p>
                    <p className="mt-2 text-sm">{o.items.map((i) => `${i.name} ×${i.qty}`).join('、')}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        含運費 {money(o.shipping)}
                        {o.discount ? `・折扣碼 ${o.couponCode} 折抵 ${money(o.discount)}` : ''}
                      </span>
                      <span className="font-black text-brand-ink">{money(o.total)}</span>
                    </div>
                    {o.pay === 'atm' && (
                      <p className="mt-2 rounded-xl bg-secondary px-3 py-2 text-xs text-secondary-foreground">
                        轉帳帳號：玉山銀行(808) 0{o.id.slice(-6)}{o.sellerId.replace(/\D/g, '').padStart(2, '0')}・請於 3 日內匯款
                      </p>
                    )}
                    <div className="mt-2">
                      <PayoutStatus released={false} paid={o.payStatus === '已付款'} />
                    </div>
                  </li>
                )
              })}
            </ul>
            <button type="button" onClick={onClose} className={`${btnPrimary} w-full`}>繼續逛市集</button>
          </div>
        )}
      </Modal>
      {secure && (
        <BankSecureModal
          amount={grand}
          cardNumber={card.number}
          onSuccess={placeOrder}
          onCancel={(reason) => {
            setSecure(false)
            setPayError(reason === 'fail' ? '動態密碼連續輸入錯誤 3 次，銀行已取消本次交易，請重新送出訂單' : '您已取消 3D 驗證，訂單尚未成立，未產生任何扣款')
          }}
        />
      )}
      {pickerFor && (
        <StorePicker
          brand={pickerFor}
          onClose={() => setPickerFor(null)}
          onPick={(label) => {
            setStore(label)
            setErrors((e) => ({ ...e, store: '' }))
            setPickerFor(null)
          }}
        />
      )}

      {termsOpen && <TermsModal onClose={() => setTermsOpen(false)} />}
      {pickerOpen && (
        <Modal title="選擇我的優惠券" onClose={() => setPickerOpen(false)} size="sm" z={80}>
          <div className="space-y-3 p-4">
            {(() => {
              const mine = wallet.filter((w) => walletStatus(w) === 'unused' && groups.some((g) => g.seller.id === w.sellerId))
              if (!mine.length) {
                return (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <Ticket className="size-10 text-border" />
                    <p className="text-sm text-muted-foreground">購物車內的店家目前沒有您可使用的優惠券</p>
                  </div>
                )
              }
              return (
                <ul className="space-y-2.5">
                  {mine.map((w) => {
                    const g = groups.find((x) => x.seller.id === w.sellerId)!
                    const offline = isOffline(g.seller)
                    const lack = Math.max(0, w.minSpend - g.subtotal)
                    const usable = !offline && lack === 0
                    return (
                      <li key={w.id} className={`${panelCls} flex items-center gap-3 p-3 ${usable ? '' : 'opacity-70'}`}>
                        <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl bg-primary text-primary-foreground">
                          <span className="text-[10px] font-bold">折抵</span>
                          <span className="text-sm font-black">{money(w.amount)}</span>
                        </div>
                        <div className="min-w-0 flex-1 text-xs">
                          <p className="truncate text-sm font-black">{g.seller.name}</p>
                          <p className="text-muted-foreground">滿 {money(w.minSpend)} 可用・期限 {w.expiresAt.replace(/-/g, '/')}</p>
                          {offline ? (
                            <p className="font-bold text-destructive">該店鋪正在進行系統維護或結帳升級中，暫時無法下單</p>
                          ) : lack > 0 ? (
                            <p className="font-bold text-amber-700">未達使用門檻，還差 {money(lack)}</p>
                          ) : (
                            <p className="font-bold text-emerald-600">符合使用門檻</p>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={!usable}
                          onClick={() => {
                            applyCode(w.code)
                            setPickerOpen(false)
                          }}
                          className={`${btnPrimary} shrink-0 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          套用
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )
            })()}
          </div>
        </Modal>
      )}
    </>
  )
}

/* ----------------------------------------------------------------------------
 * 銀行 3D 驗證（模擬）
 * -------------------------------------------------------------------------- */

function BankSecureModal({
  amount,
  cardNumber,
  onCancel,
  onSuccess,
}: {
  amount: number
  cardNumber: string
  onCancel: (reason?: 'fail') => void
  onSuccess: () => void
}) {
  const digits = cardNumber.replace(/\s/g, '')
  const bank = BANKS[digits.split('').reduce((s, c) => s + Number(c), 0) % BANKS.length]
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState(120)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const confirm = () => {
    if (busy) return
    if (left === 0) return setError('動態密碼已逾時，請重新發送')
    if (otp.length !== 6) return setError('請輸入 6 碼動態簡訊密碼')
    if (otp !== OTP_CODE) {
      const n = tries + 1
      setTries(n)
      if (n >= 3) return onCancel('fail')
      return setError(`動態密碼錯誤，還有 ${3 - n} 次機會`)
    }
    setError('')
    setBusy(true)
    timer.current = setTimeout(onSuccess, 1200)
  }

  const resend = () => {
    setLeft(120)
    setOtp('')
    setError('')
  }

  return (
    <Modal title="銀行 3D 交易安全驗證" onClose={() => !busy && onCancel()} size="sm" z={80}>
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-3 rounded-2xl bg-foreground px-4 py-3 text-card">
          <LockKeyhole className="size-6 shrink-0" />
          <div className="min-w-0">
            <p className="text-base font-black">{bank}</p>
            <p className="text-xs opacity-80">Verified by 3D Secure・交易安全驗證</p>
          </div>
        </div>

        <dl className="space-y-2 rounded-2xl border border-border/70 bg-muted/40 p-4 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">特約商店</dt><dd className="font-bold">買個 Pay 服</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">信用卡號</dt><dd className="font-mono font-bold">**** **** **** {digits.slice(-4)}</dd></div>
          <div className="flex items-baseline justify-between gap-3 border-t border-border/60 pt-2">
            <dt className="text-muted-foreground">扣款金額</dt>
            <dd className="text-2xl font-black text-brand-ink">{money(amount)}</dd>
          </div>
        </dl>

        <p className="flex items-start gap-2 rounded-xl bg-secondary px-3 py-2.5 text-xs leading-relaxed text-secondary-foreground">
          <Smartphone className="mt-0.5 size-4 shrink-0" />
          <span>動態簡訊密碼 (OTP) 已發送至綁定手機 <b className="font-mono">{BUYER_PHONE_MASKED}</b>，請於時限內輸入。</span>
        </p>

        <Field label="動態簡訊密碼 (6 碼)" error={error}>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otp}
            disabled={busy}
            onChange={(e) => {
              setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
              setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) confirm()
            }}
            className={`${inputCls} text-center font-mono text-xl tracking-[0.5em]`}
            placeholder="000000"
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            測試用密碼：<button type="button" onClick={() => setOtp(OTP_CODE)} className="font-mono font-bold text-brand-ink underline">{OTP_CODE}</button>
          </span>
          {left > 0 ? (
            <span>有效時間 {Math.floor(left / 60)}:{pad(left % 60)}</span>
          ) : (
            <button type="button" onClick={resend} className="font-bold text-brand-ink underline">重新發送密碼</button>
          )}
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={() => onCancel()} disabled={busy} className={`${btnGhost} flex-1`}>取消交易</button>
          <button type="button" onClick={confirm} disabled={busy} className={`${btnPrimary} flex-1`}>
            {busy ? <><Loader2 className="size-4 animate-spin" />銀行授權中</> : '確認付款'}
          </button>
        </div>
        <p className="text-center text-[11px] text-muted-foreground">此為模擬畫面，不會產生真實扣款</p>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------------------
 * 買家中心
 * -------------------------------------------------------------------------- */

type CenterTab = 'all' | 'unpaid' | 'toShip' | 'shipping' | 'done' | 'coupons' | 'favorites' | 'following' | 'profile' | 'security' | 'support'

const STAGE_META: Record<BuyerStage, { label: string; tone: Tone }> = {
  unpaid: { label: '待付款', tone: 'warn' },
  toShip: { label: '待出貨', tone: 'brand' },
  shipping: { label: '待收貨', tone: 'brand' },
  done: { label: '已完成', tone: 'ok' },
}

function StarPicker({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} 顆星`}
          onClick={() => onChange(i)}
          className="rounded-md p-0.5 transition hover:scale-110"
        >
          <Star className={`size-7 ${i <= value ? 'fill-primary text-primary' : 'fill-muted text-border'}`} />
        </button>
      ))}
    </div>
  )
}

const STAR_WORDS = ['', '非常不滿意', '不滿意', '普通', '滿意', '非常滿意']

function OrderReviewModal({
  order,
  onClose,
  onSubmit,
}: {
  order: Order
  onClose: () => void
  onSubmit: (inputs: ReviewInput[]) => void
}) {
  const [inputs, setInputs] = useState<ReviewInput[]>(order.items.map(() => ({ rating: 0, text: '' })))
  const [error, setError] = useState('')
  const patch = (i: number, p: Partial<ReviewInput>) => {
    setError('')
    setInputs((l) => l.map((x, idx) => (idx === i ? { ...x, ...p } : x)))
  }
  const submit = () => {
    if (inputs.some((x) => x.rating === 0)) return setError('請為每件商品評分')
    onSubmit(inputs)
  }
  return (
    <Modal title="評價商品" onClose={onClose} size="md" z={70}>
      <div className="space-y-4 p-5">
        <p className="text-xs text-muted-foreground">訂單 {order.id}・評價會公開顯示在商品頁面</p>
        {order.items.map((it, i) => (
          <section key={`${it.name}-${i}`} className={`${panelCls} space-y-3 p-4`} aria-label={`評價 ${it.name}`}>
            <div>
              <p className="text-sm font-black">{it.name}</p>
              <p className="text-xs text-muted-foreground">{it.variant}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StarPicker value={inputs[i].rating} onChange={(v) => patch(i, { rating: v })} label={`${it.name} 評分`} />
              <span className="text-sm font-bold text-brand-ink">{STAR_WORDS[inputs[i].rating]}</span>
            </div>
            <textarea
              rows={3}
              maxLength={200}
              value={inputs[i].text}
              onChange={(e) => patch(i, { text: e.target.value })}
              className={inputCls}
              placeholder="分享你的使用心得（選填，最多 200 字）"
              aria-label={`${it.name} 心得`}
            />
          </section>
        ))}
        {error && (
          <p className="flex items-center gap-1 text-xs font-medium text-destructive" role="alert">
            <CircleAlert className="size-3.5" />{error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={`${btnGhost} flex-1`}>稍後再說</button>
          <button type="button" onClick={submit} className={`${btnPrimary} flex-1`}>送出評價</button>
        </div>
      </div>
    </Modal>
  )
}

function TrackModal({
  order,
  sellerName,
  onClose,
  onAdvance,
}: {
  order: Order
  sellerName: string
  onClose: () => void
  onAdvance: () => void
}) {
  const stage = order.stage ?? 0
  const steps = trackSteps(order, sellerName)
  return (
    <Modal title="物流動態" onClose={onClose} size="sm" z={70}>
      <div className="space-y-5 p-5">
        <dl className="space-y-1.5 rounded-2xl bg-muted/50 p-4 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">物流單號</dt><dd className="font-mono font-bold">{order.tracking ?? '--'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">配送方式</dt><dd className="font-bold">{SHIP[order.shipMethod].label}</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted-foreground">收件地點</dt><dd className="text-right font-bold">{order.shipTo}</dd></div>
        </dl>

        <ol className="space-y-0" aria-label="物流軌跡">
          {steps.map((s, i) => {
            const reached = i <= stage
            const current = i === stage
            return (
              <li key={s.label} className="relative flex gap-3 pb-5 last:pb-0" aria-current={current ? 'step' : undefined}>
                {i < steps.length - 1 && (
                  <span aria-hidden className={`absolute left-3 top-7 bottom-0 w-0.5 -translate-x-1/2 ${i < stage ? 'bg-primary' : 'bg-border'}`} />
                )}
                <span
                  className={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
                    reached ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-transparent'
                  } ${current ? 'ring-4 ring-primary/25' : ''}`}
                >
                  <Check className="size-3.5" />
                </span>
                <div className={`min-w-0 flex-1 ${reached ? '' : 'opacity-50'}`}>
                  <p className={`text-sm font-black ${current ? 'text-brand-ink' : ''}`}>{s.label}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{s.detail}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{reached ? s.time : '尚未更新'}</p>
                </div>
              </li>
            )
          })}
        </ol>

        <div className="space-y-2 border-t border-border/60 pt-4">
          <button type="button" onClick={onAdvance} disabled={stage >= LAST_STAGE} className={`${btnGhost} w-full`}>
            <Truck className="size-4" />測試：模擬物流前進一站
          </button>
          <button type="button" onClick={onClose} className={`${btnPrimary} w-full`}>關閉</button>
        </div>
      </div>
    </Modal>
  )
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // 剪貼簿權限被拒時仍顯示已複製提示，買家可手動選取折扣碼
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button type="button" onClick={copy} className={`${btnGhost} px-3 py-1.5 text-xs`}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? '已複製' : '複製折扣碼'}
    </button>
  )
}

function WalletPanel({ wallet, sellers, onGoStore }: { wallet: WalletEntry[]; sellers: Seller[]; onGoStore: (sellerId: string) => void }) {
  const [filter, setFilter] = useState<WalletStatus>('unused')
  const today = new Date().toISOString().slice(0, 10)
  const counts = { unused: 0, used: 0, expired: 0 } as Record<WalletStatus, number>
  wallet.forEach((w) => {
    counts[walletStatus(w)] += 1
  })
  const list = wallet.filter((w) => walletStatus(w) === filter).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
  const FILTERS: { id: WalletStatus; label: string }[] = [
    { id: 'unused', label: '可使用' },
    { id: 'used', label: '已使用' },
    { id: 'expired', label: '已過期' },
  ]
  return (
    <section className="space-y-4" aria-label="我的優惠券">
      <div role="tablist" aria-label="優惠券狀態" className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-4 py-1.5 text-xs font-bold transition ${
              filter === f.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {f.label}（{counts[f.id]}）
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <Ticket className="size-12 text-border" />
          <p className="text-sm text-muted-foreground">
            {filter === 'unused' ? '目前沒有可使用的優惠券，到「天天簽到專區」用點數兌換吧' : filter === 'used' ? '尚未使用過優惠券' : '沒有已過期的優惠券'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((w) => {
            const left = daysBetween(today, w.expiresAt)
            const soon = filter === 'unused' && left <= 7
            return (
              <li key={w.id} className={`${panelCls} flex items-stretch overflow-hidden ${filter === 'unused' ? '' : 'opacity-60'}`}>
                <div className={`flex w-28 shrink-0 flex-col items-center justify-center px-2 py-4 text-center ${filter === 'unused' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  <span className="text-xs font-bold">折抵</span>
                  <span className="text-xl font-black">{money(w.amount)}</span>
                </div>
                <div className="min-w-0 flex-1 space-y-1 p-3 text-xs">
                  <p className="truncate text-sm font-black">{sellers.find((s) => s.id === w.sellerId)?.name ?? '指定店家'}</p>
                  <p className="text-muted-foreground">折扣碼 <b className="font-mono text-foreground">{w.code}</b>・滿 {money(w.minSpend)} 可用</p>
                  <p className="text-muted-foreground">有效期限至 {w.expiresAt.replace(/-/g, '/')}</p>
                  {filter === 'unused' && (
                    <>
                      <p className={`font-bold ${soon ? 'text-amber-700' : 'text-emerald-600'}`}>{left <= 0 ? '今天到期' : `剩餘 ${left} 天`}</p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <CopyCodeButton code={w.code} />
                        <button type="button" onClick={() => onGoStore(w.sellerId)} className={`${btnPrimary} px-3 py-1.5 text-xs`}>
                          <Store className="size-3.5" />前往該店購物
                        </button>
                      </div>
                    </>
                  )}
                  {filter === 'used' && w.usedAt && (
                    <p className="font-bold text-muted-foreground">已於 {w.usedAt.replace(/-/g, '/')} 使用・訂單 {w.orderId}</p>
                  )}
                  {filter === 'expired' && <p className="font-bold text-destructive">已過期，無法再使用</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function shipOverdueDays(o: Order, seller?: Seller) {
  const limit = seller?.shipDays ?? 3
  const t = Date.parse(o.date.replace(/\//g, '-'))
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 86400000) - limit)
}

function sellerKycDone(seller?: Seller) {
  return Boolean(seller?.kyc?.idVerified && seller.kyc.phoneVerified && seller.kyc.bankVerified)
}

function RemitModal({
  order,
  seller,
  onClose,
  onSubmit,
}: {
  order: Order
  seller?: Seller
  onClose: () => void
  onSubmit: (last5: string, fileName?: string) => void
}) {
  const [last5, setLast5] = useState(order.remit?.last5 ?? '')
  const [fileName, setFileName] = useState(order.remit?.fileName ?? '')
  const [error, setError] = useState('')
  const pay = seller?.payment
  const submit = () => {
    if (!/^\d{5}$/.test(last5)) return setError('請輸入轉出帳號後 5 碼')
    onSubmit(last5, fileName || undefined)
  }
  return (
    <Modal title="填寫匯款資料並建立存證" onClose={onClose} size="md" z={70}>
      <div className="space-y-4 p-5">
        <div className="space-y-2 rounded-2xl bg-muted/60 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-black">{seller?.name ?? '賣家'}</span>
            {sellerKycDone(seller) ? (
              <Pill tone="ok"><ShieldCheck className="size-3" />實名已驗證</Pill>
            ) : (
              <Pill tone="warn"><TriangleAlert className="size-3" />實名認證未完成</Pill>
            )}
          </div>
          {pay ? (
            <p className="text-xs leading-relaxed">收款銀行 {pay.bankCode}・帳號 <b className="font-black">{pay.bankAccount}</b>・戶名 {pay.bankHolder}</p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">賣家尚未公開收款帳號，請先透過「聯絡賣家」確認匯款資訊。</p>
          )}
          <p className="text-xs text-muted-foreground">應匯金額 {money(order.total)}</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="remit-last5" className="text-xs font-bold">匯款帳號後 5 碼</label>
          <input id="remit-last5" inputMode="numeric" maxLength={5} className={inputCls} placeholder="12345" value={last5} onChange={(e) => { setLast5(e.target.value.replace(/\D/g, '')); setError('') }} aria-invalid={Boolean(error)} />
          {error && <p className="text-xs font-bold text-destructive" role="alert">{error}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor="remit-file" className="text-xs font-bold">匯款截圖（選填）</label>
          <input id="remit-file" type="file" accept="image/*" className={inputCls} onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')} />
        </div>
        <button type="button" onClick={submit} className={`${btnPrimary} w-full justify-center`}><ShieldCheck className="size-4" />產生數位交易存證</button>
      </div>
    </Modal>
  )
}

function PoliceCertModal({ order, seller, reason, onClose }: { order: Order; seller?: Seller; reason: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const pay = seller?.payment
  const print = () => {
    const w = window.open('', '_blank', 'width=820,height=960')
    if (!w) return
    w.document.write(
      `<html><head><title>報案與消保申訴憑證</title><style>body{font-family:sans-serif;padding:28px;color:#111}h1{font-size:20px;margin:0 0 4px}p{font-size:13px;line-height:1.6;margin:4px 0}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #888;padding:6px 8px;font-size:13px;text-align:left}th{background:#f3f3f3;width:28%}</style></head><body>${ref.current?.innerHTML ?? ''}</body></html>`,
    )
    w.document.close()
    w.focus()
    w.print()
  }
  const row = (k: string, v: string) => (
    <tr key={k}>
      <th>{k}</th>
      <td>{v}</td>
    </tr>
  )
  return (
    <Modal title="警察局報案 / 消保申訴專用憑證（PDF 預覽）" onClose={onClose} size="lg" z={80}>
      <div className="space-y-4 p-5">
        <div ref={ref} className="space-y-2 rounded-2xl border border-border bg-card p-5 text-sm">
          <h1 className="text-lg font-black">交易糾紛存證憑證</h1>
          <p className="text-xs text-muted-foreground">本文件由買個 Pay 服依買家提供之交易紀錄自動產生，僅供報案、凍結帳戶或消保申訴時參考，不代表平台對事實之認定。</p>
          <table className="w-full border-collapse text-xs">
            <tbody>
              {row('憑證編號', `CERT-${order.id}`)}
              {row('產生時間', new Date().toLocaleString('zh-TW'))}
              {row('檢舉原因', reason)}
              {row('訂單編號', order.id)}
              {row('下單日期', order.date)}
              {row('買家', order.buyer)}
              {row('商品明細', order.items.map((i) => `${i.name} x${i.qty}`).join('、'))}
              {row('訂單金額', money(order.total))}
              {row('付款方式', order.pay === 'card' ? '信用卡' : 'ATM 銀行轉帳')}
              {row('匯款存證', order.remit ? `後 5 碼 ${order.remit.last5}・存證編號 ${order.remit.ref}・${order.remit.at}${order.remit.fileName ? `・截圖 ${order.remit.fileName}` : ''}` : '買家尚未上傳匯款資料')}
              {row('賣場名稱', seller?.name ?? '未知賣家')}
              {row('賣家負責人', seller?.owner ?? '未知')}
              {row('身分證 / 統編', seller?.idNo ?? '未知')}
              {row('賣家手機', seller?.kyc?.phone || '未提供')}
              {row('收款銀行帳戶', pay ? `${pay.bankCode}-${pay.bankAccount}（戶名 ${pay.bankHolder}）` : '賣家未提供收款帳戶')}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>關閉</button>
          <button type="button" onClick={print} className={btnPrimary}><FileText className="size-4" />列印 / 儲存為 PDF</button>
        </div>
      </div>
    </Modal>
  )
}

function BuyerCenterModal({
  wallet,
  orders,
  products,
  sellers,
  buyerName,
  onClose,
  onAdvance,
  onReceive,
  onReview,
  onPaid,
  onUrge,
  onRemit,
  onScamReport,
  onContact,
  onRefund,
  onGoStore,
  favorites,
  onToggleFav,
  onOpenProduct,
  followed,
  followPrefs,
  onFollowPref,
  onUnfollow,
  tone,
  nameChangedAt,
  onRename,
  onAvatar,
  avatar,
  onAvatarUpload,
  onAvatarRemove,
  onSwitchSeller,
  tickets,
  onSubmitTicket,
  onReadTicket,
  onNotify,
}: {
  onGoStore: (sellerId: string) => void
  favorites: string[]
  onToggleFav: (id: string) => void
  onOpenProduct: (id: string) => void
  followed: string[]
  followPrefs: Record<string, FollowPrefs>
  onFollowPref: (id: string, key: keyof FollowPrefs) => void
  onUnfollow: (id: string) => void
  tone: number
  nameChangedAt?: string
  onRename: (n: string) => void
  onAvatar: (i: number) => void
  avatar?: string
  onAvatarUpload: (dataUrl: string) => void
  onAvatarRemove: () => void
  onSwitchSeller: () => void
  tickets: SupportTicket[]
  onSubmitTicket: (t: { category: string; subject: string; body: string }) => void
  onReadTicket: (id: string) => void
  onNotify: (m: string) => void
  wallet: WalletEntry[]
  orders: Order[]
  products: Product[]
  sellers: Seller[]
  buyerName: string
  onClose: () => void
  onAdvance: (id: string) => void
  onReceive: (id: string) => void
  onReview: (id: string, inputs: ReviewInput[]) => void
  onPaid: (id: string) => void
  onUrge: (id: string) => void
  onRemit: (id: string, last5: string, fileName?: string) => void
  onScamReport: (id: string, reason: string) => void
  onContact: (sellerId: string) => void
  onRefund: (id: string, r: { type: RefundType; reason: string; note: string }) => void
}) {
  const [tab, setTab] = useState<CenterTab>('all')
  const [trackId, setTrackId] = useState<string | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [refundId, setRefundId] = useState<string | null>(null)
  const refundOrder = orders.find((o) => o.id === refundId)

  const sorted = useMemo(() => [...orders].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)), [orders])
  const count = (s: BuyerStage) => orders.filter((o) => buyerStage(o) === s).length
  const list = tab === 'all' ? sorted : sorted.filter((o) => buyerStage(o) === tab)
  const trackOrder = orders.find((o) => o.id === trackId)
  const reviewOrder = orders.find((o) => o.id === reviewId)
  const seller = (id: string) => sellers.find((s) => s.id === id)
  const [remitId, setRemitId] = useState<string | null>(null)
  const [certId, setCertId] = useState<string | null>(null)
  const remitOrder = remitId ? orders.find((x) => x.id === remitId) : undefined
  const certOrder = certId ? orders.find((x) => x.id === certId) : undefined
  const thumb = (o: Order, it: OrderItem) =>
    (products.find((p) => p.id === it.productId) ?? products.find((p) => p.sellerId === o.sellerId && p.name === it.name))?.image ?? ''

  return (
    <>
      <Modal title={`買家中心・${buyerName}`} onClose={onClose} size="lg" z={60}>
        <BuyerProfileHeader name={buyerName} tone={tone} avatar={avatar} completed={count('done')} onEdit={() => setTab('profile')} />
        <div className="sticky top-0 z-10 border-b border-border/60 bg-card px-4 py-3">
          <Tabs<CenterTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'all', label: '全部訂單' },
              { id: 'unpaid', label: '未付款', badge: count('unpaid') },
              { id: 'toShip', label: '待出貨', badge: count('toShip') },
              { id: 'shipping', label: '待收貨 / 物流動態', badge: count('shipping') },
              { id: 'done', label: '已完成' },
              { id: 'coupons', label: '我的優惠券', badge: wallet.filter((w) => walletStatus(w) === 'unused').length },
              { id: 'favorites', label: '我的收藏', badge: favorites.length },
              { id: 'following', label: '關注賣家', badge: followed.length },
              { id: 'profile', label: '個人資料' },
              { id: 'security', label: '帳戶安全' },
              { id: 'support', label: '客服中心', badge: tickets.filter((t) => t.unread).length },
            ]}
          />
        </div>

        <div className="space-y-4 p-4">
          {tab === 'favorites' ? (
            <FavoritesPanel
              items={favorites.flatMap((id) => {
                const p = products.find((x) => x.id === id)
                return p ? [{ id: p.id, name: p.name, price: p.price, soldOut: p.stock === 0, sellerName: seller(p.sellerId)?.name ?? '' }] : []
              })}
              renderThumb={(id) => <ProductImage src={products.find((p) => p.id === id)?.image ?? ''} alt="" />}
              onOpen={onOpenProduct}
              onToggle={onToggleFav}
            />
          ) : tab === 'following' ? (
            <FollowingPanel
              sellers={followed.flatMap((id) => {
                const sl = seller(id)
                return sl ? [{ id: sl.id, name: sl.name, city: sl.city }] : []
              })}
              prefs={followPrefs}
              renderAvatar={(id) => {
                const sl = seller(id)
                return sl ? <Avatar seller={sl} size="size-11" /> : null
              }}
              onToggle={onFollowPref}
              onUnfollow={onUnfollow}
              onGoStore={onGoStore}
            />
          ) : tab === 'profile' ? (
            <BuyerProfilePanel
              name={buyerName}
              tone={tone}
              avatar={avatar}
              onAvatarUpload={onAvatarUpload}
              onAvatarRemove={onAvatarRemove}
              nameChangedAt={nameChangedAt}
              completed={count('done')}
              onRename={onRename}
              onAvatar={onAvatar}
              onSwitchSeller={onSwitchSeller}
            />
          ) : tab === 'security' ? (
            <SecurityPanel onNotify={onNotify} />
          ) : tab === 'support' ? (
            <SupportCenter role="buyer" author={buyerName} tickets={tickets} onSubmit={onSubmitTicket} onRead={onReadTicket} />
          ) : tab === 'coupons' ? (
            <WalletPanel wallet={wallet} sellers={sellers} onGoStore={onGoStore} />
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <Receipt className="size-12 text-border" />
              <p className="text-sm text-muted-foreground">這個分類目前沒有訂單</p>
            </div>
          ) : (
            list.map((o) => {
              const stage = buyerStage(o)
              const meta = STAGE_META[stage]
              const arrived = (o.stage ?? 0) >= LAST_STAGE
              const latest = trackSteps(o, seller(o.sellerId)?.name ?? '賣家')[Math.min(o.stage ?? 0, LAST_STAGE)]
              return (
                <article key={o.id} className={`${panelCls} overflow-hidden`} aria-label={`訂單 ${o.id}`}>
                  <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 bg-muted/50 px-4 py-2.5">
                    <Store className="size-4 text-brand-ink" />
                    <span className="text-sm font-black">{seller(o.sellerId)?.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{o.id}</span>
                    <span className="ml-auto"><Pill tone={meta.tone}>{meta.label}</Pill></span>
                  </header>

                  <ul className="divide-y divide-border/60">
                    {o.items.map((it, i) => (
                      <li key={`${it.name}-${i}`} className="flex gap-3 p-4">
                        <div className="size-16 shrink-0 overflow-hidden rounded-xl border border-border/70">
                          <ProductImage src={thumb(o, it)} alt={it.name} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-bold">{it.name}</p>
                          <p className="text-xs text-muted-foreground">{it.variant}</p>
                          <p className="mt-1 text-xs text-muted-foreground">x{it.qty}</p>
                        </div>
                        <p className="text-sm font-bold">{money(it.price * it.qty)}</p>
                      </li>
                    ))}
                  </ul>

                  <footer className="space-y-3 border-t border-border/60 bg-muted/30 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">
                        {o.date.replace(/-/g, '/')}・{o.pay === 'card' ? '信用卡' : 'ATM 轉帳'}・{SHIP[o.shipMethod].label}
                      </span>
                      <span>
                        訂單金額 <b className="text-lg font-black text-brand-ink">{money(o.total)}</b>
                      </span>
                    </div>

                    <PayoutStatus released={stage === 'done'} paid={o.payStatus === '已付款'} />
                    {stage === 'unpaid' && (
                      <div className="rounded-xl bg-secondary p-3 text-xs leading-relaxed text-secondary-foreground">
                        <p className="font-bold">轉帳帳號：{atmAccount(o)}</p>
                        <p>請於 3 日內完成匯款，入帳後賣家才會出貨。</p>
                      </div>
                    )}
                    {stage === 'shipping' && (
                      <div className="flex items-start gap-2 rounded-xl bg-accent p-3 text-xs leading-relaxed text-accent-foreground">
                        <Truck className="mt-0.5 size-4 shrink-0" />
                        <div>
                          <p className="font-bold">{latest.label}</p>
                          <p>{latest.time}・物流單號 {o.tracking}</p>
                        </div>
                      </div>
                    )}

                    {o.remit && (
                      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-900">
                        <p className="flex items-center gap-1.5 font-black"><ShieldCheck className="size-4" />數位交易存證卡片</p>
                        <p className="mt-1">存證編號 {o.remit.ref}・訂單 {o.id}・金額 {money(o.total)}</p>
                        <p>匯款帳號後 5 碼 {o.remit.last5}{o.remit.fileName ? `・截圖 ${o.remit.fileName}` : ''}・{o.remit.at}</p>
                      </div>
                    )}
                    {stage === 'toShip' && shipOverdueDays(o, seller(o.sellerId)) > 0 && (
                      <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs font-bold text-destructive">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                        <p>賣家逾期未出貨（已超過承諾出貨天數 {shipOverdueDays(o, seller(o.sellerId))} 天）。您可以一鍵催單，或檢舉詐騙 / 未出貨。</p>
                      </div>
                    )}

                    {o.refund && (
                      <div className="rounded-xl border border-border bg-card p-3 text-xs leading-relaxed">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold">{o.refund.type === 'return' ? '退貨退款申請' : '退款申請'}</span>
                          <Pill tone={o.refund.status === 'pending' ? 'warn' : o.refund.status === 'accepted' ? 'ok' : 'bad'}>
                            {o.refund.status === 'pending' ? '等待賣家回覆' : o.refund.status === 'accepted' ? '賣家已同意' : '賣家已拒絕'}
                          </Pill>
                          <span className="ml-auto text-muted-foreground">{o.refund.at.replace(/-/g, '/')}</span>
                        </div>
                        <p className="mt-1 text-muted-foreground">原因：{o.refund.reason}{o.refund.note ? `・${o.refund.note}` : ''}</p>
                        {o.refund.status !== 'pending' && (
                          <p className="mt-1 font-bold">請直接透過「聯絡賣家」與店鋪確認後續退款或退貨方式。</p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" onClick={() => onContact(o.sellerId)} className={btnGhost}>
                        <Mail className="size-4" />聯絡賣家
                      </button>
                      {stage !== 'unpaid' && !o.refund && (
                        <button type="button" onClick={() => setRefundId(o.id)} className={btnGhost}>
                          <Undo2 className="size-4" />退貨 / 退款申請
                        </button>
                      )}
                      {stage === 'unpaid' && (
                        <>
                          <button type="button" onClick={() => setRemitId(o.id)} className={btnGhost}>
                            <ShieldCheck className="size-4" />{o.remit ? '更新匯款存證' : '填寫匯款資料'}
                          </button>
                          <button type="button" onClick={() => onPaid(o.id)} className={btnGhost}>
                            <Banknote className="size-4" />測試：模擬完成匯款
                          </button>
                        </>
                      )}
                      {stage === 'toShip' && (
                        <>
                          <button type="button" onClick={() => onUrge(o.id)} className={btnGhost}>
                            {shipOverdueDays(o, seller(o.sellerId)) > 0 ? '一鍵催單' : '提醒賣家出貨'}
                          </button>
                          {shipOverdueDays(o, seller(o.sellerId)) > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                onScamReport(o.id, '賣家逾期未出貨')
                                setCertId(o.id)
                              }}
                              className={`${btnGhost} text-destructive`}
                            >
                              <TriangleAlert className="size-4" />檢舉詐騙 / 未出貨
                            </button>
                          )}
                        </>
                      )}
                      {stage === 'shipping' && (
                        <>
                          <button type="button" onClick={() => setTrackId(o.id)} className={btnGhost}>
                            <Truck className="size-4" />查看物流
                          </button>
                          <button
                            type="button"
                            disabled={!arrived}
                            title={arrived ? undefined : '包裹抵達後即可確認收貨'}
                            onClick={() => onReceive(o.id)}
                            className={btnPrimary}
                          >
                            <Check className="size-4" />確認收貨
                          </button>
                        </>
                      )}
                      {stage === 'done' &&
                        (o.reviewed ? (
                          <Pill tone="ok"><Check className="size-3" />已評價</Pill>
                        ) : (
                          <button type="button" onClick={() => setReviewId(o.id)} className={btnPrimary}>
                            <Star className="size-4" />評價商品
                          </button>
                        ))}
                    </div>
                  </footer>
                </article>
              )
            })
          )}
          <DisclaimerNote />
        </div>
      </Modal>

      {remitOrder && (
        <RemitModal
          order={remitOrder}
          seller={seller(remitOrder.sellerId)}
          onClose={() => setRemitId(null)}
          onSubmit={(last5, fileName) => {
            onRemit(remitOrder.id, last5, fileName)
            setRemitId(null)
          }}
        />
      )}
      {certOrder && <PoliceCertModal order={certOrder} seller={seller(certOrder.sellerId)} reason="賣家逾期未出貨" onClose={() => setCertId(null)} />}

      {refundOrder && (
        <RefundModal
          order={refundOrder}
          sellerName={seller(refundOrder.sellerId)?.name ?? '賣家'}
          onClose={() => setRefundId(null)}
          onSubmit={(r) => {
            onRefund(refundOrder.id, r)
            setRefundId(null)
          }}
        />
      )}

      {trackOrder && (
        <TrackModal
          order={trackOrder}
          sellerName={seller(trackOrder.sellerId)?.name ?? '賣家'}
          onClose={() => setTrackId(null)}
          onAdvance={() => onAdvance(trackOrder.id)}
        />
      )}
      {reviewOrder && (
        <OrderReviewModal
          order={reviewOrder}
          onClose={() => setReviewId(null)}
          onSubmit={(inputs) => {
            onReview(reviewOrder.id, inputs)
            setReviewId(null)
          }}
        />
      )}
    </>
  )
}

/* ----------------------------------------------------------------------------
 * 賣家：商品編輯 / 續費
 * -------------------------------------------------------------------------- */

function LegalBanner() {
  return (
    <div role="note" className="flex gap-3 rounded-2xl border-2 border-destructive bg-red-50 p-4 text-sm font-bold leading-relaxed text-red-800">
      <ShieldAlert className="mt-0.5 size-5 shrink-0" />
      <p className="text-pretty">
        本平台為雙向實名制 SaaS 系統。嚴禁販售違禁品、文圖不符商品及金額異常套現。平台配合檢警調閱實名資料，違者一律強制關店、沒收帳號並移送法辦。
      </p>
    </div>
  )
}

type AiTone = 'friendly' | 'flash' | 'refined'

const AI_TONES: { id: AiTone; label: string }[] = [
  { id: 'friendly', label: '親切口語' },
  { id: 'flash', label: '限時搶購' },
  { id: 'refined', label: '質感文青' },
]

const aiPick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]

function generateMarketingCopy({ productName, keywords, price, tone }: { productName: string; keywords: string; price: string; tone: AiTone }) {
  const words = keywords.split(/[\s,，、/]+/).map((s) => s.trim()).filter(Boolean)
  const main = productName.trim() || words[0] || ''
  if (!main) return null
  const points = productName.trim() ? words : words.slice(1)
  const priceText = Number(price) > 0 ? `NT$${Number(price).toLocaleString('en-US')}` : ''
  const pointLines = points.length
    ? points.slice(0, 4).map((p) => `・${p}`)
    : ['・細節用心，日常好上手', '・出貨前逐一檢查，買得安心']

  const openers: Record<AiTone, string[]> = {
    friendly: [`最近一直被問的「${main}」，終於補貨了！`, `朋友們推坑我，現在換我推坑你：${main} 真的好用。`],
    flash: [`限時開搶｜${main}${priceText ? ` 只要 ${priceText}` : ''}`, `${main} 限量特價中，賣完就恢復原價。`],
    refined: [`生活需要一點質感，${main} 陪你把日常過得剛剛好。`, `把平凡的日子過成喜歡的樣子，從 ${main} 開始。`],
  }
  const closers: Record<AiTone, string[]> = {
    friendly: ['喜歡的話記得先下單，數量不多。', '有問題歡迎私訊，我們一起挑到適合你的那一款。'],
    flash: ['優惠只到活動結束，想要的現在下單最安心。', '庫存有限，先搶先得。'],
    refined: ['慢慢挑、慢慢用，值得被好好對待的小物。', '放進購物車，給自己一個小小的犒賞。'],
  }
  const slogans: Record<AiTone, string[]> = {
    friendly: [`${main}，今天帶它回家`, `${priceText || '限時'}好價，日常小物值得入手`, '人氣補貨中，想要的朋友動作要快'],
    flash: [`限時特價${priceText ? ` ${priceText}` : ''}｜${main}`, '倒數開搶，賣完就沒有', '今晚限定價，錯過再等下一檔'],
    refined: [`${main}，日子裡的小確幸`, `質感入手價${priceText ? ` ${priceText}` : ''}，限量上架`, '慢生活，從一件好物開始'],
  }

  const hashtags = [main, '限時特價', '買個Pay服', ...points.slice(0, 2)].map((t) => `#${t.replace(/\s/g, '')}`).join(' ')
  const post = [
    aiPick(openers[tone]),
    '',
    ...pointLines,
    ...(priceText ? ['', `限時活動價 ${priceText}`] : []),
    '',
    aiPick(closers[tone]),
    '',
    hashtags,
  ].join('\n')

  return { post, slogans: slogans[tone] }
}

function AiMarketingHelper({
  productName,
  price,
  onApply,
}: {
  productName: string
  price: string
  onApply: (text: string, mode: 'replace' | 'prepend') => void
}) {
  const [keywords, setKeywords] = useState('')
  const [tone, setTone] = useState<AiTone>('friendly')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ post: string; slogans: string[] } | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [applied, setApplied] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const generate = () => {
    setError('')
    setApplied('')
    const hits = scanBanned(productName, keywords)
    if (hits.length) {
      setResult(null)
      setError(`關鍵字含違禁詞「${hits.join('、')}」，無法生成文案`)
      return
    }
    const copy = generateMarketingCopy({ productName, keywords, price, tone })
    if (!copy) {
      setError('請先輸入商品關鍵字，或先在上方填好商品名稱')
      return
    }
    setLoading(true)
    timer.current = setTimeout(() => {
      setResult(copy)
      setLoading(false)
    }, 700)
  }

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      setError('瀏覽器不允許自動複製，請手動選取文字複製')
    }
  }

  const apply = (key: string, text: string, mode: 'replace' | 'prepend') => {
    onApply(text, mode)
    setApplied(key)
  }

  return (
    <section aria-label="AI 行銷小幫手" className="space-y-3 rounded-2xl border border-primary/40 bg-secondary/60 p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-brand-ink">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-black">AI 行銷小幫手</h3>
          <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
            輸入幾個商品關鍵字，一鍵生成社群行銷貼文與限時特價標語，生成後可直接套用到商品描述。
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="商品關鍵字（以空白或逗號分隔）">
          <input
            className={inputCls}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault()
                if (!loading) generate()
              }
            }}
            placeholder="例：手作 陶瓷 質感 送禮"
          />
        </Field>
        <button type="button" onClick={generate} disabled={loading} className={`${btnPrimary} disabled:cursor-not-allowed disabled:opacity-60`}>
          <Sparkles className="size-4" />
          {loading ? '生成中…' : result ? '重新生成' : '一鍵生成'}
        </button>
      </div>

      <div role="radiogroup" aria-label="文案風格" className="flex flex-wrap gap-2">
        {AI_TONES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={tone === t.id}
            onClick={() => setTone(t.id)}
            className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
              tone === t.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="flex gap-2 rounded-xl border border-destructive/40 bg-red-50 p-2.5 text-xs font-bold text-red-800">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="text-pretty">{error}</span>
        </p>
      )}

      <div aria-live="polite" className="space-y-3">
        {result && !loading && (
          <>
            <div className="rounded-xl border border-border/70 bg-card p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-black">社群促銷貼文</p>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => copyText('post', result.post)} className={`${btnGhost} px-2.5 py-1 text-xs`}>
                    {copied === 'post' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied === 'post' ? '已複製' : '複製貼文'}
                  </button>
                  <button type="button" onClick={() => apply('post', result.post, 'replace')} className={`${btnPrimary} px-2.5 py-1 text-xs`}>
                    {applied === 'post' ? '已套用到描述' : '套用為商品描述'}
                  </button>
                </div>
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{result.post}</pre>
            </div>

            <div className="rounded-xl border border-border/70 bg-card p-3">
              <p className="mb-2 text-xs font-black">限時特價標語</p>
              <ul className="space-y-1.5">
                {result.slogans.map((s) => (
                  <li key={s} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 font-bold">{s}</span>
                    <button type="button" onClick={() => copyText(s, s)} className={`${btnGhost} px-2.5 py-1 text-xs`}>
                      {copied === s ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied === s ? '已複製' : '複製'}
                    </button>
                    <button type="button" onClick={() => apply(s, s, 'prepend')} className={`${btnGhost} px-2.5 py-1 text-xs`}>
                      {applied === s ? '已加入' : '加到描述開頭'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
              AI 生成內容僅供參考，發布前請確認文案與商品實際相符，並遵守圖文相符切結與平台違禁品規範。
            </p>
          </>
        )}
      </div>
    </section>
  )
}

function ProductFormModal({
  product,
  sellerId,
  onSave,
  onClose,
}: {
  product: Product | null
  sellerId: string
  onSave: (p: Product) => void
  onClose: () => void
}) {
  const [name, setName] = useState(product?.name ?? '')
  const [category, setCategory] = useState(product?.category ?? DEFAULT_MAIN)
  const [subCategory, setSubCategory] = useState(product?.subCategory ?? subsOfMain(product?.category ?? DEFAULT_MAIN)[0] ?? '')
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [stock, setStock] = useState(product ? String(product.stock) : '')
  const [desc, setDesc] = useState(product?.desc ?? '')
  const [variantName, setVariantName] = useState(product?.variants[0]?.name ?? '規格')
  const [options, setOptions] = useState(product?.variants[0]?.options.join('、') ?? '標準款')
  const [useSecond, setUseSecond] = useState((product?.variants.length ?? 0) > 1)
  const [variantName2, setVariantName2] = useState(product?.variants[1]?.name ?? '尺寸')
  const [options2, setOptions2] = useState(product?.variants[1]?.options.join('、') ?? '')
  const [comboStockIn, setComboStockIn] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(product?.comboStock ?? {}).map(([k, v]) => [k, String(v)])),
  )
  const [comboPriceIn, setComboPriceIn] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(product?.comboPrice ?? {}).map(([k, v]) => [k, String(v)])),
  )
  const [bulkStock, setBulkStock] = useState('')
  const [bulkPrice, setBulkPrice] = useState('')
  const specTouched = useRef(!!product)
  const autoPreset = useRef(false)
  const [optStock, setOptStock] = useState<Record<string, string>>(() => readOptionMap(product, 'optionStock'))
  const [optPrice, setOptPrice] = useState<Record<string, string>>(() => readOptionMap(product, 'optionPrice'))
  const [specs, setSpecs] = useState(product?.specs.map(([k, v]) => `${k}：${v}`).join('\n') ?? '')
  const [image, setImage] = useState(product?.image ?? IMAGE_OPTIONS[0].src)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [agreed, setAgreed] = useState(false)
  const alertRef = useRef<HTMLDivElement>(null)
  const bannedHits = scanBanned(name, desc, specs, options, variantName, useSecond ? options2 : '', useSecond ? variantName2 : '')
  const priceOver = Number(price) > MAX_PRICE
  const optList = parseOptions(options)
  const optList2 = useSecond ? parseOptions(options2) : []
  const gName1 = variantName.trim() || '規格'
  const gName2 = variantName2.trim() || '規格二'
  const comboRows = useSecond
    ? optList.flatMap((a) => optList2.map((b) => ({ a, b, key: `${optKey(gName1, a)}::${optKey(gName2, b)}` })))
    : []
  const comboTotal = comboRows.reduce((s, r) => s + (Number(comboStockIn[r.key]) || 0), 0)
  const sizeFamily = ['fashion', 'bags'].includes(familyOfMain(category)?.id ?? '')
  const topPriceN = Math.max(
    Number(price) || 0,
    ...optList.map((o) => Number(optPrice[o]) || 0),
    ...comboRows.map((r) => Number(comboPriceIn[r.key]) || 0),
  )
  const applyApparel = () => {
    setVariantName('顏色/款式')
    setUseSecond(true)
    setVariantName2('尺寸')
    if (options === '標準款') setOptions('')
    if (!options2.trim()) setOptions2('S、M、L、XL')
  }
  const applyBulk = () => {
    if (bulkStock !== '') setComboStockIn((m) => ({ ...m, ...Object.fromEntries(comboRows.map((r) => [r.key, bulkStock])) }))
    if (bulkPrice !== '') setComboPriceIn((m) => ({ ...m, ...Object.fromEntries(comboRows.map((r) => [r.key, bulkPrice])) }))
  }

  const submit = () => {
    const e: Record<string, string> = {}
    const priceN = Number(price)
    const stockN = Number(stock)
    if (!name.trim()) e.name = '請輸入商品名稱'
    if (!Number.isInteger(priceN) || priceN <= 0) e.price = '請輸入大於 0 的整數價格'
    if (priceN > MAX_PRICE) e.price = PRICE_LIMIT_MSG
    if (!useSecond && (!Number.isInteger(stockN) || stockN < 0)) e.stock = '請輸入 0 以上的整數庫存'
    const opts = optList
    if (opts.length === 0) e.options = '至少需要一個規格選項'
    if (!useSecond && opts.some((o) => Number(optPrice[o] || 0) > MAX_PRICE)) e.options = PRICE_LIMIT_MSG
    if (useSecond) {
      if (optList2.length === 0) e.options2 = '第二規格至少需要一個選項'
      if (gName1 === gName2) e.options2 = '兩個規格名稱不可相同'
      if (comboRows.length > MAX_COMBOS) e.combos = `組合數量上限 ${MAX_COMBOS} 組，請減少規格選項`
      else if (comboRows.some((r) => (comboStockIn[r.key] ?? '') === '')) e.combos = '請填寫每個組合的庫存（沒有庫存請填 0）'
      if (comboRows.some((r) => Number(comboPriceIn[r.key] || 0) > MAX_PRICE)) e.combos = PRICE_LIMIT_MSG
    }
    if (bannedHits.length) e.risk = '含違禁或敏感詞'
    if (!agreed) e.agreed = '請先勾選圖文相符切結書，才能上架商品'
    setErrors(e)
    if (Object.keys(e).length) {
      if (e.risk || priceN > MAX_PRICE) alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    const specRows = specs
      .split('\n')
      .map((line) => line.split(/[：:]/))
      .filter((p) => p.length >= 2 && p[0].trim())
      .map((p) => [p[0].trim(), p.slice(1).join(':').trim()] as [string, string])
    const gName = gName1
    const optionStock: Record<string, number> = {}
    const optionPrice: Record<string, number> = {}
    const comboStock: Record<string, number> = {}
    const comboPrice: Record<string, number> = {}
    if (useSecond) {
      comboRows.forEach((r) => {
        comboStock[r.key] = Number(comboStockIn[r.key])
        if (comboPriceIn[r.key]) comboPrice[r.key] = Number(comboPriceIn[r.key])
      })
    } else {
      opts.forEach((o) => {
        if ((optStock[o] ?? '') !== '') optionStock[optKey(gName, o)] = Number(optStock[o])
        if (optPrice[o]) optionPrice[optKey(gName, o)] = Number(optPrice[o])
      })
    }
    const allStocked = !useSecond && opts.every((o) => optionStock[optKey(gName, o)] !== undefined)
    const finalStock = useSecond
      ? Object.values(comboStock).reduce((sum, n) => sum + n, 0)
      : allStocked
        ? opts.reduce((sum, o) => sum + optionStock[optKey(gName, o)], 0)
        : stockN
    const top = Math.max(priceN, ...Object.values(optionPrice), ...Object.values(comboPrice))
    const approvedSame = !!product?.reviewApproved && topPrice(product) === top
    const reviewHold = top > REVIEW_PRICE_LIMIT && !approvedSame
    onSave({
      id: product?.id ?? `p${Date.now()}`,
      sellerId,
      name: name.trim(),
      category,
      subCategory: subCategory || undefined,
      price: priceN,
      image,
      variants: useSecond ? [{ name: gName1, options: opts }, { name: gName2, options: optList2 }] : [{ name: gName1, options: opts }],
      stock: finalStock,
      sold: product?.sold ?? 0,
      specs: specRows.length ? specRows : [['品名', name.trim()]],
      desc: desc.trim() || '賣家尚未填寫商品描述。',
      reviews: product?.reviews ?? [],
      active: product?.active ?? true,
      flagged: product?.flagged,
      flagReason: product?.flagReason,
      reviewHold,
      reviewApproved: reviewHold ? false : product?.reviewApproved,
      optionStock: Object.keys(optionStock).length ? optionStock : undefined,
      optionPrice: Object.keys(optionPrice).length ? optionPrice : undefined,
      comboStock: Object.keys(comboStock).length ? comboStock : undefined,
      comboPrice: Object.keys(comboPrice).length ? comboPrice : undefined,
    })
  }

  return (
    <Modal title={product ? '編輯商品' : '上架新商品'} onClose={onClose} size="lg" z={60}>
      <form
        className="grid gap-4 p-5 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="md:col-span-2">
          <LegalBanner />
        </div>
        {(bannedHits.length > 0 || priceOver) && (
          <div ref={alertRef} role="alert" className="space-y-2 md:col-span-2">
            {bannedHits.length > 0 && (
              <div className="flex gap-2.5 rounded-2xl border border-destructive/40 bg-red-50 p-3 text-sm text-red-800">
                <ShieldAlert className="mt-0.5 size-5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-black">偵測到違禁或敏感詞，已強制阻擋上架</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    命中關鍵字：
                    {bannedHits.map((w) => (
                      <mark key={w} className="mx-0.5 rounded bg-destructive px-1.5 py-0.5 font-bold text-card">{w}</mark>
                    ))}
                    。請移除標題、描述、規格中的相關字詞後再送出。
                  </p>
                </div>
              </div>
            )}
            {priceOver && (
              <div className="flex gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-800">
                <TriangleAlert className="mt-0.5 size-5 shrink-0" />
                <p className="text-pretty">{PRICE_LIMIT_MSG}</p>
              </div>
            )}
          </div>
        )}
        {topPriceN > HIGH_PRICE_LIMIT && (
          <div role="note" className="flex gap-2.5 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm leading-relaxed text-blue-950 md:col-span-2">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-blue-700" />
            <p className="text-pretty">
              {topPriceN > REVIEW_PRICE_LIMIT
                ? `最高價格超過 ${money(REVIEW_PRICE_LIMIT)}，送出後商品會先進入「審核中」，平台管理員核准後才會公開。`
                : `最高價格超過 ${money(HIGH_PRICE_LIMIT)}，商品頁會自動顯示高單價防詐安全提示。`}
            </p>
          </div>
        )}
        <div className="md:col-span-2">
          <Field label="商品名稱" error={errors.name}>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="主分類">
            <select
              className={inputCls}
              value={category}
              onChange={(e) => {
                const next = e.target.value
                setCategory(next)
                setSubCategory(subsOfMain(next)[0] ?? '')
                const fam = familyOfMain(next)?.id
                const wantsSize = fam === 'fashion' || fam === 'bags'
                if (!specTouched.current && wantsSize) {
                  applyApparel()
                  autoPreset.current = true
                } else if (!specTouched.current && !wantsSize && autoPreset.current) {
                  setVariantName('規格')
                  setOptions('標準款')
                  setUseSecond(false)
                  setOptions2('')
                  autoPreset.current = false
                }
              }}
            >
              {CATEGORY_FAMILIES.map((f) => (
                <optgroup key={f.id} label={f.label}>
                  {f.mains.map((m) => <option key={m.label} value={m.label}>{m.label}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="子分類">
            <select className={inputCls} value={subCategory} onChange={(e) => setSubCategory(e.target.value)}>
              {subsOfMain(category).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="售價（NT$）" error={errors.price}>
            <input inputMode="numeric" className={inputCls} value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label={useSecond ? '總庫存（自動加總）' : '庫存數量'} error={errors.stock}>
            <input
              inputMode="numeric"
              className={`${inputCls} ${useSecond ? 'bg-muted' : ''}`}
              value={useSecond ? String(comboTotal) : stock}
              readOnly={useSecond}
              onChange={(e) => setStock(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </div>
        <div className="space-y-3 md:col-span-2">
          {sizeFamily && (
            <div role="note" className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-accent px-3 py-2.5 text-sm text-accent-foreground">
              <p className="min-w-0 flex-1 text-pretty font-bold">
                此分類建議使用「顏色/款式 × 尺寸」雙層規格，買家可分別選擇，並看到每個組合的剩餘庫存。
              </p>
              {!useSecond && (
                <button
                  type="button"
                  onClick={() => {
                    specTouched.current = true
                    applyApparel()
                  }}
                  className={btnGhost}
                >
                  套用雙層規格
                </button>
              )}
            </div>
          )}
          <VariantEditor
            title="規格一"
            name={variantName}
            onName={(v) => {
              specTouched.current = true
              setVariantName(v)
            }}
            options={options}
            onOptions={(v) => {
              specTouched.current = true
              setOptions(v)
            }}
            suggestedNames={sizeFamily ? ['顏色/款式', '尺寸'] : []}
            error={errors.options}
          />
          {useSecond ? (
            <VariantEditor
              title="規格二"
              name={variantName2}
              onName={(v) => {
                specTouched.current = true
                setVariantName2(v)
              }}
              options={options2}
              onOptions={(v) => {
                specTouched.current = true
                setOptions2(v)
              }}
              suggestedNames={sizeFamily ? ['尺寸'] : []}
              error={errors.options2}
              onRemove={() => {
                specTouched.current = true
                setUseSecond(false)
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                specTouched.current = true
                setUseSecond(true)
                if (!variantName2.trim()) setVariantName2('尺寸')
              }}
              className={`${btnGhost} w-full`}
            >
              <Plus className="size-4" />新增第二層規格（例如：顏色 × 尺寸）
            </button>
          )}

          {useSecond ? (
            <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/30 p-3">
              <p className="text-xs font-bold text-muted-foreground">
                各組合庫存與售價（共 {comboRows.length} 組；庫存填 0 前台會顯示缺貨；售價留空則沿用上方售價）
              </p>
              {comboRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">請先為兩個規格各新增至少一個選項，系統會自動產生所有組合。</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-bold text-muted-foreground">批次庫存</span>
                      <input inputMode="numeric" className={`${inputCls} w-24`} value={bulkStock} onChange={(e) => setBulkStock(e.target.value.replace(/\D/g, ''))} placeholder="例如 10" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-bold text-muted-foreground">批次售價</span>
                      <input inputMode="numeric" className={`${inputCls} w-28`} value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value.replace(/\D/g, ''))} placeholder="選填" />
                    </label>
                    <button type="button" onClick={applyBulk} disabled={bulkStock === '' && bulkPrice === ''} className={btnGhost}>
                      套用到全部組合
                    </button>
                  </div>
                  <div className="max-h-72 overflow-auto rounded-xl border border-border bg-card">
                    <table className="w-full min-w-96 text-sm">
                      <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left font-bold">{gName1}</th>
                          <th scope="col" className="px-3 py-2 text-left font-bold">{gName2}</th>
                          <th scope="col" className="w-24 px-2 py-2 text-left font-bold">庫存</th>
                          <th scope="col" className="w-28 px-2 py-2 text-left font-bold">售價</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comboRows.map((r) => (
                          <tr key={r.key} className="border-t border-border/60">
                            <td className="px-3 py-1.5 font-bold">{r.a}</td>
                            <td className="px-3 py-1.5 font-bold">{r.b}</td>
                            <td className="px-2 py-1.5">
                              <input
                                inputMode="numeric"
                                aria-label={`${r.a} ${r.b} 庫存`}
                                placeholder="庫存"
                                className={inputCls}
                                value={comboStockIn[r.key] ?? ''}
                                onChange={(e) => setComboStockIn((m) => ({ ...m, [r.key]: e.target.value.replace(/\D/g, '') }))}
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                inputMode="numeric"
                                aria-label={`${r.a} ${r.b} 售價`}
                                placeholder="售價"
                                className={inputCls}
                                value={comboPriceIn[r.key] ?? ''}
                                onChange={(e) => setComboPriceIn((m) => ({ ...m, [r.key]: e.target.value.replace(/\D/g, '') }))}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">目前總庫存 {comboTotal} 件，會自動加總為商品總庫存。</p>
                </>
              )}
              {errors.combos && (
                <p role="alert" className="flex items-center gap-1 text-xs font-medium text-destructive">
                  <CircleAlert className="size-3.5" />
                  {errors.combos}
                </p>
              )}
            </div>
          ) : (
            optList.length > 0 && (
              <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/30 p-3">
                <p className="text-xs font-bold text-muted-foreground">各選項庫存與售價（庫存填 0 會在前台自動反灰；售價留空則沿用上方售價）</p>
                <ul className="space-y-2">
                  {optList.map((o) => (
                    <li key={o} className="grid grid-cols-[1fr_5.5rem_6.5rem] items-center gap-2">
                      <span className="truncate text-sm font-bold">{o}</span>
                      <input
                        inputMode="numeric"
                        aria-label={`${o} 庫存`}
                        placeholder="庫存"
                        className={inputCls}
                        value={optStock[o] ?? ''}
                        onChange={(e) => setOptStock((m) => ({ ...m, [o]: e.target.value.replace(/\D/g, '') }))}
                      />
                      <input
                        inputMode="numeric"
                        aria-label={`${o} 售價`}
                        placeholder="售價"
                        className={inputCls}
                        value={optPrice[o] ?? ''}
                        onChange={(e) => setOptPrice((m) => ({ ...m, [o]: e.target.value.replace(/\D/g, '') }))}
                      />
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">所有選項都填寫庫存時，總庫存會自動加總。</p>
              </div>
            )
          )}
        </div>
        <div className="md:col-span-2">
          <AiMarketingHelper
            productName={name}
            price={price}
            onApply={(text, mode) => setDesc((d) => (mode === 'prepend' && d.trim() ? `${text}\n${d}` : text))}
          />
        </div>
        <div className="md:col-span-2">
          <Field label="商品描述">
            <textarea className={`${inputCls} min-h-20`} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="詳細規格表（每行一項，格式：名稱：內容）">
            <textarea className={`${inputCls} min-h-24`} value={specs} onChange={(e) => setSpecs(e.target.value)} placeholder={'材質：陶瓷\n產地：台灣'} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <p className="mb-1.5 text-xs font-bold text-muted-foreground">商品圖片</p>
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-9" role="radiogroup" aria-label="商品圖片">
            {IMAGE_OPTIONS.map((img) => (
              <button
                key={img.id}
                type="button"
                role="radio"
                aria-checked={image === img.src}
                aria-label={img.label}
                onClick={() => setImage(img.src)}
                className={`overflow-hidden rounded-xl border-2 transition ${image === img.src ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100'}`}
              >
                <ProductImage src={img.src} alt="" />
              </button>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <label className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 text-sm leading-relaxed ${errors.agreed ? 'border-destructive bg-red-50' : 'border-border bg-muted/40'}`}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 size-4 shrink-0 accent-primary"
            />
            <span className="text-pretty">
              本人保證商品圖片與實物完全相符，絕無文圖不符、假貨或掛羊頭賣狗肉之情事。
              <span className="font-bold text-destructive">（必填）</span>
            </span>
          </label>
          {errors.agreed && (
            <p role="alert" className="mt-1 flex items-center gap-1 text-xs font-medium text-destructive">
              <CircleAlert className="size-3.5" />{errors.agreed}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 md:col-span-2">
          <button type="button" className={btnGhost} onClick={onClose}>取消</button>
          <button type="submit" className={btnPrimary}>{product ? '儲存變更' : '確認上架'}</button>
        </div>
      </form>
    </Modal>
  )
}

function RenewModal({
  seller,
  reason,
  onClose,
  onPay,
}: {
  seller: Seller
  reason?: string | null
  onClose: () => void
  onPay: (method: PayMethod, info: { last4?: string }) => void
}) {
  const overdue = isClosed(seller)
  const grace = seller.plan.status === 'grace'
  const [method, setMethod] = useState<PayMethod>(overdue || grace ? 'card' : seller.plan.method)
  const [card, setCard] = useState<CardForm>(emptyCard)
  const [auto, setAuto] = useState(true)
  const [last5, setLast5] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const virtualAcct = `8089 ${seller.id.replace(/\D/g, '').padStart(2, '0')}${seller.name.length}0 ${String(seller.owner.length * 7919).padStart(5, '0')}`

  const submit = () => {
    if (method === 'card') {
      const e = validateCard(card)
      setErrors(e)
      if (Object.keys(e).length) return
      onPay('card', { last4: card.number.replace(/\s/g, '').slice(-4) })
      return
    }
    if (!/^\d{5}$/.test(last5)) {
      setErrors({ last5: '請輸入轉出帳號後 5 碼' })
      return
    }
    setErrors({})
    onPay('atm', {})
  }

  return (
    <Modal title={grace ? '補繳月費 / 更新信用卡' : '續費 / 管理付款方式'} onClose={onClose} size="md" z={60}>
      <div className="space-y-5 p-5">
        {grace && (
          <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              本月月費扣款失敗，補繳緩衝期剩餘 {graceLeft(seller.plan)} 天。請更新信用卡資訊或轉帳補繳，逾期店鋪將自動暫停營業。
            </p>
          </div>
        )}
        {overdue && (
          <div role="alert" className="flex items-start gap-2.5 rounded-2xl bg-destructive px-4 py-3 text-sm font-bold text-card">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              {reason ? `您的賣場已因月費逾期暫停，無法${reason}。` : '您的賣場已因月費逾期暫停營運，商品已從前台隱藏。'}
              完成續費後將立即重新開張並解鎖所有功能。
            </p>
          </div>
        )}
        <div className="rounded-2xl bg-secondary px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-secondary-foreground">標準賣家方案</p>
              <p className="text-lg font-black text-brand-ink">{money(PLAN_PRICE)} <span className="text-xs font-medium">/ 月</span></p>
            </div>
            <Pill tone={planLabel[seller.plan.status].tone}>{planLabel[seller.plan.status].text}</Pill>
          </div>
          <dl className="mt-3 space-y-1 border-t border-border/60 pt-3 text-xs">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">目前週期</dt><dd className="font-bold">{periodText(seller.plan)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">續費後週期</dt><dd className="font-bold text-brand-ink">{fmtDate(seller.plan.nextDate)} ~ {fmtDate(addMonth(seller.plan.nextDate))}</dd></div>
          </dl>
        </div>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {(
            [
              ['card', '信用卡定期扣款', CreditCard],
              ['atm', '銀行轉帳 / ATM', Landmark],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={method === k}
              disabled={overdue && k === 'atm'}
              title={overdue && k === 'atm' ? '逾期店家需以信用卡即時續費，ATM 需人工核銷無法即時開店' : undefined}
              onClick={() => { setMethod(k); setErrors({}) }}
              className={`flex items-center justify-center gap-2 rounded-2xl border p-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${method === k ? 'border-primary bg-accent' : 'border-border hover:border-primary/50'}`}
            >
              <Icon className="size-4 text-brand-ink" />
              {label}
            </button>
          ))}
        </div>
        {overdue && <p className="-mt-3 text-xs text-muted-foreground">逾期店家僅限信用卡即時續費；ATM 轉帳需人工核銷，無法即時重新開張。</p>}

        {method === 'card' ? (
          <div className="space-y-3">
            <CardFields value={card} onChange={setCard} errors={errors} />
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="mt-1 size-4 accent-primary" />
              <span>綁定此卡並同意每月 {money(PLAN_PRICE)} 定期自動扣款，可隨時於後台取消。</span>
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <dl className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 text-sm">
              {[
                ['收款銀行', '玉山銀行 (808)'],
                ['專屬虛擬帳號', virtualAcct],
                ['應繳金額', money(PLAN_PRICE)],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[7rem_1fr] bg-card">
                  <dt className="px-4 py-2.5 font-bold text-muted-foreground">{k}</dt>
                  <dd className="px-4 py-2.5 font-mono font-bold">{v}</dd>
                </div>
              ))}
            </dl>
            <Field label="匯款帳號後五碼（核銷用）" error={errors.last5}>
              <input inputMode="numeric" className={inputCls} placeholder="12345" value={last5} onChange={(e) => setLast5(e.target.value.replace(/\D/g, '').slice(0, 5))} />
            </Field>
            <p className="text-xs text-muted-foreground">送出後由平台人工核銷，通常於 1 個工作天內完成。</p>
          </div>
        )}

        <button type="button" onClick={submit} className={`${btnPrimary} w-full`}>
          {method === 'card' ? `${grace ? '更新卡片並補繳' : '立即付款'} ${money(PLAN_PRICE)}${overdue ? ' 並重新開張' : ''}` : '送出核銷資料'}
        </button>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------------------
 * 賣家後台
 * -------------------------------------------------------------------------- */

const planLabel: Record<PlanStatus, { text: string; tone: Tone }> = {
  active: { text: '正常營運中', tone: 'ok' },
  trial: { text: '30 天免費試用中', tone: 'brand' },
  due: { text: '待繳費', tone: 'warn' },
  verifying: { text: '核銷中', tone: 'neutral' },
  overdue: { text: '逾期未繳費（已關店）', tone: 'bad' },
  grace: { text: '扣款失敗・補繳緩衝期', tone: 'warn' },
  suspended: { text: '暫停營業 (suspended)', tone: 'bad' },
}

function ShopStatusSwitch({ closed, onChange }: { closed: boolean; onChange: (closed: boolean) => void }) {
  return (
    <div role="group" aria-label="賣場狀態測試開關" className="inline-flex rounded-full border border-border/70 bg-muted/60 p-1">
      {(
        [
          [false, '正常營運中'],
          [true, '逾期未繳費（已關店）'],
        ] as const
      ).map(([value, label]) => {
        const on = closed === value
        return (
          <button
            key={label}
            type="button"
            aria-pressed={on}
            onClick={() => { if (!on) onChange(value) }}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold transition ${on ? (value ? 'bg-destructive text-card shadow-sm' : 'bg-primary text-primary-foreground shadow-sm') : 'text-muted-foreground hover:text-foreground'}`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

const SELLER_PHONE = '0909-149-832'

type SmsPrefs = { onOrder: boolean; onPaid: boolean }

function SettingToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-background p-4">
      <div className="min-w-0">
        <p id={`${label}-label`} className="text-sm font-bold">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`text-xs font-bold ${checked ? 'text-brand-ink' : 'text-muted-foreground'}`}>{checked ? '已開啟' : '已關閉'}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${label}-label`}
          onClick={() => onChange(!checked)}
          className={`relative h-6 w-11 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${checked ? 'bg-primary' : 'bg-border'}`}
        >
          <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-card shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>
    </div>
  )
}

function SmsNotifySettings({ prefs, onChange, log }: { prefs: SmsPrefs; onChange: (p: SmsPrefs) => void; log: SmsMessage[] }) {
  return (
    <section className="space-y-5" aria-label="帳號設定">
      <div className={`${panelCls} space-y-4 p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-black">
            <Smartphone className="size-5 text-brand-ink" />訂單簡訊通知
          </h2>
          <Pill tone="ok"><Check className="size-3" />此功能已包含於 NT$599 月費方案中，不另收費</Pill>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/60 p-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-brand-ink"><Smartphone className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">賣家綁定手機</p>
            <p className="font-mono text-base font-black tracking-wide">{SELLER_PHONE}</p>
          </div>
          <Pill tone="ok"><ShieldCheck className="size-3" />已驗證</Pill>
        </div>

        <div className="space-y-3">
          <SettingToggle
            checked={prefs.onOrder}
            onChange={(v) => onChange({ ...prefs, onOrder: v })}
            label="買家下單時自動發送簡訊通知"
            description={`有新訂單成立時，立即發送簡訊至 ${SELLER_PHONE}`}
          />
          <SettingToggle
            checked={prefs.onPaid}
            onChange={(v) => onChange({ ...prefs, onPaid: v })}
            label="買家完成匯款時發送簡訊通知"
            description={`買家完成 ATM 匯款、系統入帳後，發送簡訊至 ${SELLER_PHONE}`}
          />
        </div>

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          此功能已包含於 NT$599 月費方案中，不另收費。
        </p>

        <div className="space-y-2 border-t border-border/60 pt-4">
          <h3 className="text-sm font-black">簡訊發送紀錄</h3>
          {log.length === 0 ? (
            <p className="rounded-xl bg-muted/60 p-4 text-center text-xs text-muted-foreground">
              尚無簡訊紀錄，買家下單或完成匯款後會顯示在這裡
            </p>
          ) : (
            <ul className="space-y-2" aria-label="簡訊發送紀錄">
              {log.map((m) => (
                <li key={m.id} className="rounded-xl border border-border/70 bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="ok"><Check className="size-3" />已發送至 {SELLER_PHONE}</Pill>
                    <Pill tone="neutral">{m.kind === 'order' ? '新訂單通知' : m.kind === 'paid' ? '匯款通知' : '商品檢舉通知'}</Pill>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{m.at}</span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed">{m.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function downloadInvoice(p: Payment, seller: Seller) {
  const body = [
    '買個 Pay 服 電子發票證明聯',
    '--------------------------------',
    `發票號碼：${p.invoice}`,
    `開立日期：${p.date}`,
    `買受人：${seller.name}（負責人 ${seller.owner}）`,
    `品名：標準賣家方案月費`,
    `金額：${money(p.amount)}（含稅）`,
    `付款方式：${p.method === 'card' ? '信用卡定期扣款' : '銀行轉帳 / ATM'}`,
  ].join('\n')
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `invoice-${p.invoice}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

function downloadReceipt(p: Payment, seller: Seller) {
  const body = [
    '買個 Pay 服 繳費收據',
    '--------------------------------',
    `收據編號：RC-${p.invoice}`,
    `繳費日期：${p.date}`,
    `繳費人：${seller.name}（負責人 ${seller.owner}）`,
    `項目：標準賣家方案月費`,
    `繳費金額：${money(p.amount)}（含稅）`,
    `付款方式：${p.method === 'card' ? '信用卡定期扣款' : '銀行轉帳 / ATM'}`,
    `對應電子發票：${p.invoice}`,
  ].join('\n')
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `receipt-${p.invoice}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

const shiftIsoDate = (s: string, days: number) => {
  const d = new Date(`${s}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const SMS_REMIND_DAYS = [7, 3] as const
const DEMO_SELLER_MOBILES: Record<string, string> = { s1: '0912345678', s2: '0922333444', s3: '0933555777', s4: '0955888999' }

function PhoneBindModal({
  currentPhone,
  onClose,
  onBound,
}: {
  currentPhone: string
  onClose: () => void
  onBound: (phone: string) => void
}) {
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sentCode, setSentCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [cooldown])

  const sendCode = () => {
    if (!/^09\d{8}$/.test(phone)) return setError('請輸入 10 碼手機號碼（09 開頭）')
    if (phone === currentPhone) return setError('這已經是目前綁定的手機號碼')
    setSentCode(String(Math.floor(100000 + Math.random() * 900000)))
    setCode('')
    setError('')
    setStep('code')
    setCooldown(60)
  }

  const verify = () => {
    if (code !== sentCode) return setError('驗證碼不正確，請重新輸入')
    onBound(phone)
  }

  const masked = `${phone.slice(0, 4)}***${phone.slice(7)}`

  return (
    <Modal title={currentPhone ? '更換提醒手機' : '綁定提醒手機'} onClose={onClose} size="sm" z={60}>
      {step === 'phone' ? (
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            sendCode()
          }}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            綁定後，系統會在方案到期前 7 天與 3 天，自動發送提醒簡訊到這支手機。
          </p>
          <Field label="手機號碼" error={error} hint="僅用於接收方案到期提醒與重要通知，不會對外公開。">
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="tel-national"
              className={inputCls}
              placeholder="0912345678"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
                setError('')
              }}
            />
          </Field>
          <button type="submit" className={`${btnPrimary} w-full`}>
            發送驗證碼
          </button>
        </form>
      ) : (
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            verify()
          }}
        >
          <div className="rounded-2xl bg-muted/60 p-3">
            <p className="mb-1.5 text-center text-[11px] text-muted-foreground">模擬簡訊・{masked}</p>
            <p className="rounded-2xl rounded-tl-sm bg-card px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ring-1 ring-border/60">
              【買個 Pay 服】您的手機驗證碼為 <b className="font-black tracking-widest text-brand-ink">{sentCode}</b>，10 分鐘內有效，請勿轉告他人。
            </p>
          </div>
          <Field label="輸入 6 碼驗證碼" error={error}>
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              className={`${inputCls} text-center text-lg font-black tracking-[0.5em]`}
              placeholder="000000"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                setError('')
              }}
            />
          </Field>
          <button type="submit" disabled={code.length !== 6} className={`${btnPrimary} w-full`}>
            <Check className="size-4" />驗證並綁定
          </button>
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setStep('phone')
                setError('')
              }}
              className="font-bold text-muted-foreground transition hover:text-foreground"
            >
              修改號碼
            </button>
            <button
              type="button"
              disabled={cooldown > 0}
              onClick={sendCode}
              className="font-bold text-brand-ink transition hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            >
              {cooldown > 0 ? `${cooldown} 秒後可重新發送` : '重新發送驗證碼'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function SmsReminderCard({ seller, onSaveKyc }: { seller: Seller; onSaveKyc: (k: KycInfo) => void }) {
  const [binding, setBinding] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [previewDays, setPreviewDays] = useState<(typeof SMS_REMIND_DAYS)[number]>(3)
  const phone = seller.kyc?.phone ?? DEMO_SELLER_MOBILES[seller.id] ?? ''
  const hasPhone = phone.length === 10
  const masked = hasPhone ? `${phone.slice(0, 4)}***${phone.slice(7)}` : '尚未綁定手機'
  const active = enabled && hasPhone
  const bindPhone = (p: string) => {
    const base: KycInfo = seller.kyc ?? { kind: 'individual', idVerified: false, phone: '', phoneVerified: false, bankVerified: false }
    onSaveKyc({ ...base, phone: p, phoneVerified: true })
    setEnabled(true)
    setBinding(false)
  }
  const today = todayStr()
  const expireLabel = seller.plan.status === 'trial' ? '試用到期日' : '訂閱到期日'
  const schedule = SMS_REMIND_DAYS.map((d) => {
    const date = shiftIsoDate(seller.plan.nextDate, -d)
    return { days: d, date, sent: date <= today }
  })
  const daysLeft = Math.max(0, Math.round((Date.parse(seller.plan.nextDate) - Date.parse(today)) / 86400000))
  const previewText = `【買個 Pay 服】${seller.name} 您好，您的標準賣家方案將於 ${fmtDate(seller.plan.nextDate)} 到期（剩 ${previewDays} 天），請於到期前完成續費 ${money(PLAN_PRICE)}，以免賣場暫停營業、商品被隱藏。立即續費：pay.example/renew`

  return (
    <div className={`${panelCls} space-y-4 p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-black">
            <Smartphone className="size-4 text-brand-ink" />簡訊自動提醒通知
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            系統會在{expireLabel}前 7 天與 3 天，自動發送提醒簡訊至賣家手機 {masked}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={active ? 'ok' : 'neutral'}>{active ? '提醒已開啟' : hasPhone ? '提醒已關閉' : '尚未綁定手機'}</Pill>
          <button
            type="button"
            onClick={() => setBinding(true)}
            className={hasPhone ? `${btnGhost} px-3 py-1.5 text-xs` : `${btnPrimary} px-4 py-1.5 text-xs`}
          >
            <Smartphone className="size-3.5" />{hasPhone ? '更換手機' : '綁定手機'}
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="啟用簡訊提醒"
            disabled={!hasPhone}
            onClick={() => setEnabled((v) => !v)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${enabled && hasPhone ? 'bg-primary' : 'bg-muted-foreground/30'}`}
          >
            <span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-card shadow transition-transform ${enabled && hasPhone ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground">
            {expireLabel}：{fmtDate(seller.plan.nextDate)}（{daysLeft > 0 ? `剩 ${daysLeft} 天` : '已到期'}）
          </p>
          <ul className="space-y-2">
            {schedule.map((s) => (
              <li key={s.days} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-bold">到期前 {s.days} 天提醒</p>
                  <p className="text-xs text-muted-foreground">發送日 {fmtDate(s.date)}・上午 10:00</p>
                </div>
                <Pill tone={!active ? 'neutral' : s.sent ? 'ok' : 'warn'}>
                  {!active ? '已暫停' : s.sent ? <><Check className="size-3" />已發送</> : <><Clock className="size-3" />已排程</>}
                </Pill>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-muted-foreground">
            即使已啟用自動扣款，系統仍會發送提醒；續費完成後，下一期提醒會自動重新排程。
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-muted-foreground">簡訊內容預覽</p>
            <div className="flex gap-1" role="group" aria-label="預覽提醒時間">
              {SMS_REMIND_DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={previewDays === d}
                  onClick={() => setPreviewDays(d)}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition ${previewDays === d ? 'bg-foreground text-card' : 'bg-card text-muted-foreground ring-1 ring-border hover:text-foreground'}`}
                >
                  前 {d} 天
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-muted/60 p-3">
            <p className="mb-1.5 text-center text-[11px] text-muted-foreground">簡訊・{masked}</p>
            <p className="rounded-2xl rounded-tl-sm bg-card px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ring-1 ring-border/60">
              {previewText}
            </p>
          </div>
        </div>
      </div>
      {binding && <PhoneBindModal currentPhone={hasPhone ? phone : ''} onClose={() => setBinding(false)} onBound={bindPhone} />}
    </div>
  )
}

function InvoiceVault({ seller, payments }: { seller: Seller; payments: Payment[] }) {
  const [year, setYear] = useState('all')
  const years = Array.from(new Set(payments.map((p) => p.date.slice(0, 4)))).sort().reverse()
  const rows = payments
    .filter((p) => year === 'all' || p.date.startsWith(year))
    .sort((a, b) => b.date.localeCompare(a.date))
  const paid = rows.filter((p) => p.status === '已付款')
  const total = paid.reduce((s, p) => s + p.amount, 0)

  const exportCsv = () =>
    downloadCsv(`billing-${seller.id}-${year}.csv`, [
      ['日期', '金額', '付款方式', '狀態', '發票號碼'],
      ...rows.map((p) => [p.date, p.amount, p.method === 'card' ? '信用卡' : 'ATM', p.status, p.status === '已付款' ? p.invoice : '核銷後開立']),
    ])

  return (
    <div className={`${panelCls} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-black">
            <Receipt className="size-4 text-brand-ink" />歷史帳單與雲端發票夾
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            每月 {money(PLAN_PRICE)} 的電子發票與繳費收據永久保存於雲端，可隨時下載
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="invoice-year">篩選年度</label>
          <select
            id="invoice-year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold"
          >
            <option value="all">全部年度</option>
            {years.map((y) => <option key={y} value={y}>{y} 年</option>)}
          </select>
          <button type="button" onClick={exportCsv} disabled={rows.length === 0} className={`${btnGhost} px-3 py-1.5 text-xs`}>
            <Download className="size-3.5" />匯出帳單 CSV
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-border/60 text-sm">
        <div className="bg-card px-5 py-3">
          <dt className="text-xs text-muted-foreground">已開立發票</dt>
          <dd className="text-lg font-black">{paid.length} 張</dd>
        </div>
        <div className="bg-card px-5 py-3">
          <dt className="text-xs text-muted-foreground">累計已繳月費</dt>
          <dd className="text-lg font-black text-brand-ink">{money(total)}</dd>
        </div>
      </dl>

      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">尚無繳費紀錄，完成首次繳費後會自動歸檔於此</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
              <tr>
                {['日期', '金額', '付款方式', '狀態', '發票號碼', '下載'].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5 text-left font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((p) => {
                const done = p.status === '已付款'
                return (
                  <tr key={p.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2.5">{p.date}</td>
                    <td className="px-4 py-2.5 font-bold">{money(p.amount)}</td>
                    <td className="px-4 py-2.5">{p.method === 'card' ? '信用卡' : 'ATM'}</td>
                    <td className="px-4 py-2.5"><Pill tone={done ? 'ok' : 'neutral'}>{p.status}</Pill></td>
                    <td className="px-4 py-2.5 font-mono text-xs">{done ? p.invoice : '核銷後開立'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={!done}
                          onClick={() => downloadInvoice(p, seller)}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-brand-ink transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Download className="size-3.5" />發票
                        </button>
                        <button
                          type="button"
                          disabled={!done}
                          onClick={() => downloadReceipt(p, seller)}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-brand-ink transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Download className="size-3.5" />收據
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const body = rows.map((r) => r.map(esc).join(',')).join('\r\n')
  const blob = new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function SellerPaymentSettings({ seller, onSave }: { seller: Seller; onSave: (p: PaymentSettings) => void }) {
  const cur = seller.payment
  const [bankCode, setBankCode] = useState(cur?.bankCode ?? '')
  const [bankAccount, setBankAccount] = useState(cur?.bankAccount ?? '')
  const [bankHolder, setBankHolder] = useState(cur?.bankHolder ?? '')
  const [linePayQr, setLinePayQr] = useState(cur?.linePayQr ?? '')
  const [jkoQr, setJkoQr] = useState(cur?.jkoQr ?? '')
  const [useGateway, setUseGateway] = useState(Boolean(cur?.gateway))
  const [provider, setProvider] = useState<'ecpay' | 'newebpay'>(cur?.gateway?.provider ?? 'ecpay')
  const [merchantId, setMerchantId] = useState(cur?.gateway?.merchantId ?? '')
  const [hashKey, setHashKey] = useState(cur?.gateway?.hashKey ?? '')
  const [hashIv, setHashIv] = useState(cur?.gateway?.hashIv ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const e: Record<string, string> = {}
    if (!/^\d{3}$/.test(bankCode)) e.bankCode = '請輸入 3 碼銀行代碼'
    if (!/^\d{8,16}$/.test(bankAccount)) e.bankAccount = '請輸入 8 至 16 碼數字帳號'
    if (!bankHolder.trim()) e.bankHolder = '請輸入戶名'
    if (useGateway) {
      if (!merchantId.trim()) e.merchantId = '請輸入特店編號'
      if (!hashKey.trim()) e.hashKey = '請輸入 HashKey'
      if (!hashIv.trim()) e.hashIv = '請輸入 HashIV'
    }
    setErrors(e)
    if (Object.keys(e).length) return
    onSave({
      bankCode,
      bankAccount,
      bankHolder: bankHolder.trim(),
      linePayQr: linePayQr || undefined,
      jkoQr: jkoQr || undefined,
      gateway: useGateway ? { provider, merchantId: merchantId.trim(), hashKey: hashKey.trim(), hashIv: hashIv.trim() } : undefined,
    })
  }
  const field = (id: string, label: string, value: string, set: (v: string) => void, placeholder: string, err?: string, type = 'text') => (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-bold">{label}</label>
      <input id={id} type={type} className={inputCls} value={value} placeholder={placeholder} onChange={(ev) => set(ev.target.value)} aria-invalid={Boolean(err)} />
      {err && <p className="text-xs font-bold text-destructive" role="alert">{err}</p>}
    </div>
  )
  return (
    <section className={`${panelCls} space-y-4 p-5`} aria-label="收款與金流設定">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-black"><Banknote className="size-4 text-brand-ink" />收款與金流設定</h2>
        <Pill tone={cur ? 'ok' : 'warn'}>{cur ? '已設定' : '尚未設定'}</Pill>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">買家的貨款會直接匯入您設定的帳戶，平台不代收付款項。ATM 轉帳訂單將顯示此處的收款帳號。</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {field('pay-bank-code', '銀行代碼', bankCode, setBankCode, '例如 812', errors.bankCode)}
        {field('pay-bank-account', '收款帳號', bankAccount, setBankAccount, '8 至 16 碼數字', errors.bankAccount)}
        {field('pay-bank-holder', '戶名', bankHolder, setBankHolder, '須與實名一致', errors.bankHolder)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {field('pay-linepay', 'LINE Pay 收款 QR（選填）', linePayQr, setLinePayQr, '貼上 QR 連結或檔名')}
        {field('pay-jko', '街口支付收款 QR（選填）', jkoQr, setJkoQr, '貼上 QR 連結或檔名')}
      </div>
      <div className="space-y-3 rounded-2xl bg-muted/50 p-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={useGateway} onChange={(ev) => setUseGateway(ev.target.checked)} className="size-4 accent-primary" />
          串接第三方金流（綠界 / 藍新）
        </label>
        {useGateway && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="pay-provider" className="text-xs font-bold">金流服務商</label>
              <select id="pay-provider" className={inputCls} value={provider} onChange={(ev) => setProvider(ev.target.value as 'ecpay' | 'newebpay')}>
                <option value="ecpay">綠界 ECPay</option>
                <option value="newebpay">藍新 NewebPay</option>
              </select>
            </div>
            {field('pay-merchant', '特店編號', merchantId, setMerchantId, 'MerchantID', errors.merchantId)}
            {field('pay-hashkey', 'HashKey', hashKey, setHashKey, '請妥善保管', errors.hashKey, 'password')}
            {field('pay-hashiv', 'HashIV', hashIv, setHashIv, '請妥善保管', errors.hashIv, 'password')}
            <p className="text-xs font-bold text-emerald-700 sm:col-span-2">金流直接撥入您的綠界帳戶，平台 100% 不經手資金。</p>
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={submit} className={btnPrimary}><Check className="size-4" />儲存收款設定</button>
      </div>
    </section>
  )
}

function SellerKycPanel({ seller, onSave }: { seller: Seller; onSave: (k: KycInfo) => void }) {
  const cur: KycInfo = seller.kyc ?? { kind: 'individual', idVerified: false, phone: '', phoneVerified: false, bankVerified: false }
  const [phone, setPhone] = useState(cur.phone)
  const [error, setError] = useState('')
  const done = cur.idVerified && cur.phoneVerified && cur.bankVerified
  const step = (ok: boolean, title: string, desc: string, action: ReactNode) => (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 p-3">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
        {ok ? <Check className="size-4" /> : <ShieldAlert className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      {ok ? <Pill tone="ok">已完成</Pill> : action}
    </li>
  )
  return (
    <section className={`${panelCls} space-y-4 p-5`} aria-label="實名認證">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-black"><ShieldAlert className="size-4 text-brand-ink" />賣家實名認證（KYC）</h2>
        <Pill tone={done ? 'ok' : 'warn'}>{done ? '認證完成' : '尚未完成'}</Pill>
      </div>
      <div role="radiogroup" aria-label="賣家身分" className="flex gap-2">
        {([['individual', '個人賣家'], ['company', '公司行號']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={cur.kind === k}
            onClick={() => onSave({ ...cur, kind: k, phone })}
            className={`rounded-full border px-4 py-1.5 text-xs font-bold transition ${cur.kind === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="space-y-2.5">
        {step(
          cur.idVerified,
          cur.kind === 'company' ? '公司登記與負責人驗證' : '身分證件驗證',
          `${seller.owner}・${seller.idNo}（審核文件：${seller.docName || '未上傳'}）`,
          <button type="button" onClick={() => onSave({ ...cur, phone, idVerified: true })} className={`${btnGhost} px-3 py-1.5 text-xs`}>模擬完成驗證</button>,
        )}
        {step(
          cur.phoneVerified,
          '手機號碼驗證',
          cur.phoneVerified ? cur.phone : '輸入手機並以簡訊驗證碼確認（模擬）',
          <div className="flex items-center gap-1.5">
            <input aria-label="賣家手機號碼" className={`${inputCls} w-36`} placeholder="09xxxxxxxx" value={phone} onChange={(ev) => { setPhone(ev.target.value); setError('') }} />
            <button
              type="button"
              onClick={() => {
                if (!/^09\d{8}$/.test(phone)) return setError('請輸入 10 碼手機號碼（09 開頭）')
                onSave({ ...cur, phone, phoneVerified: true })
              }}
              className={`${btnGhost} px-3 py-1.5 text-xs`}
            >
              驗證
            </button>
          </div>,
        )}
        {step(
          cur.bankVerified,
          '銀行帳戶 1 元驗證',
          seller.payment ? `將向 ${seller.payment.bankCode}-${seller.payment.bankAccount} 匯入 1 元並比對戶名（模擬）` : '請先於上方儲存收款帳號，才能進行 1 元驗證',
          <button
            type="button"
            disabled={!seller.payment}
            onClick={() => onSave({ ...cur, phone, bankVerified: true })}
            className={`${btnGhost} px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50`}
          >
            發送 1 元驗證
          </button>,
        )}
      </ul>
      {error && <p className="text-xs font-bold text-destructive" role="alert">{error}</p>}
    </section>
  )
}

function SellerExportPanel({
  products,
  orders,
  logs,
  onExported,
}: {
  products: Product[]
  orders: Order[]
  logs: ExportLog[]
  onExported: (kind: ExportLog['kind'], rows: number) => void
}) {
  const exportProducts = () => {
    downloadCsv('products.csv', [
      ['商品編號', '商品名稱', '分類', '售價', '庫存', '已售', '狀態'],
      ...products.map((p) => [p.id, p.name, p.category, p.price, p.stock, p.sold, p.flagged ? '審核中' : p.active ? '上架中' : '已下架']),
    ])
    onExported('products', products.length)
  }
  const exportOrders = () => {
    downloadCsv('orders.csv', [
      ['訂單編號', '日期', '買家', '品項', '運費', '總額', '付款', '出貨狀態'],
      ...orders.map((o) => [o.id, o.date, o.buyer, o.items.map((i) => `${i.name}x${i.qty}`).join(' / '), o.shipping, o.total, `${o.pay === 'card' ? '信用卡' : 'ATM'}・${o.payStatus}`, o.status]),
    ])
    onExported('orders', orders.length)
  }
  return (
    <section className={`${panelCls} space-y-3 p-5`} aria-label="資料匯出">
      <h2 className="flex items-center gap-1.5 text-base font-black"><FileText className="size-4 text-brand-ink" />資料匯出（CSV）</h2>
      <p className="text-xs text-muted-foreground">匯出內容僅包含您自己的店鋪資料，每次匯出都會留下紀錄。</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={exportProducts} className={btnGhost}>匯出商品清單（{products.length}）</button>
        <button type="button" onClick={exportOrders} className={btnGhost}>匯出訂單明細（{orders.length}）</button>
      </div>
      {logs.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 text-xs">
          {logs.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="font-bold">{l.kind === 'products' ? '商品清單' : '訂單明細'}・{l.rows} 筆</span>
              <span className="text-muted-foreground">{l.at}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const MIGRATE_MAX_ROWS = 200
const MIGRATE_COLUMNS: Record<'name' | 'desc' | 'category' | 'variantName' | 'option' | 'price' | 'stock', string[]> = {
  name: ['商品名稱', '商品名', 'product name', 'name'],
  desc: ['商品描述', '描述', 'product description', 'description'],
  category: ['商品分類', '分類', '類別', 'category'],
  variantName: ['規格名稱', '規格', 'variation name'],
  option: ['規格選項', '選項', '商品選項', 'variation'],
  price: ['價格', '售價', '商品價格', 'price'],
  stock: ['庫存', '商品數量', '數量', 'stock'],
}
const MIGRATE_SAMPLE_CSV = [
  '商品名稱,商品描述,商品分類,規格名稱,規格選項,價格,庫存',
  '手拉坯陶瓷馬克杯,每一只都是手工拉坯，容量約 350ml，適合日常早餐與下午茶。,居家生活,顏色,霧白,420,30',
  '手拉坯陶瓷馬克杯,每一只都是手工拉坯，容量約 350ml，適合日常早餐與下午茶。,居家生活,顏色,墨藍,450,18',
  '輕量折疊收納袋,防潑水尼龍材質，折疊後僅手掌大小，旅行出差都方便。,鞋包配飾,尺寸,M,290,60',
  '無線藍牙耳機,支援藍牙 5.3，單次續航約 6 小時。,3C數位,顏色,黑色,1280,45',
  '電子煙煙彈,範例：含違禁詞的商品會被擋下,3C數位,規格,標準款,500,10',
  '高價收藏品,範例：超過價格上限的商品會被擋下,居家生活,規格,標準款,250000,1',
].join('\n')

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^\ufeff/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim())) rows.push(row)
  return rows
}

interface MigrateItem {
  line: number
  name: string
  optionCount: number
  price: number
  stock: number
  category: string
  reasons: string[]
  notes: string[]
  product?: Product
}

function matchCsvCategory(raw: string): string | null {
  const n = raw.replace(/\s/g, '')
  if (!n) return null
  const flat = (c: string) => c.replace(/\s/g, '')
  return CATEGORIES.find((c) => flat(c) === n) ?? CATEGORIES.find((c) => n.includes(flat(c)) || flat(c).includes(n)) ?? null
}

function buildMigration(text: string, sellerId: string, existingNames: Set<string>) {
  const rows = parseCsv(text)
  if (rows.length < 2) return { error: '檔案沒有資料列，請確認是蝦皮匯出的商品 CSV。', items: [] as MigrateItem[], truncated: false }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const col = (key: keyof typeof MIGRATE_COLUMNS) => header.findIndex((h) => MIGRATE_COLUMNS[key].some((a) => a.toLowerCase() === h))
  const idx = {
    name: col('name'),
    desc: col('desc'),
    category: col('category'),
    variantName: col('variantName'),
    option: col('option'),
    price: col('price'),
    stock: col('stock'),
  }
  if (idx.name < 0 || idx.price < 0) {
    return { error: '找不到「商品名稱」或「價格」欄位，請確認第一列是標題列。', items: [] as MigrateItem[], truncated: false }
  }
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')

  interface Group {
    name: string
    line: number
    desc: string
    category: string
    variantName: string
    options: string[]
    prices: number[]
    stock: number
    badPrice: boolean
    badStock: boolean
  }
  const groups = new Map<string, Group>()
  rows.slice(1, MIGRATE_MAX_ROWS + 1).forEach((r, i) => {
    const line = i + 2
    const name = get(r, idx.name)
    const key = name || `__empty${line}`
    let g = groups.get(key)
    if (!g) {
      g = { name, line, desc: '', category: '', variantName: '', options: [], prices: [], stock: 0, badPrice: false, badStock: false }
      groups.set(key, g)
    }
    g.desc ||= get(r, idx.desc)
    g.category ||= get(r, idx.category)
    g.variantName ||= get(r, idx.variantName)
    const option = get(r, idx.option)
    if (option && !g.options.includes(option)) g.options.push(option)
    const priceRaw = get(r, idx.price).replace(/[^0-9.]/g, '')
    const price = priceRaw ? Number(priceRaw) : NaN
    if (Number.isFinite(price) && price > 0) g.prices.push(price)
    else g.badPrice = true
    const stockRaw = get(r, idx.stock).replace(/[^0-9.-]/g, '')
    const stock = stockRaw ? Number(stockRaw) : 0
    if (Number.isFinite(stock) && stock >= 0) g.stock += Math.floor(stock)
    else g.badStock = true
  })

  const stamp = Date.now()
  const items: MigrateItem[] = Array.from(groups.values()).map((g, n) => {
    const reasons: string[] = []
    const notes: string[] = []
    const price = g.prices.length ? Math.round(Math.min(...g.prices)) : 0
    if (!g.name) reasons.push('缺少商品名稱')
    if (!g.prices.length) reasons.push('價格格式錯誤')
    else if (price > MAX_PRICE) reasons.push(`超過價格上限 NT$${MAX_PRICE.toLocaleString('en-US')}`)
    if (g.badStock) reasons.push('庫存格式錯誤')
    const hits = scanBanned(g.name, g.desc, ...g.options)
    if (hits.length) reasons.push(`含違禁詞：${hits.join('、')}`)
    if (g.name && existingNames.has(g.name)) reasons.push('賣場已有同名商品')

    const matched = matchCsvCategory(g.category)
    const category = matched ?? DEFAULT_MAIN
    if (!matched) notes.push(g.category ? `分類「${g.category}」不在平台分類，已改為${DEFAULT_MAIN}` : `未填分類，已設為${DEFAULT_MAIN}`)
    if (g.badPrice && g.prices.length) notes.push('部分規格價格無效，已採用最低有效價格')

    const options = g.options.length ? g.options : ['標準款']
    const product: Product | undefined = reasons.length
      ? undefined
      : {
          id: `p${stamp}${n}`,
          sellerId,
          name: g.name,
          category,
          subCategory: subsOfMain(category)[0],
          price,
          image: IMAGE_OPTIONS[n % IMAGE_OPTIONS.length].src,
          variants: [{ name: g.variantName || '規格', options }],
          stock: g.stock,
          sold: 0,
          specs: [['品名', g.name]],
          desc: g.desc || '賣家尚未填寫商品描述。',
          reviews: [],
          active: true,
        }
    return { line: g.line, name: g.name, optionCount: options.length, price, stock: g.stock, category, reasons, notes, product }
  })
  return { error: '', items, truncated: rows.length - 1 > MIGRATE_MAX_ROWS }
}

function downloadSampleCsv() {
  const blob = new Blob(['\ufeff' + MIGRATE_SAMPLE_CSV], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'shopee-products-sample.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function ProductMigrateModal({
  sellerId,
  existingNames,
  onImport,
  onClose,
}: {
  sellerId: string
  existingNames: Set<string>
  onImport: (products: Product[]) => void
  onClose: () => void
}) {
  const [fileName, setFileName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [readError, setReadError] = useState('')

  const result = csvText ? buildMigration(csvText, sellerId, existingNames) : null
  const okItems = result?.items.filter((i) => i.product) ?? []
  const badCount = (result?.items.length ?? 0) - okItems.length
  const canImport = okItems.length > 0 && agreed

  const loadFile = async (file: File | undefined) => {
    if (!file) return
    setReadError('')
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      setReadError('請上傳 .csv 格式的檔案（可從蝦皮賣家中心匯出商品 CSV）')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setReadError('檔案超過 2MB，請分批上傳')
      return
    }
    const buf = await file.arrayBuffer()
    let text = new TextDecoder('utf-8').decode(buf)
    if (text.includes('\uFFFD')) text = new TextDecoder('big5').decode(buf)
    setFileName(file.name)
    setCsvText(text)
    setAgreed(false)
  }

  return (
    <Modal title="一鍵商品搬家（蝦皮 CSV 匯入）" onClose={onClose} size="lg" z={60}>
      <div className="space-y-4 p-5">
        <LegalBanner />
        <ol className="grid gap-2 sm:grid-cols-3">
          {['下載範例，或從蝦皮賣家中心匯出商品 CSV', '上傳檔案，系統自動比對欄位並檢查違禁詞與價格', '確認預覽後一鍵匯入，匯入後仍可逐項編輯'].map((t, i) => (
            <li key={t} className="flex gap-2 rounded-2xl border border-border/70 bg-secondary/60 p-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground">{i + 1}</span>
              <span className="text-pretty text-xs leading-relaxed">{t}</span>
            </li>
          ))}
        </ol>

        <label
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void loadFile(e.dataTransfer.files[0])
          }}
          className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed p-6 text-center transition focus-within:ring-2 focus-within:ring-primary ${
            dragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/60'
          }`}
        >
          <Upload className="size-6 text-brand-ink" />
          <span className="text-sm font-black">{fileName || '點擊選擇，或拖曳 CSV 檔案到這裡'}</span>
          <span className="text-xs text-muted-foreground">支援 UTF-8 / Big5 編碼，單檔最多 {MIGRATE_MAX_ROWS} 列、2MB</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void loadFile(e.target.files?.[0])} />
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={downloadSampleCsv} className={btnGhost}><Download className="size-4" />下載範例 CSV</button>
          <button
            type="button"
            onClick={() => {
              setFileName('shopee-products-sample.csv（範例資料）')
              setCsvText(MIGRATE_SAMPLE_CSV)
              setAgreed(false)
              setReadError('')
            }}
            className={btnGhost}
          >
            <FileSpreadsheet className="size-4" />載入範例資料試用
          </button>
          {csvText && (
            <button
              type="button"
              onClick={() => {
                setFileName('')
                setCsvText('')
                setAgreed(false)
              }}
              className={btnGhost}
            >
              清除
            </button>
          )}
        </div>

        {readError && (
          <p role="alert" className="flex gap-2 rounded-xl border border-destructive/40 bg-red-50 p-3 text-xs font-bold text-red-800">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />{readError}
          </p>
        )}

        {result?.error && (
          <p role="alert" className="flex gap-2 rounded-xl border border-destructive/40 bg-red-50 p-3 text-xs font-bold text-red-800">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />{result.error}
          </p>
        )}

        {result && !result.error && (
          <section aria-label="匯入預覽" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-black">匯入預覽</h3>
              <Pill tone="ok">可匯入 {okItems.length} 件</Pill>
              {badCount > 0 && <Pill tone="bad">無法匯入 {badCount} 件</Pill>}
              {result.truncated && <Pill tone="warn">僅讀取前 {MIGRATE_MAX_ROWS} 列</Pill>}
            </div>
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {result.items.map((it) => (
                <li key={`${it.line}-${it.name}`} className={`flex gap-3 rounded-xl border p-3 ${it.product ? 'border-border/70' : 'border-destructive/40 bg-red-50/60'}`}>
                  {it.product ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-bold">{it.name || `（第 ${it.line} 列未填名稱）`}</p>
                    {it.product && (
                      <p className="text-xs text-muted-foreground">
                        {it.category}・{money(it.price)}・庫存 {it.stock}・{it.optionCount} 個規格選項
                      </p>
                    )}
                    {it.reasons.map((r) => (
                      <p key={r} className="text-xs font-bold text-destructive">{r}</p>
                    ))}
                    {it.notes.map((n) => (
                      <p key={n} className="text-xs text-amber-700">{n}</p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-pretty text-xs text-muted-foreground">蝦皮 CSV 不含圖片，匯入的商品會先使用預設圖片，請到「編輯商品」換成實拍圖。</p>
          </section>
        )}

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 size-4 accent-primary" />
          <span className="text-pretty">我確認匯入的商品皆為本人合法銷售、圖文相符，且不含違禁品或仿冒品。</span>
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>取消</button>
          <button
            type="button"
            disabled={!canImport}
            onClick={() => onImport(okItems.map((i) => i.product as Product))}
            className={`${btnPrimary} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            匯入 {okItems.length} 件商品
          </button>
        </div>
      </div>
    </Modal>
  )
}

function SellerDashboard({
  sellers,
  seller,
  products,
  orders,
  payments,
  onSwitchSeller,
  onSaveProduct,
  onImportProducts,
  onToggleProduct,
  onDeleteProduct,
  onShip,
  onConfirmPaid,
  onPay,
  onResubmit,
  onSetShopClosed,
  onSimulateFail,
  onExpireTrial,
  onGraceDay,
  onRefundDecision,
  smsPrefs,
  onSmsPrefs,
  smsLog,
  notices,
  onReadNotices,
  appeals,
  onAppeal,
  reports = [],
  onSavePayment,
  onSaveKyc,
  exportLogs,
  onExported,
  tickets,
  onSubmitTicket,
  onReadTicket,
  onNotify,
  onCancelPlan,
}: {
  tickets: SupportTicket[]
  onSubmitTicket: (t: { category: string; subject: string; body: string }) => void
  onReadTicket: (id: string) => void
  onNotify: (m: string) => void
  onCancelPlan: (cancel: boolean) => void
  onSavePayment: (p: PaymentSettings) => void
  onSaveKyc: (k: KycInfo) => void
  exportLogs: ExportLog[]
  onExported: (kind: ExportLog['kind'], rows: number) => void
  onSimulateFail: () => void
  onExpireTrial: () => void
  onGraceDay: () => void
  onRefundDecision: (id: string, accept: boolean) => void
  notices: SellerNotice[]
  onReadNotices: () => void
  appeals: Appeal[]
  onAppeal: (a: { sellerId: string; kind: 'product' | 'ban' | 'seller'; productId?: string; productName: string; text: string }) => void
  reports?: Report[]
  sellers: Seller[]
  seller: Seller
  products: Product[]
  orders: Order[]
  payments: Payment[]
  smsPrefs: SmsPrefs
  onSmsPrefs: (p: SmsPrefs) => void
  smsLog: SmsMessage[]
  onSetShopClosed: (closed: boolean) => void
  onSwitchSeller: (id: string) => void
  onSaveProduct: (p: Product) => void
  onImportProducts: (ps: Product[]) => void
  onToggleProduct: (id: string) => void
  onDeleteProduct: (id: string) => void
  onShip: (id: string) => void
  onConfirmPaid: (id: string) => void
  onPay: (method: PayMethod, info: { last4?: string }) => void
  onResubmit: () => void
}) {
  const [tab, setTab] = useState<'products' | 'orders' | 'notices' | 'plan' | 'account' | 'support' | 'security'>('products')
  const [editing, setEditing] = useState<Product | null | 'new'>(null)
  const [migrating, setMigrating] = useState(false)
  const [renewOpen, setRenewOpen] = useState(false)
  const [renewReason, setRenewReason] = useState<string | null>(null)
  const closed = isClosed(seller)
  const unreadNotices = notices.filter((n) => !n.read)
  const [appealTarget, setAppealTarget] = useState<{ kind: 'product' | 'ban' | 'seller'; productId?: string; name: string } | null>(null)
  const productAppeal = (productId?: string) => appeals.find((a) => a.kind === 'product' && a.productId === productId)
  const banAppeal = appeals.find((a) => a.kind === 'ban')
  const sellerReportsOpen = reports.filter((r) => r.status === 'open' && r.targetType === 'seller').length
  const sellerAppeal = appeals.find((a) => a.kind === 'seller' && a.status === 'pending')
  const latestProductNoticeIds = (() => {
    const seen = new Set<string>()
    const ids = new Set<string>()
    for (const n of notices) {
      if ((n.kind === 'reported' || n.kind === 'confirmed') && n.productId && !seen.has(n.productId)) {
        seen.add(n.productId)
        ids.add(n.id)
      }
    }
    return ids
  })()
  const renderProductAppeal = (productId: string | undefined, productName: string, label: string) => {
    const flagged = (products.find((p) => p.id === productId)?.flagged ?? false) || reports.some((r) => r.status === 'open' && r.productId === productId)
    const ap = productAppeal(productId)
    if (ap && !(ap.status === 'approved' && flagged)) return { ap, button: null }
    if (!flagged) return { ap: null, button: null }
    return {
      ap: null,
      button: (
        <button type="button" onClick={() => setAppealTarget({ kind: 'product', productId, name: productName })} className={`${btnGhost} px-3 py-1.5 text-xs`}>
          <Megaphone className="size-3.5" />{label}
        </button>
      ),
    }
  }
  const submitAppeal = (text: string) => {
    if (!appealTarget) return
    onAppeal({ sellerId: seller.id, kind: appealTarget.kind, productId: appealTarget.productId, productName: appealTarget.name, text })
    setAppealTarget(null)
  }

  const openRenew = (reason: string | null = null) => {
    setRenewReason(reason)
    setRenewOpen(true)
  }
  const guard = (action: string, fn: () => void) => () => {
    if (closed) {
      openRenew(action)
      return
    }
    fn()
  }

  const myProducts = products.filter((p) => p.sellerId === seller.id)
  const myOrders = orders.filter((o) => o.sellerId === seller.id)
  const myPayments = payments.filter((p) => p.sellerId === seller.id)
  const pendingShip = myOrders.filter((o) => o.status === '待出貨').length
  const revenue = myOrders.reduce((s, o) => s + o.total, 0)
  const plan = planLabel[seller.plan.status]

  if (seller.suspended) {
    return (
      <div className={`${panelCls} mx-auto flex max-w-xl flex-col items-center gap-3 p-10 text-center`} role="alert">
        <span className="flex size-14 items-center justify-center rounded-full bg-destructive text-card"><Ban className="size-7" /></span>
        <h1 className="text-lg font-black">此賣家帳號已被平台永久封鎖</h1>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          「{seller.name}」因違反平台規範（{seller.suspendReason}）已被強制關店，所有商品已隱藏，帳號禁止再次登入。平台將配合檢警調閱實名資料。
        </p>
        {banAppeal ? (
          <AppealStatusBlock appeal={banAppeal} />
        ) : (
          <button type="button" onClick={() => setAppealTarget({ kind: 'ban', name: seller.name })} className={btnPrimary}>
            <Megaphone className="size-4" />提出申訴
          </button>
        )}
        {appealTarget && (
          <AppealModal kind={appealTarget.kind} targetName={appealTarget.name} onClose={() => setAppealTarget(null)} onSubmit={submitAppeal} />
        )}
        <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
          切換測試店家
          <select className={`${inputCls} w-auto py-1.5`} value={seller.id} onChange={(e) => onSwitchSeller(e.target.value)}>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.suspended ? '（已封鎖）' : ''}</option>)}
          </select>
        </label>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {appealTarget && (
        <AppealModal kind={appealTarget.kind} targetName={appealTarget.name} onClose={() => setAppealTarget(null)} onSubmit={submitAppeal} />
      )}
      {sellerReportsOpen > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <Flag className="size-5 shrink-0 text-amber-700" />
          <p className="min-w-0 flex-1 text-pretty font-bold leading-relaxed text-amber-900">
            您的賣場有 {sellerReportsOpen} 筆檢舉正在人工審核中，賣場仍正常營運。若認為檢舉不實，可提出申訴並回覆說明。
          </p>
          {sellerAppeal ? (
            <AppealStatusBlock appeal={sellerAppeal} />
          ) : (
            <button type="button" onClick={() => setAppealTarget({ kind: 'seller', name: seller.name })} className={`${btnGhost} px-3 py-1.5 text-xs`}>
              <Megaphone className="size-3.5" />申訴 / 回覆
            </button>
          )}
        </div>
      )}
      <div className={`${panelCls} flex flex-wrap items-center gap-4 p-4`}>
        <Avatar seller={seller} size="size-14" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-black">{seller.name}</h1>
            {seller.verify === 'approved' && <VerifiedBadge label />}
            <FounderBadge seller={seller} />
            {seller.verify === 'pending' && <Pill tone="warn"><Clock className="size-3" />待平台審核</Pill>}
            {seller.verify === 'rejected' && <Pill tone="bad"><Ban className="size-3" />審核退回</Pill>}
          </div>
          <p className="text-sm text-muted-foreground">店家後台・負責人 {seller.owner}・證件 {maskId(seller.idNo)}</p>
        </div>
        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:flex-wrap md:items-center">
          <div className="flex flex-col items-start gap-1.5 text-xs font-bold text-muted-foreground md:flex-row md:items-center md:gap-2">
            賣場狀態（測試）
            <ShopStatusSwitch closed={closed} onChange={onSetShopClosed} />
          </div>
          <label className="flex flex-col items-start gap-1.5 text-xs font-bold text-muted-foreground md:flex-row md:items-center md:gap-2">
            測試店家
            <select className={`${inputCls} w-full py-1.5 md:w-auto`} value={seller.id} onChange={(e) => onSwitchSeller(e.target.value)}>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {closed && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-destructive p-4 text-sm font-bold text-card shadow-sm">
          <CircleAlert className="size-5 shrink-0" />
          <p className="min-w-0 flex-1">您的月費已於 {fmtDate(seller.plan.nextDate)} 到期，系統已自動暫停您的賣場營業與商品刊登！</p>
          <button type="button" onClick={() => openRenew()} className="inline-flex items-center justify-center gap-1.5 rounded-full bg-card px-5 py-2 text-sm font-bold text-destructive transition hover:brightness-95 active:scale-[0.98]">
            立即續費 {money(PLAN_PRICE)}
          </button>
        </div>
      )}

      {seller.plan.status === 'grace' && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">
          <TriangleAlert className="size-5 shrink-0" />
          <p className="min-w-0 flex-1 text-pretty">
            本月月費（{money(PLAN_PRICE)}）扣款失敗！已進入 {GRACE_DAYS} 天補繳緩衝期（剩餘 {graceLeft(seller.plan)} 天），請儘速更新信用卡資訊以維持店鋪營運。
          </p>
          <button type="button" onClick={() => openRenew()} className={btnPrimary}>立即補繳 / 更新卡號</button>
        </div>
      )}

      {unreadNotices.length > 0 && tab !== 'notices' && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-accent p-4 text-sm">
          <Bell className="size-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="font-black text-destructive">您有 {unreadNotices.length} 則未讀的平台通知</p>
            <p className="truncate text-muted-foreground">{unreadNotices[0].title}</p>
          </div>
          <button type="button" onClick={() => setTab('notices')} className={btnPrimary}>查看通知</button>
        </div>
      )}

      {seller.verify === 'pending' && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <Clock className="mt-0.5 size-5 shrink-0" />
          <p>您的實名資料已送出，狀態為「待平台審核」。通過前商品不會顯示於前台市集，審核通過後才會上架。</p>
        </div>
      )}
      {seller.verify === 'rejected' && (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <CircleAlert className="mt-0.5 size-5 shrink-0" />
          <p className="min-w-0 flex-1">實名審核被退回：{seller.rejectReason || '證件資訊不清晰'}。請重新上傳後送審。</p>
          <button type="button" onClick={onResubmit} className={btnPrimary}>重新送審</button>
        </div>
      )}
      {seller.plan.status === 'due' && seller.verify === 'approved' && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <Receipt className="size-5 shrink-0" />
          <p className="min-w-0 flex-1">本期月費 {money(PLAN_PRICE)} 尚未繳納（應繳日 {seller.plan.nextDate}），逾期將暫停上架權限。</p>
          <button type="button" onClick={() => { setTab('plan'); openRenew() }} className={btnPrimary}>立即續費</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: '前台上架商品', value: closed ? 0 : myProducts.filter((p) => p.active && !p.flagged).length, icon: Package },
          { label: '待出貨訂單', value: pendingShip, icon: Truck },
          { label: '累計營收', value: money(revenue), icon: TrendingUp },
          { label: '方案狀態', value: plan.text, icon: Wallet },
        ].map((s) => (
          <div key={s.label} className={`${hoverPanelCls} flex flex-col items-start gap-2.5 p-3.5 md:flex-row md:items-center md:gap-3 md:p-4`}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-brand-ink md:size-10"><s.icon className="size-5" /></span>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-base font-black">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'products', label: '商品管理', icon: <Package className="size-4" /> },
          { id: 'orders', label: '訂單出貨', icon: <Truck className="size-4" />, badge: pendingShip },
          { id: 'notices', label: '通知中心', icon: <Bell className="size-4" />, badge: unreadNotices.length },
          { id: 'plan', label: '方案與月費管理', icon: <Wallet className="size-4" />, badge: seller.plan.status === 'due' || seller.plan.status === 'grace' || closed ? 1 : 0 },
          { id: 'account', label: '帳號設定', icon: <Settings className="size-4" /> },
          { id: 'security', label: '帳戶安全', icon: <LockKeyhole className="size-4" /> },
          { id: 'support', label: '客服中心', icon: <Mail className="size-4" />, badge: tickets.filter((t) => t.unread).length },
        ]}
      />

      {tab === 'notices' && (
        <section className="space-y-3" aria-label="通知中心">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-black">通知中心（{notices.length}）</h2>
            {unreadNotices.length > 0 && (
              <button type="button" onClick={onReadNotices} className={`${btnGhost} px-3 py-1.5 text-xs`}>全部標示已讀</button>
            )}
          </div>
          {notices.length === 0 ? (
            <p className={`${panelCls} p-10 text-center text-sm text-muted-foreground`}>目前沒有通知，商品被檢舉或平台審核結果會顯示在這裡</p>
          ) : (
            <ul className="space-y-3">
              {notices.map((n) => (
                <li key={n.id} className={`${panelCls} space-y-2 p-4 ${n.read ? '' : 'ring-1 ring-destructive/40'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    {n.kind === 'reported' && <Pill tone="warn"><Flag className="size-3" />商品被檢舉</Pill>}
                    {n.kind === 'dismissed' && <Pill tone="ok"><Check className="size-3" />檢舉已駁回</Pill>}
                    {n.kind === 'confirmed' && <Pill tone="bad"><Ban className="size-3" />確認違規</Pill>}
                    {n.kind === 'appeal_approved' && <Pill tone="ok"><Check className="size-3" />申訴成立</Pill>}
                    {n.kind === 'appeal_rejected' && <Pill tone="bad"><Ban className="size-3" />申訴駁回</Pill>}
                    {!n.read && <Pill tone="bad">未讀</Pill>}
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{n.at}</span>
                  </div>
                  <p className="text-sm font-black">{n.title}</p>
                  <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{n.text}</p>
                  {latestProductNoticeIds.has(n.id) && (() => {
                    const { ap, button } = renderProductAppeal(n.productId, n.productName, '我要申訴')
                    return ap ? <AppealStatusBlock appeal={ap} /> : button
                  })()}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'account' && (
        <div className="space-y-5">
          <SellerKycPanel seller={seller} onSave={onSaveKyc} />
          <SellerPaymentSettings key={seller.id} seller={seller} onSave={onSavePayment} />
          <SellerExportPanel products={myProducts} orders={myOrders} logs={exportLogs} onExported={onExported} />
          <SmsNotifySettings prefs={smsPrefs} onChange={onSmsPrefs} log={smsLog} />
        </div>
      )}

      {tab === 'products' && (
        <section className="space-y-3" aria-label="商品管理">
          <LegalBanner />
          <section aria-label="一鍵商品搬家" className={`${panelCls} flex flex-wrap items-center gap-4 border-primary/40 p-4`}>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-brand-ink">
              <FileSpreadsheet className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-black">一鍵商品搬家｜從蝦皮匯入商品</h3>
              <p className="mt-0.5 text-pretty text-xs leading-relaxed text-muted-foreground">
                上傳蝦皮賣家中心匯出的商品 CSV，系統自動比對欄位、檢查違禁詞與價格上限，確認後一次批次上架。
              </p>
            </div>
            <button type="button" onClick={guard('一鍵商品搬家', () => setMigrating(true))} className={btnPrimary}>
              <Upload className="size-4" />開始搬家
            </button>
          </section>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-black">我的商品（{myProducts.length}）</h2>
            <button type="button" onClick={guard('新增商品', () => setEditing('new'))} className={btnPrimary}><Plus className="size-4" />上架新商品</button>
          </div>
          {myProducts.length === 0 ? (
            <p className={`${panelCls} p-10 text-center text-sm text-muted-foreground`}>還沒有商品，點右上角開始上架</p>
          ) : (
            <ul className="space-y-3">
              {myProducts.map((p) => (
                <li key={p.id} className={`${hoverPanelCls} flex flex-wrap items-center gap-4 p-3`}>
                  <div className="size-16 shrink-0 overflow-hidden rounded-xl border border-border/70"><ProductImage src={p.image} alt={p.name} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.category}・已售 {p.sold}</p>
                  </div>
                  <p className="w-24 text-sm font-black text-brand-ink">{money(p.price)}</p>
                  <p className={`w-20 text-sm font-bold ${p.stock <= 5 ? 'text-destructive' : ''}`}>庫存 {p.stock}</p>
                  <button type="button" onClick={guard('調整商品上下架', () => onToggleProduct(p.id))} aria-pressed={p.active} className="shrink-0">
                    {p.flagged ? (
                      <Pill tone="bad"><Flag className="size-3" />被檢舉・審核中已隱藏</Pill>
                    ) : closed ? (
                      <Pill tone="bad"><Ban className="size-3" />已下架隱藏（賣場關閉）</Pill>
                    ) : (
                      <Pill tone={p.active ? 'ok' : 'neutral'}>{p.active ? '上架中' : '已下架'}</Pill>
                    )}
                  </button>
                  {(() => {
                    const { ap, button } = renderProductAppeal(p.id, p.name, '申訴')
                    return ap ? <Pill tone={appealStatusMeta[ap.status].tone}>{appealStatusMeta[ap.status].text}</Pill> : button
                  })()}
                  <div className="flex gap-1.5">
                    <button type="button" onClick={guard('編輯商品', () => setEditing(p))} className={`${btnGhost} px-3`} aria-label={`編輯 ${p.name}`}><Pencil className="size-4" /></button>
                    <button type="button" onClick={guard('刪除商品', () => onDeleteProduct(p.id))} className={`${btnGhost} px-3 hover:text-destructive`} aria-label={`刪除 ${p.name}`}><Trash2 className="size-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'orders' && (
        <section className="space-y-3" aria-label="訂單出貨">
          <h2 className="text-base font-black">訂單處理（{myOrders.length}）</h2>
          {myOrders.length === 0 ? (
            <p className={`${panelCls} p-10 text-center text-sm text-muted-foreground`}>目前沒有訂單</p>
          ) : (
            <ul className="space-y-3">
              {myOrders.map((o) => (
                <li key={o.id} className={`${panelCls} p-4`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm font-bold">{o.id}</p>
                    {o.live && <Pill tone="brand">新訂單</Pill>}
                    <Pill tone={o.status === '待出貨' ? 'warn' : o.status === '已出貨' ? 'brand' : 'ok'}>{o.status}</Pill>
                    <Pill tone={o.payStatus === '已付款' ? 'ok' : 'warn'}>{o.pay === 'card' ? '信用卡' : 'ATM'}・{o.payStatus}</Pill>
                    <span className="ml-auto text-xs text-muted-foreground">{o.date}</span>
                  </div>
                  <p className="mt-2 text-sm">{o.items.map((i) => `${i.name}（${i.variant}）×${i.qty}`).join('、')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">買家 {o.buyer}・{SHIP[o.shipMethod].label}・{o.shipTo}</p>
                  {o.refund && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <Undo2 className="size-4 shrink-0" />
                      <p className="min-w-0 flex-1">
                        <span className="font-bold">買家申請{o.refund.type === 'return' ? '退貨退款' : '退款'}</span>：{o.refund.reason}
                        {o.refund.note ? `・${o.refund.note}` : ''}
                      </p>
                      {o.refund.status === 'pending' ? (
                        <>
                          <button type="button" onClick={() => onRefundDecision(o.id, true)} className={`${btnPrimary} px-3 py-1.5 text-xs`}>同意</button>
                          <button type="button" onClick={() => onRefundDecision(o.id, false)} className={`${btnGhost} px-3 py-1.5 text-xs`}>拒絕</button>
                        </>
                      ) : (
                        <Pill tone={o.refund.status === 'accepted' ? 'ok' : 'bad'}>{o.refund.status === 'accepted' ? '已同意' : '已拒絕'}</Pill>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-black text-brand-ink">{money(o.total)} <span className="text-xs font-medium text-muted-foreground">（含運 {money(o.shipping)}）</span></p>
                    <div className="flex items-center gap-2">
                      {o.tracking && <span className="text-xs text-muted-foreground">物流單號 {o.tracking}</span>}
                      {o.payStatus === '待匯款' && (
                        <button type="button" onClick={() => onConfirmPaid(o.id)} className={btnGhost}><Banknote className="size-4" />確認已收款</button>
                      )}
                      {o.status === '待出貨' && (
                        <button type="button" disabled={o.payStatus === '待匯款'} onClick={() => onShip(o.id)} className={btnPrimary}>
                          <Truck className="size-4" />標記出貨
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'security' && (
        <section className="mx-auto max-w-xl" aria-label="帳戶安全">
          <SecurityPanel onNotify={onNotify} />
        </section>
      )}

      {tab === 'support' && (
        <section aria-label="客服中心">
          <SupportCenter role="seller" author={seller.name} tickets={tickets} onSubmit={onSubmitTicket} onRead={onReadTicket} />
        </section>
      )}

      {tab === 'plan' && (
        <section className="space-y-5" aria-label="方案與月費管理">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className={`${panelCls} relative overflow-hidden p-5`}>
              <div aria-hidden className="absolute -right-10 -top-10 size-40 rounded-full bg-accent" />
              <div className="relative">
                <p className="text-xs font-bold text-muted-foreground">目前方案</p>
                <h2 className="mt-1 text-xl font-black">標準賣家方案</h2>
                <p className="mt-1 text-3xl font-black text-brand-ink">NT$ 599 <span className="text-sm font-medium text-muted-foreground">/ 月</span></p>
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-sm font-bold text-secondary-foreground">
                  <Clock className="size-4" />本期週期：{periodText(seller.plan)}
                </p>
                <ul className="mt-4 grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
                  {['不限商品上架數', '專屬賣場與藍勾勾標章', '拆單與金物流串接', '電子發票自動開立'].map((t) => (
                    <li key={t} className="flex items-center gap-1.5"><Check className="size-4 text-emerald-600" />{t}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className={`${panelCls} space-y-3 p-5`}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">扣款狀態</p>
                <Pill tone={plan.tone}>{plan.text}</Pill>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">賣場狀態</dt><dd className="font-bold">{closed ? '暫時關閉・買家看到維護提示' : '營業中・商品顯示於前台'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">{closed ? '到期日' : '下期扣款日'}</dt><dd className="font-bold">{fmtDate(seller.plan.nextDate)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">付款方式</dt><dd className="font-bold">{seller.plan.method === 'card' ? `信用卡 •••• ${seller.plan.cardLast4 ?? '----'}` : '銀行轉帳 / ATM'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">自動扣款</dt><dd className="font-bold">{seller.plan.autoPay ? '已啟用' : '未啟用'}</dd></div>
              </dl>
              <button type="button" onClick={() => openRenew()} disabled={seller.plan.status === 'verifying'} className={`${btnPrimary} w-full`}>
                {seller.plan.status === 'verifying'
                  ? 'ATM 對帳核銷中'
                  : seller.plan.status === 'grace'
                    ? '立即補繳 / 更新卡號'
                    : seller.plan.status === 'due' || closed
                      ? '立即續費'
                      : '提前續費 / 更換付款方式'}
              </button>
              <div className="space-y-2 rounded-xl border border-dashed border-border bg-muted/50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                  <FlaskConical className="size-3.5" />測試控制
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onSimulateFail}
                    disabled={closed || seller.plan.status === 'grace'}
                    className={`${btnGhost} px-3 py-1.5 text-xs`}
                  >
                    模擬扣款失敗
                  </button>
                  {seller.plan.status === 'trial' && (
                    <button type="button" onClick={onExpireTrial} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                      模擬試用到期
                    </button>
                  )}
                  {seller.plan.status === 'grace' && (
                    <button type="button" onClick={onGraceDay} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                      模擬經過 1 天（剩 {graceLeft(seller.plan)} 天）
                    </button>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  觸發後進入 {GRACE_DAYS} 天補繳緩衝期；超過 {GRACE_DAYS} 天未補繳，狀態自動切換為「暫停營業」。
                </p>
              </div>
            </div>
          </div>

          <SubscriptionManager
            price={PLAN_PRICE}
            nextDate={seller.plan.nextDate}
            cancelAtPeriodEnd={!!seller.plan.cancelAtPeriodEnd}
            disabled={closed}
            onCancel={() => onCancelPlan(true)}
            onResume={() => onCancelPlan(false)}
          />

          <SmsReminderCard seller={seller} onSaveKyc={onSaveKyc} />

          <InvoiceVault seller={seller} payments={myPayments} />
        </section>
      )}

      {editing && (
        <ProductFormModal
          product={editing === 'new' ? null : editing}
          sellerId={seller.id}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            onSaveProduct(p)
            setEditing(null)
          }}
        />
      )}
      {migrating && (
        <ProductMigrateModal
          sellerId={seller.id}
          existingNames={new Set(myProducts.map((p) => p.name.trim()))}
          onClose={() => setMigrating(false)}
          onImport={(ps) => {
            onImportProducts(ps)
            setMigrating(false)
          }}
        />
      )}
      {renewOpen && (
        <RenewModal
          seller={seller}
          reason={renewReason}
          onClose={() => setRenewOpen(false)}
          onPay={(m, info) => {
            onPay(m, info)
            setRenewOpen(false)
          }}
        />
      )}
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * 平台總管理員後台
 * -------------------------------------------------------------------------- */

function DocPreview({ seller }: { seller: Seller }) {
  if (seller.docUrl) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={seller.docUrl} alt={`${seller.owner} 上傳的證件影本`} className="max-h-72 w-full object-contain" />
      </div>
    )
  }
  const isCompany = /^\d{8}$/.test(seller.idNo)
  return (
    <div className="rounded-2xl border border-border/70 bg-secondary p-4" role="img" aria-label={`${seller.docName} 證件預覽`}>
      <div className="rounded-xl border border-dashed border-primary/50 bg-card p-4">
        <p className="text-xs font-bold text-brand-ink">{isCompany ? '營業登記證明（預覽）' : '國民身分證（預覽）'}</p>
        <div className="mt-3 flex gap-4">
          <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded-lg bg-muted"><UserRound className="size-8 text-border" /></div>
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            <p><span className="text-xs text-muted-foreground">{isCompany ? '負責人' : '姓名'}　</span><span className="font-bold">{seller.owner}</span></p>
            <p><span className="text-xs text-muted-foreground">{isCompany ? '統一編號' : '身分證字號'}　</span><span className="font-mono font-bold">{seller.idNo}</span></p>
            <p className="truncate text-xs text-muted-foreground">檔案：{seller.docName}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReviewModal({
  seller,
  onClose,
  onApprove,
  onReject,
}: {
  seller: Seller
  onClose: () => void
  onApprove: () => void
  onReject: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  return (
    <Modal title={`審查證件｜${seller.name}`} onClose={onClose} size="md" z={60}>
      <div className="space-y-4 p-5">
        <DocPreview seller={seller} />
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {[
            ['店家名稱', seller.name],
            ['負責人', seller.owner],
            ['證號', seller.idNo],
            ['申請日期', seller.appliedAt],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-muted/60 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        {seller.verify === 'pending' ? (
          <>
            <Field label="退回原因（退回時必填）" error={error}>
              <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：證件影像模糊，無法辨識" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className={`${btnGhost} text-destructive`}
                onClick={() => {
                  if (!reason.trim()) return setError('請填寫退回原因')
                  onReject(reason.trim())
                }}
              >
                <Ban className="size-4" />退回
              </button>
              <button type="button" className={btnPrimary} onClick={onApprove}><Check className="size-4" />批准認證</button>
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-muted-foreground">此申請已處理：{seller.verify === 'approved' ? '已批准' : `已退回（${seller.rejectReason}）`}</p>
        )}
      </div>
    </Modal>
  )
}

function AdminDashboard({
  sellers,
  products,
  orders,
  onApprove,
  onReject,
  onConfirmVerify,
  onRemind,
  onSetShopClosed,
  reports,
  onDismissReport,
  onConfirmReport,
  onSuspend,
  appeals,
  onResolveAppeal,
  scamReports,
  blacklist,
  onReviewProduct,
  tickets,
  onReplyTicket,
}: {
  onReviewProduct: (id: string, ok: boolean) => void
  tickets: SupportTicket[]
  onReplyTicket: (id: string, text: string) => void
  scamReports: ScamReport[]
  blacklist: BlacklistEntry[]
  appeals: Appeal[]
  onResolveAppeal: (id: string, approve: boolean, reply: string) => void
  sellers: Seller[]
  products: Product[]
  orders: Order[]
  reports: Report[]
  onDismissReport: (id: string) => void
  onConfirmReport: (id: string) => void
  onSuspend: (id: string, reason: string) => void
  onSetShopClosed: (id: string, closed: boolean) => void
  onApprove: (id: string) => void
  onReject: (id: string, reason: string) => void
  onConfirmVerify: (id: string) => void
  onRemind: (id: string) => void
}) {
  const [tab, setTab] = useState<'board' | 'review' | 'fees' | 'risk' | 'listing' | 'tickets'>('board')
  const [filter, setFilter] = useState<'all' | VerifyStatus>('all')
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [banConfirm, setBanConfirm] = useState<string | null>(null)
  const [rejectingAppeal, setRejectingAppeal] = useState<string | null>(null)
  const [rejectReply, setRejectReply] = useState('')
  const openReports = reports.filter((r) => r.status === 'open').length
  const pendingAppeals = appeals.filter((a) => a.status === 'pending').length
  const suspendedSellers = sellers.filter((s) => s.suspended)

  const gmvBySeller = sellers.map((s) => ({
    seller: s,
    gmv: s.gmvBase + orders.filter((o) => o.sellerId === s.id).reduce((sum, o) => sum + o.total, 0),
  }))
  const totalGmv = gmvBySeller.reduce((s, g) => s + g.gmv, 0)
  const maxGmv = Math.max(...gmvBySeller.map((g) => g.gmv), 1)
  const liveToday = orders.filter((o) => o.live).reduce((s, o) => s + o.total, 0)
  const trend = TREND.map((v, i) => (i === TREND.length - 1 ? v + liveToday : v))
  const maxTrend = Math.max(...trend)
  const pendingCount = sellers.filter((s) => s.verify === 'pending').length
  const approved = sellers.filter((s) => s.verify === 'approved')
  const mrr = approved.filter((s) => s.plan.status === 'active').length * PLAN_PRICE
  const listed = products.filter((p) => {
    const s = sellers.find((x) => x.id === p.sellerId)
    return p.active && !p.flagged && s?.verify === 'approved' && !isOffline(s)
  }).length
  const reviewSeller = sellers.find((s) => s.id === reviewing) ?? null
  const shown = sellers.filter((s) => filter === 'all' || s.verify === filter)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black">平台總管理員後台</h1>
        <p className="text-sm text-muted-foreground">全站數據、賣家實名審核與月費追蹤</p>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'board', label: 'GMV 數據看板', icon: <LayoutDashboard className="size-4" /> },
          { id: 'review', label: '實名審核中心', icon: <ShieldCheck className="size-4" />, badge: pendingCount },
          { id: 'fees', label: '店家月費追蹤', icon: <Wallet className="size-4" /> },
          { id: 'risk', label: '違規審核專區', icon: <ShieldAlert className="size-4" />, badge: openReports + pendingAppeals },
          { id: 'listing', label: '高價商品審核', icon: <FileText className="size-4" />, badge: products.filter((p) => p.reviewHold).length },
          { id: 'tickets', label: '客服工單', icon: <Mail className="size-4" />, badge: tickets.filter((t) => t.status === 'open').length },
        ]}
      />

      {tab === 'board' && (
        <section className="space-y-5" aria-label="GMV 數據看板">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: '累計 GMV', value: money(totalGmv), icon: TrendingUp },
              { label: '訂單數（本次營運期）', value: `${orders.length} 筆`, icon: Package },
              { label: '認證賣家 / 待審', value: `${approved.length} / ${pendingCount}`, icon: ShieldCheck },
              { label: '月費 MRR', value: money(mrr), icon: Wallet },
            ].map((s) => (
              <div key={s.label} className={`${hoverPanelCls} p-4`}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><s.icon className="size-4 text-brand-ink" />{s.label}</div>
                <p className="mt-2 text-xl font-black">{s.value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={`${panelCls} p-5`}>
              <h2 className="text-sm font-black">近 7 日 GMV</h2>
              <div className="mt-4 flex h-44 items-end gap-2" role="img" aria-label="近七日 GMV 長條圖">
                {trend.map((v, i) => (
                  <div key={TREND_LABELS[i]} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                    <span className="text-[10px] font-bold text-muted-foreground">{(v / 1000).toFixed(1)}k</span>
                    <div className={`w-full rounded-t-lg transition-all ${i === trend.length - 1 ? 'bg-primary' : 'bg-chart-3'}`} style={{ height: `${(v / maxTrend) * 70}%` }} />
                    <span className="text-[10px] text-muted-foreground">{TREND_LABELS[i]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={`${panelCls} p-5`}>
              <h2 className="text-sm font-black">各店家 GMV 佔比</h2>
              <ul className="mt-4 space-y-3">
                {gmvBySeller.map(({ seller, gmv }) => (
                  <li key={seller.id}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1 font-bold">{seller.name}{seller.verify === 'approved' && <VerifiedBadge />}</span>
                      <span className="text-muted-foreground">{money(gmv)}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(gmv / maxGmv) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">前台目前可見商品 {listed} 件</p>
            </div>
          </div>
        </section>
      )}

      {tab === 'review' && (
        <section className="space-y-3" aria-label="實名審核中心">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="篩選審核狀態">
            {(
              [
                ['all', '全部'],
                ['pending', '待審核'],
                ['approved', '已通過'],
                ['rejected', '已退回'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${filter === id ? 'bg-foreground text-card' : 'bg-card text-muted-foreground ring-1 ring-border hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <ul className="space-y-3">
            {shown.map((s) => (
              <li key={s.id} className={`${hoverPanelCls} flex flex-wrap items-center gap-4 p-4`}>
                <Avatar seller={s} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-black">{s.name}{s.verify === 'approved' && <VerifiedBadge />}</p>
                  <p className="text-xs text-muted-foreground">負責人 {s.owner}・證號 {maskId(s.idNo)}・申請 {s.appliedAt}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><FileText className="size-3.5" />{s.docName}</p>
                </div>
                <Pill tone={s.verify === 'approved' ? 'ok' : s.verify === 'pending' ? 'warn' : 'bad'}>
                  {s.verify === 'approved' ? '已通過' : s.verify === 'pending' ? '待平台審核' : '已退回'}
                </Pill>
                <button type="button" onClick={() => setReviewing(s.id)} className={s.verify === 'pending' ? btnPrimary : btnGhost}>
                  <Eye className="size-4" />{s.verify === 'pending' ? '審查證件' : '檢視'}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className={`${panelCls} p-10 text-center text-sm text-muted-foreground`}>沒有符合條件的申請</li>}
          </ul>
        </section>
      )}

      {tab === 'fees' && (
        <section className="space-y-4" aria-label="店家月費追蹤">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                ['active', '正常營運中'],
                ['due', '待繳費'],
                ['verifying', '核銷中'],
                ['overdue', '逾期未繳費（已關店）'],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className={`${panelCls} p-4`}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-black">{sellers.filter((s) => s.plan.status === k).length}</p>
              </div>
            ))}
          </div>
          <div className={`${panelCls} overflow-x-auto`}>
            <table className="w-full min-w-[62rem] text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  {['店名', '方案', '賣場狀態', '訂閱起止時間', '付款方式', '賣場開關（測試）', '操作'].map((h) => <th key={h} scope="col" className="px-4 py-2.5 text-left font-bold">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {sellers.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 font-bold">{s.name}</td>
                    <td className="px-4 py-3">{money(PLAN_PRICE)} / 月</td>
                    <td className="px-4 py-3">
                      {s.suspended ? <Pill tone="bad"><Ban className="size-3" />已永久封鎖</Pill> : <Pill tone={planLabel[s.plan.status].tone}>{planLabel[s.plan.status].text}</Pill>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="text-xs text-muted-foreground">本期週期：</span>
                      <span className="font-bold">{periodText(s.plan)}</span>
                    </td>
                    <td className="px-4 py-3">{s.plan.method === 'card' ? `信用卡${s.plan.autoPay ? '（自動扣款）' : ''}` : 'ATM 轉帳'}</td>
                    <td className="px-4 py-3"><ShopStatusSwitch closed={isClosed(s)} onChange={(c) => onSetShopClosed(s.id, c)} /></td>
                    <td className="px-4 py-3">
                      {(s.plan.status === 'due' || s.plan.status === 'overdue') && <button type="button" onClick={() => onRemind(s.id)} className={`${btnGhost} px-3 py-1.5 text-xs`}>發送催繳通知</button>}
                      {s.plan.status === 'verifying' && <button type="button" onClick={() => onConfirmVerify(s.id)} className={`${btnPrimary} px-3 py-1.5 text-xs`}>確認核銷</button>}
                      {s.plan.status === 'active' && <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'listing' && (
        <section className="space-y-3" aria-label="高價商品審核">
          <div>
            <h2 className="text-base font-black">高價商品審核</h2>
            <p className="text-sm text-muted-foreground">
              單價超過 {money(REVIEW_PRICE_LIMIT)} 的商品會自動鎖定為「審核中」，核准後才會公開，保護買家避免高額詐騙。
            </p>
          </div>
          {products.filter((p) => p.reviewHold).length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">目前沒有等待審核的商品</p>
          ) : (
            <ul className="space-y-3">
              {products
                .filter((p) => p.reviewHold)
                .map((p) => {
                  const owner = sellers.find((x) => x.id === p.sellerId)
                  return (
                    <li key={p.id} className={`${panelCls} flex flex-wrap items-center gap-3 p-4`}>
                      <div className="size-16 shrink-0 overflow-hidden rounded-xl border border-border/70">
                        <ProductImage src={p.image} alt={p.name} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="truncate text-sm font-black">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {owner?.name ?? "未知賣家"}・{money(p.price)}
                        </p>
                        <Pill tone="warn">審核中・買家看不到</Pill>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => onReviewProduct(p.id, false)} className={`${btnGhost} px-3 py-1.5 text-xs`}>
                          退回
                        </button>
                        <button type="button" onClick={() => onReviewProduct(p.id, true)} className={`${btnPrimary} px-3 py-1.5 text-xs`}>
                          核准公開
                        </button>
                      </div>
                    </li>
                  )
                })}
            </ul>
          )}
        </section>
      )}

      {tab === 'tickets' && <AdminTicketsPanel tickets={tickets} onReply={onReplyTicket} />}

      {tab === 'risk' && (
        <section className="space-y-5" aria-label="違規審核專區">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: '待審核檢舉', value: openReports },
              { label: '待審申訴', value: pendingAppeals },
              { label: '已確認違規', value: reports.filter((r) => r.status === 'confirmed').length },
              { label: '黑名單賣家', value: suspendedSellers.length },
            ].map((s) => (
              <div key={s.label} className={`${panelCls} p-4`}>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-black">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-black">申訴案件（{appeals.length}）</h2>
            {appeals.length === 0 ? (
              <p className={`${panelCls} p-6 text-center text-sm text-muted-foreground`}>目前沒有申訴案件。賣家商品被確認違規下架或帳號遭封鎖後，可在店家後台提出申訴。</p>
            ) : (
              <ul className="space-y-3">
                {appeals.map((a) => {
                  const seller = sellers.find((s) => s.id === a.sellerId)
                  const meta = appealStatusMeta[a.status]
                  return (
                    <li key={a.id} className={`${panelCls} space-y-3 p-4`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={meta.tone}>{meta.text}</Pill>
                        <Pill tone="neutral">{a.kind === 'ban' ? '解除封鎖申訴' : '商品下架申訴'}</Pill>
                        <span className="ml-auto font-mono text-xs text-muted-foreground">{a.at}</span>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-black">{a.kind === 'ban' ? `${a.productName} 申請解除封鎖` : a.productName}</p>
                        <p className="text-xs text-muted-foreground">賣家：{seller?.name ?? '未知'}{a.kind === 'ban' && seller?.suspendReason ? `・封鎖原因：${seller.suspendReason}` : ''}</p>
                      </div>
                      <p className="text-pretty rounded-xl bg-muted/60 p-3 text-sm leading-relaxed">{a.text}</p>
                      {a.reply && <p className="text-pretty text-xs font-bold leading-relaxed">平台回覆：{a.reply}</p>}
                      {a.status === 'pending' && (
                        rejectingAppeal === a.id ? (
                          <div className="space-y-2">
                            <input
                              className={inputCls}
                              value={rejectReply}
                              onChange={(e) => setRejectReply(e.target.value)}
                              maxLength={100}
                              placeholder="駁回說明（選填，預設為維持原處分）"
                              aria-label="駁回說明"
                            />
                            <div className="flex flex-wrap justify-end gap-2">
                              <button type="button" onClick={() => setRejectingAppeal(null)} className={`${btnGhost} px-3 py-1.5 text-xs`}>取消</button>
                              <button
                                type="button"
                                onClick={() => {
                                  onResolveAppeal(a.id, false, rejectReply.trim() || '經複審後維持原處分，本案不得再次申訴。')
                                  setRejectingAppeal(null)
                                  setRejectReply('')
                                }}
                                className={`${btnDanger} px-3 py-1.5 text-xs`}
                              >
                                確認駁回
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingAppeal(a.id)
                                setRejectReply('')
                              }}
                              className={`${btnGhost} px-3 py-1.5 text-xs hover:text-destructive`}
                            >
                              駁回申訴
                            </button>
                            <button
                              type="button"
                              onClick={() => onResolveAppeal(a.id, true, a.kind === 'ban' ? '經複審後認定處分有誤，已解除封鎖。' : '經複審後認定申訴成立，商品已恢復上架。')}
                              className={`${btnPrimary} px-3 py-1.5 text-xs`}
                            >
                              <Check className="size-3.5" />{a.kind === 'ban' ? '申訴成立・解除封鎖' : '申訴成立・恢復上架'}
                            </button>
                          </div>
                        )
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-black">檢舉案件（{reports.length}）</h2>
            {reports.length === 0 ? (
              <p className={`${panelCls} p-10 text-center text-sm text-muted-foreground`}>目前沒有檢舉案件。買家可在商品詳情頁或賣場頁送出檢舉，案件會進入待審區等待人工審核，商品不會直接下架。</p>
            ) : (
              <ul className="space-y-3">
                {reports.map((r) => {
                  const seller = sellers.find((s) => s.id === r.sellerId)
                  const reason = REPORT_REASONS.find((x) => x.id === r.reason)
                  const meta = reportStatusMeta[r.status]
                  const banned = !!seller?.suspended
                  return (
                    <li key={r.id} className={`${panelCls} space-y-3 p-4`}>
                      <div className="flex flex-wrap items-start gap-3">
                        {r.targetType === 'seller' ? (
                          seller ? <Avatar seller={seller} size="size-16" /> : null
                        ) : (
                          <div className="size-16 shrink-0 overflow-hidden rounded-xl border border-border/70"><ProductImage src={r.productImage} alt={r.productName} /></div>
                        )}
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm font-black">{r.productName}<Pill tone="neutral">{r.targetType === 'seller' ? '檢舉賣家' : '檢舉商品'}</Pill></p>
                          <p className="text-xs text-muted-foreground">賣家：{seller?.name ?? '未知'}・檢舉人 {r.reporter}・{r.at}</p>
                          <p className="flex items-center gap-1.5 text-xs font-bold text-destructive">{reason && <reason.icon className="size-3.5" />}{reason?.label}</p>
                          {r.note && <p className="text-pretty text-xs text-muted-foreground">補充：{r.note}</p>}
                          {r.evidence && r.evidence.length > 0 && <EvidenceThumbs images={r.evidence} />}
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <Pill tone={meta.tone}>{meta.text}</Pill>
                          {banned && <Pill tone="bad"><Ban className="size-3" />賣家已封鎖</Pill>}
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {r.status === 'open' && (
                          <>
                            <button type="button" onClick={() => onDismissReport(r.id)} className={`${btnGhost} px-3 py-1.5 text-xs`}>{r.targetType === 'seller' ? '駁回檢舉' : '駁回檢舉（維持上架）'}</button>
                            <button type="button" onClick={() => onConfirmReport(r.id)} className={`${btnGhost} px-3 py-1.5 text-xs hover:text-destructive`}>{r.targetType === 'seller' ? '確認違規並警告' : '確認違規並下架'}</button>
                          </>
                        )}
                        {!banned && (
                          banConfirm === r.id ? (
                            <>
                              <span className="self-center text-xs font-bold text-destructive">確定永久封鎖「{seller?.name}」？</span>
                              <button type="button" onClick={() => setBanConfirm(null)} className={`${btnGhost} px-3 py-1.5 text-xs`}>取消</button>
                              <button
                                type="button"
                                onClick={() => {
                                  onSuspend(r.sellerId, reason?.label ?? '違反平台規範')
                                  setBanConfirm(null)
                                }}
                                className={`${btnDanger} px-3 py-1.5 text-xs`}
                              >
                                確認封鎖
                              </button>
                            </>
                          ) : (
                            <button type="button" onClick={() => setBanConfirm(r.id)} className={`${btnDanger} px-3 py-1.5 text-xs`}><Ban className="size-3.5" />1 秒一鍵封鎖賣場</button>
                          )
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-black">買家詐騙 / 未出貨檢舉</h2>
            {scamReports.length === 0 ? (
              <p className={`${panelCls} p-6 text-center text-sm text-muted-foreground`}>目前沒有買家提出的詐騙或未出貨檢舉</p>
            ) : (
              <ul className="space-y-2">
                {scamReports.map((r) => {
                  const target = sellers.find((x) => x.id === r.sellerId)
                  return (
                    <li key={r.id} className={`${panelCls} flex flex-wrap items-center gap-3 p-3`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black">{target?.name ?? '未知賣家'}・訂單 {r.orderId}</p>
                        <p className="text-xs text-muted-foreground">檢舉人 {r.buyer}・{r.at}・原因：{r.reason}</p>
                      </div>
                      {target?.suspended ? (
                        <Pill tone="bad"><Ban className="size-3" />已封鎖</Pill>
                      ) : (
                        <button type="button" onClick={() => onSuspend(r.sellerId, `買家檢舉：${r.reason}`)} className={`${btnDanger} px-3 py-1.5 text-xs`}>
                          <Ban className="size-3.5" />1 秒一鍵封鎖賣場
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-black">黑名單（Banned）</h2>
            {suspendedSellers.length === 0 ? (
              <p className={`${panelCls} p-6 text-center text-sm text-muted-foreground`}>目前沒有被封鎖的賣家</p>
            ) : (
              <ul className="space-y-2">
                {suspendedSellers.map((s) => (
                  <li key={s.id} className={`${panelCls} flex flex-wrap items-center gap-3 p-3`}>
                    <Avatar seller={s} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black">{s.name}</p>
                      <p className="text-xs text-muted-foreground">負責人 {s.owner}・證號 {maskId(s.idNo)}・原因：{s.suspendReason}</p>
                      {blacklist.find((b) => b.sellerId === s.id) && (
                        <p className="text-xs text-muted-foreground">
                          永久列入黑名單：身分證 {blacklist.find((b) => b.sellerId === s.id)?.idNo}・銀行帳號 {blacklist.find((b) => b.sellerId === s.id)?.bankAccount}・手機 {blacklist.find((b) => b.sellerId === s.id)?.phone}
                        </p>
                      )}
                    </div>
                    <Pill tone="bad"><Ban className="size-3" />已永久封鎖・禁止登入</Pill>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {reviewSeller && (
        <ReviewModal
          seller={reviewSeller}
          onClose={() => setReviewing(null)}
          onApprove={() => {
            onApprove(reviewSeller.id)
            setReviewing(null)
          }}
          onReject={(reason) => {
            onReject(reviewSeller.id, reason)
            setReviewing(null)
          }}
        />
      )}
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * 主元件：買個 Pay 服 開放式電商平台
 * -------------------------------------------------------------------------- */

/* ----------------------------------------------------------------------------
 * 全站分類導覽 / 退款申請 / 免責提示 / 頁尾
 * -------------------------------------------------------------------------- */

function CategoryNav({ value, onChange }: { value: CategorySel; onChange: (v: CategorySel) => void }) {
  const family = CATEGORY_FAMILIES.find((f) => f.id === value.family)
  const main = family?.mains.find((m) => m.label === value.main)
  const chip = (active: boolean) =>
    `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-bold transition md:px-4 md:py-1.5 ${
      active ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card text-muted-foreground ring-1 ring-border hover:text-foreground'
    }`

  return (
    <nav aria-label="商品分類" className="space-y-3">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
        <button type="button" aria-pressed={!value.family} onClick={() => onChange(NO_CATEGORY)} className={chip(!value.family)}>
          全部商品
        </button>
        {CATEGORY_FAMILIES.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={value.family === f.id}
            onClick={() => onChange({ family: f.id, main: null, sub: null })}
            className={chip(value.family === f.id)}
          >
            <f.icon className="size-4" />
            {f.label}
          </button>
        ))}
      </div>

      {family && (
        <div className="flex items-center gap-2 overflow-x-auto rounded-2xl border border-border/70 bg-muted/50 p-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible md:p-3">
          <span className="mr-1 shrink-0 text-xs font-bold text-muted-foreground">主分類</span>
          <button
            type="button"
            aria-pressed={!value.main}
            onClick={() => onChange({ family: family.id, main: null, sub: null })}
            className={chip(!value.main)}
          >
            {family.label}全部
          </button>
          {family.mains.map((m) => (
            <button
              key={m.label}
              type="button"
              aria-pressed={value.main === m.label}
              onClick={() => onChange({ family: family.id, main: m.label, sub: null })}
              className={chip(value.main === m.label)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {main && (
        <div className="flex items-center gap-2 overflow-x-auto rounded-2xl border border-border/70 bg-muted/50 p-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible md:p-3">
          <span className="mr-1 shrink-0 text-xs font-bold text-muted-foreground">熱門子分類</span>
          <button
            type="button"
            aria-pressed={!value.sub}
            onClick={() => onChange({ family: value.family, main: main.label, sub: null })}
            className={chip(!value.sub)}
          >
            {main.label}全部
          </button>
          {main.subs.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={value.sub === s}
              onClick={() => onChange({ family: value.family, main: main.label, sub: s })}
              className={chip(value.sub === s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </nav>
  )
}

const REFUND_REASONS = ['商品瑕疵 / 損壞', '收到錯誤商品', '商品與頁面描述不符', '尚未收到商品', '不想要了（七天鑑賞期）', '其他']

function RefundModal({
  order,
  sellerName,
  onClose,
  onSubmit,
}: {
  order: Order
  sellerName: string
  onClose: () => void
  onSubmit: (r: { type: RefundType; reason: string; note: string }) => void
}) {
  const [type, setType] = useState<RefundType>('return')
  const [reason, setReason] = useState(REFUND_REASONS[0])
  const [note, setNote] = useState('')

  return (
    <Modal title="退貨 / 退款申請" onClose={onClose} size="md" z={70}>
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit({ type, reason, note: note.trim() })
        }}
      >
        <p className="text-sm text-muted-foreground">
          訂單 <span className="font-mono font-bold text-foreground">{order.id}</span>・{sellerName}・{money(order.total)}
        </p>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-bold">申請類型</legend>
          {([
            ['return', '退貨退款', '寄回商品後，由賣家確認並退款'],
            ['refundOnly', '僅退款', '商品未收到或不需退回時使用'],
          ] as const).map(([id, label, hint]) => (
            <label
              key={id}
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm ${type === id ? 'border-primary bg-accent' : 'border-border'}`}
            >
              <input type="radio" name="refund-type" checked={type === id} onChange={() => setType(id)} className="mt-1 accent-primary" />
              <span>
                <span className="block font-bold">{label}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field label="申請原因">
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REFUND_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="補充說明（選填）">
          <textarea className={`${inputCls} min-h-24`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="請描述商品狀況，可協助賣家更快處理" />
        </Field>
        <DisclaimerNote />
        <button type="submit" className={`${btnPrimary} w-full`}>送出申請給賣家</button>
      </form>
    </Modal>
  )
}

const PHONE_OTP = '246810'

function PhoneOtpModal({ onClose, onVerified }: { onClose: () => void; onVerified: () => void }) {
  const [phone, setPhone] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const send = () => {
    if (!/^09\d{8}$/.test(phone)) return setError('請輸入 10 碼手機號碼（09 開頭）')
    setError('')
    setSent(true)
  }
  const verify = () => {
    if (code !== PHONE_OTP) return setError('驗證碼錯誤，請重新輸入')
    onVerified()
  }

  return (
    <Modal title="簡訊驗證 (OTP)" onClose={onClose} size="sm" z={80}>
      <div className="space-y-4 p-5">
        <p className="flex items-start gap-2 rounded-2xl bg-secondary p-3 text-xs leading-relaxed text-secondary-foreground">
          <Smartphone className="mt-0.5 size-4 shrink-0" />
          第一次兌換優惠券需驗證手機，防止多帳號或機器人刷點數。驗證一次後即可正常兌換。
        </p>
        <Field label="手機號碼">
          <input
            inputMode="numeric"
            className={inputCls}
            placeholder="0912345678"
            value={phone}
            disabled={sent}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
          />
        </Field>
        {sent && (
          <Field label="6 碼驗證碼" hint={`（原型示範）簡訊已發送，驗證碼為 ${PHONE_OTP}`}>
            <input
              inputMode="numeric"
              className={`${inputCls} tracking-[0.4em]`}
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </Field>
        )}
        {error && <p role="alert" className="text-xs font-bold text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>取消</button>
          {sent ? (
            <button type="button" className={btnPrimary} onClick={verify}>驗證並兌換</button>
          ) : (
            <button type="button" className={btnPrimary} onClick={send}>發送驗證碼</button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function RedeemSuccessModal({
  coupon,
  seller,
  onClose,
  onGoStore,
}: {
  coupon: Coupon
  seller?: Seller
  onClose: () => void
  onGoStore: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coupon.code)
    } catch {
      // 剪貼簿權限被拒時仍顯示已複製提示，買家可手動選取折扣碼
    }
    setCopied(true)
  }
  return (
    <Modal title="領取成功" onClose={onClose} size="sm" z={80}>
      <div className="space-y-4 p-5 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <Gift className="size-7" />
        </span>
        <div>
          <h3 className="text-lg font-black">領取成功</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            「{seller?.name}」滿 {money(coupon.minSpend)} 折 {money(coupon.amount)}
          </p>
          <p className="mt-1 text-sm font-bold text-emerald-600">已保存至您的優惠券包</p>
        </div>
        <div className="rounded-2xl border-2 border-dashed border-primary bg-accent px-4 py-3">
          <p className="text-xs text-muted-foreground">專屬折扣碼</p>
          <p className="font-mono text-2xl font-black tracking-widest text-brand-ink">{coupon.code}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className={btnGhost} onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? '已複製折扣碼' : '複製折扣碼'}
          </button>
          <button type="button" className={btnPrimary} onClick={onGoStore}>
            <Store className="size-4" />前往該店購物
          </button>
        </div>
        <CouponDisclaimer />
      </div>
    </Modal>
  )
}

function CheckinZone({
  loggedIn,
  points,
  ledger,
  checkedDays,
  checkedToday,
  coupons,
  ownedCodes,
  sellers,
  onCheckIn,
  onNextDay,
  onRedeem,
  onOpenStore,
}: {
  loggedIn: boolean
  points: number
  ledger: LedgerEntry[]
  checkedDays: number
  checkedToday: boolean
  coupons: Coupon[]
  ownedCodes: string[]
  sellers: Seller[]
  onCheckIn: () => void
  onNextDay: () => void
  onRedeem: (id: string) => void
  onOpenStore: (sid: string) => void
}) {
  const [showLedger, setShowLedger] = useState(false)
  const [burst, setBurst] = useState<number | null>(null)
  const prevToday = useRef(checkedToday)
  useEffect(() => {
    if (checkedToday && !prevToday.current) {
      setBurst(CHECKIN_REWARDS[Math.max(0, checkedDays - 1)])
      const t = setTimeout(() => setBurst(null), 1800)
      prevToday.current = checkedToday
      return () => clearTimeout(t)
    }
    prevToday.current = checkedToday
  }, [checkedToday, checkedDays])

  const listed = coupons.filter((c) => c.listed && c.active)

  return (
    <section className="mt-8 grid gap-4 lg:grid-cols-[22rem_1fr]" aria-label="天天簽到專區">
      <div className={`${panelCls} relative overflow-hidden p-5`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-lg font-black"><CalendarCheck className="size-5 text-brand-ink" />天天簽到領金幣</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">連續簽到 7 天，第 7 天獎勵加倍</p>
          </div>
          <div className="text-right">
            <p className="flex items-center justify-end gap-1 text-2xl font-black text-brand-ink"><Coins className="size-5" />{loggedIn ? points : 0}</p>
            <p className="text-xs text-muted-foreground">我的點數</p>
          </div>
        </div>
        <ol className="mt-4 grid grid-cols-7 gap-1.5" aria-label="7 天簽到進度">
          {CHECKIN_REWARDS.map((r, i) => {
            const done = loggedIn && i < checkedDays
            const today = loggedIn && !checkedToday && i === checkedDays
            return (
              <li
                key={i}
                className={`flex flex-col items-center gap-0.5 rounded-xl border py-2 text-[11px] font-bold ${
                  done ? 'border-primary bg-primary text-primary-foreground' : today ? 'border-primary bg-accent text-brand-ink ring-2 ring-primary/40' : 'border-border bg-muted/50 text-muted-foreground'
                }`}
              >
                <span>第{i + 1}天</span>
                {done ? <Check className="size-4" /> : <Coins className="size-4" />}
                <span>+{r}</span>
              </li>
            )
          })}
        </ol>
        <div className="relative mt-4">
          <button type="button" onClick={onCheckIn} disabled={loggedIn && checkedToday} className={`${btnPrimary} w-full disabled:opacity-60`}>
            <CalendarCheck className="size-4" />
            {loggedIn && checkedToday ? '今日已簽到' : '一鍵簽到'}
          </button>
          {burst !== null && (
            <span aria-live="polite" className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 animate-bounce rounded-full bg-amber-400 px-4 py-1 text-sm font-black text-amber-950 shadow-lg">
              簽到成功 +{burst} 點
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <button type="button" onClick={() => setShowLedger((v) => !v)} aria-expanded={showLedger} className="font-bold text-brand-ink hover:underline">
            {showLedger ? '收合點數明細' : '查看點數收支明細'}
          </button>
          <button type="button" onClick={onNextDay} className="inline-flex items-center gap-1 font-bold text-muted-foreground hover:text-foreground">
            <FlaskConical className="size-3.5" />模擬隔天
          </button>
        </div>
        {showLedger && (
          <ul className="mt-3 max-h-48 space-y-1.5 overflow-y-auto rounded-2xl bg-muted/50 p-3 text-xs" aria-label="點數收支明細">
            {ledger.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0"><span className="block truncate font-medium">{l.label}</span><span className="text-muted-foreground">{l.at}</span></span>
                <span className={`shrink-0 font-black ${l.delta > 0 ? 'text-emerald-600' : 'text-destructive'}`}>{l.delta > 0 ? `+${l.delta}` : l.delta}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={`${panelCls} p-5`}>
        <h2 className="flex items-center gap-1.5 text-lg font-black"><Ticket className="size-5 text-brand-ink" />點數兌換專區</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">合作賣家自主提供的店鋪優惠券，用簽到點數免費兌換</p>
        {listed.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">目前沒有上架的優惠券</p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {listed.map((c) => {
              const s = sellers.find((x) => x.id === c.sellerId)
              const remain = couponRemain(c)
              const hot = remain > 0 && c.redeemed / c.qty >= 0.5
              const owned = ownedCodes.includes(c.code)
              return (
                <li key={c.id} className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => s && onOpenStore(s.id)} className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-brand-ink">
                      <Store className="size-3.5 shrink-0" /><span className="truncate">{s?.name}</span>
                    </button>
                    {remain === 0 ? <Pill tone="bad">已兌完</Pill> : hot ? <Pill tone="warn">熱門搶手・剩 {remain} 張</Pill> : <Pill tone="ok">剩餘 {remain} 張</Pill>}
                  </div>
                  <p className="text-xl font-black text-brand-ink">滿 {money(c.minSpend)} 折 {money(c.amount)}</p>
                  <p className="text-xs text-muted-foreground">{c.cost} 點兌換『{s?.name}』滿 {money(c.minSpend)} 折 {money(c.amount)}</p>
                  <button type="button" disabled={remain === 0 || owned} onClick={() => onRedeem(c.id)} className={`${btnPrimary} mt-auto disabled:opacity-60`}>
                    <Gift className="size-4" />{owned ? '已兌換' : `${c.cost} 點立即兌換`}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="mt-4"><CouponDisclaimer /></div>
      </div>
    </section>
  )
}

function TakedownModal({
  products,
  onClose,
  onSubmit,
}: {
  products: Product[]
  onClose: () => void
  onSubmit: (pid: string, reason: ReportReason, note: string, extra: { reporterType: 'buyer' | 'brand'; contact: string }) => void
}) {
  const [pid, setPid] = useState('')
  const [reporterType, setReporterType] = useState<'buyer' | 'brand'>('buyer')
  const [reason, setReason] = useState<ReportReason | ''>('')
  const [contact, setContact] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const e: Record<string, string> = {}
    if (!pid) e.pid = '請選擇被檢舉的商品'
    if (!reason) e.reason = '請選擇檢舉類型'
    if (!contact.trim()) e.contact = '請留下聯絡 Email 或電話'
    if (note.trim().length < 10) e.note = '請至少輸入 10 個字說明侵權或違規事實'
    setErrors(e)
    if (Object.keys(e).length || !reason) return
    onSubmit(pid, reason, note.trim(), { reporterType, contact: contact.trim() })
  }

  return (
    <Modal title="檢舉違規 / 侵權商品" onClose={onClose} size="md" z={70}>
      <div className="space-y-4 p-5">
        <p className="rounded-2xl bg-secondary p-3 text-xs leading-relaxed text-secondary-foreground">
          智慧財產權與違禁品檢舉機制（Notice &amp; Takedown）：買家或品牌權利人皆可檢舉。收到通知後商品會先行下架，並由管理員審核，符合避風港免責原則。
        </p>
        <div role="radiogroup" aria-label="檢舉人身分" className="grid grid-cols-2 gap-2">
          {(
            [
              ['buyer', '一般買家'],
              ['brand', '品牌 / 智財權利人'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={reporterType === k}
              onClick={() => setReporterType(k)}
              className={`rounded-2xl border p-3 text-sm font-bold transition ${reporterType === k ? 'border-primary bg-accent' : 'border-border hover:border-primary/50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Field label="被檢舉商品" error={errors.pid}>
          <select className={inputCls} value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">請選擇商品</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="檢舉類型" error={errors.reason}>
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
            <option value="">請選擇類型</option>
            {REPORT_REASONS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </Field>
        <Field label="聯絡方式（Email 或電話）" error={errors.contact}>
          <input className={inputCls} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="legal@brand.example" />
        </Field>
        <Field label="侵權或違規事實說明" error={errors.note}>
          <textarea className={`${inputCls} min-h-24`} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="請描述侵權內容，並附上商標、著作權或相關證明編號" />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>取消</button>
          <button type="button" className={btnDanger} onClick={submit}><Flag className="size-4" />送出檢舉</button>
        </div>
      </div>
    </Modal>
  )
}

function DisclaimerNote() {
  return (
    <div role="note" className="flex gap-3 rounded-2xl border-2 border-destructive bg-red-50 p-4 text-sm font-bold leading-relaxed text-red-800">
      <ShieldAlert className="mt-0.5 size-5 shrink-0" />
      <p className="text-pretty">
        本平台為 SaaS 技術服務商，交易契約存在於買賣雙方之間。平台不代收付商品貨款，售後與退換貨請直接透過上方按鈕與店鋪賣家聯繫。
      </p>
    </div>
  )
}

const FOOTER_LINKS = [
  { href: '/legal/tos', label: '服務條款 (TOS)' },
  { href: '/legal/privacy', label: '隱私權政策 (Privacy)' },
  { href: '/legal/prohibited', label: '違禁品規範' },
  { href: '/legal/disclaimer', label: '免責聲明' },
]

function SiteFooter({ onReport, onTerms }: { onReport: () => void; onTerms: () => void }) {
  return (
    <footer className="border-t border-border/70 bg-card">
      <section className="mx-auto grid max-w-7xl gap-3 px-4 pt-8 md:grid-cols-3" aria-label="法律與平台合規專區">
        <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-black"><FileText className="size-4 text-brand-ink" />消保法賣家營業資訊揭露</h3>
          <p className="mt-1.5 text-pretty text-xs leading-relaxed text-muted-foreground">
            賣家須於後台設定公司或個人營業資訊與客服管道，並公開顯示於各賣家賣場底部，確保符合消費者保護法規定。
          </p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-black"><ShieldAlert className="size-4 text-destructive" />智慧財產權與違禁品檢舉</h3>
          <p className="mt-1.5 text-pretty text-xs leading-relaxed text-muted-foreground">
            買家或品牌方發現侵權、仿冒或違禁品，可提交檢舉，管理員審核後可一鍵下架（避風港原則）。
          </p>
          <button type="button" onClick={onReport} className={`${btnDanger} mt-3 py-1.5 text-xs`}>
            <Flag className="size-3.5" />檢舉違規 / 侵權商品
          </button>
        </div>
        <div className="rounded-2xl border border-border/70 bg-muted/40 p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-black"><Receipt className="size-4 text-brand-ink" />稅務與營業登記提醒</h3>
          <p className="mt-1.5 text-pretty text-xs leading-relaxed text-muted-foreground">{TAX_NOTE}</p>
        </div>
      </section>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md space-y-1.5">
          <p className="text-base font-black">買個 Pay 服</p>
          <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
            雙向實名制 SaaS 市集平台。平台僅提供技術服務，交易契約存在於買賣雙方之間，不代收付商品貨款。
          </p>
        </div>
        <nav aria-label="法律與合規條款">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold">
            {FOOTER_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-muted-foreground underline-offset-4 transition hover:text-brand-ink hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <button type="button" onClick={onTerms} className="font-bold text-brand-ink underline-offset-4 transition hover:underline">
                服務條款與隱私政策
              </button>
            </li>
          </ul>
        </nav>
      </div>
      <p className="border-t border-border/60 px-4 py-3 text-center text-xs text-muted-foreground">© 2026 買個 Pay 服・本站為原型展示，所有交易皆為模擬</p>
    </footer>
  )
}

export default function OpenMarketplace() {
  const [role, setRole] = useState<Role>('buyer')
  const [page, setPage] = useState<'market' | 'rewards'>('market')
  const [account, setAccount] = useState<{ name: string } | null>(null)
  const [sellers, setSellers] = useState<Seller[]>(SEED_SELLERS)
  const [products, setProducts] = useState<Product[]>(SEED_PRODUCTS)
  const [orders, setOrders] = useState<Order[]>(SEED_ORDERS)
  const [payments, setPayments] = useState<Payment[]>(SEED_PAYMENTS)
  const [reports, setReports] = useState<Report[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [mySellerId, setMySellerId] = useState('s1')
  const [followed, setFollowed] = useState<string[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [followPrefs, setFollowPrefs] = useState<Record<string, FollowPrefs>>({})
  const [buyerProfile, setBuyerProfile] = useState<{ tone: number; avatar?: string; nameChangedAt?: string }>({ tone: 0 })
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [welcomeOpen, setWelcomeOpen] = useState(true)
  const [termsOpen, setTermsOpen] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [tourRole, setTourRole] = useState<'buyer' | 'seller' | null>(null)
  const [toursSeen, setToursSeen] = useState<string[]>([])

  const [productId, setProductId] = useState<string | null>(null)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [chatId, setChatId] = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authInitialTab, setAuthInitialTab] = useState<'buyer' | 'seller'>('buyer')
  const [gateOpen, setGateOpen] = useState(false)
  const [sellerAccess, setSellerAccess] = useState(false)
  useEffect(() => {
    if (!authOpen) setAuthInitialTab('buyer')
  }, [authOpen])
  const [adminAuthed, setAdminAuthed] = useState(false)
  const [adminLoginOpen, setAdminLoginOpen] = useState(false)
  const [adminFailed, setAdminFailed] = useState(0)
  const [cartOpen, setCartOpen] = useState(false)
  const [centerOpen, setCenterOpen] = useState(false)
  const [smsPrefs, setSmsPrefs] = useState<Record<string, SmsPrefs>>({})
  const [smsLog, setSmsLog] = useState<SmsMessage[]>([])
  const [notices, setNotices] = useState<SellerNotice[]>([])
  const [appeals, setAppeals] = useState<Appeal[]>([])
  const [coupons, setCoupons] = useState<Coupon[]>(SEED_COUPONS)
  const [points, setPoints] = useState(120)
  const [ledger, setLedger] = useState<LedgerEntry[]>(SEED_LEDGER)
  const [checkedDays, setCheckedDays] = useState(2)
  const [checkedToday, setCheckedToday] = useState(false)
  const [wallet, setWallet] = useState<WalletEntry[]>(SEED_WALLET)
  const ownedCodes = useMemo(() => wallet.map((w) => w.code), [wallet])
  const usableCodes = useMemo(() => wallet.filter((w) => walletStatus(w) === 'unused').map((w) => w.code), [wallet])
  const [scamReports, setScamReports] = useState<ScamReport[]>([])
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([])
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [otpFor, setOtpFor] = useState<string | null>(null)
  const [redeemedCoupon, setRedeemedCoupon] = useState<Coupon | null>(null)
  const [takedownOpen, setTakedownOpen] = useState(false)
  const [exportLog, setExportLog] = useState<ExportLog[]>([])
  const [payResult, setPayResult] = useState<PayResult | null>(null)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategorySel>(NO_CATEGORY)
  const [sort, setSort] = useState<'new' | 'hot' | 'low' | 'high'>('hot')

  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notify = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const sellerById = useMemo(() => new Map(sellers.map((s) => [s.id, s])), [sellers])
  const checkinSellerIds = useMemo(
    () => new Set(coupons.filter((c) => c.listed && c.active).map((c) => c.sellerId)),
    [coupons],
  )
  const mySeller = sellerById.get(mySellerId) ?? sellers[0]

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = products.filter(
      (p) =>
        p.active &&
        !p.flagged &&
        !p.reviewHold &&
        sellerById.get(p.sellerId)?.verify === 'approved' &&
        !isOffline(sellerById.get(p.sellerId) as Seller) &&
        matchCategory(p, category) &&
        (!q || p.name.toLowerCase().includes(q) || (sellerById.get(p.sellerId)?.name ?? '').toLowerCase().includes(q)),
    )
    if (sort === 'hot') list.sort((a, b) => b.sold - a.sold)
    if (sort === 'low') list.sort((a, b) => a.price - b.price)
    if (sort === 'high') list.sort((a, b) => b.price - a.price)
    return list
  }, [products, sellerById, query, category, sort])

  const cartCount = cart.reduce((s, l) => s + l.qty, 0)
  const approvedCount = sellers.filter((s) => s.verify === 'approved' && !isOffline(s)).length

  /* 角色與帳號 */
  const switchRole = (r: Role, force = false) => {
    if (r === 'seller' && role !== 'seller' && !sellerAccess && !force) {
      setGateOpen(true)
      return
    }
    if (r === 'admin' && !adminAuthed) {
      setAdminLoginOpen(true)
      return
    }
    if (r !== 'admin') setAdminAuthed(false)
    if (r === 'seller' && mySeller?.suspended) {
      notify('此賣家帳號已被平台永久封鎖，禁止登入')
      return
    }
    setRole(r)
    setPage('market')
    if (!account) setAccount({ name: r === 'buyer' ? '測試買家' : r === 'seller' ? '測試賣家' : '平台管理員' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const logoClicks = useRef({ count: 0, last: 0 })
  const handleLogoClick = () => {
    const now = Date.now()
    const state = logoClicks.current
    state.count = now - state.last > 1500 ? 1 : state.count + 1
    state.last = now
    if (state.count >= 5) {
      state.count = 0
      if (!adminAuthed) setAdminLoginOpen(true)
      return
    }
    if (role === 'buyer') {
      setPage('market')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    switchRole('buyer')
  }

  /* 購物車 */
  const addToCart = (pid: string, variant: Record<string, string>, qty: number): boolean => {
    const product = products.find((p) => p.id === pid)
    if (!product) return false
    const owner = sellerById.get(product.sellerId)
    if (product.flagged || product.reviewHold || (owner && isOffline(owner))) {
      notify(owner && isOffline(owner) ? '該店鋪正在進行系統維護或結帳升級中，暫時無法下單' : '此商品目前無法購買')
      return false
    }
    const missingGroups = product.variants.filter((g) => !variant[g.name])
    if (missingGroups.length) {
      notify(pickMessage(missingGroups.map((g) => g.name)))
      return false
    }
    const key = `${pid}|${JSON.stringify(variant)}`
    const existing = cart.find((l) => l.key === key)?.qty ?? 0
    const inCartSameProduct = isCombo(product) ? 0 : cart.filter((l) => l.productId === pid && l.key !== key).reduce((s, l) => s + l.qty, 0)
    const limit = stockFor(product, variant)
    if (limit === 0) {
      notify(`「${product.name}」此規格已缺貨`)
      return false
    }
    if (existing + qty + inCartSameProduct > limit) {
      notify(`庫存不足，「${product.name}」最多可購買 ${limit} 件`)
      return false
    }
    setCart((c) => (existing ? c.map((l) => (l.key === key ? { ...l, qty: l.qty + qty } : l)) : [...c, { key, productId: pid, variant, qty }]))
    return true
  }
  const changeQty = (key: string, delta: number) =>
    setCart((c) => c.flatMap((l) => (l.key === key ? (l.qty + delta <= 0 ? [] : [{ ...l, qty: l.qty + delta }]) : [l])))
  const removeLine = (key: string) => setCart((c) => c.filter((l) => l.key !== key))

  const toggleFav = (id: string) => {
    if (!account) {
      notify('請先登入或註冊買家帳號')
      setAuthOpen(true)
      return
    }
    const has = favorites.includes(id)
    setFavorites((f) => (has ? f.filter((x) => x !== id) : [...f, id]))
    notify(has ? '已取消收藏' : '已加入收藏')
  }
  const renameBuyer = (next: string) => {
    const prev = account?.name
    if (!prev) return
    setAccount({ name: next })
    setOrders((l) => l.map((o) => (o.owner === prev ? { ...o, owner: next, buyer: next } : o)))
    setBuyerProfile((p) => ({ ...p, nameChangedAt: new Date().toISOString() }))
    notify('名稱已更新，90 天內無法再次修改')
  }
  const stampNow = () => {
    const d = new Date()
    return `${todayStr().replace(/-/g, '/')} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const submitTicket = (who: 'buyer' | 'seller', t: { category: string; subject: string; body: string }) => {
    const tk: SupportTicket = {
      id: `T${Date.now()}`,
      role: who,
      author: who === 'seller' ? (mySeller?.name ?? '賣家') : (account?.name ?? '買家'),
      ...t,
      at: stampNow(),
      status: 'open',
    }
    setTickets((l) => [tk, ...l])
    notify('已送出，客服回覆時會通知您')
  }
  const readTicket = (id: string) => setTickets((l) => l.map((t) => (t.id === id ? { ...t, unread: false } : t)))
  const replyTicket = (id: string, text: string) => {
    setTickets((l) => l.map((t) => (t.id === id ? { ...t, status: 'replied', reply: text, repliedAt: stampNow(), unread: true } : t)))
    notify('已回覆，使用者會收到通知')
  }
  const setCancelAtPeriodEnd = (id: string, cancel: boolean) => {
    setSellers((l) => l.map((x) => (x.id === id ? { ...x, plan: { ...x.plan, cancelAtPeriodEnd: cancel } } : x)))
    notify(cancel ? '已取消續約，權限保留至本期結束' : '已恢復訂閱，下期照常扣款')
  }

  useEffect(() => {
    if (welcomeOpen || !account || (role !== 'buyer' && role !== 'seller')) return
    if (!toursSeen.includes(role)) setTourRole(role)
  }, [welcomeOpen, account, role, toursSeen])

  const prefsOf = (sid: string): SmsPrefs => smsPrefs[sid] ?? { onOrder: true, onPaid: true }
  const sendSms = (sellerId: string, kind: 'order' | 'paid' | 'report', text: string): boolean => {
    if (kind !== 'report' && !prefsOf(sellerId)[kind === 'order' ? 'onOrder' : 'onPaid']) return false
    const d = new Date()
    const at = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setSmsLog((l) => [{ id, sellerId, kind, text, at }, ...l].slice(0, 30))
    return true
  }

  const checkout = (p: CheckoutPayload): Order[] => {
    const groups = new Map<string, CartLine[]>()
    cart.forEach((l) => {
      const prod = products.find((x) => x.id === l.productId)
      if (!prod) return
      if (p.sellerIds && !p.sellerIds.includes(prod.sellerId)) return
      groups.set(prod.sellerId, [...(groups.get(prod.sellerId) ?? []), l])
    })
    const stamp = `${todayStr().replace(/-/g, '')}${String(Date.now()).slice(-4)}`
    const created: Order[] = []
    let n = 1
    let smsSent = 0
    let usedCouponId: string | null = null
    let usedOrderId = ''
    const orderedKeys = new Set<string>()
    groups.forEach((lines, sid) => {
      const owner = sellerById.get(sid)
      if (!owner || isOffline(owner)) return
      const items: OrderItem[] = lines.map((l) => {
        const prod = products.find((x) => x.id === l.productId) as Product
        return { productId: prod.id, name: prod.name, variant: Object.values(l.variant).join(' / '), qty: l.qty, price: unitPrice(prod, l.variant) }
      })
      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0)
      const shipping = shipFee(p.ship, subtotal)
      const cp = p.coupon ? coupons.find((x) => x.id === p.coupon?.id) : undefined
      const couponOk = !!cp && cp.sellerId === sid && cp.active && subtotal >= cp.minSpend && (!cp.listed || usableCodes.includes(cp.code))
      const discount = couponOk && cp ? Math.min(cp.amount, subtotal) : 0
      if (couponOk && cp) {
        usedCouponId = cp.id
        usedOrderId = `OD${stamp}${n}`
      }
      lines.forEach((l) => orderedKeys.add(l.key))
      const order: Order = {
        id: `OD${stamp}${n++}`,
        sellerId: sid,
        owner: account?.name ?? p.buyer,
        buyer: p.buyer,
        items,
        subtotal,
        shipping,
        discount: discount || undefined,
        couponCode: discount && cp ? cp.code : undefined,
        total: subtotal + shipping - discount,
        pay: p.pay,
        payStatus: p.pay === 'card' ? '已付款' : '待匯款',
        status: '待出貨',
        date: todayStr(),
        shipMethod: p.ship,
        shipTo: p.shipTo,
        live: true,
      }
      created.push(order)
      const payNote = p.pay === 'card' ? '信用卡已付款' : '待 ATM 匯款'
      if (sendSms(sid, 'order', `【買個 Pay 服】新訂單 ${order.id}，買家 ${maskName(p.buyer)}，金額 ${money(order.total)}（${payNote}），請盡快處理。`)) smsSent++
    })
    setOrders((o) => [...created, ...o])
    setProducts((prev) =>
      prev.map((pr) => {
        const qty = cart.filter((l) => orderedKeys.has(l.key) && l.productId === pr.id).reduce((s, l) => s + l.qty, 0)
        if (!qty) return pr
        const comboStock = pr.comboStock ? { ...pr.comboStock } : undefined
        if (comboStock) {
          cart
            .filter((l) => orderedKeys.has(l.key) && l.productId === pr.id)
            .forEach((l) => {
              const k = comboKey(pr, l.variant)
              if (comboStock[k] !== undefined) comboStock[k] = Math.max(0, comboStock[k] - l.qty)
            })
        }
        const optionStock = pr.optionStock ? { ...pr.optionStock } : undefined
        if (optionStock) {
          cart
            .filter((l) => orderedKeys.has(l.key) && l.productId === pr.id)
            .forEach((l) =>
              Object.entries(l.variant).forEach(([g, o]) => {
                const k = optKey(g, o)
                if (optionStock[k] !== undefined) optionStock[k] = Math.max(0, optionStock[k] - l.qty)
              }),
            )
        }
        return { ...pr, stock: Math.max(0, pr.stock - qty), sold: pr.sold + qty, optionStock, comboStock }
      }),
    )
    if (usedCouponId) {
      const usedId = usedCouponId
      setCoupons((l) => l.map((c) => (c.id === usedId ? { ...c, usedOrders: c.usedOrders + 1 } : c)))
      const orderRef = usedOrderId
      const usedAt = new Date().toISOString().slice(0, 10)
      setWallet((w) => {
        let marked = false
        return w.map((e) => {
          if (!marked && e.couponId === usedId && walletStatus(e) === 'unused') {
            marked = true
            return { ...e, usedAt, orderId: orderRef }
          }
          return e
        })
      })
    }
    setCart((c) => c.filter((l) => !orderedKeys.has(l.key)))
    notify(`已成立 ${created.length} 筆訂單${smsSent ? `，並已簡訊通知 ${smsSent} 位賣家` : ''}`)
    return created
  }

  /* 認證 / 註冊 */
  const registerBuyer = (name: string) => {
    setAccount({ name })
    setRole('buyer')
    setAuthOpen(false)
    notify(`歡迎加入買個 Pay 服，${name}！`)
  }
  const login = (name: string) => {
    if (sellers.some((s) => s.suspended && (s.owner === name || s.name === name))) {
      notify('此帳號已被平台永久封鎖，禁止登入')
      return
    }
    if (sellers.some((s) => s.owner === name || s.name === name)) setSellerAccess(true)
    setAccount({ name })
    setAuthOpen(false)
    notify(`歡迎回來，${name}`)
  }
  const registerSeller = (d: SellerRegisterData) => {
    if (blacklist.some((b) => b.idNo === d.idNo)) {
      notify('此身分證 / 統編已列入全站黑名單，無法註冊賣場')
      return
    }
    const id = `s${Date.now()}`
    const colors = ['bg-primary text-primary-foreground', 'bg-foreground text-card', 'bg-emerald-700 text-card', 'bg-amber-600 text-card']
    const next: Seller = {
      id,
      name: d.storeName,
      owner: d.owner,
      idNo: d.idNo,
      docName: d.docName,
      docUrl: d.docUrl,
      verify: 'pending',
      appliedAt: todayStr(),
      rating: 0,
      followers: 0,
      tagline: '新開幕的小店，歡迎多多支持！',
      city: '台灣',
      logoClass: colors[sellers.length % colors.length],
      bannerClass: 'from-orange-300 via-amber-200 to-orange-100',
      gmvBase: 0,
      founderNo:
        sellers.filter((x) => x.founderNo).length < FOUNDER_LIMIT
          ? Math.max(0, ...sellers.map((x) => x.founderNo ?? 0)) + 1
          : undefined,
      plan: { status: 'trial', periodStart: todayStr(), nextDate: addMonth(todayStr()), method: 'card', autoPay: false, trialLeft: 30 },
    }
    setSellers((s) => [...s, next])
    setMySellerId(id)
    setAccount({ name: d.owner })
    setRole('seller')
    setSellerAccess(true)
    setAuthOpen(false)
    notify('實名資料已送出，狀態：待平台審核')
  }

  /* 賣家後台動作 */
  const saveProduct = (p: Product) => {
    setProducts((list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [p, ...list]))
    notify(p.reviewHold ? `商品價格超過 ${money(REVIEW_PRICE_LIMIT)}，已送出審核，核准後才會公開` : '商品已儲存')
  }
  const importProducts = (ps: Product[]) => {
    setProducts((list) => [...ps, ...list])
    notify(`一鍵搬家完成，已匯入 ${ps.length} 件商品`)
  }
  const toggleProduct = (id: string) => {
    if (products.find((p) => p.id === id)?.flagged) {
      notify('此商品因被檢舉已鎖定，需待平台審核完成')
      return
    }
    setProducts((l) => l.map((p) => (p.id === id ? { ...p, active: !p.active } : p)))
  }
  const approveProductReview = (id: string, ok: boolean) => {
    setProducts((l) => l.map((p) => (p.id === id ? (ok ? { ...p, reviewHold: false, reviewApproved: true } : { ...p, reviewHold: true, active: false }) : p)))
    notify(ok ? '商品已核准並公開上架' : '商品審核未通過，已退回賣家')
  }
  const deleteProduct = (id: string) => {
    setProducts((l) => l.filter((p) => p.id !== id))
    setCart((c) => c.filter((l) => l.productId !== id))
    notify('商品已刪除')
  }
  const shipOrder = (id: string) => {
    setOrders((l) => l.map((o) => (o.id === id ? { ...o, status: '已出貨', stage: 0, tracking: `TW${String(Date.now()).slice(-10)}` } : o)))
    notify('已標記出貨')
  }

  /* 買家中心動作 */
  const myBuyerOrders = account ? orders.filter((o) => o.owner === account.name || o.owner === DEMO_OWNER) : []
  const centerBadge = myBuyerOrders.filter((o) => ['unpaid', 'shipping'].includes(buyerStage(o))).length
  const openCenter = () => {
    if (!account) {
      notify('請先登入或註冊買家帳號')
      setAuthOpen(true)
      return
    }
    setCenterOpen(true)
  }
  const advanceTrack = (id: string) =>
    setOrders((l) => l.map((o) => (o.id === id ? { ...o, stage: Math.min(LAST_STAGE, (o.stage ?? 0) + 1) } : o)))
  const receiveOrder = (id: string) => {
    setOrders((l) => l.map((o) => (o.id === id ? { ...o, status: '已完成', stage: LAST_STAGE } : o)))
    notify('已確認收貨，快去評價商品吧')
  }
  const submitRemit = (id: string, last5: string, fileName?: string) => {
    const d = new Date()
    const remit: RemitProof = {
      last5,
      fileName,
      at: `${todayStr()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      ref: `EV${Date.now().toString(36).toUpperCase()}`,
    }
    setOrders((l) => l.map((x) => (x.id === id ? { ...x, remit } : x)))
    notify('已建立數位交易存證')
  }
  const reportScam = (id: string, reason: string) => {
    const o = orders.find((x) => x.id === id)
    if (!o) return
    const d = new Date()
    setScamReports((l) => [
      { id: `SR${Date.now()}`, orderId: id, sellerId: o.sellerId, buyer: account?.name ?? o.buyer, at: `${todayStr()} ${pad(d.getHours())}:${pad(d.getMinutes())}`, reason },
      ...l,
    ])
    notify('已送出檢舉，平台風控將優先審核')
  }
  const buyerPaid = (id: string) => {
    const o = orders.find((x) => x.id === id)
    setOrders((l) => l.map((x) => (x.id === id ? { ...x, payStatus: '已付款' } : x)))
    if (!o) return
    const sent = sendSms(o.sellerId, 'paid', `【買個 Pay 服】訂單 ${o.id} 買家已完成 ATM 匯款 ${money(o.total)}，系統已入帳，請盡快出貨。`)
    notify(sent ? '已完成匯款，並簡訊通知賣家' : '已完成匯款')
  }
  const reviewOrder = (id: string, inputs: ReviewInput[]) => {
    const o = orders.find((x) => x.id === id)
    if (!o) return
    const user = maskName(account?.name ?? o.buyer)
    setProducts((prev) =>
      prev.map((p) => {
        const added: Review[] = []
        o.items.forEach((it, i) => {
          const match = it.productId ? it.productId === p.id : p.sellerId === o.sellerId && p.name === it.name
          if (match) added.push({ owner: account?.name, user, rating: inputs[i].rating, text: inputs[i].text.trim() || '買家未留下文字心得', date: todayStr() })
        })
        return added.length ? { ...p, reviews: [...added, ...p.reviews] } : p
      }),
    )
    setOrders((l) => l.map((x) => (x.id === id ? { ...x, reviewed: true } : x)))
    notify('感謝您的評價，已顯示在商品頁面')
  }
  const confirmPaid = (id: string) => {
    setOrders((l) => l.map((o) => (o.id === id ? { ...o, payStatus: '已付款' } : o)))
    notify('已確認收款')
  }
  const payRenewal = (method: PayMethod, info: { last4?: string; invoice?: InvoiceOpt }) => {
    const s = mySeller
    const wasClosed = isClosed(s)
    const wasTrial = s.plan.status === 'trial'
    const stamp = todayStr()
    const invoiceNo = `QJ${stamp.replace(/-/g, '')}${s.id.replace(/\D/g, '').slice(-3)}`
    const inv: InvoiceOpt = info.invoice ?? { type: 'personal', carrier: '', email: '', taxId: '', title: '' }
    const record: Payment = {
      id: `${s.id}-${Date.now()}`,
      sellerId: s.id,
      date: stamp,
      amount: PLAN_PRICE,
      method,
      status: method === 'card' ? '已付款' : '核銷中',
      invoice: invoiceNo,
      invoiceMeta: inv.type === 'company' ? `公司戶・統編 ${inv.taxId}` : `個人・${inv.carrier || '會員載具'}`,
    }
    setPayments((l) => [record, ...l])
    setSellers((l) =>
      l.map((x) =>
        x.id === s.id
          ? {
              ...x,
              plan:
                method === 'card'
                  ? { status: 'active', periodStart: x.plan.nextDate, nextDate: addMonth(x.plan.nextDate), method: 'card', cardLast4: info.last4, autoPay: true }
                  : { ...x.plan, status: 'verifying', method: 'atm', autoPay: false, trialLeft: undefined },
            }
          : x,
      ),
    )
    if (method === 'card') {
      setPayResult({ amount: PLAN_PRICE, invoiceNo, invoice: inv, wasClosed, wasTrial, method })
    }
    notify(
      method === 'card'
        ? wasClosed
          ? '續費成功，賣場已重新開張，商品已自動重新上架'
          : wasTrial
            ? '已綁定信用卡，試用期結束後將自動續訂'
            : '付款成功，已啟用定期自動扣款'
        : '核銷資料已送出，等待平台對帳',
    )
  }
  const advanceTrialDay = (id: string) => {
    const s = sellerById.get(id)
    if (!s || s.plan.status !== 'trial') return
    const left = (s.plan.trialLeft ?? 0) - 1
    if (left <= 0) {
      setSellers((l) => l.map((x) => (x.id === id ? { ...x, plan: { ...x.plan, status: 'suspended', trialLeft: 0 } } : x)))
      notify(`30 天免費試用已結束且未綁定付款，「${s.name}」已自動暫停營業`)
      return
    }
    setSellers((l) => l.map((x) => (x.id === id ? { ...x, plan: { ...x.plan, trialLeft: left } } : x)))
    notify(`模擬經過 1 天，免費試用剩餘 ${left} 天`)
  }
  const expireTrial = (id: string) => {
    const s = sellerById.get(id)
    if (!s) return
    setSellers((l) => l.map((x) => (x.id === id ? { ...x, plan: { ...x.plan, status: 'suspended', trialLeft: 0 } } : x)))
    notify(`「${s.name}」試用到期未續費，賣場已暫停營業，商品已隱藏`)
  }
  const saveBusiness = (b: BusinessInfo) => {
    setSellers((l) => l.map((s) => (s.id === mySellerId ? { ...s, business: b } : s)))
    notify('營業資訊已儲存，將顯示於店鋪頁面')
  }
  const savePayment = (pay: PaymentSettings) => {
    setSellers((l) => l.map((s) => (s.id === mySellerId ? { ...s, payment: pay } : s)))
    notify('收款設定已儲存')
  }
  const saveKyc = (k: KycInfo) => {
    setSellers((l) => l.map((s) => (s.id === mySellerId ? { ...s, kyc: k } : s)))
    notify('實名認證資料已更新')
  }
  const logExport = (kind: ExportLog['kind'], rows: number) => {
    const d = new Date()
    setExportLog((l) => [{ id: `E${Date.now()}`, sellerId: mySellerId, kind, rows, at: `${todayStr()} ${pad(d.getHours())}:${pad(d.getMinutes())}` }, ...l].slice(0, 20))
  }

  /* 簽到點數與優惠券 */
  const requireAccount = (msg: string): boolean => {
    if (account) return true
    notify(msg)
    setAuthOpen(true)
    return false
  }
  const doCheckIn = () => {
    if (!requireAccount('請先登入買家帳號才能簽到')) return
    if (checkedToday) {
      notify('今天已經簽到過了，明天再來')
      return
    }
    if (checkedDays >= CHECKIN_REWARDS.length) return
    const reward = CHECKIN_REWARDS[checkedDays]
    setPoints((p) => p + reward)
    setLedger((l) => [{ id: `L${Date.now()}`, delta: reward, label: `每日簽到（第 ${checkedDays + 1} 天）`, at: todayStr() }, ...l])
    setCheckedDays((d) => d + 1)
    setCheckedToday(true)
    notify(`簽到成功，獲得 ${reward} 點`)
  }
  const nextCheckinDay = () => {
    setCheckedToday(false)
    if (checkedDays >= CHECKIN_REWARDS.length) setCheckedDays(0)
    notify('已模擬進入隔天，可再次簽到')
  }
  const finishRedeem = (c: Coupon) => {
    const owner = sellerById.get(c.sellerId)?.name ?? ''
    setPoints((p) => p - c.cost)
    setLedger((l) => [{ id: `L${Date.now()}`, delta: -c.cost, label: `兌換「${owner}」折價券 ${c.code}`, at: todayStr() }, ...l])
    setCoupons((l) => l.map((x) => (x.id === c.id ? { ...x, redeemed: x.redeemed + 1 } : x)))
    const today = new Date().toISOString().slice(0, 10)
    setWallet((w) => [
      { id: `w${Date.now()}`, couponId: c.id, code: c.code, sellerId: c.sellerId, amount: c.amount, minSpend: c.minSpend, claimedAt: today, expiresAt: addDays(today, WALLET_VALID_DAYS) },
      ...w,
    ])
    setOtpFor(null)
    setRedeemedCoupon(c)
  }
  const redeemCoupon = (id: string) => {
    if (!requireAccount('請先登入買家帳號才能兌換優惠券')) return
    const c = coupons.find((x) => x.id === id)
    if (!c) return
    if (couponRemain(c) <= 0) {
      notify('此優惠券已被兌換完畢')
      return
    }
    if (ownedCodes.includes(c.code)) {
      notify('您已兌換過此優惠券')
      return
    }
    if (points < c.cost) {
      notify(`點數不足，還差 ${c.cost - points} 點`)
      return
    }
    if (!phoneVerified) {
      setOtpFor(id)
      return
    }
    finishRedeem(c)
  }
  const verifyPhoneAndRedeem = () => {
    const c = coupons.find((x) => x.id === otpFor)
    setPhoneVerified(true)
    if (c) finishRedeem(c)
  }
  const createCoupon = (d: { code: string; amount: number; minSpend: number; qty: number; cost: number; listed: boolean }): string | null => {
    const code = d.code.toUpperCase()
    if (coupons.some((c) => c.code === code)) return '此折扣碼已被使用，請換一組'
    const listedCount = coupons.filter((c) => c.sellerId === mySellerId && c.listed && c.active).length
    if (d.listed && listedCount >= MAX_LISTED_COUPONS) return `每家店最多同時上架 ${MAX_LISTED_COUPONS} 張到簽到專區`
    setCoupons((l) => [{ id: `c${Date.now()}`, sellerId: mySellerId, ...d, code, redeemed: 0, usedOrders: 0, active: true }, ...l])
    notify(d.listed ? '優惠券已建立，並同步上架到簽到專區' : '優惠券已建立（僅限店內折扣碼）')
    return null
  }
  const toggleCouponListed = (id: string) => {
    const c = coupons.find((x) => x.id === id)
    if (!c) return
    if (!c.listed && coupons.filter((x) => x.sellerId === c.sellerId && x.listed && x.active).length >= MAX_LISTED_COUPONS) {
      notify(`每家店最多同時上架 ${MAX_LISTED_COUPONS} 張到簽到專區`)
      return
    }
    setCoupons((l) => l.map((x) => (x.id === id ? { ...x, listed: !x.listed } : x)))
    notify(c.listed ? '已從簽到專區下架' : '已上架到簽到專區')
  }
  const deleteCoupon = (id: string) => {
    setCoupons((l) => l.filter((c) => c.id !== id))
    notify('優惠券已刪除')
  }
  const moveSellerToFollow = (sid: string) => {
    setFollowed((f) => (f.includes(sid) ? f : [...f, sid]))
    setCart((c) => c.filter((l) => products.find((p) => p.id === l.productId)?.sellerId !== sid))
    notify('已將店家加入追蹤，營業恢復時可再回來選購')
  }
  const findSimilar = (pid: string) => {
    const p = products.find((x) => x.id === pid)
    setCartOpen(false)
    setQuery('')
    if (p) setCategory(categoryOfProduct(p))
    notify('已為您列出同類商品')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const setShopClosed = (id: string, closed: boolean) => {
    setSellers((l) =>
      l.map((s) =>
        s.id !== id
          ? s
          : {
              ...s,
              plan: closed
                ? { ...s.plan, status: 'overdue', periodStart: DEMO_EXPIRED.start, nextDate: DEMO_EXPIRED.end }
                : { ...s.plan, status: 'active', periodStart: DEMO_ACTIVE.start, nextDate: DEMO_ACTIVE.end },
            },
      ),
    )
    const name = sellerById.get(id)?.name ?? ''
    notify(closed ? `「${name}」已切換為逾期未繳費，賣場關閉、商品已下架隱藏` : `「${name}」已恢復正常營運，商品重新上架`)
  }
  const simulatePayFail = (id: string) => {
    setSellers((l) =>
      l.map((s) =>
        s.id === id
          ? { ...s, plan: { ...s.plan, status: 'grace', method: 'card', failedAt: todayStr(), graceElapsed: 0 } }
          : s,
      ),
    )
    notify(`本月月費 ${money(PLAN_PRICE)} 扣款失敗，已進入 ${GRACE_DAYS} 天補繳緩衝期`)
  }
  const advanceGraceDay = (id: string) => {
    const s = sellerById.get(id)
    if (!s || s.plan.status !== 'grace') return
    const elapsed = (s.plan.graceElapsed ?? 0) + 1
    if (elapsed >= GRACE_DAYS) {
      setSellers((l) => l.map((x) => (x.id === id ? { ...x, plan: { ...x.plan, status: 'suspended', graceElapsed: GRACE_DAYS } } : x)))
      notify(`緩衝期已滿 ${GRACE_DAYS} 天仍未補繳，「${s.name}」已自動暫停營業`)
      return
    }
    setSellers((l) => l.map((x) => (x.id === id ? { ...x, plan: { ...x.plan, graceElapsed: elapsed } } : x)))
    notify(`模擬經過 1 天，補繳緩衝期剩餘 ${GRACE_DAYS - elapsed} 天`)
  }
  const requestRefund = (id: string, r: { type: RefundType; reason: string; note: string }) => {
    const o = orders.find((x) => x.id === id)
    setOrders((l) => l.map((x) => (x.id === id ? { ...x, refund: { ...r, at: todayStr(), status: 'pending' } } : x)))
    if (o) {
      sendSms(o.sellerId, 'report', `【買個 Pay 服】訂單 ${o.id} 買家提出${r.type === 'return' ? '退貨退款' : '退款'}申請（${r.reason}），請至後台處理。`)
    }
    notify('已送出申請，賣家將直接與您聯繫處理')
  }
  const decideRefund = (id: string, accept: boolean) => {
    setOrders((l) => l.map((x) => (x.id === id && x.refund ? { ...x, refund: { ...x.refund, status: accept ? 'accepted' : 'rejected' } } : x)))
    notify(accept ? '已同意買家申請，請與買家確認退款方式' : '已拒絕買家申請')
  }
  const resubmit = () => {
    setSellers((l) => l.map((s) => (s.id === mySellerId ? { ...s, verify: 'pending', rejectReason: undefined } : s)))
    notify('已重新送審')
  }

  /* 管理員動作 */
  const approveSeller = (id: string) => {
    setSellers((l) => l.map((s) => (s.id === id ? { ...s, verify: 'approved', rejectReason: undefined } : s)))
    notify('已批准實名認證，賣家商品已上架至前台')
  }
  const rejectSeller = (id: string, reason: string) => {
    setSellers((l) => l.map((s) => (s.id === id ? { ...s, verify: 'rejected', rejectReason: reason } : s)))
    notify('已退回申請')
  }
  const confirmVerify = (id: string) => {
    setSellers((l) => l.map((s) => (s.id === id ? { ...s, plan: { ...s.plan, status: 'active', periodStart: s.plan.nextDate, nextDate: addMonth(s.plan.nextDate) } } : s)))
    setPayments((l) => {
      const idx = l.findIndex((p) => p.sellerId === id && p.status === '核銷中')
      return idx < 0 ? l : l.map((p, i) => (i === idx ? { ...p, status: '已付款' } : p))
    })
    notify('已撤銷，店家恢復正常營運')
  }
  const remind = (id: string) => notify(`已向「${sellerById.get(id)?.name}」發送催繳通知`)

  /* 風控：檢舉與停權 */
  const pushNotice = (sellerId: string, kind: SellerNotice['kind'], productName: string, title: string, text: string, sms: string, productId?: string) => {
    const d = new Date()
    const id = `N${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const at = `${todayStr()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    setNotices((l) => [{ id, sellerId, kind, productId, productName, title, text, at, read: false }, ...l])
    sendSms(sellerId, 'report', `【買個 Pay 服】${sms}`)
  }
  const reportsLeft = account
    ? Math.max(0, REPORT_LIMIT - reports.filter((r) => r.reporterAccount === account.name && Date.now() - (r.ts ?? 0) < REPORT_WINDOW_MS).length)
    : 0
  const viewer: Viewer | null = account ? { name: account.name, tone: buyerProfile.tone, avatar: buyerProfile.avatar } : null
  const needLoginForReport = () => {
    notify('請先登入會員後再檢舉（不需實名認證）')
    setAuthOpen(true)
  }
  const uploadAvatar = (dataUrl: string) => {
    setBuyerProfile((p) => ({ ...p, avatar: dataUrl }))
    if (mySeller) setSellers((l) => l.map((x) => (x.id === mySeller.id ? { ...x, logo: dataUrl } : x)))
    notify('大頭貼已更新')
  }
  const removeAvatar = () => {
    setBuyerProfile((p) => ({ ...p, avatar: undefined }))
    if (mySeller) setSellers((l) => l.map((x) => (x.id === mySeller.id ? { ...x, logo: undefined } : x)))
    notify('已移除大頭貼')
  }
  const canReport = (extra?: { reporterType?: 'buyer' | 'brand' }) => {
    if (extra?.reporterType === 'brand') return true
    if (!account) {
      needLoginForReport()
      return false
    }
    if (reportsLeft <= 0) {
      notify(`24 小時內最多只能檢舉 ${REPORT_LIMIT} 次，請稍後再試`)
      return false
    }
    return true
  }
  const reportProduct = (
    pid: string,
    reason: ReportReason,
    note: string,
    extra?: { reporterType?: 'buyer' | 'brand'; contact?: string; evidence?: string[] },
  ) => {
    const product = products.find((p) => p.id === pid)
    if (!product) return
    if (!canReport(extra)) return
    const reasonLabel = REPORT_REASONS.find((r) => r.id === reason)?.label ?? '其他'
    pushNotice(
      product.sellerId,
      'reported',
      product.name,
      `您的商品「${product.name}」被檢舉，已進入平台審核`,
      `檢舉原因：${reasonLabel}。商品不會被直接下架，案件已進入後台待審區，平台將人工審核；您可在下方提出申訴或回覆說明，提供出貨證明、進貨單據等佐證。檢舉人資料依法保密。`,
      `您的商品「${product.name}」遭檢舉（${reasonLabel}），進入人工審核，商品仍正常上架。如有異議可登入賣家後台申訴回覆。`,
      product.id,
    )
    const d = new Date()
    const report: Report = {
      id: `R${Date.now()}`,
      productId: pid,
      sellerId: product.sellerId,
      productName: product.name,
      productImage: product.image,
      reason,
      note,
      reporter: extra?.reporterType === 'brand' ? '品牌權利人' : maskName(account?.name ?? '匿名買家'),
      at: `${todayStr()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      status: 'open',
      reporterType: extra?.reporterType ?? 'buyer',
      contact: extra?.contact,
      targetType: 'product',
      evidence: extra?.evidence,
      reporterAccount: extra?.reporterType === 'brand' ? undefined : account?.name,
      ts: Date.now(),
    }
    setReports((l) => [report, ...l])
    notify('檢舉已送出，平台將進行人工審核')
  }
  const reportSeller = (sid: string, reason: ReportReason, note: string, evidence: string[]) => {
    const target = sellers.find((x) => x.id === sid)
    if (!target || !canReport()) return
    const reasonLabel = REPORT_REASONS.find((r) => r.id === reason)?.label ?? '其他'
    pushNotice(
      sid,
      'reported',
      target.name,
      '您的賣場被檢舉，已進入平台審核',
      `檢舉原因：${reasonLabel}。賣場不會被直接停權，案件已進入後台待審區，平台將人工審核；您可提出申訴或回覆說明。檢舉人資料依法保密。`,
      `您的賣場遭檢舉（${reasonLabel}），進入人工審核，賣場仍正常營運。如有異議可登入賣家後台申訴回覆。`,
    )
    const d = new Date()
    const report: Report = {
      id: `R${Date.now()}`,
      productId: '',
      sellerId: sid,
      productName: target.name,
      productImage: target.logo ?? '',
      reason,
      note,
      reporter: maskName(account?.name ?? '匿名買家'),
      at: `${todayStr()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      status: 'open',
      reporterType: 'buyer',
      targetType: 'seller',
      evidence,
      reporterAccount: account?.name,
      ts: Date.now(),
    }
    setReports((l) => [report, ...l])
    notify('檢舉已送出，平台將進行人工審核')
  }
  const dismissReport = (id: string) => {
    const target = reports.find((r) => r.id === id)
    if (!target) return
  if (target.targetType === 'seller') {
    setReports((l) => l.map((r) => (r.id === id ? { ...r, status: 'dismissed' } : r)))
    pushNotice(target.sellerId, 'dismissed', target.productName, '賣場檢舉已駁回', '平台審核後認定賣場無違規，您無需任何操作。', '平台審核後駁回對您賣場的檢舉。')
    notify('已駁回對賣家的檢舉')
    return
  }
    const stillOpen = reports.some((r) => r.id !== id && r.productId === target.productId && r.status === 'open')
    setReports((l) => l.map((r) => (r.id === id ? { ...r, status: 'dismissed' } : r)))
  if (!stillOpen) {
  setProducts((l) => l.map((p) => (p.id === target.productId ? { ...p, flagged: false, flagReason: undefined } : p)))
  setAppeals((l) =>
  l.map((a) =>
  a.kind === 'product' && a.productId === target.productId && a.status === 'pending'
  ? { ...a, status: 'approved', reply: '檢舉經審核已駁回，商品已恢復上架，無需再處理此申訴。' }
  : a,
  ),
  )
      pushNotice(
        target.sellerId,
        'dismissed',
        target.productName,
        `檢舉已駁回，「${target.productName}」恢復上架`,
        '平台審核後認定商品無違規，已自動恢復上架，您無需任何操作。',
        `平台審核後駁回對「${target.productName}」的檢舉，商品已恢復上架。`,
      )
    }
    notify(stillOpen ? '已駁回此檢舉，仍有其他待審檢舉' : '已駁回檢舉，商品恢復上架')
  }
  const confirmReport = (id: string) => {
    const target = reports.find((r) => r.id === id)
    if (!target) return
  if (target.targetType === 'seller') {
    setReports((l) => l.map((r) => (r.id === id ? { ...r, status: 'confirmed' } : r)))
    pushNotice(target.sellerId, 'confirmed', target.productName, '賣場經審核確認違規', '平台審核後確認您的賣場存在違規情事，請立即改善；累計違規可能導致賣場被永久封鎖。', '您的賣場經平台審核確認違規，請儘速改善。')
    notify('已確認賣家違規並通知賣家')
    return
  }
    setReports((l) => l.map((r) => (r.productId === target.productId && r.status === 'open' ? { ...r, status: 'confirmed' } : r)))
    setProducts((l) => l.map((p) => (p.id === target.productId ? { ...p, flagged: true, active: false } : p)))
    pushNotice(
      target.sellerId,
      'confirmed',
      target.productName,
      `「${target.productName}」經審核確認違規，已永久下架`,
      '平台審核後確認該商品違反平台規範，已永久下架且無法再上架。累計違規可能導致賣場被永久封鎖，並配合檢警調閱實名資料。',
      `您的商品「${target.productName}」經平台審核確認違規，已永久下架。累計違規將可能封鎖賣場。`,
      target.productId,
    )
    notify('已確認違規，商品永久下架，並已通知賣家')
  }
  const suspendSeller = (id: string, reason: string) => {
    const target = sellers.find((x) => x.id === id)
    if (target) {
      setBlacklist((l) =>
        l.some((b) => b.sellerId === id)
          ? l
          : [
              {
                id: `BL${Date.now()}`,
                sellerId: id,
                storeName: target.name,
                idNo: target.idNo,
                bankAccount: target.payment?.bankAccount ?? '未設定',
                phone: target.kyc?.phone || '未綁定',
                at: todayStr(),
              },
              ...l,
            ],
      )
    }
    setSellers((l) => l.map((s) => (s.id === id ? { ...s, suspended: true, banned: true, suspendReason: reason } : s)))
    setReports((l) => l.map((r) => (r.sellerId === id && r.status === 'open' ? { ...r, status: 'confirmed' } : r)))
    setCart((c) => c.filter((line) => products.find((p) => p.id === line.productId)?.sellerId !== id))
    setStoreId((cur) => (cur === id ? null : cur))
    setProductId((cur) => (products.find((p) => p.id === cur)?.sellerId === id ? null : cur))
    notify(`「${sellerById.get(id)?.name}」已被永久封鎖，商品全數隱藏`)
  }

  const submitAppeal = (a: { sellerId: string; kind: 'product' | 'ban' | 'seller'; productId?: string; productName: string; text: string }) => {
    const d = new Date()
    const appeal: Appeal = {
      ...a,
      id: `A${Date.now()}`,
      at: `${todayStr()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      status: 'pending',
    }
    setAppeals((l) => [appeal, ...l])
    notify('申訴已送出，平台將於審核後回覆')
  }
  const resolveAppeal = (id: string, approve: boolean, reply: string) => {
    const a = appeals.find((x) => x.id === id)
    if (!a || a.status !== 'pending') return
    setAppeals((l) => l.map((x) => (x.id === id ? { ...x, status: approve ? 'approved' : 'rejected', reply } : x)))
  if (approve && a.kind === 'product') {
  setProducts((l) => l.map((p) => (p.id === a.productId ? { ...p, flagged: false, flagReason: undefined, active: true } : p)))
  setReports((l) => l.map((r) => (r.productId === a.productId && r.status !== 'dismissed' ? { ...r, status: 'dismissed' } : r)))
  }
    if (approve && a.kind === 'seller') {
  setReports((l) => l.map((r) => (r.sellerId === a.sellerId && r.targetType === 'seller' && r.status === 'open' ? { ...r, status: 'dismissed' } : r)))
  }
  if (approve && a.kind === 'ban') {
      setSellers((l) => l.map((s) => (s.id === a.sellerId ? { ...s, suspended: false, suspendReason: undefined } : s)))
    }
    const subject = a.kind === 'ban' ? '賣家帳號' : a.kind === 'seller' ? '被檢舉的賣場' : `商品「${a.productName}」`
    pushNotice(
      a.sellerId,
      approve ? 'appeal_approved' : 'appeal_rejected',
      a.productName,
      approve
        ? a.kind === 'seller' ? '申訴成立，對賣場的檢舉已撤銷' : a.kind === 'ban' ? '申訴成立，賣家帳號已解除封鎖' : `申訴成立，「${a.productName}」已恢復上架`
        : `申訴駁回，${subject}維持原處分`,
      `平台回覆：${reply}`,
      approve ? `您對${subject}的申訴已成立，${a.kind === 'seller' ? '對賣場的檢舉已撤銷。' : a.kind === 'ban' ? '帳號已解除封鎖。' : '商品已恢復上架。'}` : `您對${subject}的申訴經複審後駁回，維持原處分。`,
      a.productId,
    )
    notify(approve ? (a.kind === 'ban' ? '申訴成立，已解除封鎖並通知賣家' : '申訴成立，商品已恢復上架並通知賣家') : '已駁回申訴並通知賣家')
  }

  const roleToggle = (cls: string) => (
    <div className={`h-10 items-center gap-1 rounded-full border border-border/70 bg-muted/60 p-1 md:h-9 ${cls}`} role="group" aria-label="快速切換角色（測試用）">
      {(
        [
          ['buyer', '買家'],
          ['seller', '賣家'],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={role === id}
          onClick={() => switchRole(id)}
          className={`h-full flex-1 rounded-full px-3 text-xs font-bold transition ${role === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  const searchField = (
    <>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={`${inputCls} h-10 rounded-full bg-muted/60 pl-10 md:h-auto`}
        placeholder="搜尋商品或賣家"
        aria-label="搜尋商品或賣家"
      />
    </>
  )

  const openProduct = products.find((p) => p.id === productId) ?? null
  const openProductSeller = openProduct ? sellerById.get(openProduct.sellerId) : undefined
  const storeSeller = storeId ? sellerById.get(storeId) : undefined
  const chatSeller = chatId ? sellerById.get(chatId) : undefined

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-[#f8fafc] via-[#fff7ed] to-[#f1f5f9] text-foreground">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-70 [background-image:radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:22px_22px]"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 [background-image:linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.12)_1px,transparent_1px)] [background-size:88px_88px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
      />

      <header className="sticky top-0 z-30 border-b border-border/70 bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-2.5 md:gap-x-4 md:py-3">
          <button type="button" onClick={handleLogoClick} className="flex min-w-0 items-center gap-2" aria-label="買個 Pay 服首頁">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm md:size-9"><Store className="size-[18px] md:size-5" /></span>
            <span className="truncate text-base font-black tracking-tight md:text-lg">買個 Pay 服</span>
          </button>

          {role === 'buyer' && (
            <div className="relative hidden md:block md:max-w-md md:flex-1">{searchField}</div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <InstallAppButton />

            {role === 'buyer' && (
              <button type="button" onClick={() => switchRole('seller')} className={`${btnGhost} hidden py-2 md:inline-flex`}>
                <Store className="size-4" />
                我要開店
              </button>
            )}

            {roleToggle('hidden md:flex')}

            {account ? (
              <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card py-0.5 pl-0.5 pr-1 text-xs font-bold md:gap-1.5 md:py-1 md:pl-1 md:pr-2">
                <UserAvatar name={account.name} tone={buyerProfile.tone} src={buyerProfile.avatar} size="size-8 md:size-7" textSize="text-xs" />
                <span className="hidden max-w-24 truncate sm:inline">{account.name}</span>
                <button type="button" aria-label="登出" onClick={() => { setAccount(null); setAdminAuthed(false); setSellerAccess(false); setRole('buyer'); notify('已登出') }} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <LogOut className="size-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                aria-label="登入 / 註冊"
                className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-card text-foreground transition hover:bg-muted active:scale-[0.98] md:size-auto md:gap-1.5 md:px-4 md:py-1.5 md:text-sm md:font-medium"
              >
                <LogIn className="size-4" />
                <span className="hidden md:inline">登入 / 註冊</span>
              </button>
            )}

            {role === 'buyer' && (
              <div className="hidden items-center gap-2 md:flex">
                <button
                  type="button"
                  onClick={() => { setPage(page === 'rewards' ? 'market' : 'rewards'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  aria-pressed={page === 'rewards'}
                  className={`${page === 'rewards' ? btnPrimary : btnGhost} py-2`}
                >
                  <Coins className="size-4" />
                  簽到兌換
                  <span className="text-xs font-black">{account ? points : 0}</span>
                </button>

                <button type="button" onClick={openCenter} className={`${btnGhost} relative py-2`} aria-label={`買家中心，${centerBadge} 筆待處理訂單`}>
                  <ClipboardList className="size-4" />
                  買家中心
                  {centerBadge > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-black leading-5 text-white">{centerBadge}</span>
                  )}
                </button>

                <button type="button" onClick={() => setCartOpen(true)} className={`${btnPrimary} relative py-2`} aria-label={`購物車，${cartCount} 件商品`}>
                  <ShoppingCart className="size-4" />
                  購物車
                  {cartCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[11px] font-black leading-5 text-card">{cartCount}</span>
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="order-last flex w-full items-center gap-2 md:hidden">
            {roleToggle(role === 'buyer' ? 'flex shrink-0' : 'flex w-full')}
            {role === 'buyer' && <div className="relative min-w-0 flex-1">{searchField}</div>}
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl px-4 pb-28 md:pb-20">
        {role === 'buyer' && page === 'rewards' && (
          <div className="mt-6">
            <button type="button" onClick={() => { setPage('market'); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className={`${btnGhost} py-1.5`}>
              <ArrowLeft className="size-4" />返回市集
            </button>
            <CheckinZone
              loggedIn={!!account}
              points={points}
              ledger={ledger}
              checkedDays={checkedDays}
              checkedToday={checkedToday}
              coupons={coupons}
              ownedCodes={ownedCodes}
              sellers={sellers}
              onCheckIn={doCheckIn}
              onNextDay={nextCheckinDay}
              onRedeem={redeemCoupon}
              onOpenStore={(sid) => setStoreId(sid)}
            />
          </div>
        )}

        {role === 'buyer' && page === 'market' && (
          <>
            <section className="relative mt-4 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm md:mt-6" aria-label="市集介紹">
              <div aria-hidden className="flex overflow-hidden">
                {Array.from({ length: 48 }).map((_, i) => (
                  <span key={i} className={`h-5 w-14 shrink-0 rounded-b-full ${i % 2 === 0 ? 'bg-primary' : 'bg-secondary'}`} />
                ))}
              </div>
              <div className="grid items-center gap-5 p-5 md:grid-cols-[1.2fr_1fr] md:gap-6 md:p-10">
                <div>
                  <Pill tone="brand"><ShieldCheck className="size-3.5" />賣家皆經實名審核</Pill>
                  <h1 className="mt-3 text-balance text-[28px] font-black leading-tight md:text-5xl">每位賣家，<br />都是一間小市集</h1>
                  <p className="mt-3 max-w-lg text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
                    在買個 Pay 服逛手作、3C、露營與茶飲。多賣家一起結帳也不怕，系統自動拆單，7-11、全家、宅配任你選。
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 text-sm md:mt-5 md:gap-3">
                    <span className="rounded-full bg-muted px-3.5 py-1.5 font-bold"><span className="text-brand-ink">{approvedCount}</span> 間認證賣家</span>
                    <span className="rounded-full bg-muted px-3.5 py-1.5 font-bold"><span className="text-brand-ink">{visibleProducts.length}</span> 件在架商品</span>
                    <span className="rounded-full bg-muted px-3.5 py-1.5 font-bold">滿 {money(FREE_SHIP)} 免運</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => switchRole('seller')}
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-4 py-2 text-sm font-bold text-foreground transition hover:bg-primary/20 active:scale-[0.98] md:mt-4"
                  >
                    <Store className="size-4 text-primary" />
                    我要開店
                    <span className="text-xs font-medium text-muted-foreground">月費 {money(PLAN_PRICE)}</span>
                  </button>
                </div>
                <div className="relative mx-auto hidden h-56 w-full max-w-sm md:block" aria-hidden>
                  {[
                    { src: '/products/mug.png', cls: 'left-0 top-6 -rotate-6' },
                    { src: '/products/backpack.png', cls: 'left-1/3 top-0 rotate-3' },
                    { src: '/products/earbuds.png', cls: 'right-0 top-10 rotate-6' },
                  ].map((i) => (
                    <div key={i.src} className={`absolute w-36 overflow-hidden rounded-2xl border-4 border-card shadow-lg ${i.cls}`}>
                      <ProductImage src={i.src} alt="" />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="mt-6 md:mt-8" aria-label="商品列表">
              <CategoryNav value={category} onChange={setCategory} />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold text-muted-foreground">
                  {category.sub ?? category.main ?? (category.family ? CATEGORY_FAMILIES.find((f) => f.id === category.family)?.label : '全部商品')}
                  <span className="ml-2 font-medium">共 {visibleProducts.length} 件</span>
                </p>
                <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs font-bold text-muted-foreground">
                  排序
                  <select className={`${inputCls} w-auto rounded-full py-1.5`} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                    <option value="hot">熱銷優先</option>
                    <option value="low">價格由低到高</option>
                    <option value="high">價格由高到低</option>
                  </select>
                </label>
              </div>

              {visibleProducts.length === 0 ? (
                <div className={`${panelCls} mt-6 flex flex-col items-center gap-2 p-14 text-center`}>
                  <Search className="size-10 text-border" />
                  <p className="text-sm text-muted-foreground">找不到符合的商品，換個關鍵字試試</p>
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {visibleProducts.map((p) => {
                    const s = sellerById.get(p.sellerId)
                    if (!s) return null
                    return <ProductCard key={p.id} product={p} seller={s} checkin={checkinSellerIds.has(s.id)} faved={favorites.includes(p.id)} onFav={() => toggleFav(p.id)} onOpen={() => setProductId(p.id)} onOpenStore={() => setStoreId(s.id)} />
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {role === 'seller' && mySeller && (
          <div className="mt-6">
            <SellerDashboard
              sellers={sellers}
              seller={mySeller}
              products={products}
              orders={orders}
              payments={payments}
              onSwitchSeller={setMySellerId}
              onSaveProduct={saveProduct}
              onImportProducts={importProducts}
              onToggleProduct={toggleProduct}
              onDeleteProduct={deleteProduct}
              onShip={shipOrder}
              onConfirmPaid={confirmPaid}
              onPay={payRenewal}
              onResubmit={resubmit}
              onSetShopClosed={(c) => setShopClosed(mySeller.id, c)}
              onSavePayment={savePayment}
              onSaveKyc={saveKyc}
              exportLogs={exportLog.filter((l) => l.sellerId === mySeller.id)}
              onExported={logExport}
              onSimulateFail={() => simulatePayFail(mySeller.id)}
              onExpireTrial={() => expireTrial(mySeller.id)}
              onGraceDay={() => advanceGraceDay(mySeller.id)}
              onRefundDecision={decideRefund}
              smsPrefs={prefsOf(mySeller.id)}
              onSmsPrefs={(p) => setSmsPrefs((m) => ({ ...m, [mySeller.id]: p }))}
              smsLog={smsLog.filter((m) => m.sellerId === mySeller.id)}
              notices={notices.filter((n) => n.sellerId === mySeller.id)}
              onReadNotices={() => setNotices((l) => l.map((n) => (n.sellerId === mySeller.id ? { ...n, read: true } : n)))}
              appeals={appeals.filter((a) => a.sellerId === mySeller.id)}
              onAppeal={submitAppeal}
              reports={reports.filter((r) => r.sellerId === mySeller.id)}
              tickets={tickets.filter((t) => t.role === 'seller' && t.author === mySeller.name)}
              onSubmitTicket={(t) => submitTicket('seller', t)}
              onReadTicket={readTicket}
              onNotify={notify}
              onCancelPlan={(c) => setCancelAtPeriodEnd(mySeller.id, c)}
            />
          </div>
        )}

        {role === 'admin' && adminAuthed && (
          <div className="mt-6 space-y-5">
            <AdminSecurityBanner
              onLogout={() => { setAdminAuthed(false); setRole('buyer'); notify('已登出管理員後台') }}
              onTimeout={() => { setAdminAuthed(false); setRole('buyer'); notify('閒置逾時，已自動登出管理員後台') }}
            />
            <AdminDashboard
              sellers={sellers}
              products={products}
              orders={orders}
              onApprove={approveSeller}
              onReject={rejectSeller}
              onConfirmVerify={confirmVerify}
              onRemind={remind}
              onSetShopClosed={setShopClosed}
              reports={reports}
              onDismissReport={dismissReport}
              onConfirmReport={confirmReport}
              onSuspend={suspendSeller}
              scamReports={scamReports}
              blacklist={blacklist}
              appeals={appeals}
              onResolveAppeal={resolveAppeal}
              onReviewProduct={approveProductReview}
              tickets={tickets}
              onReplyTicket={replyTicket}
            />
          </div>
        )}
      </main>

      <SiteFooter onReport={() => setTakedownOpen(true)} onTerms={() => setTermsOpen(true)} />

      {welcomeOpen && <WelcomePromoModal threshold={FREE_SHIP} onClose={() => setWelcomeOpen(false)} />}
      {termsOpen && <TermsModal onClose={() => setTermsOpen(false)} />}
      {forgotOpen && <ForgotPasswordModal onClose={() => setForgotOpen(false)} onNotify={notify} />}
      {tourRole && (
        <OnboardingTour
          role={tourRole}
          onDone={() => {
            setToursSeen((l) => [...l, tourRole])
            setTourRole(null)
          }}
        />
      )}

      {storeSeller && (
        <StoreModal
          seller={storeSeller}
          checkin={checkinSellerIds.has(storeSeller.id)}
          closed={isOffline(storeSeller)}
          suspended={!!storeSeller.suspended}
          products={products.filter((p) => p.sellerId === storeSeller.id && p.active && !p.flagged && !isOffline(storeSeller))}
          followed={followed.includes(storeSeller.id)}
          onFollow={() =>
            setFollowed((f) => (f.includes(storeSeller.id) ? f.filter((x) => x !== storeSeller.id) : [...f, storeSeller.id]))
          }
          onClose={() => setStoreId(null)}
          onOpenProduct={(id) => setProductId(id)}
          onChat={() => setChatId(storeSeller.id)}
          viewer={viewer}
          reportsLeft={reportsLeft}
          onNeedLogin={needLoginForReport}
          onReport={(reason, note, evidence) => reportSeller(storeSeller.id, reason, note, evidence)}
        />
      )}

      {openProduct && openProductSeller && (
        <ProductModal
          key={openProduct.id}
          product={openProduct}
          seller={openProductSeller}
          checkin={checkinSellerIds.has(openProductSeller.id)}
          onClose={() => setProductId(null)}
          onNotify={notify}
          onAdd={(v, q) => {
            if (addToCart(openProduct.id, v, q)) notify('已加入購物車')
          }}
          onBuyNow={(v, q) => {
            if (addToCart(openProduct.id, v, q)) {
              setProductId(null)
              setCartOpen(true)
            }
          }}
          onOpenStore={() => {
            setProductId(null)
            setStoreId(openProductSeller.id)
          }}
          onChat={() => setChatId(openProductSeller.id)}
          onReport={(reason, note, evidence) => reportProduct(openProduct.id, reason, note, { evidence })}
          viewer={viewer}
          reportsLeft={reportsLeft}
          onNeedLogin={needLoginForReport}
          faved={favorites.includes(openProduct.id)}
          onFav={() => toggleFav(openProduct.id)}
          similar={products
            .filter((x) => {
              const so = sellerById.get(x.sellerId)
              return x.id !== openProduct.id && x.category === openProduct.category && x.active && !x.flagged && !x.reviewHold && !!so && !isOffline(so)
            })
            .slice(0, 3)}
          onOpenSimilar={(id) => setProductId(id)}
        />
      )}

      {cartOpen && (
        <CartModal
          cart={cart}
          products={products}
          sellers={sellers}
          loggedIn={!!account}
          buyerName={account?.name ?? ''}
          onClose={() => setCartOpen(false)}
          onQty={changeQty}
          onRemove={removeLine}
          onOpenStore={(id) => {
            setCartOpen(false)
            setStoreId(id)
          }}
          onNeedLogin={() => {
            notify('請先登入或註冊買家帳號')
            setAuthOpen(true)
          }}
          onCheckout={checkout}
          coupons={coupons}
          ownedCodes={usableCodes}
          wallet={wallet}
          onFindSimilar={findSimilar}
          onMoveFollow={moveSellerToFollow}
        />
      )}

      {otpFor && <PhoneOtpModal onClose={() => setOtpFor(null)} onVerified={verifyPhoneAndRedeem} />}

      {redeemedCoupon && (
        <RedeemSuccessModal
          coupon={redeemedCoupon}
          seller={sellerById.get(redeemedCoupon.sellerId)}
          onClose={() => setRedeemedCoupon(null)}
          onGoStore={() => {
            setStoreId(redeemedCoupon.sellerId)
            setRedeemedCoupon(null)
          }}
        />
      )}

      {takedownOpen && (
        <TakedownModal
          products={products.filter((p) => p.active && !p.flagged)}
          onClose={() => setTakedownOpen(false)}
          onSubmit={(pid, reason, note, extra) => {
            reportProduct(pid, reason, note, extra)
            setTakedownOpen(false)
          }}
        />
      )}

      {centerOpen && account && (
        <BuyerCenterModal
          wallet={wallet}
          orders={myBuyerOrders}
          products={products}
          sellers={sellers}
          buyerName={account.name}
          onClose={() => setCenterOpen(false)}
          onAdvance={advanceTrack}
          onReceive={receiveOrder}
          onReview={reviewOrder}
          onPaid={buyerPaid}
          onUrge={() => notify('已一鍵催單，賣家將收到出貨提醒')}
          onRemit={submitRemit}
          onScamReport={reportScam}
          onContact={(sid) => setChatId(sid)}
          onRefund={requestRefund}
          onGoStore={(sid) => {
            setCenterOpen(false)
            setStoreId(sid)
          }}
          favorites={favorites}
          onToggleFav={toggleFav}
          onOpenProduct={(id) => {
            setCenterOpen(false)
            setProductId(id)
          }}
          followed={followed}
          followPrefs={followPrefs}
          onFollowPref={(id, key) =>
            setFollowPrefs((m) => {
              const cur: FollowPrefs = m[id] ?? { newItem: true, coupon: true }
              return { ...m, [id]: { ...cur, [key]: !cur[key] } }
            })
          }
          onUnfollow={(id) => setFollowed((f) => f.filter((x) => x !== id))}
          tone={buyerProfile.tone}
          nameChangedAt={buyerProfile.nameChangedAt}
          onRename={renameBuyer}
          onAvatar={(i) => setBuyerProfile((p) => ({ ...p, tone: i }))}
          avatar={buyerProfile.avatar}
          onAvatarUpload={uploadAvatar}
          onAvatarRemove={removeAvatar}
          onSwitchSeller={() => {
            setCenterOpen(false)
            switchRole('seller')
          }}
          tickets={tickets.filter((t) => t.role === 'buyer')}
          onSubmitTicket={(t) => submitTicket('buyer', t)}
          onReadTicket={readTicket}
          onNotify={notify}
        />
      )}

      {chatSeller && <ChatModal key={chatSeller.id} seller={chatSeller} viewer={viewer} onClose={() => setChatId(null)} />}

      {adminLoginOpen && (
        <AdminAuthModal
          failed={adminFailed}
          onFail={() => setAdminFailed((n) => Math.min(n + 1, ADMIN_MAX_ATTEMPTS))}
          onResetLock={() => setAdminFailed(0)}
          onClose={() => setAdminLoginOpen(false)}
          onSuccess={() => {
            setAdminFailed(0)
            setAdminLoginOpen(false)
            setAdminAuthed(true)
            setRole('admin')
            setPage('market')
            if (!account) setAccount({ name: '平台管理員' })
            window.scrollTo({ top: 0, behavior: 'smooth' })
            notify('管理員身分驗證通過')
          }}
        />
      )}

      {authOpen && (
        <AuthModal
          initialTab={authInitialTab}
          onClose={() => setAuthOpen(false)}
          onLogin={login}
          onBuyer={registerBuyer}
          onSeller={registerSeller}
          onForgot={() => {
            setAuthOpen(false)
            setForgotOpen(true)
          }}
        />
      )}

      {gateOpen && (
        <SellerGateModal
          onClose={() => setGateOpen(false)}
          onUpgrade={() => {
            setGateOpen(false)
            setAuthInitialTab('seller')
            setAuthOpen(true)
          }}
          onDemo={() => {
            setGateOpen(false)
            setMySellerId('s1')
            setSellerAccess(true)
            setAccount((a) => a ?? { name: '測試賣家' })
            setRole('seller')
            setPage('market')
            window.scrollTo({ top: 0, behavior: 'smooth' })
            notify('已進入測試賣家「森日手作陶坊」（體驗模式，免註冊）')
          }}
        />
      )}

      {role === 'buyer' && (page === 'market' || page === 'rewards') && (
        <MobileTabBar
          active={page}
          points={account ? points : 0}
          cartCount={cartCount}
          centerBadge={centerBadge}
          onMarket={() => { setPage('market'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
          onRewards={() => { setPage('rewards'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
          onCart={() => setCartOpen(true)}
          onCenter={openCenter}
        />
      )}

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[100] flex justify-center px-4 md:bottom-6">
        {toast && (
          <p className="pointer-events-auto flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-bold text-card shadow-xl">
            <Check className="size-4 text-primary" />
            {toast}
          </p>
        )}
      </div>
    </div>
  )
}
