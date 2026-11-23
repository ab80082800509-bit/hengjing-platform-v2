-- =============================================================================
-- 第四、第五階段第二批補充：每日簽到延後觸發器的執行權限
-- 請人工審查後，在 Supabase SQL Editor 一次執行整份。本檔不會被這次作業自動執行。
--
-- 正式環境 claim_my_daily_checkin() 提交時回 42501：
-- permission denied for table reward_claims。
-- member_point_entry_requires_claim() 目前是 SECURITY INVOKER。
-- 它的約束觸發器是 DEFERRABLE INITIALLY DEFERRED，要等交易提交才執行。
-- 簽到函式返回後，目前使用者回到 authenticated，延後觸發器就以該角色讀取 reward_claims。
-- authenticated 沒有這張表的權限，所以提交失敗。
--
-- 本檔只對既有函式 ALTER FUNCTION：改為 SECURITY DEFINER，並固定 search_path。
-- 領獎紀錄是否存在的檢查、觸發器、帳本資料、簽到金額與資料表授權都維持原狀。
-- 不重建、不停用觸發器，也不授權 anon、authenticated、service_role 讀寫 reward_claims。
-- 不開放 post_member_reward。
--
-- 其他帳本觸發器是立即觸發，會在 SECURITY DEFINER 的發獎函式返回前執行。
-- 它們不是這次 42501 的來源，本檔不修改。
-- 可重跑：只調整同一支函式的執行身份與 search_path，不重建資料表。
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

COMMIT;
