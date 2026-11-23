// 只在本機隔離 Supabase（docker）驗證：正常遊玩的每一份存檔都會被資料庫接受，
// 而且資料庫重算出來的金幣、經驗與遊戲本身算的一模一樣。整段在一個交易裡，最後 ROLLBACK。
// 用法：npx tsx scripts/run-street-cloud-play-test.ts [容器名稱] [--v2]
// --v2：開放內容版本 2（新商品與新裝潢），並在雲端存檔本體後加上商店街 v2 SQL。
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  MAX_SHOP_LEVEL,
  STREET_BUILDINGS,
  STREET_PRODUCTS,
  buyDecor,
  liveDecors,
  setStreetContentVersion,
  newSim,
  newStreet,
  serve,
  setOpen,
  snapshot,
  startJob,
  tick,
  unlockBuilding,
  upgrade,
  type StreetState,
} from '../lib/arcade/street-rules'

const v2 = process.argv.includes('--v2')
const container = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'supabase_db_hengjing-stage45-local'
if (v2) setStreetContentVersion(2)
const STREET_DECORS = liveDecors()
const CLOCK = Date.parse('2026-10-29T12:00:00+08:00')
const SAVE_EVERY_MS = 10_000

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

let auto: StreetState = { progress: newStreet(CLOCK), sim: newSim(newStreet(CLOCK)) }
const first = snapshot(auto)
auto = setOpen(auto, true, CLOCK)
const rand = seeded(11)
const steps: { elapsed: number; payload: unknown; coins: number; xp: number }[] = []
let lastSave = 0
const done = () => auto.progress.shopLevel === MAX_SHOP_LEVEL && auto.progress.buildings.length === STREET_BUILDINGS.length && auto.progress.ownedDecors.length === STREET_DECORS.length
for (let i = 0; i < 600_000 && !done(); i += 1) {
  auto = tick(auto, 100, rand, CLOCK).state
  for (const c of auto.sim.customers) {
    if (c.kind === 'guest' && c.phase === 'wait') {
      const res = serve(auto, c.id, CLOCK)
      if (res.ok) auto = res.state
    }
  }
  for (const p of STREET_PRODUCTS) {
    const res = startJob(auto, p.id)
    if (res.ok) auto = res.state
  }
  for (const act of [
    (s: StreetState) => upgrade(s, CLOCK),
    ...STREET_BUILDINGS.map((b) => (s: StreetState) => unlockBuilding(s, b.id, CLOCK)),
    ...STREET_DECORS.map((d) => (s: StreetState) => buyDecor(s, d.id, CLOCK)),
  ]) {
    const res = act(auto)
    if (res.ok) auto = res.state
  }
  if (auto.sim.t - lastSave >= SAVE_EVERY_MS) {
    const snap = snapshot(auto)
    steps.push({ elapsed: (auto.sim.t - lastSave) / 1000, payload: snap, coins: snap.coins, xp: snap.xp })
    lastSave = auto.sim.t
  }
}
const snap = snapshot(auto)
steps.push({ elapsed: Math.max(1, (auto.sim.t - lastSave) / 1000), payload: snap, coins: snap.coins, xp: snap.xp })
if (!done()) throw new Error(`自動經營沒有買齊（Lv.${auto.progress.shopLevel}）`)

const body = (file: string) => {
  const sql = readFileSync(file, 'utf8')
  return sql.slice(sql.indexOf('BEGIN;') + 'BEGIN;'.length, sql.lastIndexOf('COMMIT;'))
}
const has = (rel: string) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', `select to_regclass('${rel}') is not null`], { encoding: 'utf8' }).trim() === 't'
const lit = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`

const user = 'eeeeeeee-0000-4000-8000-0000000000e9'
const test = `
INSERT INTO auth.users (id, email, aud, role, instance_id)
VALUES ('${user}', 'cloud-play@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
DO $p$
DECLARE
  steps jsonb := ${lit(steps)};
  step jsonb;
  r jsonb;
  rev bigint := 1;
  i integer := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '${user}', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '${user}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := public.import_my_street_save(${lit(first)}, gen_random_uuid());
  IF NOT (r ->> 'ok')::boolean OR r ->> 'importSource' <> 'fresh' THEN RAISE EXCEPTION 'FAIL 新店轉移 %', r; END IF;
  FOR step IN SELECT e FROM jsonb_array_elements(steps) AS t(e) LOOP
    i := i + 1;
    EXECUTE 'RESET ROLE';
    UPDATE public.member_street_saves SET updated_at = updated_at - make_interval(secs => (step ->> 'elapsed')::numeric) WHERE user_id = '${user}';
    EXECUTE 'SET LOCAL ROLE authenticated';
    r := public.save_my_street(rev, step -> 'payload', gen_random_uuid());
    IF NOT (r ->> 'ok')::boolean THEN RAISE EXCEPTION 'FAIL 第 % 次正常存檔被拒：%', i, r ->> 'reason'; END IF;
    IF (r #>> '{progress,coins}') <> (step ->> 'coins') OR (r #>> '{progress,xp}') <> (step ->> 'xp') THEN
      RAISE EXCEPTION 'FAIL 第 % 次金幣／經驗不一致：資料庫 %／%，遊戲 %／%', i, r #>> '{progress,coins}', r #>> '{progress,xp}', step ->> 'coins', step ->> 'xp';
    END IF;
    rev := (r ->> 'revision')::bigint;
  END LOOP;
  RAISE NOTICE 'PASS 正常遊玩 % 次存檔全部接受，金幣與經驗和遊戲完全一致（最後 Lv.%、% 金幣）', i, r #>> '{progress,shopLevel}', r #>> '{progress,coins}';
END
$p$;`

const parts = ['BEGIN;']
if (!has('public.member_street_friends')) parts.push(body('supabase/manual/20261029220200_street_friend_help_apply.sql'))
if (!has('public.member_street_steals')) parts.push(body('supabase/manual/20261029230100_street_steal_explore_apply.sql'))
parts.push(body('supabase/manual/20261030010100_street_cloud_save_apply.sql'))
if (v2) parts.push(body('supabase/manual/20261030030200_street_content_v2_apply.sql'))
parts.push(test, 'ROLLBACK;')
const run = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: parts.join('\n'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
console.log(String(run.stderr ?? '').split('\n').filter((line) => /PASS|FAIL|ERROR/.test(line)).join('\n'))
console.log(`自動經營 ${(auto.sim.t / 60000).toFixed(1)} 分鐘、服務 ${auto.progress.stats.served} 位、${steps.length} 次存檔`)
if (run.status !== 0) process.exit(1)
