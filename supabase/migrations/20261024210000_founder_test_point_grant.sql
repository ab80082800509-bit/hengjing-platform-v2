-- =============================================================================
-- 創始人優惠券測試額度：把指定會員的可用餘額補足至 5,000 點，並保留一次回收。
-- 請先整份執行 supabase/manual/20261024210000_founder_test_point_grant_preview.sql。
-- 預演以 ROLLBACK 結束，不留下結構或點數。預演通過後，才人工執行這份正式 migration。
-- 本檔只提交結構與兩支內部函式，不會給任何會員入帳。
-- 本檔不會被這次作業自動執行。
--
-- 不修改 post_member_reward、簽到、刮卡、邀請或券包保護。
-- 不直接改餘額。餘額列仍只在流水與領獎寫入後，由同一筆發獎交易回寫，
-- 而且必須等於流水合計；沒有 app.reward_post 時，既有觸發器會拒絕。
-- 補點是補到 5,000，不是再加 5,000。全庫這組領獎鍵只能各有一筆。
-- 回收只扣這筆測試補點裡還沒花掉的點數。花掉與否只看補點那一列之後的餘額鏈，
-- 不看 created_at，也不看 UUID。同一交易的 now() 相同；並發扣點的交易開始時間也可能早於補點。
-- 下一筆的 balance_after - delta 必須等於上一筆的 balance_after，而且同一個餘額只能接出一筆。
-- 鏈上的負數目前只接受優惠券扣點，並全部先算成花掉測試點。鏈上的簽到與刮卡不扣。
-- 補點前的流水不在這條鏈上，即使建立時間相同也不扣。已走過的流水不重走。
-- 鏈斷掉、分岔，或可回收額大於目前餘額時，整筆停止。
-- 會員只要已有 perk_unlock 就整筆停止。第五批永久 Inventory 尚未建立，這次不能清虛擬特權。
-- 點數兌換券不能改、不能刪，也沒有核銷欄位。回收函式不會作廢券、訂單或虛擬道具。
-- =============================================================================

BEGIN;

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

COMMIT;
