-- =============================================================================
-- 第四、第五階段第二批補充預演：每日簽到延後觸發器的執行權限
-- 與正式 migration 的修正內容必須相同。整份在同一個交易內，結尾 ROLLBACK。
-- 不會留下函式修改、點數、流水或領獎紀錄，也不會刪除、清空或重設現有帳本。
--
-- 延後約束觸發器平常要到交易提交才執行，ROLLBACK 不會執行它。
-- 預演因此在 authenticated 呼叫簽到入口之後，立刻把已排隊的這一支觸發器檢查一次。
-- 這只影響本交易的檢查時機，不改變資料庫裡 INITIALLY DEFERRED 的觸發器定義。
-- =============================================================================

BEGIN;

-- checkin-claim-trigger-security-body-start

DO $require_checkin_claim_trigger$
BEGIN
  IF to_regprocedure('public.member_point_entry_requires_claim()') IS NULL THEN
    RAISE EXCEPTION '需要已套用的第一批延後領獎檢查';
  END IF;
  IF to_regprocedure('public.post_member_reward(uuid, text, text, integer, jsonb)') IS NULL THEN
    RAISE EXCEPTION '需要已套用的第一批 post_member_reward';
  END IF;
  IF to_regprocedure('public.claim_my_daily_checkin()') IS NULL THEN
    RAISE EXCEPTION '需要已套用的第二批每日簽到';
  END IF;
END
$require_checkin_claim_trigger$;

ALTER FUNCTION public.member_point_entry_requires_claim()
  SECURITY DEFINER
  SET search_path = public, pg_catalog;

COMMENT ON FUNCTION public.member_point_entry_requires_claim() IS
  '延後約束觸發器。交易提交時以函式擁有者確認點數流水有對應領獎紀錄。不回傳領獎內容，也不開放 reward_claims。';

REVOKE ALL ON FUNCTION public.member_point_entry_requires_claim() FROM PUBLIC, anon, authenticated;

DO $revoke_claim_trigger_service$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RETURN;
  END IF;
  EXECUTE 'REVOKE ALL ON FUNCTION public.member_point_entry_requires_claim() FROM service_role';
END
$revoke_claim_trigger_service$;

DO $checkin_claim_trigger_security_check$
DECLARE
  fn regprocedure := 'public.member_point_entry_requires_claim()'::regprocedure;
  def text;
  actor text;
  priv text;
  actors text[] := ARRAY['anon', 'authenticated'];
BEGIN
  def := pg_get_functiondef(fn);
  IF position('FROM public.reward_claims' IN def) = 0
     OR position('point_entry_id = NEW.id' IN def) = 0
     OR position('點數流水缺少領獎紀錄' IN def) = 0 THEN
    RAISE EXCEPTION '延後領獎檢查必須保留';
  END IF;
  IF position('SECURITY DEFINER' IN def) = 0 THEN
    RAISE EXCEPTION '延後觸發器必須以函式擁有者執行';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = fn
      AND prosecdef
      AND provolatile = 'v'
  ) THEN
    RAISE EXCEPTION '延後觸發器必須以函式擁有者執行';
  END IF;

  IF (
    SELECT count(*)
    FROM unnest(coalesce((SELECT proconfig FROM pg_proc WHERE oid = fn), ARRAY[]::text[])) AS cfg
    WHERE cfg LIKE 'search_path=%'
  ) IS DISTINCT FROM 1
  OR NOT EXISTS (
    SELECT 1
    FROM unnest(coalesce((SELECT proconfig FROM pg_proc WHERE oid = fn), ARRAY[]::text[])) AS cfg
    WHERE cfg = 'search_path=public, pg_catalog'
  ) THEN
    RAISE EXCEPTION '延後觸發器必須固定 search_path';
  END IF;

  IF (
    SELECT proowner FROM pg_proc WHERE oid = fn
  ) IS DISTINCT FROM (
    SELECT c.relowner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'reward_claims'
  ) THEN
    RAISE EXCEPTION '觸發器函式擁有者必須與 reward_claims 擁有者相同';
  END IF;

  IF NOT has_table_privilege(
    (SELECT proowner FROM pg_proc WHERE oid = fn),
    'public.reward_claims',
    'SELECT'
  ) THEN
    RAISE EXCEPTION '觸發器函式擁有者必須能讀取 reward_claims';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'member_point_entries'
      AND t.tgname = 'member_point_entries_require_claim'
      AND NOT t.tgisinternal
  ) IS DISTINCT FROM 1
  OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND c.relname = 'member_point_entries'
      AND t.tgname = 'member_point_entries_require_claim'
      AND p.oid = fn
      AND t.tgconstraint <> 0
      AND t.tgdeferrable
      AND t.tginitdeferred
      AND t.tgenabled = 'O'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION '延後約束觸發器必須維持啟用且交易結束才檢查';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = fn
      AND (
        proacl IS NULL
        OR EXISTS (
          SELECT 1
          FROM aclexplode(proacl) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        )
      )
  ) THEN
    RAISE EXCEPTION 'PUBLIC 不應能執行延後領獎檢查';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    actors := array_append(actors, 'service_role');
  END IF;

  FOREACH actor IN ARRAY actors LOOP
    IF has_function_privilege(actor, fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% 不應能執行延後領獎檢查', actor;
    END IF;
    IF has_function_privilege(actor, 'public.post_member_reward(uuid, text, text, integer, jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION '% 不應能直接發獎', actor;
    END IF;
    FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(actor, 'public.reward_claims', priv) THEN
        RAISE EXCEPTION '% 不應能對 reward_claims 執行 %', actor, priv;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT has_function_privilege('authenticated', 'public.claim_my_daily_checkin()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_my_checkin_state()', 'EXECUTE') THEN
    RAISE EXCEPTION '登入會員應仍能簽到並讀取自己的簽到狀態';
  END IF;
  IF has_function_privilege('anon', 'public.claim_my_daily_checkin()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_my_checkin_state()', 'EXECUTE') THEN
    RAISE EXCEPTION '匿名角色不應能簽到';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'reward_claims'
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'reward_claims 必須維持 RLS，且不能強制套用到擁有者';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reward_claims'
  ) THEN
    RAISE EXCEPTION 'reward_claims 不應有直接資料表政策';
  END IF;
END
$checkin_claim_trigger_security_check$;

-- checkin-claim-trigger-security-body-end

-- 以下只在預演交易內呼叫簽到。最後會 ROLLBACK。不建立會員，也不改現有帳本。

DO $checkin_security_preview_setup$
DECLARE
  uid uuid;
  balance_sig text;
  entry_sig text;
  claim_sig text;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION '預演開始時不應已是 API 角色。交易會回復。';
  END IF;
  IF (SELECT count(*) FROM auth.users) < 1 THEN
    RAISE EXCEPTION '預演停止：至少需要一位既有會員。交易會回復，不會建立會員。';
  END IF;

  SELECT u.id
  INTO uid
  FROM auth.users AS u
  WHERE NOT EXISTS (
      SELECT 1 FROM public.member_point_accounts AS a WHERE a.user_id = u.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.member_point_entries AS e WHERE e.user_id = u.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.reward_claims AS c WHERE c.user_id = u.id
    )
  ORDER BY u.id
  LIMIT 1;

  IF uid IS NULL THEN
    RAISE EXCEPTION '預演停止：找不到沒有點數帳戶、流水與領獎紀錄的既有會員。不會刪除或改寫現有帳本。交易會回復。';
  END IF;

  SELECT coalesce(pg_catalog.md5(string_agg(user_id::text || ':' || balance::text, ',' ORDER BY user_id::text)), 'empty')
  INTO balance_sig
  FROM public.member_point_accounts;

  SELECT coalesce(pg_catalog.md5(string_agg(user_id::text || ':' || n::text, ',' ORDER BY user_id::text)), 'empty')
  INTO entry_sig
  FROM (
    SELECT user_id, count(*) AS n
    FROM public.member_point_entries
    GROUP BY user_id
  ) AS counted;

  SELECT coalesce(pg_catalog.md5(string_agg(user_id::text || ':' || n::text, ',' ORDER BY user_id::text)), 'empty')
  INTO claim_sig
  FROM (
    SELECT user_id, count(*) AS n
    FROM public.reward_claims
    GROUP BY user_id
  ) AS counted;

  PERFORM set_config('app.checkin_security_user', uid::text, true);
  PERFORM set_config('app.checkin_security_day', to_char(public.taipei_today(), 'YYYY-MM-DD'), true);
  PERFORM set_config('app.checkin_security_balance_sig', balance_sig, true);
  PERFORM set_config('app.checkin_security_entry_sig', entry_sig, true);
  PERFORM set_config('app.checkin_security_claim_sig', claim_sig, true);
  PERFORM set_config(
    'app.checkin_security_accounts',
    (SELECT count(*)::text FROM public.member_point_accounts),
    true
  );
  PERFORM set_config(
    'app.checkin_security_entries',
    (SELECT count(*)::text FROM public.member_point_entries),
    true
  );
  PERFORM set_config(
    'app.checkin_security_claims',
    (SELECT count(*)::text FROM public.reward_claims),
    true
  );
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );

  IF auth.uid() IS DISTINCT FROM uid THEN
    RAISE EXCEPTION '無法模擬 auth.uid()，簽到預演停止。交易會回復。';
  END IF;
END
$checkin_security_preview_setup$;

SET LOCAL ROLE authenticated;

DO $checkin_security_preview_member$
DECLARE
  uid uuid := auth.uid();
  posted jsonb;
  replay jsonb;
  denied_table boolean := false;
  denied_post boolean := false;
BEGIN
  IF uid IS NULL OR uid::text IS DISTINCT FROM current_setting('app.checkin_security_user', true) THEN
    RAISE EXCEPTION '切換到一般會員後讀不到原本的 auth.uid()。交易會回復。';
  END IF;

  posted := public.claim_my_daily_checkin();
  -- ROLLBACK 不會執行延後約束觸發器。這裡仍以一般會員身份，強制檢查剛才排隊的那一次。
  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE';

  IF (posted->>'replayed')::boolean IS DISTINCT FROM false
     OR (posted->>'awardedDelta')::integer IS DISTINCT FROM 10
     OR (posted->>'balance')::integer IS DISTINCT FROM 10
     OR (posted->>'checkedToday')::boolean IS DISTINCT FROM true
     OR (posted->>'checkedDays')::integer IS DISTINCT FROM 1
     OR posted->>'taipeiDay' IS DISTINCT FROM current_setting('app.checkin_security_day', true)
     OR jsonb_array_length(posted->'entries') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '首次簽到沒有正常入帳';
  END IF;

  replay := public.claim_my_daily_checkin();
  IF (replay->>'replayed')::boolean IS DISTINCT FROM true
     OR (replay->>'balance')::integer IS DISTINCT FROM 10
     OR (replay->>'awardedDelta')::integer IS DISTINCT FROM 10
     OR replay->>'taipeiDay' IS DISTINCT FROM current_setting('app.checkin_security_day', true)
     OR jsonb_array_length(replay->'entries') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '同一天再次簽到不能再增加點數';
  END IF;

  BEGIN
    PERFORM 1 FROM public.reward_claims;
    RAISE EXCEPTION '一般會員不應能直接讀取 reward_claims';
  EXCEPTION
    WHEN insufficient_privilege THEN
      denied_table := true;
  END;
  IF NOT denied_table THEN
    RAISE EXCEPTION '一般會員直接讀取 reward_claims 時沒有被拒絕';
  END IF;

  BEGIN
    PERFORM public.post_member_reward(
      uid,
      'checkin',
      'checkin:' || current_setting('app.checkin_security_day', true),
      10,
      '{}'::jsonb
    );
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
END
$checkin_security_preview_member$;

RESET ROLE;

DO $checkin_security_preview_verify$
DECLARE
  uid uuid;
  balance_sig text;
  entry_sig text;
  claim_sig text;
  day text;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION '權限驗證後仍停在 API 角色';
  END IF;

  uid := current_setting('app.checkin_security_user', true)::uuid;
  day := current_setting('app.checkin_security_day', true);

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND c.relname = 'member_point_entries'
      AND t.tgname = 'member_point_entries_require_claim'
      AND p.oid = 'public.member_point_entry_requires_claim()'::regprocedure
      AND t.tgconstraint <> 0
      AND t.tgdeferrable
      AND t.tginitdeferred
      AND t.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION '預演不得把延後約束觸發器改成立即檢查';
  END IF;

  IF (SELECT count(*) FROM public.member_point_accounts)
       IS DISTINCT FROM current_setting('app.checkin_security_accounts', true)::bigint + 1
     OR (SELECT count(*) FROM public.member_point_entries)
       IS DISTINCT FROM current_setting('app.checkin_security_entries', true)::bigint + 1
     OR (SELECT count(*) FROM public.reward_claims)
       IS DISTINCT FROM current_setting('app.checkin_security_claims', true)::bigint + 1 THEN
    RAISE EXCEPTION '簽到試算改到了預期以外的帳本筆數';
  END IF;

  SELECT coalesce(pg_catalog.md5(string_agg(user_id::text || ':' || balance::text, ',' ORDER BY user_id::text)), 'empty')
  INTO balance_sig
  FROM public.member_point_accounts
  WHERE user_id <> uid;

  SELECT coalesce(pg_catalog.md5(string_agg(user_id::text || ':' || n::text, ',' ORDER BY user_id::text)), 'empty')
  INTO entry_sig
  FROM (
    SELECT user_id, count(*) AS n
    FROM public.member_point_entries
    WHERE user_id <> uid
    GROUP BY user_id
  ) AS counted;

  SELECT coalesce(pg_catalog.md5(string_agg(user_id::text || ':' || n::text, ',' ORDER BY user_id::text)), 'empty')
  INTO claim_sig
  FROM (
    SELECT user_id, count(*) AS n
    FROM public.reward_claims
    WHERE user_id <> uid
    GROUP BY user_id
  ) AS counted;

  IF balance_sig IS DISTINCT FROM current_setting('app.checkin_security_balance_sig', true)
     OR entry_sig IS DISTINCT FROM current_setting('app.checkin_security_entry_sig', true)
     OR claim_sig IS DISTINCT FROM current_setting('app.checkin_security_claim_sig', true) THEN
    RAISE EXCEPTION '既有點數帳戶被改寫';
  END IF;

  IF (SELECT count(*) FROM public.member_point_entries WHERE user_id = uid) IS DISTINCT FROM 1
     OR (SELECT count(*) FROM public.reward_claims WHERE user_id = uid) IS DISTINCT FROM 1
     OR (SELECT coalesce(sum(delta), 0) FROM public.member_point_entries WHERE user_id = uid) IS DISTINCT FROM 10
     OR (SELECT balance FROM public.member_point_accounts WHERE user_id = uid) IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '點數餘額、流水與領獎紀錄不一致';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.member_point_entries AS e
    JOIN public.reward_claims AS c ON c.point_entry_id = e.id
    JOIN public.member_point_accounts AS a ON a.user_id = e.user_id
    WHERE e.user_id = uid
      AND c.user_id = uid
      AND a.user_id = uid
      AND e.kind = 'checkin'
      AND c.kind = 'checkin'
      AND e.delta = 10
      AND c.delta = 10
      AND e.balance_after = 10
      AND c.balance_after = 10
      AND a.balance = 10
      AND e.claim_key = c.claim_key
      AND e.claim_key = 'checkin:' || day
      AND e.taipei_day = c.taipei_day
      AND e.taipei_day = day::date
      AND e.metadata = c.metadata
  ) THEN
    RAISE EXCEPTION '點數餘額、流水與領獎紀錄不一致';
  END IF;

  RAISE NOTICE '簽到權限預演通過。接下來回復交易，不會留下點數或函式修改。';
END
$checkin_security_preview_verify$;

ROLLBACK;
