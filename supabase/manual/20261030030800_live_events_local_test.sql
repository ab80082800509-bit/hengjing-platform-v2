-- 只給本機隔離 Supabase 使用，不可在正式庫執行。
-- 由 scripts/run-live-events-local-test.mjs 組合：BEGIN；前置本體；活動 SQL；本檔；ROLLBACK。

CREATE FUNCTION pg_temp.as_member(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END
$$;

CREATE FUNCTION pg_temp.ok(label text, cond boolean, detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL %: %', label, detail;
  END IF;
  RAISE NOTICE 'PASS %', label;
END
$$;

CREATE FUNCTION pg_temp.fails(label text, stmt text, want text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  msg text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    msg := SQLERRM;
  END;
  IF msg IS NULL OR position(want IN msg) = 0 THEN
    RAISE EXCEPTION 'FAIL %: got %', label, coalesce(msg, '沒有錯誤');
  END IF;
  RAISE NOTICE 'PASS %', label;
END
$$;

CREATE FUNCTION pg_temp.ev(s jsonb, p_id text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(s -> 'events') AS t(e) WHERE e ->> 'eventId' = p_id
$$;

CREATE FUNCTION pg_temp.merge_events(p_user uuid, p_type text, p_n integer, p_at timestamptz) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('merge.internal', 'on', true);
  INSERT INTO public.member_merge_shop_events (user_id, action_key, action_type, revision_after, result, created_at)
  SELECT p_user, gen_random_uuid()::text, p_type, 1, '{}'::jsonb, p_at FROM generate_series(1, p_n);
  PERFORM set_config('merge.internal', 'off', true);
END
$$;

RESET ROLE;
DO $$
DECLARE
  a uuid := 'aaaaaaaa-0000-4000-8000-0000000000c1';
  t timestamptz := '2026-10-29 15:00:00+08';
  s jsonb;
  w jsonb;
  need integer;
BEGIN
  s := public.live_event_state(a, t);
  PERFORM pg_temp.ok('台北時間期別', pg_temp.ev(s, 'merge_weekly_rush') ->> 'periodKey' = 'w:2026-10-26'
    AND pg_temp.ev(s, 'merge_daily_errand') ->> 'periodKey' = 'd:2026-10-29'
    AND pg_temp.ev(s, 'street_monthly_fair') ->> 'periodKey' = 'm:2026-10'
    AND pg_temp.ev(s, 'season_street_parade') ->> 'periodKey' = 's:2026-autumn', s::text);
  PERFORM pg_temp.ok('萬聖節期間才有萬聖節活動、聖誕活動不出現', pg_temp.ev(s, 'fest_halloween') IS NOT NULL AND pg_temp.ev(s, 'fest_christmas_block') IS NULL);
  PERFORM pg_temp.ok('活動不帶 Pay 點數欄位', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s -> 'events') e WHERE e ? 'payPoints' AND (e ->> 'payPoints')::int <> 0));

  w := pg_temp.ev(s, 'merge_weekly_rush');
  need := (w ->> 'target')::int;
  PERFORM pg_temp.merge_events(a, CASE w ->> 'metric' WHEN 'merge.orders' THEN 'serve' ELSE 'merge' END, need - 1, t - interval '1 hour');
  PERFORM pg_temp.merge_events(a, CASE w ->> 'metric' WHEN 'merge.orders' THEN 'serve' ELSE 'merge' END, 5, '2026-10-25 23:00:00+08');
  PERFORM pg_temp.ok('只算這一期（台北週一 00:00 起）', (pg_temp.ev(public.live_event_state(a, t), 'merge_weekly_rush') ->> 'progress')::int = need - 1);
END $$;

SELECT pg_temp.fails('目標未達不能領', $q$SELECT public.live_event_claim('aaaaaaaa-0000-4000-8000-0000000000c1', 'merge_weekly_rush', '2026-10-29 15:00:00+08')$q$, '活動目標還沒完成');
DO $$
DECLARE
  a uuid := 'aaaaaaaa-0000-4000-8000-0000000000c1';
  t timestamptz := '2026-10-29 15:00:00+08';
  w jsonb := pg_temp.ev(public.live_event_state(a, t), 'merge_weekly_rush');
  s jsonb;
BEGIN
  PERFORM pg_temp.merge_events(a, CASE w ->> 'metric' WHEN 'merge.orders' THEN 'serve' ELSE 'merge' END, 1, t - interval '1 minute');
  s := public.live_event_claim(a, 'merge_weekly_rush', t);
  PERFORM pg_temp.ok('達標可領取並留下永久紀錄', (pg_temp.ev(s, 'merge_weekly_rush') ->> 'claimed')::boolean
    AND (s -> 'records' -> 0 ->> 'eventId') = 'merge_weekly_rush' AND (s -> 'records' -> 0 ->> 'periodKey') = 'w:2026-10-26', s::text);
END $$;
SELECT pg_temp.fails('同一期不能重複領', $q$SELECT public.live_event_claim('aaaaaaaa-0000-4000-8000-0000000000c1', 'merge_weekly_rush', '2026-10-31 20:00:00+08')$q$, '已經領過');
DO $$
DECLARE
  a uuid := 'aaaaaaaa-0000-4000-8000-0000000000c1';
  s jsonb := public.live_event_state(a, '2026-11-02 00:00:00+08');
BEGIN
  PERFORM pg_temp.ok('下週一 00:00 自動換期、可再挑戰', pg_temp.ev(s, 'merge_weekly_rush') ->> 'periodKey' = 'w:2026-11-02'
    AND NOT (pg_temp.ev(s, 'merge_weekly_rush') ->> 'claimed')::boolean AND (pg_temp.ev(s, 'merge_weekly_rush') ->> 'progress')::int = 0);
  PERFORM pg_temp.ok('舊紀錄保留', EXISTS (SELECT 1 FROM jsonb_array_elements(s -> 'records') r WHERE r ->> 'periodKey' = 'w:2026-10-26'));
  PERFORM pg_temp.ok('輪替內容換下一種', (pg_temp.ev(s, 'merge_weekly_rush') ->> 'variant')::int <> (SELECT variant FROM public.member_live_event_entries WHERE user_id = a AND event_id = 'merge_weekly_rush' AND period_key = 'w:2026-10-26'));
END $$;

-- 商店街：以加入活動時的雲端存檔為起點，之前累積的客人不算。
DO $$
DECLARE
  b uuid := 'bbbbbbbb-0000-4000-8000-0000000000c2';
  t timestamptz := '2026-10-29 10:00:00+08';
  s jsonb;
  goal jsonb;
BEGIN
  INSERT INTO public.member_street_saves (user_id, progress, coins, xp, shop_level, import_source, last_request_key)
  VALUES (b, '{"v":3,"stats":{"served":300,"earned":9000}}', 0, 0, 2, 'fresh', gen_random_uuid());
  s := public.live_event_state(b, t);
  goal := pg_temp.ev(s, 'street_daily_rounds');
  PERFORM pg_temp.ok('商店街舊累積不算進這一期', (goal ->> 'progress')::int = 0, goal::text);
  UPDATE public.member_street_saves
  SET progress = jsonb_build_object('v', 3, 'stats', jsonb_build_object('served', 300 + 25, 'earned', 9000 + 900))
  WHERE user_id = b;
  goal := pg_temp.ev(public.live_event_state(b, t + interval '2 hours'), 'street_daily_rounds');
  PERFORM pg_temp.ok('商店街這一期的進度', (goal ->> 'progress')::int = (goal ->> 'target')::int, goal::text);
  PERFORM pg_temp.ok('商店街每日活動可領', (pg_temp.ev(public.live_event_claim(b, 'street_daily_rounds', t + interval '2 hours'), 'street_daily_rounds') ->> 'claimed')::boolean);
  PERFORM pg_temp.ok('隔天 00:00 台北時間換新一天', pg_temp.ev(public.live_event_state(b, '2026-10-30 00:00:00+08'), 'street_daily_rounds') ->> 'periodKey' = 'd:2026-10-30');
END $$;

-- 節慶：聖誕期間方塊活動只算期間內 verified 排行賽；期間外不能領。
DO $$
DECLARE
  c uuid := 'cccccccc-0000-4000-8000-0000000000c3';
  t timestamptz := '2026-12-24 20:00:00+08';
  s jsonb;
BEGIN
  INSERT INTO public.block_ranked_runs (user_id, seed, week_start, status, submitted_at, move_log, score, lines, best_combo, moves)
  VALUES (c, 7, '2026-12-21', 'rejected', t - interval '1 hour', '[]', 9000, 0, 0, 1),
         (c, 8, '2026-12-14', 'verified', '2026-12-18 12:00:00+08', '[]', 1200, 4, 1, 20);
  s := public.live_event_state(c, t);
  PERFORM pg_temp.ok('聖誕期間出現聖誕活動', pg_temp.ev(s, 'fest_christmas_block') ->> 'periodKey' = 'f:christmas:2026-12-20' AND (pg_temp.ev(s, 'fest_christmas_block') ->> 'progress')::int = 0, coalesce(pg_temp.ev(s, 'fest_christmas_block')::text, 'none'));
  INSERT INTO public.block_ranked_runs (user_id, seed, week_start, status, submitted_at, move_log, score, lines, best_combo, moves)
  VALUES (c, 9, '2026-12-21', 'verified', t - interval '30 minutes', '[]', 2100, 9, 2, 30);
  s := public.live_event_claim(c, 'fest_christmas_block', t);
  PERFORM pg_temp.ok('節慶活動完成留下限定收藏', EXISTS (SELECT 1 FROM jsonb_array_elements(s -> 'records') r WHERE r ->> 'eventId' = 'fest_christmas_block' AND r ->> 'medal' = 'ic-trophy'));
  PERFORM pg_temp.ok('節慶結束後收藏仍在', EXISTS (SELECT 1 FROM jsonb_array_elements(public.live_event_state(c, '2027-01-15 12:00:00+08') -> 'records') r WHERE r ->> 'eventId' = 'fest_christmas_block')
    AND pg_temp.ev(public.live_event_state(c, '2027-01-15 12:00:00+08'), 'fest_christmas_block') IS NULL);
  PERFORM pg_temp.ok('隔年聖誕自動再開新的一期', pg_temp.ev(public.live_event_state(c, '2027-12-24 12:00:00+08'), 'fest_christmas_block') ->> 'periodKey' = 'f:christmas:2027-12-20');
  PERFORM pg_temp.ok('領取沒有刪掉排行賽紀錄', (SELECT count(*) FROM public.block_ranked_runs WHERE user_id = c) = 3);
END $$;
SELECT pg_temp.fails('節慶期間外不能領', $q$SELECT public.live_event_claim('cccccccc-0000-4000-8000-0000000000c3', 'fest_christmas_block', '2027-01-15 12:00:00+08')$q$, '活動不在進行期間');
SELECT pg_temp.fails('不存在的活動', $q$SELECT public.live_event_claim('cccccccc-0000-4000-8000-0000000000c3', 'nope_event', '2026-12-24 12:00:00+08')$q$, '活動不在進行期間');

-- 四種週期的台北時間邊界。同一瞬間用 UTC 或 +08 寫，期別必須相同。
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s got %s', x.label, coalesce(p.period_key, 'null')), ', ')
  INTO bad
  FROM (VALUES
    ('午夜前每日', 'merge_daily_errand', TIMESTAMPTZ '2026-10-29 23:59:59+08', 'd:2026-10-29'),
    ('午夜後每日', 'merge_daily_errand', TIMESTAMPTZ '2026-10-30 00:00:00+08', 'd:2026-10-30'),
    ('UTC 16:00 是台北次日', 'merge_daily_errand', TIMESTAMPTZ '2026-10-29 16:00:00+00', 'd:2026-10-30'),
    ('跨週前', 'merge_weekly_rush', TIMESTAMPTZ '2026-11-01 23:59:59+08', 'w:2026-10-26'),
    ('跨週後', 'block_weekly_cup', TIMESTAMPTZ '2026-11-02 00:00:00+08', 'w:2026-11-02'),
    ('跨月前', 'street_monthly_fair', TIMESTAMPTZ '2026-10-31 23:59:59+08', 'm:2026-10'),
    ('跨月後', 'street_monthly_fair', TIMESTAMPTZ '2026-11-01 00:00:00+08', 'm:2026-11'),
    ('跨年前每日', 'merge_daily_errand', TIMESTAMPTZ '2026-12-31 23:59:59+08', 'd:2026-12-31'),
    ('跨年後每日', 'merge_daily_errand', TIMESTAMPTZ '2027-01-01 00:00:00+08', 'd:2027-01-01'),
    ('跨年月', 'street_monthly_fair', TIMESTAMPTZ '2027-01-01 00:00:00+08', 'm:2027-01'),
    ('跨年仍屬原週', 'merge_weekly_rush', TIMESTAMPTZ '2027-01-01 00:00:00+08', 'w:2026-12-28'),
    ('跨年後新週', 'merge_weekly_rush', TIMESTAMPTZ '2027-01-04 00:00:00+08', 'w:2027-01-04'),
    ('冬末', 'season_street_parade', TIMESTAMPTZ '2027-02-28 23:59:59+08', 's:2026-winter'),
    ('春始', 'season_street_parade', TIMESTAMPTZ '2027-03-01 00:00:00+08', 's:2027-spring'),
    ('春末', 'season_street_parade', TIMESTAMPTZ '2027-05-31 23:59:59+08', 's:2027-spring'),
    ('夏始', 'season_street_parade', TIMESTAMPTZ '2027-06-01 00:00:00+08', 's:2027-summer'),
    ('夏末', 'season_street_parade', TIMESTAMPTZ '2027-08-31 23:59:59+08', 's:2027-summer'),
    ('秋始', 'season_street_parade', TIMESTAMPTZ '2027-09-01 00:00:00+08', 's:2027-autumn'),
    ('秋末', 'season_street_parade', TIMESTAMPTZ '2027-11-30 23:59:59+08', 's:2027-autumn'),
    ('冬始', 'season_street_parade', TIMESTAMPTZ '2027-12-01 00:00:00+08', 's:2027-winter'),
    ('一月仍是上一年冬季', 'season_street_parade', TIMESTAMPTZ '2027-01-15 12:00:00+08', 's:2026-winter')
  ) AS x(label, event_id, at, want)
  LEFT JOIN LATERAL public.live_event_period(x.event_id, x.at) AS p ON true
  WHERE p.period_key IS DISTINCT FROM x.want;
  PERFORM pg_temp.ok('四種週期的台北時間邊界', bad IS NULL, coalesce(bad, ''));
END $$;

DO $$
DECLARE
  a uuid := 'aaaaaaaa-0000-4000-8000-0000000000c1';
  t timestamptz := '2026-10-29 15:00:00+08';
  v1 integer;
  v2 integer;
  n integer;
BEGIN
  v1 := (pg_temp.ev(public.live_event_state(a, t), 'merge_daily_errand') ->> 'variant')::integer;
  v2 := (pg_temp.ev(public.live_event_state(a, t), 'merge_daily_errand') ->> 'variant')::integer;
  SELECT count(*) INTO n FROM public.member_live_event_entries
  WHERE user_id = a AND event_id = 'merge_daily_errand' AND period_key = 'd:2026-10-29';
  PERFORM pg_temp.ok('同一期重讀不換題、不重複建檔', v1 = v2 AND n = 1, format('variant %s rows %s', v1, n));
END $$;

-- 商店街跨日再領：新的一天可以領，昨天的紀錄留下，金幣、經驗、等級不被清掉。
DO $$
DECLARE
  b uuid := 'bbbbbbbb-0000-4000-8000-0000000000c2';
  t timestamptz := '2026-10-30 12:00:00+08';
  goal jsonb;
  s jsonb;
  stat text;
  base integer;
BEGIN
  goal := pg_temp.ev(public.live_event_state(b, t), 'street_daily_rounds');
  stat := CASE goal ->> 'metric' WHEN 'street.earned' THEN 'earned' ELSE 'served' END;
  base := coalesce((SELECT (progress #>> ARRAY['stats', stat])::integer FROM public.member_street_saves WHERE user_id = b), 0);
  UPDATE public.member_street_saves
  SET progress = jsonb_set(progress, ARRAY['stats', stat], to_jsonb(base + (goal ->> 'target')::integer))
  WHERE user_id = b;
  s := public.live_event_claim(b, 'street_daily_rounds', t);
  PERFORM pg_temp.ok('跨日後可領新的一天且昨天紀錄還在',
    (pg_temp.ev(s, 'street_daily_rounds') ->> 'claimed')::boolean
    AND (pg_temp.ev(s, 'street_daily_rounds') ->> 'periodKey') = 'd:2026-10-30'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(s -> 'records') r WHERE r ->> 'periodKey' = 'd:2026-10-29')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(s -> 'records') r WHERE r ->> 'periodKey' = 'd:2026-10-30'), s::text);
  PERFORM pg_temp.ok('換期領取沒有清商店街金幣經驗等級',
    (SELECT coins = 0 AND xp = 0 AND shop_level = 2 FROM public.member_street_saves WHERE user_id = b));
END $$;
SELECT pg_temp.fails('新的一天領過後不能再領', $q$SELECT public.live_event_claim('bbbbbbbb-0000-4000-8000-0000000000c2', 'street_daily_rounds', '2026-10-30 18:00:00+08')$q$, '已經領過');

-- 會員權限：只能用 get/claim 兩個入口，不能改時間、不能直接寫表。
SELECT pg_temp.as_member('aaaaaaaa-0000-4000-8000-0000000000c1');
SELECT pg_temp.ok('會員可讀活動', jsonb_array_length(public.get_my_live_events() -> 'events') >= 6);
SELECT pg_temp.fails('會員不能指定時間', $q$SELECT public.live_event_state('aaaaaaaa-0000-4000-8000-0000000000c1', now())$q$, 'permission denied');
SELECT pg_temp.fails('會員不能直接寫活動紀錄', $q$INSERT INTO public.member_live_event_entries (user_id, event_id, period_key, variant, claimed_at) VALUES ('aaaaaaaa-0000-4000-8000-0000000000c1', 'fest_christmas_block', 'f:christmas:2030-12-20', 0, now())$q$, 'permission denied');
SELECT pg_temp.fails('會員不能改活動目錄', $q$UPDATE public.game_live_events SET variants = '[{"metric":"merge.orders","target":0}]'$q$, 'permission denied');
SELECT pg_temp.fails('未達標的會員領取被拒', $q$SELECT public.claim_my_live_event('street_monthly_fair')$q$, '活動目標還沒完成');
RESET ROLE;
SELECT pg_temp.ok('活動目錄 pay_points 全為 0', NOT EXISTS (SELECT 1 FROM public.game_live_events WHERE pay_points <> 0));
SELECT pg_temp.fails('不能把活動改成發點數', $q$UPDATE public.game_live_events SET pay_points = 10 WHERE id = 'merge_weekly_rush'$q$, 'check constraint');
SELECT pg_temp.ok('會員讀取用資料庫現在時間', position('live_event_state(auth.uid(), now())' in pg_get_functiondef('public.get_my_live_events()'::regprocedure)) > 0);
SELECT pg_temp.ok('會員領取用資料庫現在時間', position('live_event_claim(auth.uid(), p_event_id, now())' in pg_get_functiondef('public.claim_my_live_event(text)'::regprocedure)) > 0);
SELECT pg_temp.ok('領取有交易鎖', position('pg_advisory_xact_lock' in pg_get_functiondef('public.live_event_claim(uuid,text,timestamptz)'::regprocedure)) > 0);
SELECT pg_temp.ok('活動函式不改寫遊戲存檔或點數帳',
  position('UPDATE public.member_street_saves' in pg_get_functiondef('public.live_event_state(uuid,timestamptz)'::regprocedure)) = 0
  AND position('UPDATE public.member_street_saves' in pg_get_functiondef('public.live_event_claim(uuid,text,timestamptz)'::regprocedure)) = 0
  AND position('member_merge_shops' in pg_get_functiondef('public.live_event_claim(uuid,text,timestamptz)'::regprocedure)) = 0
  AND position('member_point_entries' in pg_get_functiondef('public.live_event_claim(uuid,text,timestamptz)'::regprocedure)) = 0
  AND position('member_point_accounts' in pg_get_functiondef('public.live_event_state(uuid,timestamptz)'::regprocedure)) = 0);
