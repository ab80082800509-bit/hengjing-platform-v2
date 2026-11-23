-- =============================================================================
-- 預演：BEGIN → 建立發獎帳本 → 檢查權限與台北日 → 用既有會員試算 → ROLLBACK
-- 請在 Supabase SQL Editor 一次執行整份，不要逐句執行。本檔不會被這次作業自動執行。
--
-- 交易結束時 ROLLBACK。正式資料庫不會留下這次建立的表、函式或點數。
-- 若正式 migration 已經執行過，ROLLBACK 會回到執行前的函式與空帳本，不會保留試算點數。
-- 不修改 profiles、products、orders、庫存、既有 RLS 或結帳開關。
-- 不讀寫邀請資料庫，不建立會員，不把訪客進站當成註冊。
--
-- 需要至少一位既有 auth.users。帳本表若已經有資料，預演會停止並回復。
-- 訪客綁定不寫入。一般會員必須實際呼叫並被權限拒絕；只模擬 JWT，或用管理者連線呼叫，都不算權限通過。
-- 這是單一連線的試算，不能代替兩個同時請求的並發測試。
-- 檢查失敗時交易會中止。若編輯器停在錯誤，請單獨執行 ROLLBACK，不要提交。
--
-- 預演完成後若要確認乾淨環境沒有留下新表，請單獨執行下面這句，不要和本檔一起執行：
-- SELECT to_regclass('public.member_point_entries') AS entries_table;
-- 從未執行正式 migration 時，結果應為 NULL。NULL 只代表預演已回復，不是點數測試通過。
-- =============================================================================

BEGIN;

-- reward-ledger-body-start

DO $reward_ledger_database$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION '這份帳本只能建立在有 auth.users 的 Supabase，不能建立在邀請資料庫';
  END IF;
END
$reward_ledger_database$;

CREATE OR REPLACE FUNCTION public.taipei_today(p_at timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT (timezone('Asia/Taipei', p_at))::date;
$$;

COMMENT ON FUNCTION public.taipei_today(timestamptz) IS
  '把一個絕對時間換算成 Asia/Taipei 日曆日。發獎只呼叫不帶參數的 taipei_today()，使用資料庫交易時鐘。';

CREATE TABLE IF NOT EXISTS public.member_visitor_links (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  visitor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_visitor_links_pkey PRIMARY KEY (visitor_id),
  CONSTRAINT member_visitor_links_visitor_format CHECK (visitor_id ~ '^[a-f0-9]{32}$')
);

CREATE INDEX IF NOT EXISTS member_visitor_links_user
  ON public.member_visitor_links (user_id);

COMMENT ON TABLE public.member_visitor_links IS
  'Supabase 會員與瀏覽器訪客編號的對照。一個訪客編號只能屬於一位會員；一位會員可以有多個裝置。綁定本身不發獎，也不寫入邀請資料庫。';

CREATE TABLE IF NOT EXISTS public.member_point_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
  balance integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_point_accounts_balance_nonnegative CHECK (balance >= 0)
);

COMMENT ON TABLE public.member_point_accounts IS
  '會員點數餘額。餘額只能由發獎交易更新，而且必須等於該會員流水合計。';

CREATE TABLE IF NOT EXISTS public.member_point_entries (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  delta integer NOT NULL,
  balance_after integer NOT NULL,
  kind text NOT NULL,
  claim_key text NOT NULL,
  taipei_day date NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_point_entries_delta_nonzero CHECK (delta <> 0),
  CONSTRAINT member_point_entries_balance_after_nonnegative CHECK (balance_after >= 0),
  CONSTRAINT member_point_entries_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT member_point_entries_kind_known CHECK (
    kind IN ('checkin', 'scratch', 'coupon_exchange', 'perk_unlock')
  ),
  CONSTRAINT member_point_entries_key_shape CHECK (
    (kind = 'checkin' AND claim_key ~ '^checkin:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    OR (kind = 'scratch' AND claim_key ~ '^scratch:[A-Za-z0-9:_-]{1,120}$')
    OR (kind = 'coupon_exchange' AND claim_key ~ '^coupon_exchange:[A-Za-z0-9:_-]{1,120}$')
    OR (kind = 'perk_unlock' AND claim_key ~ '^perk_unlock:[A-Za-z0-9:_-]{1,120}$')
  ),
  CONSTRAINT member_point_entries_user_claim UNIQUE (user_id, claim_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS member_point_entries_one_checkin_per_taipei_day
  ON public.member_point_entries (user_id, taipei_day)
  WHERE kind = 'checkin';

CREATE INDEX IF NOT EXISTS member_point_entries_user_created
  ON public.member_point_entries (user_id, created_at DESC, id DESC);

COMMENT ON TABLE public.member_point_entries IS
  '點數流水。建立後不可修改或刪除。同一會員的同一個領獎鍵只能有一筆。';

CREATE TABLE IF NOT EXISTS public.reward_claims (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  kind text NOT NULL,
  claim_key text NOT NULL,
  taipei_day date NOT NULL,
  delta integer NOT NULL,
  balance_after integer NOT NULL,
  point_entry_id uuid NOT NULL UNIQUE REFERENCES public.member_point_entries (id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reward_claims_delta_nonzero CHECK (delta <> 0),
  CONSTRAINT reward_claims_balance_after_nonnegative CHECK (balance_after >= 0),
  CONSTRAINT reward_claims_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT reward_claims_kind_known CHECK (
    kind IN ('checkin', 'scratch', 'coupon_exchange', 'perk_unlock')
  ),
  CONSTRAINT reward_claims_key_shape CHECK (
    (kind = 'checkin' AND claim_key ~ '^checkin:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    OR (kind = 'scratch' AND claim_key ~ '^scratch:[A-Za-z0-9:_-]{1,120}$')
    OR (kind = 'coupon_exchange' AND claim_key ~ '^coupon_exchange:[A-Za-z0-9:_-]{1,120}$')
    OR (kind = 'perk_unlock' AND claim_key ~ '^perk_unlock:[A-Za-z0-9:_-]{1,120}$')
  ),
  CONSTRAINT reward_claims_user_claim UNIQUE (user_id, claim_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS reward_claims_one_checkin_per_taipei_day
  ON public.reward_claims (user_id, taipei_day)
  WHERE kind = 'checkin';

COMMENT ON TABLE public.reward_claims IS
  '已入帳的領獎紀錄，與點數流水一對一。簽到另以台北日唯一索引防止同一天兩筆。';

CREATE OR REPLACE FUNCTION public.reject_reward_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION '點數流水與領獎紀錄不可修改或刪除';
END;
$$;

DROP TRIGGER IF EXISTS member_point_entries_no_mutation ON public.member_point_entries;
CREATE TRIGGER member_point_entries_no_mutation
  BEFORE UPDATE OR DELETE ON public.member_point_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_reward_ledger_mutation();

DROP TRIGGER IF EXISTS reward_claims_no_mutation ON public.reward_claims;
CREATE TRIGGER reward_claims_no_mutation
  BEFORE UPDATE OR DELETE ON public.reward_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_reward_ledger_mutation();

CREATE OR REPLACE FUNCTION public.guard_member_point_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '點數帳戶不可刪除';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION '不能變更點數帳戶的會員';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.balance <> 0 THEN
    RAISE EXCEPTION '點數餘額與流水不一致';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.balance IS DISTINCT FROM OLD.balance
     AND current_setting('app.reward_post', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '點數餘額只能由發獎交易更新';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_point_accounts_guard ON public.member_point_accounts;
CREATE TRIGGER member_point_accounts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_point_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_member_point_account();

CREATE OR REPLACE FUNCTION public.member_points_balance_matches()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  summed bigint;
BEGIN
  SELECT coalesce(sum(delta), 0)
  INTO summed
  FROM public.member_point_entries
  WHERE user_id = NEW.user_id;

  IF summed IS DISTINCT FROM NEW.balance::bigint THEN
    RAISE EXCEPTION '點數餘額與流水不一致';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_point_accounts_balance_matches ON public.member_point_accounts;
CREATE TRIGGER member_point_accounts_balance_matches
  AFTER INSERT OR UPDATE ON public.member_point_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.member_points_balance_matches();

CREATE OR REPLACE FUNCTION public.member_point_entry_requires_claim()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.reward_claims
    WHERE point_entry_id = NEW.id
  ) THEN
    RAISE EXCEPTION '點數流水缺少領獎紀錄';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_point_entries_require_claim ON public.member_point_entries;
CREATE CONSTRAINT TRIGGER member_point_entries_require_claim
  AFTER INSERT ON public.member_point_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.member_point_entry_requires_claim();

CREATE OR REPLACE FUNCTION public.reward_claim_matches_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  entry public.member_point_entries%ROWTYPE;
BEGIN
  SELECT *
  INTO entry
  FROM public.member_point_entries
  WHERE id = NEW.point_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '領獎紀錄缺少點數流水';
  END IF;
  IF entry.user_id IS DISTINCT FROM NEW.user_id
     OR entry.claim_key IS DISTINCT FROM NEW.claim_key
     OR entry.kind IS DISTINCT FROM NEW.kind
     OR entry.delta IS DISTINCT FROM NEW.delta
     OR entry.balance_after IS DISTINCT FROM NEW.balance_after
     OR entry.taipei_day IS DISTINCT FROM NEW.taipei_day
     OR entry.metadata IS DISTINCT FROM NEW.metadata
  THEN
    RAISE EXCEPTION '領獎紀錄與點數流水不一致';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reward_claims_match_entry ON public.reward_claims;
CREATE TRIGGER reward_claims_match_entry
  AFTER INSERT ON public.reward_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.reward_claim_matches_entry();

CREATE OR REPLACE FUNCTION public.post_member_reward(
  p_user_id uuid,
  p_kind text,
  p_claim_key text,
  p_delta integer,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  day date;
  account public.member_point_accounts%ROWTYPE;
  existing_claim public.reward_claims%ROWTYPE;
  entry_id uuid;
  claim_id uuid;
  next_balance integer;
BEGIN
  -- 沒有這個交易內旗標就不能寫餘額。API 角色另外已撤銷執行權。
  IF current_setting('app.reward_post', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '發獎只能由資料庫內部交易呼叫';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;
  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION '獎勵附註必須是物件';
  END IF;
  IF octet_length(p_metadata::text) > 1024 THEN
    RAISE EXCEPTION '獎勵附註過長';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('checkin', 'scratch', 'coupon_exchange', 'perk_unlock') THEN
    RAISE EXCEPTION '尚未開放這個獎勵來源';
  END IF;
  IF p_kind <> 'checkin' THEN
    RAISE EXCEPTION '這個獎勵來源尚未開放入帳';
  END IF;

  day := public.taipei_today();
  IF p_claim_key IS DISTINCT FROM ('checkin:' || to_char(day, 'YYYY-MM-DD')) THEN
    RAISE EXCEPTION '簽到領獎鍵必須使用資料庫台北日';
  END IF;
  IF p_delta IS NULL OR p_delta NOT IN (10, 15, 20, 50) THEN
    RAISE EXCEPTION '簽到點數必須是已確認的 10、15、20 或 50';
  END IF;

  INSERT INTO public.member_point_accounts (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT *
  INTO account
  FROM public.member_point_accounts
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '無法鎖定點數帳戶';
  END IF;

  SELECT *
  INTO existing_claim
  FROM public.reward_claims
  WHERE user_id = p_user_id
    AND claim_key = p_claim_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing_claim.kind IS DISTINCT FROM p_kind OR existing_claim.delta IS DISTINCT FROM p_delta THEN
      RAISE EXCEPTION '同一領獎鍵不可改寫來源或點數';
    END IF;
    RETURN jsonb_build_object(
      'replayed', true,
      'claimId', existing_claim.id,
      'pointEntryId', existing_claim.point_entry_id,
      'delta', existing_claim.delta,
      'balanceAfter', existing_claim.balance_after,
      'currentBalance', account.balance,
      'taipeiDay', existing_claim.taipei_day,
      'kind', existing_claim.kind,
      'claimKey', existing_claim.claim_key
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reward_claims
    WHERE user_id = p_user_id
      AND kind = 'checkin'
      AND taipei_day = day
      AND claim_key IS DISTINCT FROM p_claim_key
  ) THEN
    RAISE EXCEPTION '同一天不能重複簽到';
  END IF;

  next_balance := account.balance + p_delta;
  IF next_balance < 0 THEN
    RAISE EXCEPTION '點數不足';
  END IF;

  INSERT INTO public.member_point_entries (
    user_id, delta, balance_after, kind, claim_key, taipei_day, metadata
  )
  VALUES (
    p_user_id, p_delta, next_balance, p_kind, p_claim_key, day, p_metadata
  )
  RETURNING id INTO entry_id;

  UPDATE public.member_point_accounts
  SET balance = next_balance,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.reward_claims (
    user_id, kind, claim_key, taipei_day, delta, balance_after, point_entry_id, metadata
  )
  VALUES (
    p_user_id, p_kind, p_claim_key, day, p_delta, next_balance, entry_id, p_metadata
  )
  RETURNING id INTO claim_id;

  RETURN jsonb_build_object(
    'replayed', false,
    'claimId', claim_id,
    'pointEntryId', entry_id,
    'delta', p_delta,
    'balanceAfter', next_balance,
    'currentBalance', next_balance,
    'taipeiDay', day,
    'kind', p_kind,
    'claimKey', p_claim_key
  );
END;
$$;

COMMENT ON FUNCTION public.post_member_reward(uuid, text, text, integer, jsonb) IS
  '內部發獎。先鎖會員帳戶，再以領獎鍵回放；簽到鍵與台北日都由資料庫時鐘產生。不對 API 角色開放。';

CREATE OR REPLACE FUNCTION public.link_my_visitor(p_visitor_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  owner uuid;
  inserted text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_visitor_id IS NULL OR p_visitor_id !~ '^[a-f0-9]{32}$' THEN
    RAISE EXCEPTION '訪客身分格式不正確';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('visitor:' || p_visitor_id, 0));

  inserted := NULL;
  INSERT INTO public.member_visitor_links (user_id, visitor_id)
  VALUES (uid, p_visitor_id)
  ON CONFLICT (visitor_id) DO NOTHING
  RETURNING visitor_id INTO inserted;

  SELECT user_id
  INTO owner
  FROM public.member_visitor_links
  WHERE visitor_id = p_visitor_id;

  IF owner IS NULL THEN
    RAISE EXCEPTION '無法完成訪客綁定';
  END IF;
  IF owner IS DISTINCT FROM uid THEN
    RAISE EXCEPTION '這個訪客身分已經綁定其他會員';
  END IF;

  RETURN jsonb_build_object('linked', true, 'replayed', inserted IS NULL);
END;
$$;

COMMENT ON FUNCTION public.link_my_visitor(text) IS
  '保留的訪客綁定。目前只能確認登入會員與編號格式，還不能證明呼叫者擁有該編號，所以暫時不授權給 PUBLIC、anon、authenticated、service_role。不發點數，也不讀邀請資料庫。';

CREATE OR REPLACE FUNCTION public.get_my_reward_account()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  bal integer := 0;
  links integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;

  SELECT balance
  INTO bal
  FROM public.member_point_accounts
  WHERE user_id = uid;
  IF NOT FOUND THEN
    bal := 0;
  END IF;

  SELECT count(*)::integer
  INTO links
  FROM public.member_visitor_links
  WHERE user_id = uid;

  RETURN jsonb_build_object(
    'balance', bal,
    'taipeiDay', public.taipei_today(),
    'visitorLinkCount', links
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_reward_account() IS
  '讀取自己的點數餘額、資料庫台北日與已綁定訪客數。不建立帳戶，也不發獎。';

ALTER TABLE public.member_visitor_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_point_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_point_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.member_visitor_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_point_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_point_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.reward_claims FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.taipei_today(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_reward_ledger_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_member_point_account() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.member_points_balance_matches() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.member_point_entry_requires_claim() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reward_claim_matches_entry() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_member_reward(uuid, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_my_visitor(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_reward_account() FROM PUBLIC, anon, authenticated;

DO $revoke_service$
DECLARE
  fn text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RETURN;
  END IF;
  EXECUTE 'REVOKE ALL ON TABLE public.member_visitor_links FROM service_role';
  EXECUTE 'REVOKE ALL ON TABLE public.member_point_accounts FROM service_role';
  EXECUTE 'REVOKE ALL ON TABLE public.member_point_entries FROM service_role';
  EXECUTE 'REVOKE ALL ON TABLE public.reward_claims FROM service_role';
  FOREACH fn IN ARRAY ARRAY[
    'public.taipei_today(timestamptz)',
    'public.reject_reward_ledger_mutation()',
    'public.guard_member_point_account()',
    'public.member_points_balance_matches()',
    'public.member_point_entry_requires_claim()',
    'public.reward_claim_matches_entry()',
    'public.post_member_reward(uuid, text, text, integer, jsonb)',
    'public.link_my_visitor(text)',
    'public.get_my_reward_account()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', fn);
  END LOOP;
END
$revoke_service$;

GRANT EXECUTE ON FUNCTION public.get_my_reward_account() TO authenticated;

DO $reward_ledger_check$
DECLARE
  def text := pg_get_functiondef('public.post_member_reward(uuid, text, text, integer, jsonb)'::regprocedure);
  missing text := '';
  rel text;
  actor text;
  priv text;
  actors text[] := ARRAY['anon', 'authenticated'];
  locked_fn text;
BEGIN
  IF public.taipei_today('2026-10-22 00:00:00+00'::timestamptz) <> DATE '2026-10-22' THEN
    RAISE EXCEPTION '台北日在 UTC 午夜不應是前一天';
  END IF;
  IF public.taipei_today('2026-10-21 16:00:00+00'::timestamptz) <> DATE '2026-10-22' THEN
    RAISE EXCEPTION '台北日應從 UTC 16:00 開始';
  END IF;
  IF public.taipei_today('2026-10-22 15:59:59+00'::timestamptz) <> DATE '2026-10-22' THEN
    RAISE EXCEPTION '台北日在 23:59 不應換日';
  END IF;
  IF public.taipei_today('2026-10-22 16:00:00+00'::timestamptz) <> DATE '2026-10-23' THEN
    RAISE EXCEPTION '台北日應在 UTC 16:00 換到下一天';
  END IF;
  IF position('Asia/Taipei' IN pg_get_functiondef('public.taipei_today(timestamptz)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '台北日必須使用 Asia/Taipei';
  END IF;

  IF position('FOR UPDATE' IN def) = 0 THEN missing := missing || ' for_update'; END IF;
  IF position('taipei_today()' IN def) = 0 THEN missing := missing || ' taipei_today'; END IF;
  IF position('p_delta NOT IN (10, 15, 20, 50)' IN def) = 0 THEN missing := missing || ' checkin_amounts'; END IF;
  IF position('這個獎勵來源尚未開放入帳' IN def) = 0 THEN missing := missing || ' closed_kind'; END IF;
  IF position('點數不足' IN def) = 0 THEN missing := missing || ' insufficient'; END IF;
  IF position('app.reward_post' IN def) = 0 THEN missing := missing || ' internal_flag'; END IF;
  IF position('timestamptz' IN pg_get_function_identity_arguments('public.post_member_reward(uuid, text, text, integer, jsonb)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '發獎函式不能接受呼叫端傳入時間';
  END IF;
  IF missing <> '' THEN
    RAISE EXCEPTION '發獎函式檢查未過，缺少:%', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.post_member_reward(uuid, text, text, integer, jsonb)'::regprocedure
      AND prosecdef
      AND provolatile = 'v'
      AND EXISTS (
        SELECT 1
        FROM unnest(coalesce(proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
          AND cfg LIKE '%public%'
          AND cfg LIKE '%pg_catalog%'
      )
  ) THEN
    RAISE EXCEPTION '發獎函式必須是 VOLATILE SECURITY DEFINER，且固定 search_path';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.taipei_today(timestamptz)'::regprocedure
      AND prosecdef
  ) THEN
    RAISE EXCEPTION '台北日函式不應提權';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.post_member_reward(uuid, text, text, integer, jsonb)'::regprocedure
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
    RAISE EXCEPTION 'PUBLIC 不應能發獎';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.link_my_visitor(text)'::regprocedure
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
    RAISE EXCEPTION 'PUBLIC 不應能綁定訪客';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    actors := array_append(actors, 'service_role');
  END IF;

  FOREACH locked_fn IN ARRAY ARRAY[
    'public.post_member_reward(uuid, text, text, integer, jsonb)',
    'public.reject_reward_ledger_mutation()',
    'public.guard_member_point_account()',
    'public.member_points_balance_matches()',
    'public.member_point_entry_requires_claim()',
    'public.reward_claim_matches_entry()',
    'public.taipei_today(timestamptz)'
  ]
  LOOP
    FOREACH actor IN ARRAY actors LOOP
      IF has_function_privilege(actor, locked_fn, 'EXECUTE') THEN
        RAISE EXCEPTION '% 不應能執行 %', actor, locked_fn;
      END IF;
    END LOOP;
  END LOOP;

  IF has_function_privilege('authenticated', 'public.link_my_visitor(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '登入會員暫時不能呼叫訪客綁定';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_my_reward_account()', 'EXECUTE') THEN
    RAISE EXCEPTION '登入會員應能讀取自己的點數餘額';
  END IF;

  FOREACH actor IN ARRAY actors LOOP
    IF has_function_privilege(actor, 'public.link_my_visitor(text)', 'EXECUTE') THEN
      RAISE EXCEPTION '% 不應能執行訪客綁定', actor;
    END IF;
    IF actor <> 'authenticated'
       AND has_function_privilege(actor, 'public.get_my_reward_account()', 'EXECUTE') THEN
      RAISE EXCEPTION '% 不應能讀取發獎帳戶', actor;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'public.link_my_visitor(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_my_reward_account()', 'EXECUTE') THEN
    RAISE EXCEPTION '匿名角色不應能讀取或綁定發獎帳戶';
  END IF;

  FOREACH rel IN ARRAY ARRAY[
    'member_point_accounts',
    'member_point_entries',
    'reward_claims',
    'member_visitor_links'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = rel
        AND c.relrowsecurity
        AND NOT c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'public.% 必須開啟 RLS，且不能強制套用到擁有者', rel;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = rel
    ) THEN
      RAISE EXCEPTION 'public.% 不應有直接資料表政策', rel;
    END IF;
    FOREACH actor IN ARRAY actors LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
      LOOP
        IF has_table_privilege(actor, format('public.%I', rel), priv) THEN
          RAISE EXCEPTION '% 不應能對 public.% 執行 %', actor, rel, priv;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'reward_claims_one_checkin_per_taipei_day'
  ) THEN
    RAISE EXCEPTION '缺少每日簽到唯一索引';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'member_point_entries_one_checkin_per_taipei_day'
  ) THEN
    RAISE EXCEPTION '缺少每日簽到流水唯一索引';
  END IF;
END
$reward_ledger_check$;

-- reward-ledger-body-end

-- 以下只在預演交易內寫入，最後會 ROLLBACK。
DO $reward_preview$
DECLARE
  uid uuid;
  day date;
  claim_key text;
  posted jsonb;
  replay jsonb;
BEGIN
  SELECT id INTO uid FROM auth.users ORDER BY id LIMIT 1;
  IF uid IS NULL THEN
    RAISE EXCEPTION '預演停止：至少需要一位既有會員才能試算。交易會回復，不會建立會員。';
  END IF;

  IF EXISTS (SELECT 1 FROM public.member_point_accounts)
     OR EXISTS (SELECT 1 FROM public.member_point_entries)
     OR EXISTS (SELECT 1 FROM public.reward_claims)
     OR EXISTS (SELECT 1 FROM public.member_visitor_links) THEN
    RAISE EXCEPTION '預演停止：帳本已經有資料。交易會回復，不會在既有餘額上試算。';
  END IF;

  day := public.taipei_today();
  claim_key := 'checkin:' || to_char(day, 'YYYY-MM-DD');
  PERFORM set_config('app.reward_post', 'off', true);

  BEGIN
    PERFORM public.post_member_reward(uid, 'checkin', claim_key, 10, '{}'::jsonb);
    RAISE EXCEPTION '未開啟內部旗標時不應入帳';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('發獎只能由資料庫內部交易呼叫' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('app.reward_post', 'on', true);
  posted := public.post_member_reward(
    uid,
    'checkin',
    claim_key,
    10,
    jsonb_build_object('clientDay', '1999-01-01')
  );
  IF (posted->>'replayed')::boolean IS DISTINCT FROM false
     OR (posted->>'currentBalance')::integer IS DISTINCT FROM 10
     OR posted->>'taipeiDay' IS DISTINCT FROM to_char(day, 'YYYY-MM-DD') THEN
    RAISE EXCEPTION '第一次簽到沒有依資料庫台北日入帳 10 點';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.member_point_entries
    WHERE user_id = uid AND taipei_day = DATE '1999-01-01'
  ) THEN
    RAISE EXCEPTION '附註裡的日期被當成發獎日';
  END IF;

  SET CONSTRAINTS ALL IMMEDIATE;

  replay := public.post_member_reward(uid, 'checkin', claim_key, 10, '{}'::jsonb);
  IF (replay->>'replayed')::boolean IS DISTINCT FROM true
     OR (replay->>'currentBalance')::integer IS DISTINCT FROM 10
     OR (SELECT count(*) FROM public.member_point_entries) IS DISTINCT FROM 1
     OR (SELECT count(*) FROM public.reward_claims) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '重複呼叫應該回放原領獎，不能再次入帳';
  END IF;

  BEGIN
    PERFORM public.post_member_reward(uid, 'checkin', claim_key, 11, '{}'::jsonb);
    RAISE EXCEPTION '未確認的簽到金額不應入帳';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('簽到點數必須是已確認的 10、15、20 或 50' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.post_member_reward(uid, 'checkin', claim_key, 50, '{}'::jsonb);
    RAISE EXCEPTION '同一領獎鍵不應改寫點數';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('同一領獎鍵不可改寫來源或點數' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.post_member_reward(uid, 'checkin', 'checkin:1999-01-01', 10, '{}'::jsonb);
    RAISE EXCEPTION '呼叫端不應指定簽到日期';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('簽到領獎鍵必須使用資料庫台北日' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.post_member_reward(uid, 'scratch', 'scratch:free:1', 10, '{}'::jsonb);
    RAISE EXCEPTION '刮卡不應在第一批入帳';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('這個獎勵來源尚未開放入帳' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.post_member_reward(uid, 'invite', 'invite:1', 10, '{}'::jsonb);
    RAISE EXCEPTION '邀請不應成為點數來源';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('尚未開放這個獎勵來源' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('app.reward_post', 'off', true);
  BEGIN
    UPDATE public.member_point_accounts SET balance = balance + 1 WHERE user_id = uid;
    RAISE EXCEPTION '關閉旗標後仍改到餘額';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('點數餘額只能由發獎交易更新' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('app.reward_post', 'on', true);
  BEGIN
    UPDATE public.member_point_accounts SET balance = balance + 1 WHERE user_id = uid;
    RAISE EXCEPTION '餘額被單獨改寫';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('點數餘額與流水不一致' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    UPDATE public.member_point_entries SET delta = 50 WHERE user_id = uid;
    RAISE EXCEPTION '流水被改寫';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('點數流水與領獎紀錄不可修改或刪除' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    DELETE FROM public.reward_claims WHERE user_id = uid;
    RAISE EXCEPTION '領獎紀錄被刪除';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('點數流水與領獎紀錄不可修改或刪除' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    DELETE FROM public.member_point_accounts WHERE user_id = uid;
    RAISE EXCEPTION '點數帳戶被刪除';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('點數帳戶不可刪除' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO public.member_point_entries (
      user_id, delta, balance_after, kind, claim_key, taipei_day
    )
    VALUES (uid, 10, 10, 'checkin', 'checkin:1999-01-01', DATE '1999-01-01');
    RAISE EXCEPTION '沒有領獎紀錄的流水被留下';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('點數流水缺少領獎紀錄' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('app.reward_preview_day', to_char(day, 'YYYY-MM-DD'), true);
  IF auth.uid() IS DISTINCT FROM uid THEN
    RAISE EXCEPTION '點數試算已通過內部檢查，但無法模擬 auth.uid()，一般會員讀取測試停止。交易會回復，不會留下點數。';
  END IF;
END
$reward_preview$;

-- 這裡的連線仍是管理者。管理者能執行 SECURITY DEFINER，不能拿來證明一般會員沒有權限。
SET LOCAL ROLE authenticated;

DO $reward_preview_as_member$
DECLARE
  account jsonb;
  denied boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '切換到一般會員後讀不到 auth.uid()。交易會回復。';
  END IF;

  account := public.get_my_reward_account();
  IF (account->>'balance')::integer IS DISTINCT FROM 10
     OR account->>'taipeiDay' IS DISTINCT FROM current_setting('app.reward_preview_day')
     OR (account->>'visitorLinkCount')::integer IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '一般會員讀到的餘額、台北日或訪客數不正確';
  END IF;

  BEGIN
    PERFORM public.link_my_visitor('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF position('link_my_visitor' IN SQLERRM) = 0 THEN
        RAISE EXCEPTION '一般會員被拒絕的原因不是函式權限：%', SQLERRM;
      END IF;
      denied := true;
    WHEN OTHERS THEN
      RAISE EXCEPTION '一般會員呼叫訪客綁定時進入了函式，這不是權限拒絕：%', SQLERRM;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION '一般會員呼叫訪客綁定時沒有被拒絕';
  END IF;
END
$reward_preview_as_member$;

RESET ROLE;

DO $reward_preview_after_member$
DECLARE
  uid uuid;
BEGIN
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION '權限驗證後仍停在一般會員角色，後續檢查不能算數';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_visitor_links) THEN
    RAISE EXCEPTION '被拒絕的訪客綁定不應寫入資料';
  END IF;
  SELECT id INTO uid FROM auth.users ORDER BY id LIMIT 1;
  IF (SELECT count(*) FROM public.member_point_entries) IS DISTINCT FROM 1
     OR (SELECT count(*) FROM public.reward_claims) IS DISTINCT FROM 1
     OR (SELECT balance FROM public.member_point_accounts WHERE user_id = uid) IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '預演結束時的餘額或流水不正確';
  END IF;
  IF has_function_privilege('authenticated', 'public.link_my_visitor(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.link_my_visitor(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '一般會員或匿名角色仍可執行訪客綁定';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
     AND has_function_privilege('service_role', 'public.link_my_visitor(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role 仍可執行訪客綁定';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.link_my_visitor(text)'::regprocedure
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
    RAISE EXCEPTION 'PUBLIC 仍可執行訪客綁定';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_my_reward_account()', 'EXECUTE') THEN
    RAISE EXCEPTION '一般會員應仍能讀取自己的點數餘額';
  END IF;

  RAISE NOTICE '預演通過。一般會員不能呼叫訪客綁定，仍可讀取自己的帳戶。接下來回復交易，不會留下點數或新物件。';
END
$reward_preview_after_member$;

ROLLBACK;
