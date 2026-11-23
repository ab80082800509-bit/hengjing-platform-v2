import { readFileSync } from 'node:fs'
import { EMPTY_NAV, marketplaceHref, readMarketplaceNav } from '../lib/marketplace-url'
import {
  STREET_BUILDINGS,
  STREET_DECORS,
  STREET_PRODUCTS,
  newStreet,
  parseStreet,
  type BuildingId,
} from '../lib/arcade/street-rules'
import {
  activeLikeCount,
  exhibitSig,
  exhibitStreet,
  nextLikeActive,
  parseMyStreetSocial,
  parsePublicStreet,
  projectStreetExhibit,
  recordVisit,
  streetVisitHref,
  visitorStats,
} from '../lib/arcade/street-public'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const CLOCK = Date.UTC(2026, 9, 27, 4)
const owner = '11111111-1111-4111-8111-111111111111'
const friend = '22222222-2222-4222-8222-222222222222'

const source = {
  shopLevel: 3,
  buildings: ['tea', 'gift'] as BuildingId[],
  equipped: {
    street: 'lights' as const,
    shops: { main: 'lantern' as const, tea: 'flower' as const, gift: 'mat' as const },
  },
}
const exhibit = projectStreetExhibit(source)
assert(exhibit !== null && exhibit.shopLevel === 3, '公開街景等級應保留')
assert(exhibit?.buildings.join() === 'tea', '未達等級的禮盒坊不能公開')
assert(exhibit?.equipped.street === 'lights' && exhibit.equipped.shops.main === 'lantern' && exhibit.equipped.shops.tea === 'flower' && !exhibit.equipped.shops.gift, '未開幕店面的裝潢不能公開')
assert(!('coins' in exhibit!) && !('stock' in exhibit!) && !('xp' in exhibit!), '公開街景不該帶金幣或庫存欄位')

const rich = parseStreet({ ...newStreet(CLOCK), coins: 777, xp: 80, shopLevel: 3, buildings: ['tea'], ownedDecors: ['lantern', 'flower', 'lights'], equipped: source.equipped, open: true })
assert(rich !== null && rich.coins === 777, '私人存檔仍保留金幣')
const fromRich = projectStreetExhibit(rich!)
assert(fromRich !== null && !JSON.stringify(fromRich).includes('777') && fromRich.buildings.join() === 'tea', '從私人存檔投影時要丟掉金幣')
const shown = exhibitStreet(fromRich!)
assert(shown.coins === 0 && shown.xp === 0 && shown.open === false && shown.stock.croissant === 0 && shown.shopLevel === 3 && shown.equipped.shops.tea === 'flower', '參觀用街景不能帶屋主的收益或營業狀態')
assert(parseStreet(JSON.parse(JSON.stringify({ ...rich, v: rich!.v })))?.coins === 777, '投影不能改寫原本的 v3 存檔')

assert(nextLikeActive(null) && nextLikeActive(false) && !nextLikeActive(true), '同一顆讚再按應取消')
assert(activeLikeCount([{ memberId: friend, active: true }, { memberId: friend, active: true }, { memberId: owner, active: false }]) === 1, '重複列不能灌成多顆讚')

let seen = recordVisit(owner, owner, '2026-10-27', [])
assert(!seen.counted && seen.seen.length === 0, '自己進出不能增加拜訪')
seen = recordVisit(owner, friend, '2026-10-27', seen.seen)
assert(seen.counted && seen.seen.length === 1, '第一位朋友的拜訪要記下')
const again = recordVisit(owner, friend, '2026-10-27', seen.seen)
assert(!again.counted && again.seen.length === 1, '同一天重複拜訪不能再加')
const nextDay = recordVisit(owner, friend, '2026-10-28', again.seen)
assert(nextDay.counted && visitorStats(nextDay.seen, '2026-10-28').visitors === 1 && visitorStats(nextDay.seen, '2026-10-28').todayVisitors === 1, '人氣以會員去重，今日只算當天')

const closed = parsePublicStreet({ ok: false, reason: 'closed', email: 'a@b.c', coins: 500 }, owner)
assert(closed === null, '未公開不能解析成街景')
const leaked = parsePublicStreet({
  ok: true,
  ownerId: owner,
  published: true,
  nickname: '小花',
  avatarUrl: 'https://evil.example/secret.png',
  avatarTone: 1,
  likes: 2,
  likedByMe: false,
  visitors: 3,
  todayVisitors: 1,
  revision: 4,
  updatedAt: '2026-10-27T00:00:00.000Z',
  shopLevel: 3,
  buildings: ['tea'],
  equipped: { street: 'lights', shops: { main: 'lantern', tea: 'flower' } },
  email: 'a@b.c',
  phone: '0912000000',
  coins: 500,
  stock: { croissant: 9 },
}, owner)
assert(leaked !== null && leaked.nickname === '小花' && leaked.avatarUrl === null && leaked.exhibit.shopLevel === 3, '公開街景只留暱稱與店面')
assert(!JSON.stringify(leaked).includes('a@b.c') && !JSON.stringify(leaked).includes('0912') && !JSON.stringify(leaked).includes('500'), '公開解析不能帶走私人欄位')
assert(parsePublicStreet({ ...leaked, ok: true, ownerId: friend, shopLevel: 3, buildings: ['tea'], equipped: leaked!.exhibit.equipped, published: true, likes: 0, visitors: 0, todayVisitors: 0, revision: 1, likedByMe: false }, owner) === null, '回傳的屋主與連結不符時要丟掉')

const mine = parseMyStreetSocial({ ok: true, published: false, likes: 0, visitors: 0, todayVisitors: 0, revision: 0, updatedAt: null, shopLevel: null })
assert(mine?.published === false && mine.exhibit === null, '尚未公開時不該有展示街景')

const href = streetVisitHref('/', owner)
assert(href === `/?page=arcade&game=street&visit=${owner}`, '拜訪連結格式錯誤')
assert(readMarketplaceNav(new URLSearchParams(href.slice(2))).visit === owner, '拜訪連結要能讀回')
assert(readMarketplaceNav(new URLSearchParams(`page=arcade&game=merge&visit=${owner}`)).visit === null, '其他遊戲不能帶街景拜訪')
assert(readMarketplaceNav(new URLSearchParams('page=arcade&game=street&visit=not-a-member')).visit === null, '不合法的會員編號要忽略')
assert(marketplaceHref('/', { ...EMPTY_NAV, page: 'arcade', game: 'street' }) === '/?page=arcade&game=street', '自己的商店街網址維持原樣')
assert(exhibitSig(exhibit!) !== exhibitSig({ ...exhibit!, shopLevel: 2, buildings: [], equipped: exhibit!.equipped }), '裝潢或店面變更要產生不同的同步簽名')

const sql = readFileSync(new URL('../supabase/manual/20261027202000_street_social_preview.sql', import.meta.url), 'utf8')
const streetV2 = readFileSync(new URL('../supabase/manual/20261030030200_street_content_v2_apply.sql', import.meta.url), 'utf8')
for (const decor of STREET_DECORS) {
  const src = (decor.since ?? 1) >= 2 ? streetV2 : sql
  assert(src.includes(`WHEN '${decor.id}' THEN ${decor.needShop}`), `SQL 裝潢等級與規則不一致：${decor.id}`)
  assert(src.includes(`WHEN '${decor.id}' THEN '${decor.slot}'`), `SQL 裝潢位置與規則不一致：${decor.id}`)
  assert(streetV2.includes(`"${decor.id}": {"cost": ${decor.cost}, "rank": ${decor.needRank}, "shop": ${decor.needShop}}`), `v2 雲端規格裝潢與規則不一致：${decor.id}`)
}
for (const product of STREET_PRODUCTS) {
  assert(new RegExp(`"${product.id}": ${product.unlock}\\b`).test(streetV2), `v2 雲端規格商品等級與規則不一致：${product.id}`)
}
for (const building of STREET_BUILDINGS) {
  assert(sql.includes(`WHEN '${building.id}' THEN ${building.needShop}`), `SQL 店面等級與規則不一致：${building.id}`)
}
assert(sql.includes('owner_id <> member_id'), 'SQL 必須拒絕自己算拜訪或按讚')
assert(sql.includes('ON CONFLICT (owner_id, member_id) DO UPDATE'), '按讚必須是同一列切換')
assert(sql.includes('ON CONFLICT DO NOTHING'), '同一天的拜訪必須靠主鍵去重')
assert(sql.includes('AND published'), '未公開的街不能被讀出')
assert(!sql.includes('member_point') && !sql.includes('post_member_reward'), '本批不能動 Pay 點數')
assert(sql.includes('REVOKE ALL ON TABLE public.member_street_exhibits FROM PUBLIC, anon, authenticated'), '公開表不能直接授權給會員')
assert(sql.includes('GRANT EXECUTE ON FUNCTION public.get_public_street(uuid) TO authenticated'), '已登入會員才可讀公開街景')
assert(sql.includes('REVOKE ALL ON FUNCTION public.get_public_street(uuid) FROM PUBLIC, anon'), '匿名不可讀街景')
assert(!sql.includes('GRANT EXECUTE ON FUNCTION public.get_public_street(uuid) TO anon'), '匿名不可被授權讀街景')
assert(sql.includes('pg_catalog.pg_trigger_depth() > 1'), '外鍵連動刪除必須放行')
assert(sql.includes('NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id)'), '會員已刪除時街景列要能跟著清掉')
assert(sql.includes('一般會員不該能直接刪除街景'), '隔離測試要拒絕會員直接刪表')
assert(sql.includes('隔離會員刪除沒有剛好刪除一位測試會員'), '隔離測試要真的刪除測試會員')
assert(sql.includes('NOT p_published AND NOT view_ok'), '無效街景仍要能取消公開')
assert(!sql.includes('SET search_path = public'), '函式不能把 public 放進 search_path')
assert(sql.includes('search_path = pg_catalog'), '函式必須固定 search_path')
assert(sql.includes('/storage/v1/object/public/member-avatars/'), '頭像只能接受會員頭像桶的公開網址')
assert(sql.includes('不得用來發放 Pay 點數或排行獎勵'), '前端送入的等級與裝潢不能當成可發獎成就')
assert(!sql.includes('GRANT EXECUTE ON FUNCTION public.guard_street_social_write() TO authenticated'), '一般會員不能執行刪除守衛')
assert(!sql.includes('GRANT EXECUTE ON FUNCTION public.guard_street_social_write() TO anon'), '匿名不能執行刪除守衛')

const client = readFileSync(new URL('../lib/arcade/street-social-client.ts', import.meta.url), 'utf8')
assert(!client.includes('localStorage.getItem') && !client.includes('localStorage.setItem'), '社交互動不能寫進 localStorage')
assert(client.includes('shopLevel') && !client.includes('coins'), '送出的公開街景不能帶金幣')

console.log('street social checks passed')
