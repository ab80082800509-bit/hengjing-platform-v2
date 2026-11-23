-- =============================================================================
-- 第四、第五階段第二批每日簽到預演
-- 與正式 migration 的函式本文必須相同。整份在同一個交易內，結尾 ROLLBACK。
-- 不會留下函式、點數或簽到紀錄。帳本已有資料時會停止，不會在既有餘額上試算。
-- =============================================================================

BEGIN;

-- daily-checkin-body-start

CREATE OR REPLACE FUNCTION public.checkin_cycle_from_days(p_days date[], p_today date)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  days date[];
  latest date;
  run_end date;
  cursor date;
  run_length integer := 0;
  next_index integer;
  cycle_day integer;
  rewards integer[] := ARRAY[10, 10, 15, 15, 20, 20, 50];
  claim_delta integer;
  checked_days integer;
BEGIN
  IF p_today IS NULL THEN
    RAISE EXCEPTION '無法計算台北日期';
  END IF;

  SELECT coalesce(array_agg(cleaned.day ORDER BY cleaned.day), ARRAY[]::date[])
  INTO days
  FROM (
    SELECT DISTINCT raw_day AS day
    FROM unnest(coalesce(p_days, ARRAY[]::date[])) AS raw_day
    WHERE raw_day IS NOT NULL
      AND raw_day <= p_today
  ) AS cleaned;

  IF coalesce(cardinality(days), 0) = 0 THEN
    RETURN jsonb_build_object(
      'checkedToday', false,
      'checkedDays', 0,
      'nextDelta', 10,
      'todayDelta', NULL,
      'claimDelta', 10,
      'claimCycleDay', 1
    );
  END IF;

  latest := days[cardinality(days)];
  IF latest = p_today THEN
    run_end := p_today;
  ELSIF latest = (p_today - 1) THEN
    run_end := latest;
  ELSE
    RETURN jsonb_build_object(
      'checkedToday', false,
      'checkedDays', 0,
      'nextDelta', 10,
      'todayDelta', NULL,
      'claimDelta', 10,
      'claimCycleDay', 1
    );
  END IF;

  cursor := run_end;
  WHILE cursor = ANY (days) LOOP
    run_length := run_length + 1;
    cursor := cursor - 1;
  END LOOP;

  IF latest = p_today THEN
    cycle_day := ((run_length - 1) % 7) + 1;
    claim_delta := rewards[cycle_day];
    RETURN jsonb_build_object(
      'checkedToday', true,
      'checkedDays', cycle_day,
      'nextDelta', NULL,
      'todayDelta', claim_delta,
      'claimDelta', claim_delta,
      'claimCycleDay', cycle_day
    );
  END IF;

  next_index := run_length % 7;
  IF next_index = 0 THEN
    checked_days := 0;
    cycle_day := 1;
  ELSE
    checked_days := next_index;
    cycle_day := next_index + 1;
  END IF;
  claim_delta := rewards[cycle_day];
  RETURN jsonb_build_object(
    'checkedToday', false,
    'checkedDays', checked_days,
    'nextDelta', claim_delta,
    'todayDelta', NULL,
    'claimDelta', claim_delta,
    'claimCycleDay', cycle_day
  );
END;
$$;

COMMENT ON FUNCTION public.checkin_cycle_from_days(date[], date) IS
  '由簽到日期計算七日循環。不讀表、不發獎。中斷一天，或剛完成第 7 天，下一次都從第 1 天 10 點開始。呼叫端的今天必須是資料庫台北日。';

CREATE OR REPLACE FUNCTION public.build_my_checkin_state(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  day date := public.taipei_today();
  days date[];
  progress jsonb;
  bal integer := 0;
  entries jsonb;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;

  SELECT balance
  INTO bal
  FROM public.member_point_accounts
  WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    bal := 0;
  END IF;

  SELECT coalesce(array_agg(claims.taipei_day ORDER BY claims.taipei_day), ARRAY[]::date[])
  INTO days
  FROM (
    SELECT DISTINCT taipei_day
    FROM public.reward_claims
    WHERE user_id = p_user_id
      AND kind = 'checkin'
  ) AS claims;

  progress := public.checkin_cycle_from_days(days, day);

  WITH marked AS (
    SELECT
      e.id,
      e.delta,
      e.taipei_day,
      e.created_at,
      e.taipei_day - (ROW_NUMBER() OVER (ORDER BY e.taipei_day))::integer AS grp
    FROM public.member_point_entries e
    WHERE e.user_id = p_user_id
      AND e.kind = 'checkin'
  ),
  positioned AS (
    SELECT
      id,
      delta,
      taipei_day,
      created_at,
      ((ROW_NUMBER() OVER (PARTITION BY grp ORDER BY taipei_day) - 1) % 7) + 1 AS cycle_day
    FROM marked
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', recent.id,
      'delta', recent.delta,
      'at', to_char(recent.taipei_day, 'YYYY-MM-DD'),
      'label', '每日簽到（第 ' || recent.cycle_day::text || ' 天）'
    )
    ORDER BY recent.taipei_day DESC, recent.created_at DESC
  ), '[]'::jsonb)
  INTO entries
  FROM (
    SELECT id, delta, taipei_day, created_at, cycle_day
    FROM positioned
    ORDER BY taipei_day DESC, created_at DESC
    LIMIT 400
  ) AS recent;

  RETURN progress || jsonb_build_object(
    'balance', bal,
    'taipeiDay', to_char(day, 'YYYY-MM-DD'),
    'entries', entries
  );
END;
$$;

COMMENT ON FUNCTION public.build_my_checkin_state(uuid) IS
  '組出一位會員的簽到狀態。不授權給 API。入口函式只會傳入 auth.uid()。';

CREATE OR REPLACE FUNCTION public.get_my_checkin_state()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN public.build_my_checkin_state(uid);
END;
$$;

COMMENT ON FUNCTION public.get_my_checkin_state() IS
  '登入會員讀取自己的點數餘額、資料庫台北日、連續簽到進度與簽到紀錄。不發獎。';

CREATE OR REPLACE FUNCTION public.claim_my_daily_checkin()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date;
  days date[];
  progress jsonb;
  stored_delta integer;
  claim_delta integer;
  posted jsonb;
  state jsonb;
  locked uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reward-checkin:' || uid::text, 0));

  INSERT INTO public.member_point_accounts (user_id)
  VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT user_id
  INTO locked
  FROM public.member_point_accounts
  WHERE user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '無法鎖定點數帳戶';
  END IF;

  day := public.taipei_today();

  SELECT coalesce(array_agg(claims.taipei_day ORDER BY claims.taipei_day), ARRAY[]::date[])
  INTO days
  FROM (
    SELECT DISTINCT taipei_day
    FROM public.reward_claims
    WHERE user_id = uid
      AND kind = 'checkin'
  ) AS claims;

  progress := public.checkin_cycle_from_days(days, day);

  SELECT delta
  INTO stored_delta
  FROM public.reward_claims
  WHERE user_id = uid
    AND kind = 'checkin'
    AND taipei_day = day;

  IF stored_delta IS NOT NULL THEN
    claim_delta := stored_delta;
  ELSE
    claim_delta := (progress->>'claimDelta')::integer;
  END IF;

  PERFORM set_config('app.reward_post', 'on', true);

  BEGIN
    posted := public.post_member_reward(
      uid,
      'checkin',
      'checkin:' || to_char(day, 'YYYY-MM-DD'),
      claim_delta,
      jsonb_build_object('cycleDay', (progress->>'claimCycleDay')::integer)
    );
  EXCEPTION
    WHEN unique_violation THEN
      posted := NULL;
  END;

  state := public.build_my_checkin_state(uid);

  IF posted IS NULL THEN
    IF (state->>'checkedToday')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION '簽到沒有成功，點數沒有增加';
    END IF;
    RETURN state || jsonb_build_object(
      'replayed', true,
      'awardedDelta', (state->>'todayDelta')::integer
    );
  END IF;

  IF (posted->>'currentBalance')::integer IS DISTINCT FROM (state->>'balance')::integer THEN
    RAISE EXCEPTION '點數餘額與流水不一致';
  END IF;

  RETURN state || jsonb_build_object(
    'replayed', (posted->>'replayed')::boolean,
    'awardedDelta', (posted->>'delta')::integer
  );
END;
$$;

COMMENT ON FUNCTION public.claim_my_daily_checkin() IS
  '登入會員的每日簽到。先鎖這位會員，再用資料庫台北日與既有簽到紀錄決定點數，最後呼叫第一批內部發獎。沒有參數。重複請求回放原領獎。';

REVOKE ALL ON FUNCTION public.checkin_cycle_from_days(date[], date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_my_checkin_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_checkin_state() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_my_daily_checkin() FROM PUBLIC, anon, authenticated;

DO $revoke_checkin_service$
DECLARE
  fn text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RETURN;
  END IF;
  FOREACH fn IN ARRAY ARRAY[
    'public.checkin_cycle_from_days(date[], date)',
    'public.build_my_checkin_state(uuid)',
    'public.get_my_checkin_state()',
    'public.claim_my_daily_checkin()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', fn);
  END LOOP;
END
$revoke_checkin_service$;

GRANT EXECUTE ON FUNCTION public.get_my_checkin_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_my_daily_checkin() TO authenticated;

DO $daily_checkin_check$
DECLARE
  progress jsonb;
  claim_def text := pg_get_functiondef('public.claim_my_daily_checkin()'::regprocedure);
  read_def text := pg_get_functiondef('public.get_my_checkin_state()'::regprocedure);
  actor text;
  fn text;
  actors text[] := ARRAY['anon', 'authenticated'];
BEGIN
  IF to_regprocedure('public.post_member_reward(uuid, text, text, integer, jsonb)') IS NULL THEN
    RAISE EXCEPTION '第二批需要已套用的第一批 post_member_reward';
  END IF;
  IF to_regprocedure('public.taipei_today(timestamptz)') IS NULL THEN
    RAISE EXCEPTION '第二批需要已套用的台北日函式';
  END IF;
  IF public.taipei_today('2026-10-22 15:59:59+00'::timestamptz) <> DATE '2026-10-22' THEN
    RAISE EXCEPTION '台北日在 23:59 不應換日';
  END IF;
  IF public.taipei_today('2026-10-22 16:00:00+00'::timestamptz) <> DATE '2026-10-23' THEN
    RAISE EXCEPTION '台北日應在 UTC 16:00 換到下一天';
  END IF;

  progress := public.checkin_cycle_from_days(ARRAY[]::date[], DATE '2026-10-22');
  IF (progress->>'claimDelta')::integer IS DISTINCT FROM 10
     OR (progress->>'checkedDays')::integer IS DISTINCT FROM 0
     OR (progress->>'checkedToday')::boolean IS DISTINCT FROM false
     OR (progress->>'claimCycleDay')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '首次簽到應從第 1 天 10 點開始';
  END IF;

  progress := public.checkin_cycle_from_days(ARRAY[DATE '2026-10-20', DATE '2026-10-21']::date[], DATE '2026-10-22');
  IF (progress->>'checkedToday')::boolean IS DISTINCT FROM false
     OR (progress->>'checkedDays')::integer IS DISTINCT FROM 2
     OR (progress->>'claimDelta')::integer IS DISTINCT FROM 15
     OR (progress->>'claimCycleDay')::integer IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '連續兩天後下一次應是第 3 天 15 點';
  END IF;

  progress := public.checkin_cycle_from_days(ARRAY[DATE '2026-10-20']::date[], DATE '2026-10-22');
  IF (progress->>'checkedDays')::integer IS DISTINCT FROM 0
     OR (progress->>'claimDelta')::integer IS DISTINCT FROM 10
     OR (progress->>'claimCycleDay')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '中斷後應從第 1 天重新計算';
  END IF;

  progress := public.checkin_cycle_from_days(
    ARRAY[DATE '2026-10-16', DATE '2026-10-17', DATE '2026-10-18', DATE '2026-10-19', DATE '2026-10-20', DATE '2026-10-21']::date[],
    DATE '2026-10-22'
  );
  IF (progress->>'checkedDays')::integer IS DISTINCT FROM 6
     OR (progress->>'claimDelta')::integer IS DISTINCT FROM 50
     OR (progress->>'claimCycleDay')::integer IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION '滿六天後下一次應是第 7 天 50 點';
  END IF;

  progress := public.checkin_cycle_from_days(
    ARRAY[DATE '2026-10-15', DATE '2026-10-16', DATE '2026-10-17', DATE '2026-10-18', DATE '2026-10-19', DATE '2026-10-20', DATE '2026-10-21']::date[],
    DATE '2026-10-22'
  );
  IF (progress->>'checkedDays')::integer IS DISTINCT FROM 0
     OR (progress->>'claimDelta')::integer IS DISTINCT FROM 10
     OR (progress->>'claimCycleDay')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '完成七日後下一次應從第 1 天 10 點重新計算';
  END IF;

  progress := public.checkin_cycle_from_days(
    ARRAY[DATE '2026-10-14', DATE '2026-10-15', DATE '2026-10-16', DATE '2026-10-17', DATE '2026-10-18', DATE '2026-10-19', DATE '2026-10-20', DATE '2026-10-21']::date[],
    DATE '2026-10-22'
  );
  IF (progress->>'checkedDays')::integer IS DISTINCT FROM 1
     OR (progress->>'claimDelta')::integer IS DISTINCT FROM 10
     OR (progress->>'claimCycleDay')::integer IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION '連續八天後下一次應是第 2 天 10 點';
  END IF;

  progress := public.checkin_cycle_from_days(ARRAY[DATE '2026-10-22', DATE '2026-10-22', DATE '2026-10-23']::date[], DATE '2026-10-22');
  IF (progress->>'checkedToday')::boolean IS DISTINCT FROM true
     OR (progress->>'checkedDays')::integer IS DISTINCT FROM 1
     OR (progress->>'todayDelta')::integer IS DISTINCT FROM 10
     OR progress->>'nextDelta' IS NOT NULL
     OR (progress->>'claimDelta')::integer IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '今天已簽到應停在第 1 天 10 點';
  END IF;

  progress := public.checkin_cycle_from_days(
    ARRAY[DATE '2026-10-16', DATE '2026-10-17', DATE '2026-10-18', DATE '2026-10-19', DATE '2026-10-20', DATE '2026-10-21', DATE '2026-10-22']::date[],
    DATE '2026-10-22'
  );
  IF (progress->>'checkedToday')::boolean IS DISTINCT FROM true
     OR (progress->>'checkedDays')::integer IS DISTINCT FROM 7
     OR (progress->>'todayDelta')::integer IS DISTINCT FROM 50
     OR progress->>'nextDelta' IS NOT NULL THEN
    RAISE EXCEPTION '連續七天且含今天應是第 7 天 50 點';
  END IF;

  IF pg_get_function_identity_arguments('public.claim_my_daily_checkin()'::regprocedure) <> '' THEN
    RAISE EXCEPTION '簽到入口不能接受參數';
  END IF;
  IF pg_get_function_identity_arguments('public.get_my_checkin_state()'::regprocedure) <> '' THEN
    RAISE EXCEPTION '簽到讀取不能接受參數';
  END IF;
  IF position('auth.uid()' IN claim_def) = 0 OR position('auth.uid()' IN read_def) = 0 THEN
    RAISE EXCEPTION '簽到必須使用 auth.uid()';
  END IF;
  IF position('p_user_id' IN claim_def) > 0 OR position('p_delta' IN claim_def) > 0 OR position('p_today' IN claim_def) > 0 THEN
    RAISE EXCEPTION '簽到入口不能接受會員、點數或日期參數';
  END IF;
  IF position('public.taipei_today()' IN claim_def) = 0 THEN
    RAISE EXCEPTION '簽到必須使用資料庫台北日';
  END IF;
  IF position('pg_advisory_xact_lock' IN claim_def) = 0 OR position('FOR UPDATE' IN claim_def) = 0 THEN
    RAISE EXCEPTION '簽到缺少交易鎖';
  END IF;
  IF position('app.reward_post' IN claim_def) = 0 OR position('set_config' IN claim_def) = 0 THEN
    RAISE EXCEPTION '簽到必須在交易內開啟內部發獎旗標';
  END IF;
  IF position('public.post_member_reward(' IN claim_def) = 0 THEN
    RAISE EXCEPTION '簽到必須呼叫第一批內部發獎';
  END IF;
  IF position('ARRAY[10, 10, 15, 15, 20, 20, 50]' IN pg_get_functiondef('public.checkin_cycle_from_days(date[], date)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '七日獎勵必須維持 10、10、15、15、20、20、50';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.claim_my_daily_checkin()'::regprocedure
      AND prosecdef
      AND provolatile = 'v'
  ) THEN
    RAISE EXCEPTION '簽到入口必須是 VOLATILE SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.get_my_checkin_state()'::regprocedure
      AND prosecdef
      AND provolatile = 'v'
  ) THEN
    RAISE EXCEPTION '簽到讀取必須是 VOLATILE SECURITY DEFINER';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.checkin_cycle_from_days(date[], date)'::regprocedure
      AND prosecdef
  ) THEN
    RAISE EXCEPTION '純計算函式不應提權';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    actors := array_append(actors, 'service_role');
  END IF;

  FOREACH fn IN ARRAY ARRAY[
    'public.checkin_cycle_from_days(date[], date)',
    'public.build_my_checkin_state(uuid)',
    'public.post_member_reward(uuid, text, text, integer, jsonb)'
  ]
  LOOP
    FOREACH actor IN ARRAY actors LOOP
      IF has_function_privilege(actor, fn, 'EXECUTE') THEN
        RAISE EXCEPTION '% 不應能執行 %', actor, fn;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT has_function_privilege('authenticated', 'public.claim_my_daily_checkin()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_my_checkin_state()', 'EXECUTE') THEN
    RAISE EXCEPTION '登入會員應能簽到並讀取自己的簽到狀態';
  END IF;
  IF has_function_privilege('anon', 'public.claim_my_daily_checkin()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_my_checkin_state()', 'EXECUTE') THEN
    RAISE EXCEPTION '匿名角色不能簽到或讀取簽到狀態';
  END IF;
  FOREACH actor IN ARRAY actors LOOP
    IF actor <> 'authenticated'
       AND (
         has_function_privilege(actor, 'public.claim_my_daily_checkin()', 'EXECUTE')
         OR has_function_privilege(actor, 'public.get_my_checkin_state()', 'EXECUTE')
       ) THEN
      RAISE EXCEPTION '% 不應能簽到或讀取簽到狀態', actor;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'reward_claims_one_checkin_per_taipei_day'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'member_point_entries_one_checkin_per_taipei_day'
  ) THEN
    RAISE EXCEPTION '缺少每日簽到唯一索引';
  END IF;
END
$daily_checkin_check$;

-- daily-checkin-body-end

-- 以下只在預演交易內寫入，最後會 ROLLBACK。不建立會員，也不留下點數。

DO $daily_checkin_preview_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.member_point_accounts)
     OR EXISTS (SELECT 1 FROM public.member_point_entries)
     OR EXISTS (SELECT 1 FROM public.reward_claims)
     OR EXISTS (SELECT 1 FROM public.member_visitor_links) THEN
    RAISE EXCEPTION '預演停止：帳本已經有資料。交易會回復，不會在既有餘額上試算。';
  END IF;
  IF (SELECT count(*) FROM auth.users) < 1 THEN
    RAISE EXCEPTION '預演停止：至少需要一位既有會員才能試算。交易會回復，不會建立會員。';
  END IF;
END
$daily_checkin_preview_guard$;

DO $daily_checkin_preview_claim$
DECLARE
  uid uuid;
  other uuid;
  posted jsonb;
  replay jsonb;
  account_balance integer;
  summed bigint;
BEGIN
  SELECT id INTO uid FROM auth.users ORDER BY id LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('app.reward_preview_user', uid::text, true);
  IF auth.uid() IS DISTINCT FROM uid THEN
    RAISE EXCEPTION '無法模擬 auth.uid()，簽到預演停止。交易會回復。';
  END IF;

  PERFORM set_config(
    'app.reward_preview_day',
    to_char(public.taipei_today(), 'YYYY-MM-DD'),
    true
  );

  posted := public.claim_my_daily_checkin();
  IF (posted->>'replayed')::boolean IS DISTINCT FROM false
     OR (posted->>'awardedDelta')::integer IS DISTINCT FROM 10
     OR (posted->>'balance')::integer IS DISTINCT FROM 10
     OR (posted->>'checkedToday')::boolean IS DISTINCT FROM true
     OR (posted->>'checkedDays')::integer IS DISTINCT FROM 1
     OR posted->>'taipeiDay' IS DISTINCT FROM to_char(public.taipei_today(), 'YYYY-MM-DD')
     OR jsonb_array_length(posted->'entries') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '第一次簽到沒有取得第 1 天 10 點';
  END IF;

  replay := public.claim_my_daily_checkin();
  IF (replay->>'replayed')::boolean IS DISTINCT FROM true
     OR (replay->>'balance')::integer IS DISTINCT FROM 10
     OR (SELECT count(*) FROM public.member_point_entries WHERE user_id = uid) IS DISTINCT FROM 1
     OR (SELECT count(*) FROM public.reward_claims WHERE user_id = uid) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '同一天再次簽到仍再入帳';
  END IF;

  SELECT a.balance INTO account_balance
  FROM public.member_point_accounts AS a
  WHERE a.user_id = uid;
  SELECT coalesce(sum(delta), 0) INTO summed FROM public.member_point_entries WHERE user_id = uid;
  IF account_balance IS DISTINCT FROM 10 OR summed IS DISTINCT FROM account_balance::bigint THEN
    RAISE EXCEPTION '帳戶餘額與點數流水不一致';
  END IF;

  SELECT id INTO other FROM auth.users WHERE id <> uid ORDER BY id LIMIT 1;
  IF other IS NULL THEN
    PERFORM set_config('app.reward_preview_other', '', true);
    RAISE NOTICE '只有一位既有會員，跨帳戶讀取留在預演後段跳過實呼，函式本身沒有 user_id 參數。';
  ELSE
    PERFORM set_config('app.reward_preview_other', other::text, true);
  END IF;
END
$daily_checkin_preview_claim$;

SET LOCAL ROLE authenticated;

DO $daily_checkin_preview_as_member$
DECLARE
  uid uuid := auth.uid();
  state jsonb;
  denied_post boolean := false;
  denied_table boolean := false;
BEGIN
  IF uid IS NULL OR uid::text IS DISTINCT FROM current_setting('app.reward_preview_user', true) THEN
    RAISE EXCEPTION '切換到一般會員後讀不到原本的 auth.uid()。交易會回復。';
  END IF;

  state := public.claim_my_daily_checkin();
  IF (state->>'replayed')::boolean IS DISTINCT FROM true
     OR (state->>'balance')::integer IS DISTINCT FROM 10
     OR (state->>'awardedDelta')::integer IS DISTINCT FROM 10
     OR jsonb_array_length(state->'entries') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '一般會員同一天再次簽到仍再入帳';
  END IF;

  state := public.get_my_checkin_state();
  IF (state->>'balance')::integer IS DISTINCT FROM 10
     OR (state->>'checkedToday')::boolean IS DISTINCT FROM true
     OR state->>'taipeiDay' IS DISTINCT FROM
        current_setting('app.reward_preview_day', true) THEN
    RAISE EXCEPTION '一般會員讀到的簽到狀態不正確';
  END IF;

  BEGIN
    PERFORM public.post_member_reward(uid, 'checkin', 'checkin:' || current_setting('app.reward_preview_day', true), 10, '{}'::jsonb);
    RAISE EXCEPTION '一般會員不應能直接發獎';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF position('post_member_reward' IN SQLERRM) = 0 THEN
        RAISE EXCEPTION '一般會員直接發獎的拒絕不是來自 post_member_reward：%', SQLERRM;
      END IF;
      denied_post := true;
  END;
  IF NOT denied_post THEN
    RAISE EXCEPTION '一般會員直接發獎時沒有被拒絕';
  END IF;

  BEGIN
    PERFORM 1 FROM public.member_point_accounts;
    RAISE EXCEPTION '一般會員不應能讀取點數表';
  EXCEPTION
    WHEN insufficient_privilege THEN
      denied_table := true;
  END;
  IF NOT denied_table THEN
    RAISE EXCEPTION '一般會員讀取點數表時沒有被拒絕';
  END IF;
END
$daily_checkin_preview_as_member$;

RESET ROLE;

DO $daily_checkin_preview_other$
DECLARE
  other text := current_setting('app.reward_preview_other', true);
  uid uuid;
  state jsonb;
BEGIN
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION '權限驗證後仍停在一般會員角色';
  END IF;
  IF other IS NULL OR other = '' THEN
    RAISE NOTICE '跨帳戶實測需要第二位既有會員。這次沒有改寫第一位會員以外的資料。';
    RETURN;
  END IF;

  SELECT id INTO uid FROM auth.users WHERE id::text = current_setting('app.reward_preview_user', true);
  PERFORM set_config('request.jwt.claim.sub', other, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  IF auth.uid()::text IS DISTINCT FROM other THEN
    RAISE EXCEPTION '無法模擬第二位會員的 auth.uid()。交易會回復。';
  END IF;
  IF auth.uid() = uid THEN
    RAISE EXCEPTION '跨帳戶測試仍停在第一位會員';
  END IF;

  state := public.get_my_checkin_state();
  IF (state->>'balance')::integer IS DISTINCT FROM 0
     OR jsonb_array_length(state->'entries') IS DISTINCT FROM 0
     OR (state->>'checkedToday')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION '第二位會員讀到了別人的點數或簽到紀錄';
  END IF;
  IF (SELECT balance FROM public.member_point_accounts WHERE user_id = uid) IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '讀取第二位會員時改到了第一位會員的餘額';
  END IF;
END
$daily_checkin_preview_other$;

SET LOCAL ROLE authenticated;

DO $daily_checkin_preview_other_role$
DECLARE
  other text := current_setting('app.reward_preview_other', true);
  state jsonb;
  denied boolean := false;
BEGIN
  IF other IS NULL OR other = '' THEN
    RETURN;
  END IF;
  IF auth.uid()::text IS DISTINCT FROM other THEN
    RAISE EXCEPTION '一般會員角色下的跨帳戶身分不正確';
  END IF;
  state := public.get_my_checkin_state();
  IF (state->>'balance')::integer IS DISTINCT FROM 0
     OR jsonb_array_length(state->'entries') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '一般會員角色仍讀到其他會員的點數';
  END IF;
  BEGIN
    state := public.claim_my_daily_checkin();
    IF (state->>'replayed')::boolean IS DISTINCT FROM false
       OR (state->>'balance')::integer IS DISTINCT FROM 10
       OR (state->>'awardedDelta')::integer IS DISTINCT FROM 10
       OR (state->>'checkedDays')::integer IS DISTINCT FROM 1
       OR jsonb_array_length(state->'entries') IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION '第二位會員的首次簽到結果不正確';
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      denied := true;
  END;
  IF denied THEN
    RAISE EXCEPTION '第二位一般會員應能簽到自己的帳戶';
  END IF;
END
$daily_checkin_preview_other_role$;

RESET ROLE;

SET LOCAL ROLE anon;

DO $daily_checkin_preview_anon$
DECLARE
  denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.claim_my_daily_checkin();
    RAISE EXCEPTION '匿名角色不應能簽到';
  EXCEPTION
    WHEN insufficient_privilege THEN
      denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION '匿名角色簽到時沒有被拒絕';
  END IF;
END
$daily_checkin_preview_anon$;

RESET ROLE;

DO $daily_checkin_preview_done$
DECLARE
  uid uuid;
  entries integer;
  summed bigint;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION '預演結束時仍不是管理者角色';
  END IF;
  SELECT id INTO uid FROM auth.users WHERE id::text = current_setting('app.reward_preview_user', true);
  SELECT count(*)::integer INTO entries FROM public.member_point_entries WHERE user_id = uid;
  SELECT coalesce(sum(delta), 0) INTO summed FROM public.member_point_entries WHERE user_id = uid;
  IF entries IS DISTINCT FROM 1
     OR summed IS DISTINCT FROM 10
     OR (SELECT balance FROM public.member_point_accounts WHERE user_id = uid) IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '預演結束時第一位會員的餘額與流水不一致';
  END IF;
  IF current_setting('app.reward_preview_other', true) <> '' THEN
    IF (SELECT balance FROM public.member_point_accounts WHERE user_id::text = current_setting('app.reward_preview_other', true)) IS DISTINCT FROM 10
       OR (SELECT count(*) FROM public.member_point_entries WHERE user_id::text = current_setting('app.reward_preview_other', true)) IS DISTINCT FROM 1
       OR (SELECT coalesce(sum(delta), 0) FROM public.member_point_entries WHERE user_id::text = current_setting('app.reward_preview_other', true)) IS DISTINCT FROM 10 THEN
      RAISE EXCEPTION '第二位會員的餘額與流水不一致，或簽到寫進了別的帳戶';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.member_point_accounts a
    WHERE a.balance IS DISTINCT FROM (
      SELECT coalesce(sum(e.delta), 0)::integer
      FROM public.member_point_entries e
      WHERE e.user_id = a.user_id
    )
  ) THEN
    RAISE EXCEPTION '有會員的餘額與流水不一致';
  END IF;
  RAISE NOTICE '簽到預演通過。接下來回復交易，不會留下點數或新函式。';
END
$daily_checkin_preview_done$;

ROLLBACK;
