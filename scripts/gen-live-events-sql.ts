// 由 lib/arcade/live-ops.ts 產生活動 SQL，讓資料庫的期別、輪替與節慶窗口和前端同一份規則。
// 用法：npx tsx scripts/gen-live-events-sql.ts   （只寫檔，不連線資料庫）
import { writeFileSync } from 'node:fs'
import { LIVE_EVENTS, activeLiveEvents, eventPeriod, festivalWindows } from '../lib/arcade/live-ops'

const OUT = 'supabase/manual/20261030030700_live_events_apply.sql'
const FROM_YEAR = 2026
const TO_YEAR = 2050
const q = (s: string) => `'${s.replace(/'/g, "''")}'`

const catalog = LIVE_EVENTS.map((def) => {
  const variants = JSON.stringify(def.variants.map((v) => ({ metric: v.metric, target: v.target })))
  return `  (${q(def.id)}, ${q(def.game)}, ${q(def.cadence)}, ${def.festivalId ? q(def.festivalId) : 'NULL'}, ${q(variants)}::jsonb, ${q(def.reward.medal)})`
}).join(',\n')

const festivalIds = [...new Set(LIVE_EVENTS.flatMap((def) => (def.festivalId ? [def.festivalId] : [])))]
const windows = festivalIds.flatMap((id) => festivalWindows(id, FROM_YEAR, TO_YEAR).map((w) => `  (${q(id)}, DATE ${q(w.startsOn)}, DATE ${q(w.endsOn)})`)).join(',\n')

// 自我檢查：挑幾個台北時間點，資料庫算出的期別與輪替內容必須和前端一致。
const samples = ['2026-10-29T23:59:00+08:00', '2026-11-02T00:00:00+08:00', '2026-12-24T12:00:00+08:00', '2027-02-10T12:00:00+08:00', '2027-09-15T08:00:00+08:00', '2031-06-01T00:30:00+08:00']
const expectations = samples.flatMap((iso) => {
  const ms = Date.parse(iso)
  return LIVE_EVENTS.map((def) => {
    const period = eventPeriod(def, ms)
    const live = activeLiveEvents(ms).find((e) => e.id === def.id)
    const variant = live ? def.variants.findIndex((v) => v.title === live.title && v.metric === live.metric) : -1
    return `  (${q(def.id)}, TIMESTAMPTZ ${q(iso)}, ${period ? q(period.key) : 'NULL'}, ${variant})`
  })
}).join(',\n')

const sql = `-- 第七階段第 9 批：三款遊戲的每日／每週／每月／遊戲季／節慶活動（伺服器紀錄版）。
-- 本檔由 scripts/gen-live-events-sql.ts 依 lib/arcade/live-ops.ts 產生，請勿手改；改規則後重新產生。
--
-- 影響範圍：
--   新增 game_live_events、game_live_festival_windows、member_live_event_entries 三張表與五個函式。
--   不改任何既有表、不碰點數 ledger、不發 Pay 點數（pay_points 有 CHECK = 0）、不動購物車／訂單／金流／賣家訂閱。
--   會員只能透過 get_my_live_events / claim_my_live_event 讀寫自己的活動紀錄，不能直接寫表。
-- 期別一律以 Asia/Taipei 計算；節慶窗口為 ${FROM_YEAR}～${TO_YEAR} 年依 27 種節慶規則（含農曆）推算，不是單次日期。
-- 進度只用伺服器資料重算：合成小舖看 member_merge_shop_events、商店街看雲端存檔（以加入活動時為起點）、方塊看 verified 排行賽。
-- 依賴：member_merge_shop_events 必須已存在；商店街雲端存檔、方塊排行賽表若還沒套用，對應活動顯示「待開放」。
-- 回復方式：DROP FUNCTION 五個函式後 DROP TABLE member_live_event_entries, game_live_festival_windows, game_live_events。

BEGIN;

DO $live_precheck$
BEGIN
  IF to_regclass('public.member_merge_shop_events') IS NULL THEN
    RAISE EXCEPTION '請先套用合成小舖（member_merge_shop_events 不存在）';
  END IF;
END
$live_precheck$;

CREATE TABLE IF NOT EXISTS public.game_live_events (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{3,40}$'),
  game_id text NOT NULL CHECK (game_id IN ('merge_shop', 'block_challenge', 'dream_street')),
  cadence text NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly', 'season', 'festival')),
  festival_id text,
  variants jsonb NOT NULL CHECK (jsonb_typeof(variants) = 'array' AND jsonb_array_length(variants) BETWEEN 1 AND 12),
  medal text NOT NULL,
  pay_points integer NOT NULL DEFAULT 0 CHECK (pay_points = 0),
  active boolean NOT NULL DEFAULT true,
  CHECK ((cadence = 'festival') = (festival_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.game_live_festival_windows (
  festival_id text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on > starts_on),
  PRIMARY KEY (festival_id, starts_on)
);

CREATE TABLE IF NOT EXISTS public.member_live_event_entries (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES public.game_live_events (id),
  period_key text NOT NULL CHECK (period_key ~ '^(d|w|m|s|f):[a-z0-9:-]{4,60}$'),
  variant integer NOT NULL CHECK (variant >= 0),
  baseline integer NOT NULL DEFAULT 0 CHECK (baseline >= 0),
  joined_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  PRIMARY KEY (user_id, event_id, period_key)
);

ALTER TABLE public.game_live_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_live_festival_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_live_event_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_live_events, public.game_live_festival_windows, public.member_live_event_entries FROM PUBLIC, anon, authenticated;

INSERT INTO public.game_live_events (id, game_id, cadence, festival_id, variants, medal) VALUES
${catalog}
ON CONFLICT (id) DO UPDATE SET game_id = EXCLUDED.game_id, cadence = EXCLUDED.cadence, festival_id = EXCLUDED.festival_id,
  variants = EXCLUDED.variants, medal = EXCLUDED.medal, active = true;

INSERT INTO public.game_live_festival_windows (festival_id, starts_on, ends_on) VALUES
${windows}
ON CONFLICT (festival_id, starts_on) DO UPDATE SET ends_on = EXCLUDED.ends_on;

-- 某個活動在 p_now 的那一期（台北時間）。不在期間回傳空。
CREATE OR REPLACE FUNCTION public.live_event_period(p_event_id text, p_now timestamptz)
RETURNS TABLE (period_key text, starts_at timestamptz, ends_at timestamptz, variant integer)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  ev public.game_live_events%ROWTYPE;
  d date := (p_now AT TIME ZONE 'Asia/Taipei')::date;
  m integer := extract(month FROM d)::integer;
  y integer := extract(year FROM d)::integer;
  first_day date;
  next_day date;
  idx integer;
  season text;
  season_year integer;
  n integer;
BEGIN
  SELECT * INTO ev FROM public.game_live_events WHERE id = p_event_id AND active;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF ev.cadence = 'daily' THEN
    first_day := d; next_day := d + 1; idx := d - DATE '2026-01-01';
    period_key := 'd:' || to_char(d, 'YYYY-MM-DD');
  ELSIF ev.cadence = 'weekly' THEN
    first_day := d - (extract(isodow FROM d)::integer - 1); next_day := first_day + 7;
    idx := floor((first_day - DATE '2025-12-29')::numeric / 7)::integer;
    period_key := 'w:' || to_char(first_day, 'YYYY-MM-DD');
  ELSIF ev.cadence = 'monthly' THEN
    first_day := date_trunc('month', d)::date; next_day := (first_day + interval '1 month')::date;
    idx := (y - 2026) * 12 + m - 1;
    period_key := 'm:' || to_char(d, 'YYYY-MM');
  ELSIF ev.cadence = 'season' THEN
    season := CASE WHEN m BETWEEN 3 AND 5 THEN 'spring' WHEN m BETWEEN 6 AND 8 THEN 'summer' WHEN m BETWEEN 9 AND 11 THEN 'autumn' ELSE 'winter' END;
    season_year := CASE WHEN season = 'winter' AND m <= 2 THEN y - 1 ELSE y END;
    first_day := make_date(season_year, CASE season WHEN 'spring' THEN 3 WHEN 'summer' THEN 6 WHEN 'autumn' THEN 9 ELSE 12 END, 1);
    next_day := (first_day + interval '3 months')::date;
    idx := (season_year - 2026) * 4 + CASE season WHEN 'spring' THEN 0 WHEN 'summer' THEN 1 WHEN 'autumn' THEN 2 ELSE 3 END;
    period_key := 's:' || season_year || '-' || season;
  ELSE
    SELECT w.starts_on, w.ends_on INTO first_day, next_day
    FROM public.game_live_festival_windows AS w
    WHERE w.festival_id = ev.festival_id AND w.starts_on <= d AND d < w.ends_on;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    idx := extract(year FROM first_day)::integer - 2026;
    period_key := 'f:' || ev.festival_id || ':' || to_char(first_day, 'YYYY-MM-DD');
  END IF;
  n := jsonb_array_length(ev.variants);
  variant := ((idx % n) + n) % n;
  starts_at := first_day::timestamp AT TIME ZONE 'Asia/Taipei';
  ends_at := next_day::timestamp AT TIME ZONE 'Asia/Taipei';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.live_event_available(p_metric text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_metric IN ('merge.orders', 'merge.merges') THEN to_regclass('public.member_merge_shop_events') IS NOT NULL
    WHEN p_metric IN ('street.served', 'street.earned') THEN to_regclass('public.member_street_saves') IS NOT NULL
    WHEN p_metric IN ('block.ranked', 'block.score') THEN to_regclass('public.block_ranked_runs') IS NOT NULL
    ELSE false
  END
$$;

-- 伺服器重算的進度原始值。商店街是累計值（扣掉加入時的 baseline 才是這一期的進度），其他直接是這一期的值。
CREATE OR REPLACE FUNCTION public.live_event_metric(p_user uuid, p_metric text, p_from timestamptz, p_to timestamptz)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  value bigint := 0;
  street jsonb;
BEGIN
  IF NOT public.live_event_available(p_metric) THEN
    RETURN 0;
  END IF;
  IF p_metric IN ('merge.orders', 'merge.merges') THEN
    SELECT count(*) INTO value FROM public.member_merge_shop_events AS e
    WHERE e.user_id = p_user AND e.action_type = CASE p_metric WHEN 'merge.orders' THEN 'serve' ELSE 'merge' END
      AND e.created_at >= p_from AND e.created_at < p_to;
  ELSIF p_metric IN ('street.served', 'street.earned') THEN
    EXECUTE 'SELECT progress FROM public.member_street_saves WHERE user_id = $1' INTO street USING p_user;
    IF street IS NOT NULL AND jsonb_typeof(street #> ARRAY['stats', substr(p_metric, 8)]) = 'number' THEN
      value := floor((street #>> ARRAY['stats', substr(p_metric, 8)])::numeric)::bigint;
    END IF;
  ELSIF p_metric = 'block.ranked' THEN
    EXECUTE 'SELECT count(*) FROM public.block_ranked_runs WHERE user_id = $1 AND status = ''verified'' AND submitted_at >= $2 AND submitted_at < $3'
      INTO value USING p_user, p_from, p_to;
  ELSIF p_metric = 'block.score' THEN
    EXECUTE 'SELECT coalesce(max(score), 0) FROM public.block_ranked_runs WHERE user_id = $1 AND status = ''verified'' AND submitted_at >= $2 AND submitted_at < $3'
      INTO value USING p_user, p_from, p_to;
  END IF;
  RETURN LEAST(GREATEST(coalesce(value, 0), 0), 1000000000)::integer;
END;
$$;

-- 讀取（並自動加入）目前進行中的活動。p_now 只給內部測試用；會員呼叫的版本固定用 now()。
CREATE OR REPLACE FUNCTION public.live_event_state(p_user uuid, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  ev public.game_live_events%ROWTYPE;
  per record;
  entry public.member_live_event_entries%ROWTYPE;
  goal jsonb;
  metric text;
  raw integer;
  items jsonb := '[]'::jsonb;
  records jsonb;
BEGIN
  FOR ev IN SELECT * FROM public.game_live_events WHERE active ORDER BY id LOOP
    SELECT * INTO per FROM public.live_event_period(ev.id, p_now);
    CONTINUE WHEN per.period_key IS NULL;
    goal := ev.variants -> per.variant;
    metric := goal ->> 'metric';
    raw := public.live_event_metric(p_user, metric, per.starts_at, per.ends_at);
    INSERT INTO public.member_live_event_entries (user_id, event_id, period_key, variant, baseline)
    VALUES (p_user, ev.id, per.period_key, per.variant, CASE WHEN metric LIKE 'street.%' THEN raw ELSE 0 END)
    ON CONFLICT DO NOTHING;
    SELECT * INTO entry FROM public.member_live_event_entries
    WHERE user_id = p_user AND event_id = ev.id AND period_key = per.period_key;
    items := items || jsonb_build_object(
      'eventId', ev.id,
      'gameId', ev.game_id,
      'cadence', ev.cadence,
      'periodKey', per.period_key,
      'variant', entry.variant,
      'metric', metric,
      'target', (goal ->> 'target')::integer,
      'progress', LEAST(GREATEST(raw - entry.baseline, 0), (goal ->> 'target')::integer),
      'available', public.live_event_available(metric),
      'claimed', entry.claimed_at IS NOT NULL,
      'startsAt', per.starts_at,
      'endsAt', per.ends_at
    );
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object('eventId', e.event_id, 'periodKey', e.period_key, 'variant', e.variant, 'medal', ev2.medal, 'claimedAt', e.claimed_at)
    ORDER BY e.claimed_at DESC), '[]'::jsonb)
  INTO records
  FROM (SELECT * FROM public.member_live_event_entries WHERE user_id = p_user AND claimed_at IS NOT NULL ORDER BY claimed_at DESC LIMIT 60) AS e
  JOIN public.game_live_events AS ev2 ON ev2.id = e.event_id;

  RETURN jsonb_build_object('events', items, 'records', records, 'version', 1, 'serverNow', p_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.live_event_claim(p_user uuid, p_event_id text, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  per record;
  entry public.member_live_event_entries%ROWTYPE;
  goal jsonb;
  raw integer;
BEGIN
  IF p_event_id IS NULL OR p_event_id !~ '^[a-z0-9_]{3,40}$' THEN
    RAISE EXCEPTION '找不到這個活動';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('live_event:' || p_user::text, 0));
  SELECT * INTO per FROM public.live_event_period(p_event_id, p_now);
  IF per.period_key IS NULL THEN
    RAISE EXCEPTION '活動不在進行期間';
  END IF;
  PERFORM public.live_event_state(p_user, p_now);
  SELECT * INTO entry FROM public.member_live_event_entries
  WHERE user_id = p_user AND event_id = p_event_id AND period_key = per.period_key FOR UPDATE;
  IF entry.claimed_at IS NOT NULL THEN
    RAISE EXCEPTION '這一期已經領過活動紀錄';
  END IF;
  SELECT variants -> entry.variant INTO goal FROM public.game_live_events WHERE id = p_event_id;
  IF NOT public.live_event_available(goal ->> 'metric') THEN
    RAISE EXCEPTION '活動資料來源還沒開放';
  END IF;
  raw := public.live_event_metric(p_user, goal ->> 'metric', per.starts_at, per.ends_at);
  IF raw - entry.baseline < (goal ->> 'target')::integer THEN
    RAISE EXCEPTION '活動目標還沒完成';
  END IF;
  UPDATE public.member_live_event_entries SET claimed_at = p_now
  WHERE user_id = p_user AND event_id = p_event_id AND period_key = per.period_key;
  RETURN public.live_event_state(p_user, p_now) || jsonb_build_object('claimed', jsonb_build_object('eventId', p_event_id, 'periodKey', per.period_key));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_live_events()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN public.live_event_state(auth.uid(), now());
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_my_live_event(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN public.live_event_claim(auth.uid(), p_event_id, now());
END;
$$;

REVOKE ALL ON FUNCTION public.live_event_period(text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_event_available(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_event_metric(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_event_state(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_event_claim(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_live_events() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_my_live_event(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_live_events() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_my_live_event(text) TO authenticated;

DO $live_self_check$
DECLARE
  bad text;
  def text := pg_get_functiondef('public.live_event_claim(uuid, text, timestamptz)'::regprocedure);
BEGIN
  IF (SELECT count(*) FROM public.game_live_events WHERE active AND cadence = 'festival') < 27 THEN
    RAISE EXCEPTION '27 種節慶都要有限定活動';
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_live_events WHERE pay_points <> 0) THEN
    RAISE EXCEPTION '活動不可發 Pay 點數';
  END IF;
  IF position('member_point' IN def) > 0 OR position('post_member_reward' IN def) > 0 THEN
    RAISE EXCEPTION '活動領取不可碰點數';
  END IF;
  SELECT string_agg(x.event_id || '@' || x.at::text, ', ') INTO bad
  FROM (VALUES
${expectations}
  ) AS x(event_id, at, want_key, want_variant)
  LEFT JOIN LATERAL public.live_event_period(x.event_id, x.at) AS p ON true
  WHERE p.period_key IS DISTINCT FROM x.want_key OR (x.want_key IS NOT NULL AND p.variant <> x.want_variant);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '資料庫期別和前端不一致：%', bad;
  END IF;
END
$live_self_check$;

COMMIT;
`

writeFileSync(OUT, sql)
console.log(`wrote ${OUT}: ${LIVE_EVENTS.length} events, ${windows.split('\n').length} festival windows`)
