export const SELLER_TABS = ['products', 'orders', 'reports', 'messages', 'coupons', 'notices', 'plan', 'account', 'storefront', 'support', 'security'] as const
export type SellerTab = (typeof SELLER_TABS)[number]
export type MarketSort = 'new' | 'hot' | 'low' | 'high'
export type MarketQuick = 'freeShip' | 'hot' | 'founder' | 'new'

export type MarketplaceNav = {
  product: string | null
  store: string | null
  q: string
  family: string | null
  main: string | null
  sub: string | null
  sort: MarketSort
  quick: MarketQuick | null
  page: 'market' | 'rewards'
  view: 'buyer' | 'seller'
  center: boolean
  tab: SellerTab | null
  chat: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const EMPTY_NAV: MarketplaceNav = {
  product: null,
  store: null,
  q: '',
  family: null,
  main: null,
  sub: null,
  sort: 'hot',
  quick: null,
  page: 'market',
  view: 'buyer',
  center: false,
  tab: null,
  chat: null,
}

const uuid = (value: string | null) => (value && UUID_RE.test(value) ? value : null)
const clip = (value: string | null, max: number) => {
  const text = (value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim()
  return text ? text.slice(0, max) : null
}

export function readMarketplaceNav(params: Pick<URLSearchParams, 'get'>): MarketplaceNav {
  const sort = params.get('sort')
  const quick = params.get('quick')
  const page = params.get('page')
  const view = params.get('view')
  const tab = params.get('tab')
  return {
    product: uuid(params.get('p')),
    store: uuid(params.get('store')),
    q: clip(params.get('q'), 80) ?? '',
    family: clip(params.get('family'), 32)?.toLowerCase() ?? null,
    main: clip(params.get('main'), 40),
    sub: clip(params.get('sub'), 40),
    sort: sort === 'new' || sort === 'hot' || sort === 'low' || sort === 'high' ? sort : 'hot',
    quick: quick === 'freeShip' || quick === 'hot' || quick === 'founder' || quick === 'new' ? quick : null,
    page: page === 'rewards' ? 'rewards' : 'market',
    view: view === 'seller' ? 'seller' : 'buyer',
    center: params.get('center') === '1',
    tab: SELLER_TABS.includes(tab as SellerTab) ? (tab as SellerTab) : null,
    chat: uuid(params.get('chat')),
  }
}

export function marketplaceHref(pathname: string, nav: MarketplaceNav) {
  const params = new URLSearchParams()
  if (nav.product) params.set('p', nav.product)
  if (nav.store) params.set('store', nav.store)
  if (nav.q) params.set('q', nav.q)
  if (nav.family) params.set('family', nav.family)
  if (nav.main) params.set('main', nav.main)
  if (nav.sub) params.set('sub', nav.sub)
  if (nav.sort !== 'hot') params.set('sort', nav.sort)
  if (nav.quick) params.set('quick', nav.quick)
  if (nav.page === 'rewards') params.set('page', 'rewards')
  if (nav.view === 'seller') params.set('view', 'seller')
  if (nav.center) params.set('center', '1')
  if (nav.view === 'seller' && nav.tab) params.set('tab', nav.tab)
  if (nav.chat) params.set('chat', nav.chat)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function sameNav(a: MarketplaceNav, b: MarketplaceNav) {
  return (Object.keys(EMPTY_NAV) as (keyof MarketplaceNav)[]).every((key) => a[key] === b[key])
}
