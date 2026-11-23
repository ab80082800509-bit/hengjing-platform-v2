-- =============================================================================
-- 創始人 5,000 點測試額度預演
-- 整份在同一個交易內，結尾必須維持 ROLLBACK。
-- 不要把 ROLLBACK 改成 COMMIT。預演不留下結構、函式、隔離會員或點數。
-- 只建立交易內的隔離會員。既有會員的餘額與流水若被改到，預演會停止並回復。
-- 語句若中途失敗，交易會中止；離開連線前仍要執行 ROLLBACK，中止的交易不會提交。
-- 預演通過後，才審查並執行 supabase/migrations/20261024210000_founder_test_point_grant.sql。
-- 那份正式 migration 只提交結構與函式，不會給任何會員入帳。
-- =============================================================================

BEGIN;
DO $founder_preview_guard$
DECLARE
  v_trigger record;
  v_trigger_def text;
BEGIN
  IF current_user IN ('authenticated', 'anon', 'service_role') THEN
    RAISE EXCEPTION '預演必須由資料庫擁有者開始。交易會回復。';
  END IF;
  IF to_regclass('public.reward_claims') IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.reward_claims AS claim
    WHERE claim.claim_key IN (
      'platform_grant:founder-coupon-test-20261024',
      'platform_reclaim:founder-coupon-test-20261024'
    )
  ) THEN
    RAISE EXCEPTION '預演停止：正式庫已有這次測試補點或回收。不會再寫。交易會回復。';
  END IF;

  FOR v_trigger IN
    SELECT routine.oid AS fn_oid,
           lang.lanname,
           namespace.nspname || '.' || relation.relname || '.' || trigger_info.tgname AS label
    FROM pg_trigger AS trigger_info
    JOIN pg_class AS relation ON relation.oid = trigger_info.tgrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_proc AS routine ON routine.oid = trigger_info.tgfoid
    JOIN pg_language AS lang ON lang.oid = routine.prolang
    WHERE NOT trigger_info.tgisinternal
      AND (
        (namespace.nspname = 'auth' AND relation.relname IN ('users', 'identities'))
        OR (
          namespace.nspname = 'public'
          AND relation.relname IN (
            'profiles', 'member_point_accounts', 'member_point_entries',
            'reward_claims', 'member_coupon_holds'
          )
        )
      )
  LOOP
    IF v_trigger.lanname NOT IN ('plpgsql', 'sql') THEN
      RAISE EXCEPTION '預演停止：觸發器 % 不是 SQL，無法確認 ROLLBACK 不會留下交易外副作用。交易會回復。', v_trigger.label;
    END IF;
    v_trigger_def := pg_get_functiondef(v_trigger.fn_oid);
    IF v_trigger_def ~* '(dblink|pg_net|net\.http_|http_request|lo_import|pg_background)' THEN
      RAISE EXCEPTION '預演停止：觸發器 % 可能寫出交易外。不會繼續建立測試資料。交易會回復。', v_trigger.label;
    END IF;
  END LOOP;
END
$founder_preview_guard$;

-- founder-test-grant-body-start

DO $founder_grant_require$
BEGIN
  IF to_regclass('auth.users') IS NULL
     OR to_regclass('public.member_point_accounts') IS NULL
     OR to_regclass('public.member_point_entries') IS NULL
     OR to_regclass('public.reward_claims') IS NULL
     OR to_regclass('public.member_coupon_holds') IS NULL THEN
    RAISE EXCEPTION '需要已套用的點數帳本與會員券包';
  END IF;
  IF to_regprocedure('public.post_member_reward(uuid, text, text, integer, jsonb)') IS NULL
     OR to_regprocedure('public.post_coupon_exchange_debit(uuid, text, jsonb)') IS NULL
     OR to_regprocedure('public.taipei_today(timestamptz)') IS NULL
     OR to_regprocedure('public.guard_member_coupon_hold()') IS NULL THEN
    RAISE EXCEPTION '需要已套用的發獎、扣點、台北日與券包保護';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = 'auth'
      AND column_info.table_name = 'users'
      AND column_info.column_name = 'email_confirmed_at'
  ) THEN
    RAISE EXCEPTION '需要 auth.users.email_confirmed_at 才能核對已驗證信箱';
  END IF;
  IF position(
    '已領取的優惠券不可修改或刪除'
    IN pg_get_functiondef('public.guard_member_coupon_hold()'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION '券包仍必須不可修改或刪除，這次不能假裝能作廢優惠券';
  END IF;
  IF position(
    'platform_grant'
    IN pg_get_functiondef('public.post_member_reward(uuid, text, text, integer, jsonb)'::regprocedure)
  ) > 0 THEN
    RAISE EXCEPTION '不能把測試補點放進既有發獎函式';
  END IF;
END
$founder_grant_require$;

ALTER TABLE public.member_point_entries
  DROP CONSTRAINT IF EXISTS member_point_entries_kind_known,
  DROP CONSTRAINT IF EXISTS member_point_entries_key_shape;

ALTER TABLE public.member_point_entries
  ADD CONSTRAINT member_point_entries_kind_known CHECK (
    kind IN ('checkin', 'scratch', 'coupon_exchange', 'perk_unlock', 'platform_grant', 'platform_reclaim')
  ),
  ADD CONSTRAINT member_point_entries_key_shape CHECK (
    (kind = 'checkin' AND claim_key ~ '^checkin:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    OR (kind = 'scratch' AND claim_key ~ '^scratch:[A-Za-z0-9:_-]{1,120}$')
    OR (kind = 'coupon_exchange' AND claim_key ~ '^coupon_exchange:[A-Za-z0-9:_-]{1,120}$')
    OR (kind = 'perk_unlock' AND claim_key ~ '^perk_unlock:[A-Za-z0-9:_-]{1,120}$')
    OR (kind = 'platform_grant' AND claim_key = 'platform_grant:founder-coupon-test-20261024')
    OR (kind = 'platform_reclaim' AND claim_key = 'platform_reclaim:founder-coupon-test-20261024')
  );

ALTER TABLE public.reward_claims
  DROP CONSTRAINT IF EXISTS reward_claims_kind_known,
  DROP CONSTRAINT IF EXISTS reward_claims_key_shape;

ALTER TABLE public.reward_claims
  ADD CONSTRAINT reward_claims_kind_known CHECK (
    kind IN ('checkin', 'scratch', 'coupon_exchange', 'perk_unlock', 'platform_grant', 'platform_reclaim')
  ),
  ADD CONSTRAINT reward_claims_key_shape CHECK (
    (kind = 'checkin' AND claim_key ~ '^checkin:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    OR (kind = 'scratch' AND claim_key ~ '^scratch:[A-Za-z0-9:_-]{1,120}$')
    OR (kind = 'coupon_exchange' AND claim_key ~ '^coupon_exchange:[A-Za-z0-9:_-]{1,120}$')
    OR (kind = 'perk_unlock' AND claim_key ~ '^perk_unlock:[A-Za-z0-9:_-]{1,120}$')
    OR (kind = 'platform_grant' AND claim_key = 'platform_grant:founder-coupon-test-20261024')
    OR (kind = 'platform_reclaim' AND claim_key = 'platform_reclaim:founder-coupon-test-20261024')
  );

CREATE UNIQUE INDEX IF NOT EXISTS member_point_entries_one_platform_grant_key
  ON public.member_point_entries (claim_key)
  WHERE kind = 'platform_grant';

CREATE UNIQUE INDEX IF NOT EXISTS reward_claims_one_platform_grant_key
  ON public.reward_claims (claim_key)
  WHERE kind = 'platform_grant';

CREATE UNIQUE INDEX IF NOT EXISTS member_point_entries_one_platform_reclaim_key
  ON public.member_point_entries (claim_key)
  WHERE kind = 'platform_reclaim';

CREATE UNIQUE INDEX IF NOT EXISTS reward_claims_one_platform_reclaim_key
  ON public.reward_claims (claim_key)
  WHERE kind = 'platform_reclaim';

CREATE OR REPLACE FUNCTION public.post_founder_coupon_test_grant(
  p_user_id uuid,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_confirmed uuid;
  v_account public.member_point_accounts%ROWTYPE;
  v_existing public.reward_claims%ROWTYPE;
  v_entry_id uuid;
  v_claim_id uuid;
  v_day date;
  v_delta integer;
  v_next_balance integer;
  v_summed bigint;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_target integer := 5000;
  v_grant_key text := 'platform_grant:founder-coupon-test-20261024';
  v_reclaim_key text := 'platform_reclaim:founder-coupon-test-20261024';
  v_note jsonb;
BEGIN
  IF session_user IN ('anon', 'authenticated', 'authenticator', 'service_role') THEN
    RAISE EXCEPTION '補點只能由資料庫擁有者在 SQL 編輯器執行';
  END IF;
  IF coalesce(current_setting('request.jwt.claim.role', true), '')
     IN ('anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION '補點不能從 API 角色呼叫';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION '請填入已確認的會員信箱';
  END IF;
  IF p_user_id IS NULL
     OR p_user_id = '00000000-0000-0000-0000-000000000000'::uuid
     OR v_email = 'member@example.com' THEN
    RAISE EXCEPTION '請先換成已確認的會員編號與信箱';
  END IF;

  SELECT users.id
  INTO v_confirmed
  FROM auth.users AS users
  WHERE users.id = p_user_id
    AND lower(users.email) = v_email
    AND users.email_confirmed_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION '信箱、會員編號與已驗證信箱沒有同時對上同一人';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_grant_key, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_reclaim_key, 0));
  PERFORM set_config('app.reward_post', 'on', true);

  INSERT INTO public.member_point_accounts (user_id)
  VALUES (v_confirmed)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT account.*
  INTO v_account
  FROM public.member_point_accounts AS account
  WHERE account.user_id = v_confirmed
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '無法鎖定點數帳戶';
  END IF;

  SELECT coalesce(sum(entry.delta), 0)
  INTO v_summed
  FROM public.member_point_entries AS entry
  WHERE entry.user_id = v_confirmed;

  IF v_summed IS DISTINCT FROM v_account.balance::bigint THEN
    RAISE EXCEPTION '點數餘額與流水不一致';
  END IF;

  SELECT claim.*
  INTO v_existing
  FROM public.reward_claims AS claim
  WHERE claim.claim_key = v_grant_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM v_confirmed
       OR v_existing.kind IS DISTINCT FROM 'platform_grant' THEN
      RAISE EXCEPTION '這次測試補點已經記在其他紀錄，不能再發';
    END IF;
    PERFORM set_config('app.reward_post', 'off', true);
    RETURN pg_catalog.jsonb_build_object(
      'replayed', true,
      'userId', v_confirmed,
      'delta', 0,
      'recordedDelta', v_existing.delta,
      'balance', v_account.balance,
      'targetBalance', v_target,
      'claimKey', v_existing.claim_key
    );
  END IF;

  IF v_account.balance >= v_target THEN
    RAISE EXCEPTION '餘額已有 % 點，達到或超過 5000，這次不寫入流水', v_account.balance;
  END IF;

  v_delta := v_target - v_account.balance;
  v_next_balance := v_account.balance + v_delta;
  IF v_delta <= 0 OR v_next_balance IS DISTINCT FROM v_target THEN
    RAISE EXCEPTION '補點後必須剛好是 5000 點';
  END IF;

  v_day := public.taipei_today();
  v_note := pg_catalog.jsonb_build_object(
    'purpose', 'founder-coupon-exchange-test',
    'targetBalance', v_target
  );

  INSERT INTO public.member_point_entries (
    user_id, delta, balance_after, kind, claim_key, taipei_day, metadata
  )
  VALUES (
    v_confirmed, v_delta, v_next_balance, 'platform_grant', v_grant_key, v_day, v_note
  )
  RETURNING id INTO v_entry_id;

  UPDATE public.member_point_accounts AS account
  SET balance = v_next_balance,
      updated_at = pg_catalog.now()
  WHERE account.user_id = v_confirmed;

  INSERT INTO public.reward_claims (
    user_id, kind, claim_key, taipei_day, delta, balance_after, point_entry_id, metadata
  )
  VALUES (
    v_confirmed, 'platform_grant', v_grant_key, v_day, v_delta, v_next_balance, v_entry_id, v_note
  )
  RETURNING id INTO v_claim_id;

  PERFORM set_config('app.reward_post', 'off', true);

  RETURN pg_catalog.jsonb_build_object(
    'replayed', false,
    'userId', v_confirmed,
    'claimId', v_claim_id,
    'pointEntryId', v_entry_id,
    'balanceBefore', v_account.balance,
    'delta', v_delta,
    'balanceAfter', v_next_balance,
    'targetBalance', v_target,
    'claimKey', v_grant_key
  );
END;
$$;

COMMENT ON FUNCTION public.post_founder_coupon_test_grant(uuid, text) IS
  '把同一位已驗證會員的可用餘額補足至 5000。差額寫入 platform_grant 流水與領獎紀錄。不授權給 API。全庫只能成功一次；第二次回放原紀錄。';

CREATE OR REPLACE FUNCTION public.post_founder_coupon_test_reclaim(
  p_user_id uuid,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_confirmed uuid;
  v_account public.member_point_accounts%ROWTYPE;
  v_existing public.reward_claims%ROWTYPE;
  v_entry_id uuid;
  v_claim_id uuid;
  v_day date;
  v_grant_delta integer;
  v_grant_entry_id uuid;
  v_grant_created_at timestamptz;
  v_grant_balance_after integer;
  v_cursor bigint;
  v_net_after bigint;
  v_step_count integer;
  v_match_count integer;
  v_step_id uuid;
  v_step_delta integer;
  v_step_balance_after integer;
  v_step_kind text;
  v_seen uuid[];
  v_spent_after bigint;
  v_unused bigint;
  v_clawback integer;
  v_next_balance integer;
  v_summed bigint;
  v_holds jsonb;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_grant_key text := 'platform_grant:founder-coupon-test-20261024';
  v_reclaim_key text := 'platform_reclaim:founder-coupon-test-20261024';
  v_limit text := '點數兌換券不可修改或刪除，沒有核銷欄位，訂單也沒有連到券包。這次只收回尚未花掉的測試點數，不會作廢券、訂單或虛擬道具。';
  v_note jsonb;
BEGIN
  IF session_user IN ('anon', 'authenticated', 'authenticator', 'service_role') THEN
    RAISE EXCEPTION '回收只能由資料庫擁有者在 SQL 編輯器執行';
  END IF;
  IF coalesce(current_setting('request.jwt.claim.role', true), '')
     IN ('anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION '回收不能從 API 角色呼叫';
  END IF;
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION '請填入已確認的會員信箱';
  END IF;
  IF p_user_id IS NULL
     OR p_user_id = '00000000-0000-0000-0000-000000000000'::uuid
     OR v_email = 'member@example.com' THEN
    RAISE EXCEPTION '請先換成已確認的會員編號與信箱';
  END IF;

  SELECT users.id
  INTO v_confirmed
  FROM auth.users AS users
  WHERE users.id = p_user_id
    AND lower(users.email) = v_email
    AND users.email_confirmed_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION '信箱、會員編號與已驗證信箱沒有同時對上同一人';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_grant_key, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_reclaim_key, 0));
  PERFORM set_config('app.reward_post', 'on', true);

  SELECT account.*
  INTO v_account
  FROM public.member_point_accounts AS account
  WHERE account.user_id = v_confirmed
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這次測試補點，不能回收';
  END IF;

  SELECT coalesce(sum(entry.delta), 0)
  INTO v_summed
  FROM public.member_point_entries AS entry
  WHERE entry.user_id = v_confirmed;

  IF v_summed IS DISTINCT FROM v_account.balance::bigint THEN
    RAISE EXCEPTION '點數餘額與流水不一致';
  END IF;

  SELECT entry.delta, entry.id, entry.created_at, entry.balance_after
  INTO v_grant_delta, v_grant_entry_id, v_grant_created_at, v_grant_balance_after
  FROM public.member_point_entries AS entry
  WHERE entry.user_id = v_confirmed
    AND entry.kind = 'platform_grant'
    AND entry.claim_key = v_grant_key;

  IF NOT FOUND OR v_grant_delta IS NULL OR v_grant_delta <= 0 THEN
    RAISE EXCEPTION '找不到這次測試補點，不能回收';
  END IF;
  IF v_grant_balance_after IS NULL
     OR v_grant_balance_after::bigint < v_grant_delta::bigint THEN
    RAISE EXCEPTION '測試補點流水的餘額無法核對，這次不回收';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.reward_claims AS claim
    WHERE claim.point_entry_id = v_grant_entry_id
      AND claim.user_id = v_confirmed
      AND claim.kind = 'platform_grant'
      AND claim.claim_key = v_grant_key
      AND claim.delta = v_grant_delta
  ) THEN
    RAISE EXCEPTION '測試補點流水沒有對應的領獎紀錄';
  END IF;

  -- 任何 perk_unlock 都停止。第五批永久 Inventory 還沒有，不能把道具流水折成已花點數後繼續回收。
  -- 否則會假裝買過的虛擬特權已經可以清理。這裡不刪流水、不改券包，也不建立或刪除道具。
  IF EXISTS (
    SELECT 1
    FROM public.member_point_entries AS entry
    WHERE entry.user_id = v_confirmed
      AND entry.kind = 'perk_unlock'
  ) THEN
    RAISE EXCEPTION '這位會員已有虛擬道具流水，這次回收不會猜它能不能收回';
  END IF;

  -- 券包清單仍用建立時間，只供人工閱讀，不參與回收金額。
  -- 同一交易裡、補點之前領的券可能被列進來；金額仍只看餘額鏈。
  SELECT coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'holdId', hold.id,
        'couponId', hold.coupon_id,
        'code', hold.code,
        'createdAt', hold.created_at
      )
      ORDER BY hold.created_at, hold.id
    ),
    '[]'::jsonb
  )
  INTO v_holds
  FROM public.member_coupon_holds AS hold
  WHERE hold.user_id = v_confirmed
    AND hold.source = 'points'
    AND hold.created_at >= v_grant_created_at;

  SELECT claim.*
  INTO v_existing
  FROM public.reward_claims AS claim
  WHERE claim.claim_key = v_reclaim_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM v_confirmed
       OR v_existing.kind IS DISTINCT FROM 'platform_reclaim'
       OR v_existing.delta >= 0 THEN
      RAISE EXCEPTION '這次測試回收已經記在其他紀錄，不能再扣';
    END IF;
    PERFORM set_config('app.reward_post', 'off', true);
    RETURN pg_catalog.jsonb_build_object(
      'replayed', true,
      'userId', v_confirmed,
      'delta', 0,
      'recordedDelta', v_existing.delta,
      'balance', v_account.balance,
      'claimKey', v_existing.claim_key,
      'holdsReleased', false,
      'entitlementLimit', v_limit,
      'unresolvedPointHolds', v_holds
    );
  END IF;

  -- 可重算的回收規則：
  -- 測試點數只認這筆 platform_grant。補點前餘額 = 該列 balance_after - delta。
  -- 從該列的 balance_after 往後走，下一筆的 balance_after - delta 必須剛好等於目前餘額。
  -- now() 在同一交易相同，gen_random_uuid() 沒有先後，所以不用 created_at 或 id。
  -- 並發扣點若先開始、等帳戶鎖後才入帳，建立時間可能早於補點，但餘額鏈仍接在補點之後。
  -- 鏈上目前只把優惠券負數算成花掉的測試點。簽到與刮卡不扣。perk_unlock 在進鏈之前就停止。
  -- 補點前的扣點不在這條鏈上。
  -- 已經走過的流水不再走。餘額回到舊數字時，只接還沒走過的下一筆。
  -- 鏈中斷、同一個餘額接出兩筆還沒走過的流水，或走完沒有接到目前餘額，整筆停止，不估算。
  v_cursor := v_grant_balance_after::bigint;
  v_spent_after := 0;
  v_net_after := 0;
  v_step_count := 0;
  v_seen := ARRAY[v_grant_entry_id];

  LOOP
    v_step_count := v_step_count + 1;
    IF v_step_count > 10000 THEN
      RAISE EXCEPTION '補點之後的流水超過可驗證上限，這次不回收';
    END IF;

    SELECT count(*)::integer
    INTO v_match_count
    FROM public.member_point_entries AS entry
    WHERE entry.user_id = v_confirmed
      AND NOT (entry.id = ANY (v_seen))
      AND (entry.balance_after::bigint - entry.delta::bigint) = v_cursor;

    IF v_match_count = 0 THEN
      EXIT;
    END IF;
    IF v_match_count > 1 THEN
      RAISE EXCEPTION '同一個餘額接出兩筆流水，無法確認測試點數花到哪裡，這次不回收';
    END IF;

    SELECT entry.id, entry.delta, entry.balance_after, entry.kind
    INTO v_step_id, v_step_delta, v_step_balance_after, v_step_kind
    FROM public.member_point_entries AS entry
    WHERE entry.user_id = v_confirmed
      AND NOT (entry.id = ANY (v_seen))
      AND (entry.balance_after::bigint - entry.delta::bigint) = v_cursor;

    IF v_step_id IS NULL
       OR v_step_delta IS NULL
       OR v_step_balance_after IS NULL
       OR v_step_balance_after::bigint IS DISTINCT FROM v_cursor + v_step_delta::bigint THEN
      RAISE EXCEPTION '補點之後的餘額鏈中斷，這次不回收';
    END IF;
    IF v_step_kind = 'perk_unlock' THEN
      RAISE EXCEPTION '這位會員已有虛擬道具流水，這次回收不會猜它能不能收回';
    END IF;
    IF v_step_kind = 'coupon_exchange' AND v_step_delta < 0 THEN
      v_spent_after := v_spent_after + (-v_step_delta)::bigint;
    ELSIF v_step_kind IN ('checkin', 'scratch') AND v_step_delta > 0 THEN
      NULL;
    ELSE
      RAISE EXCEPTION '補點之後有無法歸屬的流水，這次不回收';
    END IF;

    v_seen := v_seen || v_step_id;
    v_net_after := v_net_after + v_step_delta::bigint;
    v_cursor := v_step_balance_after::bigint;
  END LOOP;

  IF v_cursor IS DISTINCT FROM v_account.balance::bigint
     OR v_grant_balance_after::bigint + v_net_after IS DISTINCT FROM v_account.balance::bigint THEN
    RAISE EXCEPTION '補點之後的餘額鏈沒有接到目前餘額，這次不回收';
  END IF;

  v_unused := v_grant_delta::bigint - v_spent_after;
  IF v_unused <= 0 THEN
    v_clawback := 0;
  ELSIF v_unused > v_account.balance::bigint THEN
    RAISE EXCEPTION '餘額低於尚未花掉的測試點，為避免扣到其他點數，這次不回收';
  ELSIF v_unused > 2147483647 THEN
    RAISE EXCEPTION '回收金額超過帳本整數範圍，這次不回收';
  ELSE
    v_clawback := v_unused::integer;
  END IF;

  IF v_clawback = 0 THEN
    PERFORM set_config('app.reward_post', 'off', true);
    RETURN pg_catalog.jsonb_build_object(
      'replayed', false,
      'recorded', false,
      'userId', v_confirmed,
      'delta', 0,
      'balance', v_account.balance,
      'grantDelta', v_grant_delta,
      'spentAfterGrant', v_spent_after,
      'holdsReleased', false,
      'entitlementLimit', v_limit,
      'unresolvedPointHolds', v_holds
    );
  END IF;

  v_next_balance := v_account.balance - v_clawback;
  IF v_next_balance < 0 THEN
    RAISE EXCEPTION '回收後餘額不可為負數';
  END IF;

  v_day := public.taipei_today();
  v_note := pg_catalog.jsonb_build_object(
    'purpose', 'founder-coupon-exchange-test-reclaim',
    'grantKey', v_grant_key,
    'grantDelta', v_grant_delta,
    'spentAfterGrant', v_spent_after,
    'clawback', v_clawback
  );

  INSERT INTO public.member_point_entries (
    user_id, delta, balance_after, kind, claim_key, taipei_day, metadata
  )
  VALUES (
    v_confirmed, -v_clawback, v_next_balance, 'platform_reclaim', v_reclaim_key, v_day, v_note
  )
  RETURNING id INTO v_entry_id;

  UPDATE public.member_point_accounts AS account
  SET balance = v_next_balance,
      updated_at = pg_catalog.now()
  WHERE account.user_id = v_confirmed;

  INSERT INTO public.reward_claims (
    user_id, kind, claim_key, taipei_day, delta, balance_after, point_entry_id, metadata
  )
  VALUES (
    v_confirmed, 'platform_reclaim', v_reclaim_key, v_day, -v_clawback, v_next_balance, v_entry_id, v_note
  )
  RETURNING id INTO v_claim_id;

  PERFORM set_config('app.reward_post', 'off', true);

  RETURN pg_catalog.jsonb_build_object(
    'replayed', false,
    'recorded', true,
    'userId', v_confirmed,
    'claimId', v_claim_id,
    'pointEntryId', v_entry_id,
    'balanceBefore', v_account.balance,
    'delta', -v_clawback,
    'balanceAfter', v_next_balance,
    'grantDelta', v_grant_delta,
    'spentAfterGrant', v_spent_after,
    'holdsReleased', false,
    'entitlementLimit', v_limit,
    'unresolvedPointHolds', v_holds
  );
END;
$$;

COMMENT ON FUNCTION public.post_founder_coupon_test_reclaim(uuid, text) IS
  '收回這次測試補點裡尚未花掉的點數。花掉的點數只沿補點之後的唯一餘額鏈計算，不用建立時間或 UUID。保留補點前餘額與之後的簽到、刮卡。已有虛擬道具流水時停止。不作廢優惠券、訂單或虛擬道具，也不授權給 API。';

REVOKE ALL ON FUNCTION public.post_founder_coupon_test_grant(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_founder_coupon_test_reclaim(uuid, text) FROM PUBLIC, anon, authenticated;

DO $revoke_founder_grant_service$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.post_founder_coupon_test_grant(uuid, text) FROM service_role';
    EXECUTE 'REVOKE ALL ON FUNCTION public.post_founder_coupon_test_reclaim(uuid, text) FROM service_role';
  END IF;
END
$revoke_founder_grant_service$;

DO $founder_grant_check$
DECLARE
  v_grant_def text := pg_get_functiondef('public.post_founder_coupon_test_grant(uuid, text)'::regprocedure);
  v_reclaim_def text := pg_get_functiondef('public.post_founder_coupon_test_reclaim(uuid, text)'::regprocedure);
  v_post_def text := pg_get_functiondef('public.post_member_reward(uuid, text, text, integer, jsonb)'::regprocedure);
  v_kind_def text;
  v_fn text;
BEGIN
  SELECT pg_get_constraintdef(constraint_info.oid)
  INTO v_kind_def
  FROM pg_constraint AS constraint_info
  WHERE constraint_info.conname = 'member_point_entries_kind_known'
    AND constraint_info.conrelid = 'public.member_point_entries'::regclass;

  IF position('platform_grant' IN v_kind_def) = 0
     OR position('platform_reclaim' IN v_kind_def) = 0 THEN
    RAISE EXCEPTION '點數流水約束沒有納入這次測試補點與回收';
  END IF;
  IF position('claim.claim_key = v_grant_key' IN v_grant_def) = 0
     OR position('claim.claim_key = v_reclaim_key' IN v_reclaim_def) = 0
     OR position('WHERE claim_key = claim_key' IN v_grant_def) > 0
     OR position('WHERE claim_key = claim_key' IN v_reclaim_def) > 0 THEN
    RAISE EXCEPTION '領獎鍵條件必須使用表別名與不同的變數名稱';
  END IF;
  IF position('v_target - v_account.balance' IN v_grant_def) = 0
     OR position('補點後必須剛好是 5000 點' IN v_grant_def) = 0
     OR position('+ 5000' IN v_grant_def) > 0
     OR position('balance + 5000' IN v_grant_def) > 0 THEN
    RAISE EXCEPTION '測試額度必須補足至 5000，不能固定再加 5000';
  END IF;
  IF position('platform_grant' IN v_post_def) > 0
     OR position('尚未開放這個獎勵來源' IN v_post_def) = 0
     OR position('這個獎勵來源尚未開放入帳' IN v_post_def) = 0 THEN
    RAISE EXCEPTION '既有發獎函式必須維持原規則';
  END IF;
  IF position('entry.balance_after::bigint - entry.delta::bigint' IN v_reclaim_def) = 0
     OR position('entry.created_at >= v_grant_created_at' IN v_reclaim_def) > 0 THEN
    RAISE EXCEPTION '回收必須沿餘額鏈歸屬測試點數，不能用建立時間';
  END IF;
  IF position('這位會員已有虛擬道具流水' IN v_reclaim_def) = 0
     OR position('user_inventory' IN v_reclaim_def) > 0
     OR position('DELETE FROM public.member_point_entries' IN v_reclaim_def) > 0 THEN
    RAISE EXCEPTION '回收函式不能假裝已經收回虛擬道具';
  END IF;
  IF position('holdsReleased' IN v_reclaim_def) = 0
     OR position('不會作廢券、訂單或虛擬道具' IN v_reclaim_def) = 0
     OR position('UPDATE public.member_coupon_holds' IN v_reclaim_def) > 0
     OR position('DELETE FROM public.member_coupon_holds' IN v_reclaim_def) > 0 THEN
    RAISE EXCEPTION '回收函式不能假裝已經作廢優惠券';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.post_founder_coupon_test_grant(uuid, text)',
    'public.post_founder_coupon_test_reclaim(uuid, text)'
  ]
  LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '測試補點與回收不能開放給 API';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
       AND has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '測試補點與回收不能開放給 service_role';
    END IF;
  END LOOP;
END
$founder_grant_check$;

-- founder-test-grant-body-end


CREATE TEMP TABLE pg_temp.founder_preview_ready ();
DROP TABLE pg_temp.founder_preview_ready;

CREATE OR REPLACE FUNCTION pg_temp.founder_preview_insert_user(
  p_label text,
  p_confirm boolean
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_id uuid := pg_catalog.gen_random_uuid();
  v_email text;
  v_instance uuid;
  v_column record;
  v_columns text;
  v_values text;
  v_separator text;
  v_expression text;
  v_missing text;
BEGIN
  v_email := 'founder-grant-preview-' || p_label || '-' || replace(v_new_id::text, '-', '') || '@example.invalid';

  SELECT users.instance_id
  INTO v_instance
  FROM auth.users AS users
  WHERE users.instance_id IS NOT NULL
  LIMIT 1;
  IF v_instance IS NULL THEN
    v_instance := '00000000-0000-0000-0000-000000000000';
  END IF;

  v_columns := '';
  v_values := '';
  v_separator := '';
  v_missing := '';

  FOR v_column IN
    SELECT column_info.column_name, column_info.is_nullable, column_info.column_default,
           column_info.is_generated, column_info.is_identity
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = 'auth'
      AND column_info.table_name = 'users'
    ORDER BY column_info.ordinal_position
  LOOP
    IF v_column.is_generated IS DISTINCT FROM 'NEVER' OR v_column.is_identity = 'YES' THEN
      CONTINUE;
    END IF;
    v_expression := NULL;
    IF v_column.column_name = 'id' THEN
      v_expression := format('%L::uuid', v_new_id::text);
    ELSIF v_column.column_name = 'instance_id' THEN
      v_expression := format('%L::uuid', v_instance::text);
    ELSIF v_column.column_name IN ('aud', 'role') THEN
      v_expression := quote_literal('authenticated');
    ELSIF v_column.column_name = 'email' THEN
      v_expression := quote_literal(v_email);
    ELSIF v_column.column_name IN (
      'encrypted_password', 'confirmation_token', 'recovery_token',
      'email_change_token_new', 'email_change', 'email_change_token_current',
      'phone', 'phone_change', 'phone_change_token', 'reauthentication_token'
    ) THEN
      v_expression := quote_literal('');
    ELSIF v_column.column_name = 'raw_app_meta_data' THEN
      v_expression := quote_literal('{"provider":"email","providers":["email"]}') || '::jsonb';
    ELSIF v_column.column_name = 'raw_user_meta_data' THEN
      v_expression := quote_literal('{}') || '::jsonb';
    ELSIF v_column.column_name IN ('created_at', 'updated_at') THEN
      v_expression := 'now()';
    ELSIF v_column.column_name = 'email_confirmed_at' THEN
      v_expression := CASE WHEN p_confirm THEN 'now()' ELSE 'NULL' END;
    ELSIF v_column.column_name IN ('is_super_admin', 'is_sso_user', 'is_anonymous') THEN
      v_expression := 'false';
    ELSIF v_column.column_name = 'email_change_confirm_status' THEN
      v_expression := '0';
    END IF;

    IF v_expression IS NOT NULL THEN
      v_columns := v_columns || v_separator || format('%I', v_column.column_name);
      v_values := v_values || v_separator || v_expression;
      v_separator := ', ';
    ELSIF v_column.is_nullable = 'NO' AND v_column.column_default IS NULL THEN
      v_missing := v_missing || v_column.column_name || ',';
    END IF;
  END LOOP;

  IF v_missing <> '' THEN
    RAISE EXCEPTION '預演停止：auth.users 有未預期的必填欄位 %，不會猜測正式會員結構。交易會回復。', v_missing;
  END IF;
  EXECUTE format('INSERT INTO auth.users (%s) VALUES (%s)', v_columns, v_values);

  IF to_regclass('auth.identities') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM auth.identities AS identity
       WHERE identity.user_id = v_new_id
     ) THEN
    v_columns := '';
    v_values := '';
    v_separator := '';
    v_missing := '';
    FOR v_column IN
      SELECT column_info.column_name, column_info.is_nullable, column_info.column_default,
             column_info.is_generated, column_info.is_identity
      FROM information_schema.columns AS column_info
      WHERE column_info.table_schema = 'auth'
        AND column_info.table_name = 'identities'
      ORDER BY column_info.ordinal_position
    LOOP
      IF v_column.is_generated IS DISTINCT FROM 'NEVER' OR v_column.is_identity = 'YES' THEN
        CONTINUE;
      END IF;
      v_expression := NULL;
      IF v_column.column_name = 'id' THEN
        v_expression := format('%L::uuid', pg_catalog.gen_random_uuid()::text);
      ELSIF v_column.column_name = 'user_id' THEN
        v_expression := format('%L::uuid', v_new_id::text);
      ELSIF v_column.column_name = 'provider' THEN
        v_expression := quote_literal('email');
      ELSIF v_column.column_name = 'provider_id' THEN
        v_expression := quote_literal(v_new_id::text);
      ELSIF v_column.column_name = 'identity_data' THEN
        v_expression := format('%L::jsonb', pg_catalog.jsonb_build_object('sub', v_new_id, 'email', v_email)::text);
      ELSIF v_column.column_name = 'email' THEN
        v_expression := quote_literal(v_email);
      ELSIF v_column.column_name IN ('created_at', 'updated_at', 'last_sign_in_at') THEN
        v_expression := 'now()';
      END IF;
      IF v_expression IS NOT NULL THEN
        v_columns := v_columns || v_separator || format('%I', v_column.column_name);
        v_values := v_values || v_separator || v_expression;
        v_separator := ', ';
      ELSIF v_column.is_nullable = 'NO' AND v_column.column_default IS NULL THEN
        v_missing := v_missing || v_column.column_name || ',';
      END IF;
    END LOOP;
    IF v_missing <> '' THEN
      RAISE EXCEPTION '預演停止：auth.identities 有未預期的必填欄位 %。交易會回復。', v_missing;
    END IF;
    IF v_columns <> '' THEN
      EXECUTE format('INSERT INTO auth.identities (%s) VALUES (%s)', v_columns, v_values);
    END IF;
  END IF;

  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.founder_preview_append_entry(
  p_user_id uuid,
  p_kind text,
  p_claim_key text,
  p_delta integer,
  p_balance_after integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id uuid;
  v_day date := public.taipei_today();
  v_note jsonb := pg_catalog.jsonb_build_object('preview', p_claim_key);
BEGIN
  IF current_setting('app.reward_post', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '預演附加流水需要發獎旗標';
  END IF;
  INSERT INTO public.member_point_entries (
    user_id, delta, balance_after, kind, claim_key, taipei_day, metadata
  )
  VALUES (
    p_user_id, p_delta, p_balance_after, p_kind, p_claim_key, v_day, v_note
  )
  RETURNING id INTO v_entry_id;

  INSERT INTO public.reward_claims (
    user_id, kind, claim_key, taipei_day, delta, balance_after, point_entry_id, metadata
  )
  VALUES (
    p_user_id, p_kind, p_claim_key, v_day, p_delta, p_balance_after, v_entry_id, v_note
  );

  UPDATE public.member_point_accounts AS account
  SET balance = p_balance_after,
      updated_at = pg_catalog.now()
  WHERE account.user_id = p_user_id;
END;
$$;

DO $founder_preview_exercise$
DECLARE
  v_user uuid;
  v_email text;
  v_other uuid;
  v_other_email text;
  v_unconfirmed uuid;
  v_unconfirmed_email text;
  v_day text;
  v_posted jsonb;
  v_balance integer;
  v_checkin_delta integer;
BEGIN
  CREATE TEMP TABLE pg_temp.founder_grant_balance_before AS
  SELECT account.user_id, account.balance
  FROM public.member_point_accounts AS account;

  CREATE TEMP TABLE pg_temp.founder_grant_entry_before AS
  SELECT entry.user_id, count(*)::integer AS entry_count
  FROM public.member_point_entries AS entry
  GROUP BY entry.user_id;

  v_user := pg_temp.founder_preview_insert_user('member', true);
  v_other := pg_temp.founder_preview_insert_user('other', true);
  v_unconfirmed := pg_temp.founder_preview_insert_user('plain', false);

  SELECT users.email INTO v_email FROM auth.users AS users WHERE users.id = v_user;
  SELECT users.email INTO v_other_email FROM auth.users AS users WHERE users.id = v_other;
  SELECT users.email INTO v_unconfirmed_email FROM auth.users AS users WHERE users.id = v_unconfirmed;
  v_day := to_char(public.taipei_today(), 'YYYY-MM-DD');

  DECLARE
    v_chain uuid;
    v_chain_email text;
    v_chain_balance integer;
  BEGIN
    v_chain := pg_temp.founder_preview_insert_user('perk', true);
    SELECT users.email INTO v_chain_email FROM auth.users AS users WHERE users.id = v_chain;
    PERFORM set_config('app.reward_post', 'on', true);
    PERFORM public.post_member_reward(
      v_chain, 'checkin', 'checkin:' || v_day, 50,
      pg_catalog.jsonb_build_object('preview', 'perk-baseline')
    );
    PERFORM public.post_founder_coupon_test_grant(v_chain, v_chain_email);
    PERFORM set_config('app.reward_post', 'on', true);
    PERFORM pg_temp.founder_preview_append_entry(
      v_chain, 'perk_unlock', 'perk_unlock:preview-after-grant', -100, 4900
    );
    BEGIN
      PERFORM public.post_founder_coupon_test_reclaim(v_chain, v_chain_email);
      RAISE EXCEPTION '虛擬道具流水不應被當成可回收';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM IS DISTINCT FROM '這位會員已有虛擬道具流水，這次回收不會猜它能不能收回' THEN
          RAISE;
        END IF;
    END;
    SELECT account.balance
    INTO v_chain_balance
    FROM public.member_point_accounts AS account
    WHERE account.user_id = v_chain;
    IF v_chain_balance IS DISTINCT FROM 4900 THEN
      RAISE EXCEPTION '停止回收時不應改餘額';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.member_point_entries AS entry
      WHERE entry.user_id = v_chain
        AND entry.kind = 'perk_unlock'
        AND entry.delta = -100
    ) THEN
      RAISE EXCEPTION '停止回收時不應刪除虛擬道具流水';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.member_point_entries AS entry
      WHERE entry.kind = 'platform_reclaim'
    ) OR EXISTS (
      SELECT 1
      FROM public.member_coupon_holds AS hold
      WHERE hold.user_id = v_chain
    ) THEN
      RAISE EXCEPTION '虛擬道具流水存在時不應寫入回收或券包';
    END IF;
    PERFORM set_config('app.reward_post', 'off', true);
    RAISE EXCEPTION '道具預演結束，回復這段隔離資料';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '道具預演結束，回復這段隔離資料' THEN
        RAISE;
      END IF;
  END;

  DECLARE
    v_chain uuid;
    v_chain_email text;
    v_posted_chain jsonb;
  BEGIN
    v_chain := pg_temp.founder_preview_insert_user('chain', true);
    SELECT users.email INTO v_chain_email FROM auth.users AS users WHERE users.id = v_chain;
    PERFORM set_config('app.reward_post', 'on', true);
    PERFORM public.post_member_reward(
      v_chain, 'checkin', 'checkin:' || v_day, 50,
      pg_catalog.jsonb_build_object('preview', 'chain-baseline')
    );
    PERFORM pg_temp.founder_preview_append_entry(
      v_chain, 'coupon_exchange', 'coupon_exchange:preview-before-grant', -20, 30
    );
    PERFORM public.post_founder_coupon_test_grant(v_chain, v_chain_email);
    PERFORM set_config('app.reward_post', 'on', true);
    PERFORM pg_temp.founder_preview_append_entry(
      v_chain, 'coupon_exchange', 'coupon_exchange:preview-after-grant', -10, 4990
    );
    -- 這筆只在下面的子交易裡代表「扣點後又賺回同一個餘額」。區塊結束就回復，不會留在主測試會員上。
    PERFORM pg_temp.founder_preview_append_entry(
      v_chain, 'scratch', 'scratch:preview-after-grant', 10, 5000
    );
    v_posted_chain := public.post_founder_coupon_test_reclaim(v_chain, v_chain_email);
    IF (v_posted_chain->>'replayed')::boolean IS DISTINCT FROM false
       OR (v_posted_chain->>'delta')::integer IS DISTINCT FROM -4960
       OR (v_posted_chain->>'balanceAfter')::integer IS DISTINCT FROM 40
       OR (v_posted_chain->>'spentAfterGrant')::integer IS DISTINCT FROM 10
       OR (v_posted_chain->>'grantDelta')::integer IS DISTINCT FROM 4970 THEN
      RAISE EXCEPTION '同一交易時間的扣點必須沿餘額鏈歸屬，不能把補點前的扣點算進測試額度';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.member_point_entries AS entry
      WHERE entry.user_id = v_chain
        AND entry.claim_key = 'coupon_exchange:preview-before-grant'
        AND entry.delta = -20
    ) OR NOT EXISTS (
      SELECT 1
      FROM public.member_point_entries AS entry
      WHERE entry.user_id = v_chain
        AND entry.claim_key = 'scratch:preview-after-grant'
        AND entry.delta = 10
    ) THEN
      RAISE EXCEPTION '補點前的扣點與補點後的正數流水不應被刪除';
    END IF;
    PERFORM set_config('app.reward_post', 'off', true);
    RAISE EXCEPTION '餘額鏈預演結束，回復這段隔離資料';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '餘額鏈預演結束，回復這段隔離資料' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('app.reward_post', 'on', true);
  v_posted := public.post_member_reward(
    v_user,
    'checkin',
    'checkin:' || v_day,
    10,
    pg_catalog.jsonb_build_object('preview', 'founder-grant-baseline')
  );
  PERFORM set_config('app.reward_post', 'off', true);
  IF (v_posted->>'replayed')::boolean IS DISTINCT FROM false
     OR (v_posted->>'delta')::integer IS DISTINCT FROM 10
     OR (v_posted->>'currentBalance')::integer IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '隔離會員的 10 點基準沒有走簽到帳本';
  END IF;

  v_posted := public.post_founder_coupon_test_grant(v_user, v_email);
  IF (v_posted->>'replayed')::boolean IS DISTINCT FROM false
     OR (v_posted->>'balanceBefore')::integer IS DISTINCT FROM 10
     OR (v_posted->>'delta')::integer IS DISTINCT FROM 4990
     OR (v_posted->>'balanceAfter')::integer IS DISTINCT FROM 5000
     OR v_posted->>'userId' IS DISTINCT FROM v_user::text THEN
    RAISE EXCEPTION '10 點基準應補 4990 點，餘額成為 5000，不能再加 5000';
  END IF;

  v_posted := public.post_founder_coupon_test_grant(v_user, v_email);
  IF (v_posted->>'replayed')::boolean IS DISTINCT FROM true
     OR (v_posted->>'delta')::integer IS DISTINCT FROM 0
     OR (v_posted->>'recordedDelta')::integer IS DISTINCT FROM 4990
     OR (v_posted->>'balance')::integer IS DISTINCT FROM 5000 THEN
    RAISE EXCEPTION '同一筆測試補點被重複發放';
  END IF;

  BEGIN
    PERFORM public.post_founder_coupon_test_grant(v_user, v_other_email);
    RAISE EXCEPTION '信箱不符時不應補點';
  EXCEPTION
    WHEN others THEN
      IF position('沒有同時對上同一人' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.post_founder_coupon_test_grant(v_unconfirmed, v_unconfirmed_email);
    RAISE EXCEPTION '未驗證信箱不應補點';
  EXCEPTION
    WHEN others THEN
      IF position('沒有同時對上同一人' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  -- platform_grant 不在既有來源名單，真正拋出的是下面這句。
  -- 「這個獎勵來源尚未開放入帳」只留給名單內尚未開放入帳的來源，這次呼叫到不了。
  BEGIN
    PERFORM set_config('app.reward_post', 'on', true);
    PERFORM public.post_member_reward(
      v_user,
      'platform_grant',
      'platform_grant:founder-coupon-test-20261024',
      5000,
      '{}'::jsonb
    );
    RAISE EXCEPTION '舊發獎函式不應接受測試補點';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '尚未開放這個獎勵來源' THEN
        RAISE;
      END IF;
  END;
  PERFORM set_config('app.reward_post', 'off', true);

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.post_founder_coupon_test_grant(v_user, v_email);
    RAISE EXCEPTION '一般會員不應能呼叫測試補點';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('app.reward_post', 'on', true);
  v_posted := public.post_coupon_exchange_debit(
    v_user,
    'coupon_exchange:preview-founder-test',
    pg_catalog.jsonb_build_object('preview', 'founder-grant-spend')
  );
  PERFORM set_config('app.reward_post', 'off', true);
  IF (v_posted->>'delta')::integer IS DISTINCT FROM -100
     OR (v_posted->>'currentBalance')::integer IS DISTINCT FROM 4900 THEN
    RAISE EXCEPTION '預演扣點後餘額應是 4900';
  END IF;

  v_posted := public.post_founder_coupon_test_reclaim(v_user, v_email);
  IF (v_posted->>'replayed')::boolean IS DISTINCT FROM false
     OR (v_posted->>'recorded')::boolean IS DISTINCT FROM true
     OR (v_posted->>'delta')::integer IS DISTINCT FROM -4890
     OR (v_posted->>'balanceAfter')::integer IS DISTINCT FROM 10
     OR (v_posted->>'holdsReleased')::boolean IS DISTINCT FROM false
     OR position('不會作廢券' IN v_posted->>'entitlementLimit') = 0 THEN
    RAISE EXCEPTION '應只收回尚未花掉的 4890 測試點，並留下原本的 10 點';
  END IF;

  v_posted := public.post_founder_coupon_test_reclaim(v_user, v_email);
  IF (v_posted->>'replayed')::boolean IS DISTINCT FROM true
     OR (v_posted->>'delta')::integer IS DISTINCT FROM 0
     OR (v_posted->>'balance')::integer IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '同一筆測試回收被重複扣點';
  END IF;

  v_posted := public.post_founder_coupon_test_grant(v_user, v_email);
  IF (v_posted->>'replayed')::boolean IS DISTINCT FROM true
     OR (v_posted->>'balance')::integer IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '回收後再次補點不應把餘額重補到 5000';
  END IF;

  BEGIN
    PERFORM public.post_founder_coupon_test_grant(v_other, v_other_email);
    RAISE EXCEPTION '第二位會員不應能領同一筆測試補點';
  EXCEPTION
    WHEN others THEN
      IF position('已經記在其他紀錄' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    UPDATE public.member_point_accounts AS account
    SET balance = account.balance + 1
    WHERE account.user_id = v_user;
    RAISE EXCEPTION '沒有發獎旗標時不應能改餘額';
  EXCEPTION
    WHEN others THEN
      IF position('點數餘額只能由發獎交易更新' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  EXECUTE 'SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE';

  SELECT account.balance
  INTO v_balance
  FROM public.member_point_accounts AS account
  WHERE account.user_id = v_user;
  SELECT entry.delta
  INTO v_checkin_delta
  FROM public.member_point_entries AS entry
  WHERE entry.user_id = v_user
    AND entry.kind = 'checkin';

  IF v_balance IS DISTINCT FROM 10 OR v_checkin_delta IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '回收後應留下簽到的 10 點';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.member_point_entries AS entry
    WHERE entry.user_id = v_user
      AND entry.kind = 'scratch'
  ) THEN
    RAISE EXCEPTION '預演不應偽造刮卡流水';
  END IF;
  IF (
    SELECT count(*)
    FROM public.member_point_entries AS entry
    WHERE entry.kind = 'platform_grant'
  ) IS DISTINCT FROM 1
  OR (
    SELECT count(*)
    FROM public.reward_claims AS claim
    WHERE claim.kind = 'platform_reclaim'
      AND claim.delta = -4890
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '測試補點與回收必須各只有一筆對應流水';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.founder_grant_balance_before AS prior
    JOIN public.member_point_accounts AS account ON account.user_id = prior.user_id
    WHERE account.balance IS DISTINCT FROM prior.balance
  ) THEN
    RAISE EXCEPTION '預演改到了既有會員餘額。交易會回復。';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_temp.founder_grant_balance_before AS prior
    LEFT JOIN (
      SELECT entry.user_id, count(*)::integer AS entry_count
      FROM public.member_point_entries AS entry
      GROUP BY entry.user_id
    ) AS after_entries ON after_entries.user_id = prior.user_id
    LEFT JOIN pg_temp.founder_grant_entry_before AS prior_entries
      ON prior_entries.user_id = prior.user_id
    WHERE coalesce(after_entries.entry_count, 0) IS DISTINCT FROM coalesce(prior_entries.entry_count, 0)
  ) THEN
    RAISE EXCEPTION '預演改到了既有會員流水。交易會回復。';
  END IF;
END
$founder_preview_exercise$;

ROLLBACK;
