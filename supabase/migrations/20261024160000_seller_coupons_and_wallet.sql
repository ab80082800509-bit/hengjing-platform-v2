-- =============================================================================
-- 第四、第五階段第四批：商家優惠券、會員券包、免費曝光
-- 請人工審查後，在 Supabase SQL Editor 一次執行整份。本檔不會被這次作業自動執行。
--
-- 不重跑第三批，不改簽到金額、刮卡機率、邀請規則或 checkout_enabled。
-- 不建立創始券庫存。創始券獎項仍只入帳 30 點。
-- 一般券獎項只有在商家已授權、有效且仍有庫存時才發券；否則仍入帳 20 點。
-- 發券與替代點數只會有一種結果。不另贈 2 點或 5 點。
-- 點數兌換固定扣 100 點，走獨立扣點函式，不把負數塞進 post_member_reward。
-- 賣場免費領取不扣點，也不佔遊戲曝光名額。遊戲曝光與賣場領取共用 issued_count。
-- 同一會員同一張券只會有一筆持有紀錄。這是既有「已領取過」規則，不是另訂的每日上限。
-- 領取當下寫入到期日：領取日加 30 天，與券截止日期較早者。重新登入不重算。
-- 已領取的條件與到期日做成快照。商家事後修改模板，不會改會員已持有的那一筆。
-- 正式結帳未開放，持有紀錄不會被標成已用於訂單。
-- =============================================================================

BEGIN;

-- coupon-batch-body-start

DO $require_coupon_batch$
BEGIN
  IF to_regprocedure('public.post_member_reward(uuid, text, text, integer, jsonb)') IS NULL THEN
    RAISE EXCEPTION '第四批需要已套用的第一批 post_member_reward';
  END IF;
  IF to_regprocedure('public.taipei_today(timestamptz)') IS NULL THEN
    RAISE EXCEPTION '第四批需要已套用的台北日函式';
  END IF;
  IF to_regprocedure('public.is_approved_seller()') IS NULL THEN
    RAISE EXCEPTION '第四批需要已存在的 public.is_approved_seller()';
  END IF;
  IF to_regclass('public.seller_applications') IS NULL THEN
    RAISE EXCEPTION '第四批需要已存在的 seller_applications';
  END IF;
  IF to_regprocedure('public.draw_my_scratch_card()') IS NULL
     OR to_regprocedure('public.scratch_award_from_units(integer, integer)') IS NULL
     OR to_regprocedure('public.build_my_scratch_state(uuid, boolean, integer, uuid)') IS NULL THEN
    RAISE EXCEPTION '第四批需要已套用的第三批刮卡';
  END IF;
  IF to_regprocedure('public.claim_my_daily_checkin()') IS NULL
     OR pg_get_function_identity_arguments('public.claim_my_daily_checkin()'::regprocedure) <> '' THEN
    RAISE EXCEPTION '既有簽到入口不應被改掉';
  END IF;
END
$require_coupon_batch$;

DO $scratch_coupon_constraints$
DECLARE
  con name;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint AS c
    JOIN pg_class AS rel ON rel.oid = c.conrelid
    JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'scratch_plays'
      AND c.contype = 'c'
      AND (
        pg_get_constraintdef(c.oid) LIKE '%outcome_kind%'
        OR pg_get_constraintdef(c.oid) LIKE '%points%'
      )
      AND pg_get_constraintdef(c.oid) NOT LIKE '%claim_key%'
      AND pg_get_constraintdef(c.oid) NOT LIKE '%slot%'
  LOOP
    EXECUTE format('ALTER TABLE public.scratch_plays DROP CONSTRAINT %I', con);
  END LOOP;
END
$scratch_coupon_constraints$;

ALTER TABLE public.scratch_plays
  ADD CONSTRAINT scratch_plays_kind_check CHECK (
    outcome_kind IN ('points', 'none', 'coupon_fallback', 'founder_fallback', 'coupon')
  );

ALTER TABLE public.scratch_plays
  ADD CONSTRAINT scratch_plays_points_check CHECK (
    (outcome_kind = 'coupon' AND points = 0)
    OR (outcome_kind <> 'coupon' AND points IN (3, 10, 15, 20, 30, 50))
  );

COMMENT ON CONSTRAINT scratch_plays_kind_check ON public.scratch_plays IS
  'coupon 只代表已從商家授權券池發出的一般券。創始券沒有庫存，仍用 founder_fallback。';

CREATE TABLE IF NOT EXISTS public.seller_coupons (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  percent integer NOT NULL DEFAULT 0,
  max_discount integer,
  gift text NOT NULL DEFAULT '',
  min_spend integer NOT NULL,
  qty integer NOT NULL,
  issued_count integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  game_pool boolean NOT NULL DEFAULT false,
  shelf boolean NOT NULL DEFAULT false,
  start_on date NOT NULL,
  end_on date NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT seller_coupons_code_check CHECK (code ~ '^[A-Z0-9]{4,12}$'),
  CONSTRAINT seller_coupons_code_key UNIQUE (code),
  CONSTRAINT seller_coupons_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 20),
  CONSTRAINT seller_coupons_kind_check CHECK (kind IN ('cash', 'percent', 'gift', 'freeship')),
  CONSTRAINT seller_coupons_qty_check CHECK (qty BETWEEN 1 AND 10000),
  CONSTRAINT seller_coupons_issued_check CHECK (issued_count >= 0 AND issued_count <= qty),
  CONSTRAINT seller_coupons_min_spend_check CHECK (min_spend BETWEEN 1 AND 100000),
  CONSTRAINT seller_coupons_dates_check CHECK (end_on >= start_on),
  CONSTRAINT seller_coupons_benefit_check CHECK (
    (
      kind = 'cash'
      AND amount BETWEEN 1 AND 5000
      AND amount < min_spend
      AND percent = 0
      AND gift = ''
      AND max_discount IS NULL
    )
    OR (
      kind = 'percent'
      AND percent BETWEEN 10 AND 99
      AND amount = 0
      AND gift = ''
      AND (max_discount IS NULL OR max_discount BETWEEN 1 AND 100000)
    )
    OR (
      kind = 'gift'
      AND char_length(gift) BETWEEN 1 AND 30
      AND amount = 0
      AND percent = 0
      AND max_discount IS NULL
    )
    OR (
      kind = 'freeship'
      AND amount = 0
      AND percent = 0
      AND gift = ''
      AND max_discount IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS seller_coupons_seller_live
  ON public.seller_coupons (seller_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS seller_coupons_game_pool
  ON public.seller_coupons (seller_id)
  WHERE game_pool AND deleted_at IS NULL;

COMMENT ON TABLE public.seller_coupons IS
  '商家自己的優惠券模板與共用庫存。game_pool 是遊戲曝光授權，shelf 是賣場免費領取。兩者都扣 issued_count。';

CREATE TABLE IF NOT EXISTS public.member_coupon_holds (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  coupon_id uuid NOT NULL REFERENCES public.seller_coupons (id) ON DELETE RESTRICT,
  seller_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  source text NOT NULL,
  request_key text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  amount integer NOT NULL,
  percent integer NOT NULL,
  max_discount integer,
  gift text NOT NULL,
  min_spend integer NOT NULL,
  claimed_on date NOT NULL,
  expires_on date NOT NULL,
  scratch_play_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT member_coupon_holds_source_check CHECK (source IN ('shelf', 'points', 'scratch')),
  CONSTRAINT member_coupon_holds_user_coupon UNIQUE (user_id, coupon_id),
  CONSTRAINT member_coupon_holds_user_request UNIQUE (user_id, request_key),
  CONSTRAINT member_coupon_holds_play_once UNIQUE (scratch_play_id),
  CONSTRAINT member_coupon_holds_expiry_check CHECK (
    expires_on >= claimed_on
    AND expires_on <= claimed_on + 30
  ),
  CONSTRAINT member_coupon_holds_link_check CHECK (
    (
      source = 'shelf'
      AND scratch_play_id IS NULL
      AND request_key = 'shelf:' || coupon_id::text
    )
    OR (
      source = 'points'
      AND scratch_play_id IS NULL
      AND request_key = 'points:' || coupon_id::text
    )
    OR (
      source = 'scratch'
      AND scratch_play_id IS NOT NULL
      AND request_key = 'scratch:' || scratch_play_id::text
    )
  ),
  CONSTRAINT member_coupon_holds_play_fkey
    FOREIGN KEY (scratch_play_id) REFERENCES public.scratch_plays (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS member_coupon_holds_user
  ON public.member_coupon_holds (user_id, expires_on, id);

COMMENT ON TABLE public.member_coupon_holds IS
  '會員券包。條件與到期日在領取當下寫入，之後不因重新登入或商家改模板而重算。沒有核銷欄位。';

CREATE OR REPLACE FUNCTION public.guard_seller_coupon()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  participating integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '優惠券不可直接刪除';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF current_setting('app.coupon_seller', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION '只有商家本人可以建立自己的優惠券';
    END IF;
    IF NEW.issued_count <> 0 OR NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION '新優惠券不能自帶已發行數量';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('app.coupon_issue', true) = 'on' THEN
      IF NEW.issued_count IS DISTINCT FROM OLD.issued_count + 1
         OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
         OR NEW.code IS DISTINCT FROM OLD.code
         OR NEW.name IS DISTINCT FROM OLD.name
         OR NEW.kind IS DISTINCT FROM OLD.kind
         OR NEW.amount IS DISTINCT FROM OLD.amount
         OR NEW.percent IS DISTINCT FROM OLD.percent
         OR NEW.max_discount IS DISTINCT FROM OLD.max_discount
         OR NEW.gift IS DISTINCT FROM OLD.gift
         OR NEW.min_spend IS DISTINCT FROM OLD.min_spend
         OR NEW.qty IS DISTINCT FROM OLD.qty
         OR NEW.active IS DISTINCT FROM OLD.active
         OR NEW.game_pool IS DISTINCT FROM OLD.game_pool
         OR NEW.shelf IS DISTINCT FROM OLD.shelf
         OR NEW.start_on IS DISTINCT FROM OLD.start_on
         OR NEW.end_on IS DISTINCT FROM OLD.end_on
         OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
         OR NEW.created_at IS DISTINCT FROM OLD.created_at
         OR NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION '發券交易不能修改優惠券條件';
      END IF;
      RETURN NEW;
    END IF;
    IF current_setting('app.coupon_seller', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION '只有商家本人可以管理自己的優惠券';
    END IF;
    IF NEW.issued_count IS DISTINCT FROM OLD.issued_count THEN
      RAISE EXCEPTION '不能直接修改已發行數量';
    END IF;
    IF NEW.seller_id IS DISTINCT FROM OLD.seller_id
       OR NEW.code IS DISTINCT FROM OLD.code
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION '不能修改優惠券歸屬或折扣碼';
    END IF;
    IF OLD.issued_count > 0 AND (
      NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.percent IS DISTINCT FROM OLD.percent
      OR NEW.max_discount IS DISTINCT FROM OLD.max_discount
      OR NEW.gift IS DISTINCT FROM OLD.gift
      OR NEW.min_spend IS DISTINCT FROM OLD.min_spend
    ) THEN
      RAISE EXCEPTION '已有會員領取，不能修改使用條件';
    END IF;
    IF OLD.start_on <= public.taipei_today() AND NEW.start_on IS DISTINCT FROM OLD.start_on THEN
      RAISE EXCEPTION '已經開始的優惠券不能改開始日期';
    END IF;
  END IF;

  IF NEW.game_pool AND NEW.active AND NEW.deleted_at IS NULL AND NEW.end_on >= public.taipei_today() THEN
    SELECT count(*)::integer
    INTO participating
    FROM public.seller_coupons
    WHERE seller_id = NEW.seller_id
      AND id IS DISTINCT FROM NEW.id
      AND game_pool
      AND active
      AND deleted_at IS NULL
      AND end_on >= public.taipei_today();
    IF participating >= 3 THEN
      RAISE EXCEPTION '每家店最多同時上架 3 張到簽到專區';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seller_coupons_guard ON public.seller_coupons;
CREATE TRIGGER seller_coupons_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.seller_coupons
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_seller_coupon();

CREATE OR REPLACE FUNCTION public.guard_member_coupon_hold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '已領取的優惠券不可修改或刪除';
  END IF;
  IF current_setting('app.coupon_issue', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '會員不能自行建立已領取優惠券';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_coupon_holds_guard ON public.member_coupon_holds;
CREATE TRIGGER member_coupon_holds_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_coupon_holds
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_member_coupon_hold();

CREATE OR REPLACE FUNCTION public.coupon_seller_name(p_seller_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(
    (
      SELECT btrim(sa.store_name)
      FROM public.seller_applications AS sa
      WHERE sa.user_id = p_seller_id
        AND sa.status = 'approved'
        AND nullif(btrim(sa.store_name), '') IS NOT NULL
      ORDER BY sa.created_at DESC
      LIMIT 1
    ),
    '賣場'
  );
$$;

CREATE OR REPLACE FUNCTION public.coupon_hold_expiry(p_claimed date, p_end date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_claimed IS NULL OR p_end IS NULL THEN NULL
    WHEN (p_claimed + 30) < p_end THEN p_claimed + 30
    ELSE p_end
  END;
$$;

CREATE OR REPLACE FUNCTION public.seller_coupon_json(p_row public.seller_coupons)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'id', p_row.id,
    'sellerId', p_row.seller_id,
    'code', p_row.code,
    'name', p_row.name,
    'kind', p_row.kind,
    'amount', p_row.amount,
    'percent', p_row.percent,
    'maxDiscount', p_row.max_discount,
    'gift', p_row.gift,
    'minSpend', p_row.min_spend,
    'qty', p_row.qty,
    'redeemed', p_row.issued_count,
    'usedOrders', 0,
    'listed', p_row.game_pool,
    'shelf', p_row.shelf,
    'cost', 100,
    'active', p_row.active,
    'startAt', pg_catalog.to_char(p_row.start_on, 'YYYY-MM-DD'),
    'endAt', pg_catalog.to_char(p_row.end_on, 'YYYY-MM-DD'),
    'deleted', p_row.deleted_at IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.member_coupon_hold_json(p_row public.member_coupon_holds)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  today date := public.taipei_today();
BEGIN
  RETURN pg_catalog.jsonb_build_object(
    'id', p_row.id,
    'couponId', p_row.coupon_id,
    'code', p_row.code,
    'sellerId', p_row.seller_id,
    'sellerName', public.coupon_seller_name(p_row.seller_id),
    'source', p_row.source,
    'kind', p_row.kind,
    'amount', p_row.amount,
    'percent', p_row.percent,
    'maxDiscount', p_row.max_discount,
    'gift', p_row.gift,
    'minSpend', p_row.min_spend,
    'claimedAt', pg_catalog.to_char(p_row.claimed_on, 'YYYY-MM-DD'),
    'expiresAt', pg_catalog.to_char(p_row.expires_on, 'YYYY-MM-DD'),
    'status', CASE WHEN p_row.expires_on < today THEN 'expired' ELSE 'unused' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_coupon_exchange_debit(
  p_user_id uuid,
  p_claim_key text,
  p_metadata jsonb
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
  IF current_setting('app.reward_post', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '扣點只能由資料庫內部交易呼叫';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;
  IF p_metadata IS NULL OR pg_catalog.jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION '獎勵附註必須是物件';
  END IF;
  IF pg_catalog.octet_length(p_metadata::text) > 1024 THEN
    RAISE EXCEPTION '獎勵附註過長';
  END IF;
  IF p_claim_key IS NULL OR p_claim_key !~ '^coupon_exchange:[A-Za-z0-9:_-]{1,120}$' THEN
    RAISE EXCEPTION '優惠券兌換領獎鍵不正確';
  END IF;

  day := public.taipei_today();

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
    IF existing_claim.kind IS DISTINCT FROM 'coupon_exchange' OR existing_claim.delta IS DISTINCT FROM -100 THEN
      RAISE EXCEPTION '同一領獎鍵不可改寫來源或點數';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'replayed', true,
      'delta', existing_claim.delta,
      'balanceAfter', existing_claim.balance_after,
      'currentBalance', account.balance,
      'claimKey', existing_claim.claim_key
    );
  END IF;

  IF account.balance < 100 THEN
    RAISE EXCEPTION '點數不足';
  END IF;

  next_balance := account.balance - 100;

  INSERT INTO public.member_point_entries (
    user_id, delta, balance_after, kind, claim_key, taipei_day, metadata
  )
  VALUES (
    p_user_id, -100, next_balance, 'coupon_exchange', p_claim_key, day, p_metadata
  )
  RETURNING id INTO entry_id;

  UPDATE public.member_point_accounts
  SET balance = next_balance,
      updated_at = pg_catalog.now()
  WHERE user_id = p_user_id;

  INSERT INTO public.reward_claims (
    user_id, kind, claim_key, taipei_day, delta, balance_after, point_entry_id, metadata
  )
  VALUES (
    p_user_id, 'coupon_exchange', p_claim_key, day, -100, next_balance, entry_id, p_metadata
  )
  RETURNING id INTO claim_id;

  RETURN pg_catalog.jsonb_build_object(
    'replayed', false,
    'claimId', claim_id,
    'pointEntryId', entry_id,
    'delta', -100,
    'balanceAfter', next_balance,
    'currentBalance', next_balance,
    'claimKey', p_claim_key
  );
END;
$$;

COMMENT ON FUNCTION public.post_coupon_exchange_debit(uuid, text, jsonb) IS
  '優惠券兌換專用扣點。固定 -100，不接受呼叫端傳入點數。不取代 post_member_reward，也不對 API 開放。';

CREATE OR REPLACE FUNCTION public.issue_member_coupon(
  p_user_id uuid,
  p_coupon_id uuid,
  p_source text,
  p_request_key text,
  p_scratch_play_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  day date := public.taipei_today();
  coupon public.seller_coupons%ROWTYPE;
  hold_id uuid;
  expires_on date;
BEGIN
  IF current_setting('app.coupon_issue', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '發券只能由資料庫內部交易呼叫';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('shelf', 'points', 'scratch') THEN
    RAISE EXCEPTION '優惠券來源不正確';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;

  SELECT *
  INTO coupon
  FROM public.seller_coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  IF NOT FOUND OR coupon.deleted_at IS NOT NULL OR NOT coupon.active THEN
    RAISE EXCEPTION '此優惠券目前無法領取';
  END IF;
  IF coupon.start_on > day OR coupon.end_on < day THEN
    RAISE EXCEPTION '此優惠券目前無法領取';
  END IF;
  IF coupon.issued_count >= coupon.qty THEN
    RAISE EXCEPTION '此優惠券已被領完';
  END IF;
  IF p_source = 'shelf' AND NOT coupon.shelf THEN
    RAISE EXCEPTION '此優惠券目前無法領取';
  END IF;
  IF p_source IN ('points', 'scratch') AND NOT coupon.game_pool THEN
    RAISE EXCEPTION '此優惠券目前無法領取';
  END IF;
  IF p_source = 'scratch' AND p_scratch_play_id IS NULL THEN
    RAISE EXCEPTION '刮卡沒有成功，優惠券沒有進入券包';
  END IF;
  IF p_source <> 'scratch' AND p_scratch_play_id IS NOT NULL THEN
    RAISE EXCEPTION '優惠券來源不正確';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.member_coupon_holds
    WHERE user_id = p_user_id
      AND coupon_id = coupon.id
  ) THEN
    RAISE EXCEPTION '您已領取過此優惠券';
  END IF;

  expires_on := public.coupon_hold_expiry(day, coupon.end_on);
  IF expires_on IS NULL OR expires_on < day THEN
    RAISE EXCEPTION '此優惠券目前無法領取';
  END IF;

  UPDATE public.seller_coupons
  SET issued_count = issued_count + 1,
      updated_at = pg_catalog.now()
  WHERE id = coupon.id
    AND issued_count < qty
    AND issued_count = coupon.issued_count;

  IF NOT FOUND THEN
    RAISE EXCEPTION '此優惠券已被領完';
  END IF;

  INSERT INTO public.member_coupon_holds (
    user_id, coupon_id, seller_id, source, request_key,
    code, name, kind, amount, percent, max_discount, gift, min_spend,
    claimed_on, expires_on, scratch_play_id
  )
  VALUES (
    p_user_id, coupon.id, coupon.seller_id, p_source, p_request_key,
    coupon.code, coupon.name, coupon.kind, coupon.amount, coupon.percent,
    coupon.max_discount, coupon.gift, coupon.min_spend,
    day, expires_on, p_scratch_play_id
  )
  RETURNING id INTO hold_id;

  RETURN hold_id;
END;
$$;

COMMENT ON FUNCTION public.issue_member_coupon(uuid, uuid, text, text, uuid) IS
  '從商家優惠券的同一份庫存發一張到會員券包。賣場、點數兌換與刮卡都走這裡。不對 API 開放。';

CREATE OR REPLACE FUNCTION public.lock_scratch_pool_coupon(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  day date := public.taipei_today();
  chosen uuid;
BEGIN
  IF current_setting('app.coupon_issue', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '發券只能由資料庫內部交易呼叫';
  END IF;
  -- 權重尚未確認。符合條件的授權券以相同機率抽一張，不依金額或商家排序加權。
  SELECT coupon.id
  INTO chosen
  FROM public.seller_coupons AS coupon
  WHERE coupon.game_pool
    AND coupon.active
    AND coupon.deleted_at IS NULL
    AND coupon.issued_count < coupon.qty
    AND coupon.start_on <= day
    AND coupon.end_on >= day
    AND NOT EXISTS (
      SELECT 1
      FROM public.member_coupon_holds AS hold
      WHERE hold.user_id = p_user_id
        AND hold.coupon_id = coupon.id
    )
  ORDER BY pg_catalog.random()
  LIMIT 1
  FOR UPDATE OF coupon;

  RETURN chosen;
END;
$$;

COMMENT ON FUNCTION public.lock_scratch_pool_coupon(uuid) IS
  '鎖定一張可發的遊戲曝光券。沒有可發券時回傳 NULL，呼叫端必須改走原本的替代點數。';

CREATE OR REPLACE FUNCTION public.seller_coupon_from_draft(
  p_draft jsonb,
  p_current public.seller_coupons
)
RETURNS public.seller_coupons
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  row public.seller_coupons := p_current;
  kind text;
  amount integer;
  percent integer;
  max_discount integer;
  gift text;
  min_spend integer;
  qty integer;
  start_on date;
  end_on date;
  today date := public.taipei_today();
  locked boolean;
BEGIN
  IF p_draft IS NULL OR pg_catalog.jsonb_typeof(p_draft) <> 'object' THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;
  BEGIN
    kind := p_draft->>'kind';
    amount := coalesce((p_draft->>'amount')::integer, 0);
    percent := coalesce((p_draft->>'percent')::integer, 0);
    gift := btrim(coalesce(p_draft->>'gift', ''));
    min_spend := (p_draft->>'minSpend')::integer;
    qty := (p_draft->>'qty')::integer;
    start_on := (p_draft->>'startAt')::date;
    end_on := (p_draft->>'endAt')::date;
    IF nullif(p_draft->>'maxDiscount', '') IS NULL OR (p_draft->>'maxDiscount')::integer = 0 THEN
      max_discount := NULL;
    ELSE
      max_discount := (p_draft->>'maxDiscount')::integer;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION '優惠券內容不正確';
  END;

  IF kind IS NULL OR kind NOT IN ('cash', 'percent', 'gift', 'freeship') THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;
  IF min_spend IS NULL OR qty IS NULL OR start_on IS NULL OR end_on IS NULL THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;
  IF btrim(coalesce(p_draft->>'name', '')) = '' OR char_length(btrim(p_draft->>'name')) > 20 THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;
  IF end_on < today OR end_on < start_on THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;
  IF pg_catalog.jsonb_typeof(p_draft->'listed') <> 'boolean'
     OR pg_catalog.jsonb_typeof(p_draft->'shelf') <> 'boolean' THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;

  locked := p_current.id IS NOT NULL AND p_current.issued_count > 0;
  IF locked AND (
    kind IS DISTINCT FROM p_current.kind
    OR amount IS DISTINCT FROM p_current.amount
    OR percent IS DISTINCT FROM p_current.percent
    OR max_discount IS DISTINCT FROM p_current.max_discount
    OR gift IS DISTINCT FROM p_current.gift
    OR min_spend IS DISTINCT FROM p_current.min_spend
  ) THEN
    RAISE EXCEPTION '已有會員領取，不能修改使用條件';
  END IF;
  IF p_current.id IS NOT NULL AND p_current.start_on <= today AND start_on IS DISTINCT FROM p_current.start_on THEN
    RAISE EXCEPTION '已經開始的優惠券不能改開始日期';
  END IF;
  IF p_current.id IS NOT NULL AND qty < p_current.issued_count THEN
    RAISE EXCEPTION '發行數量不可低於已領取數量';
  END IF;
  IF p_current.id IS NULL AND start_on < today THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;
  IF kind = 'cash' AND (amount < 1 OR amount > 5000 OR amount >= min_spend OR percent <> 0 OR gift <> '' OR max_discount IS NOT NULL) THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;
  IF kind = 'percent' AND (percent < 10 OR percent > 99 OR amount <> 0 OR gift <> '' OR (max_discount IS NOT NULL AND (max_discount < 1 OR max_discount > 100000))) THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;
  IF kind = 'gift' AND (char_length(gift) < 1 OR char_length(gift) > 30 OR amount <> 0 OR percent <> 0 OR max_discount IS NOT NULL) THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;
  IF kind = 'freeship' AND (amount <> 0 OR percent <> 0 OR gift <> '' OR max_discount IS NOT NULL) THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;
  IF min_spend < 1 OR min_spend > 100000 OR qty < 1 OR qty > 10000 THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;

  IF NOT locked THEN
    IF kind <> 'cash' THEN
      amount := 0;
    END IF;
    IF kind <> 'percent' THEN
      percent := 0;
      max_discount := NULL;
    END IF;
    IF kind <> 'gift' THEN
      gift := '';
    END IF;
    row.kind := kind;
    row.amount := amount;
    row.percent := percent;
    row.max_discount := max_discount;
    row.gift := gift;
    row.min_spend := min_spend;
  END IF;

  row.name := btrim(p_draft->>'name');
  row.qty := qty;
  row.start_on := CASE
    WHEN p_current.id IS NOT NULL AND p_current.start_on <= today THEN p_current.start_on
    ELSE start_on
  END;
  row.end_on := end_on;
  row.game_pool := (p_draft->>'listed')::boolean;
  row.shelf := (p_draft->>'shelf')::boolean;
  RETURN row;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_my_seller_coupon(p_id uuid, p_draft jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  current_row public.seller_coupons;
  next_row public.seller_coupons;
  code text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '尚未通過賣家審核';
  END IF;

  PERFORM set_config('app.coupon_issue', 'off', true);
  PERFORM set_config('app.coupon_seller', 'on', true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coupon-seller:' || uid::text, 0));

  IF p_id IS NULL THEN
    code := pg_catalog.upper(btrim(coalesce(p_draft->>'code', '')));
    IF code !~ '^[A-Z0-9]{4,12}$' THEN
      RAISE EXCEPTION '優惠券內容不正確';
    END IF;
    next_row.seller_id := uid;
    next_row.code := code;
    next_row.issued_count := 0;
    next_row.active := true;
    next_row.deleted_at := NULL;
    next_row := public.seller_coupon_from_draft(p_draft, next_row);
    next_row.id := pg_catalog.gen_random_uuid();
    next_row.created_at := pg_catalog.now();
    next_row.updated_at := pg_catalog.now();
    BEGIN
      INSERT INTO public.seller_coupons
      SELECT next_row.*;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION '此折扣碼已被使用，請換一組';
    END;
  ELSE
    SELECT *
    INTO current_row
    FROM public.seller_coupons
    WHERE id = p_id
    FOR UPDATE;
    IF NOT FOUND OR current_row.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION '找不到此折價券';
    END IF;
    IF current_row.seller_id IS DISTINCT FROM uid THEN
      RAISE EXCEPTION '不能管理其他商家的優惠券';
    END IF;
    next_row := public.seller_coupon_from_draft(p_draft, current_row);
    next_row.updated_at := pg_catalog.now();
    UPDATE public.seller_coupons
    SET name = next_row.name,
        kind = next_row.kind,
        amount = next_row.amount,
        percent = next_row.percent,
        max_discount = next_row.max_discount,
        gift = next_row.gift,
        min_spend = next_row.min_spend,
        qty = next_row.qty,
        game_pool = next_row.game_pool,
        shelf = next_row.shelf,
        start_on = next_row.start_on,
        end_on = next_row.end_on,
        updated_at = next_row.updated_at
    WHERE id = current_row.id
      AND seller_id = uid
    RETURNING * INTO next_row;
  END IF;

  RETURN public.seller_coupon_json(next_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_seller_coupon_flag(
  p_id uuid,
  p_flag text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.seller_coupons;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '尚未通過賣家審核';
  END IF;
  IF p_flag IS NULL OR p_flag NOT IN ('active', 'game_pool', 'shelf') OR p_enabled IS NULL THEN
    RAISE EXCEPTION '優惠券內容不正確';
  END IF;

  PERFORM set_config('app.coupon_issue', 'off', true);
  PERFORM set_config('app.coupon_seller', 'on', true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coupon-seller:' || uid::text, 0));

  SELECT *
  INTO row
  FROM public.seller_coupons
  WHERE id = p_id
  FOR UPDATE;
  IF NOT FOUND OR row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '找不到此折價券';
  END IF;
  IF row.seller_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION '不能管理其他商家的優惠券';
  END IF;

  IF p_flag = 'active' THEN
    row.active := p_enabled;
  ELSIF p_flag = 'game_pool' THEN
    row.game_pool := p_enabled;
  ELSE
    row.shelf := p_enabled;
  END IF;
  row.updated_at := pg_catalog.now();

  UPDATE public.seller_coupons
  SET active = row.active,
      game_pool = row.game_pool,
      shelf = row.shelf,
      updated_at = row.updated_at
  WHERE id = row.id
    AND seller_id = uid
  RETURNING * INTO row;

  RETURN public.seller_coupon_json(row);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_seller_coupon(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.seller_coupons;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '尚未通過賣家審核';
  END IF;

  PERFORM set_config('app.coupon_issue', 'off', true);
  PERFORM set_config('app.coupon_seller', 'on', true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coupon-seller:' || uid::text, 0));

  SELECT *
  INTO row
  FROM public.seller_coupons
  WHERE id = p_id
  FOR UPDATE;
  IF NOT FOUND OR row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '找不到此折價券';
  END IF;
  IF row.seller_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION '不能管理其他商家的優惠券';
  END IF;

  UPDATE public.seller_coupons
  SET deleted_at = pg_catalog.now(),
      active = false,
      game_pool = false,
      shelf = false,
      updated_at = pg_catalog.now()
  WHERE id = row.id
    AND seller_id = uid
  RETURNING * INTO row;

  RETURN public.seller_coupon_json(row);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_seller_coupons()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  result jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '尚未通過賣家審核';
  END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(public.seller_coupon_json(coupon) ORDER BY coupon.created_at DESC), '[]'::jsonb)
  INTO result
  FROM public.seller_coupons AS coupon
  WHERE coupon.seller_id = uid
    AND coupon.deleted_at IS NULL;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_store_coupons(p_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  day date := public.taipei_today();
  result jsonb;
BEGIN
  IF p_seller_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(public.seller_coupon_json(coupon) ORDER BY coupon.created_at DESC), '[]'::jsonb)
  INTO result
  FROM public.seller_coupons AS coupon
  WHERE coupon.seller_id = p_seller_id
    AND coupon.deleted_at IS NULL
    AND coupon.active
    AND coupon.start_on <= day
    AND coupon.end_on >= day
    AND (coupon.shelf OR coupon.game_pool);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_coupon_wallet()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  result jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(public.member_coupon_hold_json(hold) ORDER BY hold.expires_on, hold.created_at), '[]'::jsonb)
  INTO result
  FROM public.member_coupon_holds AS hold
  WHERE hold.user_id = uid;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_storefront_coupon(p_coupon_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  hold public.member_coupon_holds;
  hold_id uuid;
  balance integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_coupon_id IS NULL THEN
    RAISE EXCEPTION '此優惠券目前無法領取';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coupon-user:' || uid::text, 0));

  SELECT *
  INTO hold
  FROM public.member_coupon_holds
  WHERE user_id = uid
    AND coupon_id = p_coupon_id;

  SELECT account.balance
  INTO balance
  FROM public.member_point_accounts AS account
  WHERE account.user_id = uid;
  IF balance IS NULL THEN
    balance := 0;
  END IF;

  IF hold.id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'replayed', true,
      'balance', balance,
      'hold', public.member_coupon_hold_json(hold)
    );
  END IF;

  PERFORM set_config('app.coupon_seller', 'off', true);
  PERFORM set_config('app.coupon_issue', 'on', true);

  hold_id := public.issue_member_coupon(uid, p_coupon_id, 'shelf', 'shelf:' || p_coupon_id::text, NULL);
  SELECT * INTO hold FROM public.member_coupon_holds WHERE id = hold_id AND user_id = uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION '此優惠券目前無法領取';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'replayed', false,
    'balance', balance,
    'hold', public.member_coupon_hold_json(hold)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.exchange_my_coupon(p_coupon_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  coupon public.seller_coupons;
  hold public.member_coupon_holds;
  account public.member_point_accounts;
  posted jsonb;
  hold_id uuid;
  v_claim_key text;
  metadata jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_coupon_id IS NULL THEN
    RAISE EXCEPTION '此優惠券目前無法領取';
  END IF;

  v_claim_key := 'coupon_exchange:' || p_coupon_id::text;
  metadata := pg_catalog.jsonb_build_object('couponId', p_coupon_id, 'source', 'points');

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coupon-user:' || uid::text, 0));

  INSERT INTO public.member_point_accounts (user_id)
  VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT *
  INTO account
  FROM public.member_point_accounts
  WHERE user_id = uid
  FOR UPDATE;

  SELECT *
  INTO coupon
  FROM public.seller_coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '此優惠券目前無法領取';
  END IF;

  SELECT *
  INTO hold
  FROM public.member_coupon_holds
  WHERE user_id = uid
    AND coupon_id = p_coupon_id;

  IF FOUND THEN
    IF hold.source = 'points' AND EXISTS (
      SELECT 1
      FROM public.reward_claims AS claim
      WHERE claim.user_id = uid
        AND claim.claim_key = v_claim_key
        AND claim.kind = 'coupon_exchange'
        AND claim.delta = -100
    ) THEN
      RETURN pg_catalog.jsonb_build_object(
        'replayed', true,
        'balance', account.balance,
        'hold', public.member_coupon_hold_json(hold)
      );
    END IF;
    RAISE EXCEPTION '您已領取過此優惠券';
  END IF;

  IF coupon.deleted_at IS NOT NULL OR NOT coupon.active OR NOT coupon.game_pool
     OR coupon.start_on > public.taipei_today()
     OR coupon.end_on < public.taipei_today() THEN
    RAISE EXCEPTION '此優惠券目前無法領取';
  END IF;
  IF coupon.issued_count >= coupon.qty THEN
    RAISE EXCEPTION '此優惠券已被領完';
  END IF;
  IF account.balance < 100 THEN
    RAISE EXCEPTION '點數不足';
  END IF;

  PERFORM set_config('app.coupon_seller', 'off', true);
  PERFORM set_config('app.reward_post', 'on', true);
  PERFORM set_config('app.coupon_issue', 'on', true);

  posted := public.post_coupon_exchange_debit(uid, v_claim_key, metadata);
  IF (posted->>'replayed')::boolean IS DISTINCT FROM false OR (posted->>'delta')::integer IS DISTINCT FROM -100 THEN
    RAISE EXCEPTION '優惠券兌換沒有完成，點數與庫存都沒有變更';
  END IF;

  hold_id := public.issue_member_coupon(uid, p_coupon_id, 'points', 'points:' || p_coupon_id::text, NULL);
  SELECT * INTO hold FROM public.member_coupon_holds WHERE id = hold_id AND user_id = uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION '優惠券兌換沒有完成，點數與庫存都沒有變更';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'replayed', false,
    'balance', (posted->>'currentBalance')::integer,
    'hold', public.member_coupon_hold_json(hold)
  );
END;
$$;

COMMENT ON FUNCTION public.exchange_my_coupon(uuid) IS
  '用固定 100 點兌換一張已授權的遊戲曝光券。扣點、發券與庫存在同一個交易。失敗會整筆回復。';

CREATE OR REPLACE FUNCTION public.build_my_scratch_state(
  p_user_id uuid,
  p_replayed boolean,
  p_awarded integer,
  p_card_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  day date := public.taipei_today();
  bal integer := 0;
  used integer := 0;
  bonus boolean := false;
  total integer;
  card jsonb := NULL;
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

  SELECT count(*)::integer
  INTO used
  FROM public.scratch_plays
  WHERE user_id = p_user_id
    AND taipei_day = day;

  SELECT EXISTS (
    SELECT 1
    FROM public.member_invite_daily_bonus
    WHERE user_id = p_user_id
      AND taipei_day = day
  )
  INTO bonus;

  total := CASE WHEN bonus THEN 2 ELSE 1 END;

  SELECT pg_catalog.jsonb_build_object(
    'id', play.id,
    'slot', play.slot,
    'outcomeKind', play.outcome_kind,
    'points', play.points,
    'revealed', play.revealed_at IS NOT NULL,
    'coupon', CASE
      WHEN play.outcome_kind = 'coupon' THEN (
        SELECT pg_catalog.jsonb_build_object(
          'holdId', hold.id,
          'couponId', hold.coupon_id,
          'code', hold.code,
          'sellerId', hold.seller_id,
          'sellerName', public.coupon_seller_name(hold.seller_id),
          'name', hold.name,
          'kind', hold.kind,
          'amount', hold.amount,
          'percent', hold.percent,
          'maxDiscount', hold.max_discount,
          'gift', hold.gift,
          'minSpend', hold.min_spend,
          'expiresOn', pg_catalog.to_char(hold.expires_on, 'YYYY-MM-DD')
        )
        FROM public.member_coupon_holds AS hold
        WHERE hold.scratch_play_id = play.id
          AND hold.user_id = play.user_id
      )
      ELSE NULL
    END
  )
  INTO card
  FROM public.scratch_plays AS play
  WHERE play.user_id = p_user_id
    AND play.taipei_day = day
    AND (
      (p_card_id IS NOT NULL AND play.id = p_card_id)
      OR (
        p_card_id IS NULL
        AND (
          play.revealed_at IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM public.scratch_plays AS pending
            WHERE pending.user_id = p_user_id
              AND pending.taipei_day = day
              AND pending.revealed_at IS NULL
          )
        )
      )
    )
  ORDER BY
    CASE WHEN play.revealed_at IS NULL THEN 0 ELSE 1 END,
    play.slot DESC
  LIMIT 1;

  RETURN pg_catalog.jsonb_build_object(
    'balance', bal,
    'taipeiDay', pg_catalog.to_char(day, 'YYYY-MM-DD'),
    'baseChances', 1,
    'bonusChances', CASE WHEN bonus THEN 1 ELSE 0 END,
    'chancesTotal', total,
    'used', used,
    'chancesLeft', CASE WHEN total > used THEN total - used ELSE 0 END,
    'inviteBonusToday', bonus,
    'replayed', coalesce(p_replayed, false),
    'awardedDelta', p_awarded,
    'card', card
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.draw_my_scratch_card()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date;
  locked uuid;
  existing public.scratch_plays%ROWTYPE;
  award jsonb;
  slot integer;
  points integer;
  kind text;
  v_claim_key text;
  play_id uuid;
  posted jsonb;
  bonus boolean := false;
  used integer := 0;
  chosen uuid := NULL;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reward-scratch:' || uid::text, 0));

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

  SELECT *
  INTO existing
  FROM public.scratch_plays
  WHERE user_id = uid
    AND taipei_day = day
    AND revealed_at IS NULL
  ORDER BY slot
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF existing.outcome_kind = 'coupon' THEN
      IF existing.points IS DISTINCT FROM 0 OR NOT EXISTS (
        SELECT 1
        FROM public.member_coupon_holds
        WHERE scratch_play_id = existing.id
          AND user_id = uid
      ) THEN
        RAISE EXCEPTION '刮卡沒有成功，優惠券沒有進入券包';
      END IF;
      RETURN public.build_my_scratch_state(uid, true, NULL, existing.id);
    END IF;

    PERFORM set_config('app.reward_post', 'on', true);
    posted := public.post_member_reward(
      uid,
      'scratch',
      existing.claim_key,
      existing.points,
      pg_catalog.jsonb_build_object('outcomeKind', existing.outcome_kind, 'slot', existing.slot)
    );
    IF (posted->>'delta')::integer IS DISTINCT FROM existing.points THEN
      RAISE EXCEPTION '刮卡沒有成功，點數沒有增加';
    END IF;
    RETURN public.build_my_scratch_state(uid, true, NULL, existing.id);
  END IF;

  SELECT count(*)::integer
  INTO used
  FROM public.scratch_plays
  WHERE user_id = uid
    AND taipei_day = day;

  SELECT EXISTS (
    SELECT 1
    FROM public.member_invite_daily_bonus
    WHERE user_id = uid
      AND taipei_day = day
  )
  INTO bonus;

  IF used >= (CASE WHEN bonus THEN 2 ELSE 1 END) THEN
    RAISE EXCEPTION '今日刮卡次數已用完';
  END IF;

  slot := used + 1;
  IF slot = 2 AND bonus IS DISTINCT FROM true THEN
    RAISE EXCEPTION '邀請加碼次數尚未成立';
  END IF;
  IF slot NOT IN (1, 2) THEN
    RAISE EXCEPTION '今日刮卡次數已用完';
  END IF;

  award := public.scratch_award_from_units(
    least(9999, floor(pg_catalog.random() * 10000)::integer),
    least(9999, floor(pg_catalog.random() * 10000)::integer)
  );
  kind := award->>'outcomeKind';
  points := (award->>'points')::integer;

  IF kind = 'coupon_fallback' THEN
    PERFORM set_config('app.coupon_seller', 'off', true);
    PERFORM set_config('app.coupon_issue', 'on', true);
    chosen := public.lock_scratch_pool_coupon(uid);
    IF chosen IS NOT NULL THEN
      kind := 'coupon';
      points := 0;
    END IF;
  END IF;

  IF kind = 'coupon' AND (chosen IS NULL OR points IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION '刮卡沒有成功，優惠券沒有進入券包';
  END IF;

  v_claim_key := 'scratch:' || to_char(day, 'YYYY-MM-DD') || ':slot:' || slot::text;

  INSERT INTO public.scratch_plays (
    user_id, taipei_day, slot, claim_key, outcome_kind, points
  )
  VALUES (
    uid, day, slot, v_claim_key, kind, points
  )
  RETURNING id INTO play_id;

  -- scratch-coupon-or-points
  IF kind = 'coupon' THEN
    PERFORM public.issue_member_coupon(uid, chosen, 'scratch', 'scratch:' || play_id::text, play_id);
    IF NOT EXISTS (
      SELECT 1
      FROM public.member_coupon_holds
      WHERE scratch_play_id = play_id
        AND user_id = uid
    ) THEN
      RAISE EXCEPTION '刮卡沒有成功，優惠券沒有進入券包';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.reward_claims AS rc
      WHERE user_id = uid
        AND rc.claim_key = v_claim_key
    ) THEN
      RAISE EXCEPTION '刮卡沒有成功，優惠券與點數不能同時領取';
    END IF;
  ELSE
    PERFORM set_config('app.coupon_issue', 'off', true);
    PERFORM set_config('app.reward_post', 'on', true);
    posted := public.post_member_reward(
      uid,
      'scratch',
      v_claim_key,
      points,
      pg_catalog.jsonb_build_object('outcomeKind', kind, 'slot', slot)
    );
    IF (posted->>'replayed')::boolean IS DISTINCT FROM false
       OR (posted->>'delta')::integer IS DISTINCT FROM points
       OR (posted->>'currentBalance')::integer IS DISTINCT FROM (
         SELECT balance FROM public.member_point_accounts WHERE user_id = uid
       ) THEN
      RAISE EXCEPTION '刮卡沒有成功，點數沒有增加';
    END IF;
  END IF;
  -- scratch-coupon-or-points-end

  RETURN public.build_my_scratch_state(
    uid,
    false,
    CASE WHEN kind = 'coupon' THEN NULL ELSE points END,
    play_id
  );
END;
$$;

COMMENT ON FUNCTION public.draw_my_scratch_card() IS
  '刮卡機率不變。一般券有可發庫存就發券且不入點；沒有則仍入帳 20 點。創始券仍只入帳 30 點。';

REVOKE ALL ON FUNCTION public.guard_seller_coupon() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_member_coupon_hold() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.coupon_seller_name(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.coupon_hold_expiry(date, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.seller_coupon_json(public.seller_coupons) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_coupon_hold_json(public.member_coupon_holds) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.post_coupon_exchange_debit(uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_member_coupon(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lock_scratch_pool_coupon(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.seller_coupon_from_draft(jsonb, public.seller_coupons) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.build_my_scratch_state(uuid, boolean, integer, uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_my_seller_coupon(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_my_seller_coupon_flag(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_my_seller_coupon(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_seller_coupons() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_store_coupons(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_coupon_wallet() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_storefront_coupon(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exchange_my_coupon(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_my_seller_coupon(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_seller_coupon_flag(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_my_seller_coupon(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_seller_coupons() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_store_coupons(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_coupon_wallet() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_storefront_coupon(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_my_coupon(uuid) TO authenticated;

ALTER TABLE public.seller_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_coupon_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.seller_coupons FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.member_coupon_holds FROM PUBLIC, anon, authenticated, service_role;

DO $coupon_batch_check$
DECLARE
  award jsonb;
  post_def text := pg_get_functiondef('public.post_member_reward(uuid, text, text, integer, jsonb)'::regprocedure);
  draw_def text := pg_get_functiondef('public.draw_my_scratch_card()'::regprocedure);
  exchange_def text := pg_get_functiondef('public.exchange_my_coupon(uuid)'::regprocedure);
  debit_def text := pg_get_functiondef('public.post_coupon_exchange_debit(uuid, text, jsonb)'::regprocedure);
  branch text;
  branch_start integer;
  branch_else integer;
  branch_end integer;
  fn text;
BEGIN
  award := public.scratch_award_from_units(0, 0);
  IF award->>'outcomeKind' IS DISTINCT FROM 'coupon_fallback' OR (award->>'points')::integer IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '刮卡一般券機率不應被改掉';
  END IF;
  award := public.scratch_award_from_units(2499, 1);
  IF award->>'outcomeKind' IS DISTINCT FROM 'coupon_fallback' OR (award->>'points')::integer IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION '刮卡一般券邊界不應被改掉';
  END IF;
  award := public.scratch_award_from_units(9000, 1);
  IF award->>'outcomeKind' IS DISTINCT FROM 'founder_fallback' OR (award->>'points')::integer IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '創始券仍必須是 30 點替代，不能自建庫存';
  END IF;
  award := public.scratch_award_from_units(9499, 1);
  IF award->>'outcomeKind' IS DISTINCT FROM 'founder_fallback' OR (award->>'points')::integer IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION '創始券邊界不應被改掉';
  END IF;
  award := public.scratch_award_from_units(9500, 0);
  IF award->>'outcomeKind' IS DISTINCT FROM 'none' OR (award->>'points')::integer IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '刮卡保底不應被改掉';
  END IF;

  IF position('p_delta NOT IN (10, 15, 20, 50)' IN post_def) = 0
     OR position('這個獎勵來源尚未開放入帳' IN post_def) = 0
     OR position('p_delta NOT IN (3, 10, 15, 20, 30, 50)' IN post_def) = 0 THEN
    RAISE EXCEPTION '不能改寫已驗收的發獎函式規則';
  END IF;
  IF position('FOUNDER_DAILY' IN draw_def) > 0 OR position('創始券每日 5' IN draw_def) > 0 THEN
    RAISE EXCEPTION '不能恢復創始券每日 5 張';
  END IF;

  branch_start := position('-- scratch-coupon-or-points' IN draw_def);
  branch_end := position('-- scratch-coupon-or-points-end' IN draw_def);
  branch_else := position('ELSE' IN substr(draw_def, branch_start, branch_end - branch_start));
  IF branch_start = 0 OR branch_end <= branch_start OR branch_else = 0 THEN
    RAISE EXCEPTION '刮卡發券與入點必須分成兩個分支';
  END IF;
  branch := substr(draw_def, branch_start, branch_else - 1);
  IF position('post_member_reward' IN branch) > 0 OR position('issue_member_coupon' IN branch) = 0 THEN
    RAISE EXCEPTION '發出優惠券時不能同時入點';
  END IF;
  IF public.coupon_hold_expiry(DATE '2026-10-01', DATE '2026-12-31') IS DISTINCT FROM DATE '2026-10-31' THEN
    RAISE EXCEPTION '領取後 30 天必須早於較晚的券截止日';
  END IF;
  IF public.coupon_hold_expiry(DATE '2026-10-20', DATE '2026-11-01') IS DISTINCT FROM DATE '2026-11-01' THEN
    RAISE EXCEPTION '券截止日較早時必須用券截止日';
  END IF;

  IF exchange_def ~ E'(^|\n)[ \t]*EXCEPTION([ \t\r\n]|$)' THEN
    RAISE EXCEPTION '兌換函式不能吞掉錯誤';
  END IF;
  IF position('-100' IN debit_def) = 0 OR position('p_delta' IN debit_def) > 0 THEN
    RAISE EXCEPTION '扣點函式必須寫死 100 點，不能接受呼叫端傳入點數';
  END IF;

  FOREACH fn IN ARRAY ARRAY[
    'public.post_coupon_exchange_debit(uuid, text, jsonb)',
    'public.issue_member_coupon(uuid, uuid, text, text, uuid)',
    'public.lock_scratch_pool_coupon(uuid)',
    'public.post_member_reward(uuid, text, text, integer, jsonb)'
  ]
  LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE')
       OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '內部扣點或發券函式不能開放給 API';
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'public.claim_storefront_coupon(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.exchange_my_coupon(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.list_my_coupon_wallet()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.claim_storefront_coupon(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.exchange_my_coupon(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.list_store_coupons(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '優惠券入口權限不正確';
  END IF;

  IF has_table_privilege('authenticated', 'public.seller_coupons', 'INSERT')
     OR has_table_privilege('authenticated', 'public.seller_coupons', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.member_coupon_holds', 'INSERT')
     OR has_table_privilege('authenticated', 'public.member_point_accounts', 'UPDATE')
     OR has_table_privilege('anon', 'public.member_coupon_holds', 'SELECT') THEN
    RAISE EXCEPTION '不能直接開放優惠券或點數表';
  END IF;
END
$coupon_batch_check$;

-- coupon-batch-body-end

COMMIT;
