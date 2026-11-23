-- =============================================================================
-- 賣家授權 Pay 點數兌換券（購物優惠區）
-- 請先在正式 Supabase SQL Editor 跑 20261029210000_seller_coupon_point_offers_readonly_check.sql，
-- apply_gate 顯示可以套用後，再整份執行本檔。
--
-- 只新增：seller_coupon_point_offers 表、其守門觸發器，以及 4 個入口函式。
-- 不改 seller_coupons、member_coupon_holds、點數帳本的結構與既有函式；
-- 不改 get_my_points_mall、exchange_my_coupon、刮卡、簽到、特權商城或 checkout_enabled。
-- 不新增、不修改任何既有優惠券或會員點數。
--
-- 規則：
-- * 只有發券商家本人能開啟或關閉自己券的點數兌換，並自訂所需點數、可兌換數量與截止日。
-- * 使用條件（門檻、折扣、券期限）沿用券本身，兌換後快照進既有會員券包。
-- * 一般券（賣場領取、刮卡曝光）不會因此變成點數券；沒有授權紀錄就不會出現在購物優惠區。
-- * 點數兌換與賣場領取、刮卡共用券的 issued_count 總庫存，另以 points_issued 控管點數兌換上限。
-- * 扣點、發券、兩層庫存在同一個交易；失敗整筆回復。同一會員同一張券只有一筆持有與一筆扣點。
-- * 折扣由發券商家承擔；本檔沒有任何平台補貼或付款給商家的欄位。
-- =============================================================================

BEGIN;

DO $require_point_offers$
BEGIN
  IF to_regclass('public.seller_coupons') IS NULL
     OR to_regclass('public.member_coupon_holds') IS NULL
     OR to_regclass('public.member_point_accounts') IS NULL
     OR to_regclass('public.member_point_entries') IS NULL
     OR to_regclass('public.reward_claims') IS NULL
     OR to_regclass('public.seller_applications') IS NULL THEN
    RAISE EXCEPTION '需要先套用第四、五階段的優惠券與點數帳本';
  END IF;
  IF to_regprocedure('public.taipei_today(timestamptz)') IS NULL
     OR to_regprocedure('public.is_approved_seller()') IS NULL
     OR to_regprocedure('public.coupon_seller_name(uuid)') IS NULL
     OR to_regprocedure('public.coupon_hold_expiry(date, date)') IS NULL
     OR to_regprocedure('public.seller_coupon_json(public.seller_coupons)') IS NULL
     OR to_regprocedure('public.member_coupon_hold_json(public.member_coupon_holds)') IS NULL THEN
    RAISE EXCEPTION '需要先套用第四批優惠券函式';
  END IF;
  IF to_regclass('public.seller_coupon_point_offers') IS NOT NULL
     OR to_regprocedure('public.exchange_my_point_offer(uuid, integer)') IS NOT NULL THEN
    RAISE EXCEPTION '賣家點數兌換授權已存在，本檔不覆蓋';
  END IF;
END
$require_point_offers$;

CREATE TABLE public.seller_coupon_point_offers (
  coupon_id uuid PRIMARY KEY REFERENCES public.seller_coupons (id) ON DELETE RESTRICT,
  seller_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  points_cost integer NOT NULL,
  points_qty integer NOT NULL,
  points_issued integer NOT NULL DEFAULT 0,
  ends_on date NOT NULL,
  authorized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT seller_coupon_point_offers_cost_check CHECK (points_cost BETWEEN 1 AND 100000),
  CONSTRAINT seller_coupon_point_offers_qty_check CHECK (points_qty BETWEEN 1 AND 10000),
  CONSTRAINT seller_coupon_point_offers_issued_check CHECK (points_issued >= 0 AND points_issued <= points_qty),
  CONSTRAINT seller_coupon_point_offers_authorized_check CHECK (NOT enabled OR authorized_at IS NOT NULL)
);

CREATE INDEX seller_coupon_point_offers_seller
  ON public.seller_coupon_point_offers (seller_id);

CREATE INDEX seller_coupon_point_offers_live
  ON public.seller_coupon_point_offers (authorized_at DESC)
  WHERE enabled;

COMMENT ON TABLE public.seller_coupon_point_offers IS
  '商家明確授權的 Pay 點數兌換設定。沒有這筆或 enabled=false 的券不會出現在購物優惠區。points_issued 只由兌換交易遞增。';

CREATE FUNCTION public.guard_seller_coupon_point_offer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  owner uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '點數兌換授權不可直接刪除';
  END IF;
  IF TG_OP = 'UPDATE' AND current_setting('app.point_offer_issue', true) = 'on' THEN
    IF NEW.points_issued IS DISTINCT FROM OLD.points_issued + 1
       OR NEW.coupon_id IS DISTINCT FROM OLD.coupon_id
       OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
       OR NEW.enabled IS DISTINCT FROM OLD.enabled
       OR NEW.points_cost IS DISTINCT FROM OLD.points_cost
       OR NEW.points_qty IS DISTINCT FROM OLD.points_qty
       OR NEW.ends_on IS DISTINCT FROM OLD.ends_on
       OR NEW.authorized_at IS DISTINCT FROM OLD.authorized_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION '兌換交易不能修改點數兌換條件';
    END IF;
    RETURN NEW;
  END IF;
  IF current_setting('app.point_offer_seller', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '只有商家本人可以設定點數兌換';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.points_issued <> 0 THEN
    RAISE EXCEPTION '新授權不能自帶已兌換數量';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.points_issued IS DISTINCT FROM OLD.points_issued
    OR NEW.coupon_id IS DISTINCT FROM OLD.coupon_id
    OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION '不能修改已兌換數量或授權歸屬';
  END IF;
  SELECT coupon.seller_id INTO owner FROM public.seller_coupons AS coupon WHERE coupon.id = NEW.coupon_id;
  IF owner IS DISTINCT FROM NEW.seller_id THEN
    RAISE EXCEPTION '點數兌換授權必須屬於發券商家';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER seller_coupon_point_offers_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.seller_coupon_point_offers
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_seller_coupon_point_offer();

CREATE FUNCTION public.point_offer_json(p_offer public.seller_coupon_point_offers)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'couponId', p_offer.coupon_id,
    'enabled', p_offer.enabled,
    'pointsCost', p_offer.points_cost,
    'pointsQty', p_offer.points_qty,
    'pointsIssued', p_offer.points_issued,
    'endsOn', pg_catalog.to_char(p_offer.ends_on, 'YYYY-MM-DD')
  );
$$;

CREATE FUNCTION public.save_my_coupon_point_offer(
  p_coupon_id uuid,
  p_enabled boolean,
  p_points_cost integer,
  p_points_qty integer,
  p_ends_on date
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date := public.taipei_today();
  coupon public.seller_coupons;
  offer public.seller_coupon_point_offers;
  has_offer boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '尚未通過賣家審核';
  END IF;
  IF p_coupon_id IS NULL OR p_enabled IS NULL OR p_points_cost IS NULL OR p_points_qty IS NULL OR p_ends_on IS NULL THEN
    RAISE EXCEPTION '點數兌換設定不正確';
  END IF;
  IF p_points_cost < 1 OR p_points_cost > 100000 THEN
    RAISE EXCEPTION '兌換所需點數需介於 1–100,000 點';
  END IF;
  IF p_points_qty < 1 OR p_points_qty > 10000 THEN
    RAISE EXCEPTION '可兌換數量需介於 1–10,000 張';
  END IF;

  PERFORM set_config('app.point_offer_issue', 'off', true);
  PERFORM set_config('app.point_offer_seller', 'on', true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coupon-seller:' || uid::text, 0));

  SELECT * INTO coupon FROM public.seller_coupons WHERE id = p_coupon_id FOR UPDATE;
  IF NOT FOUND OR coupon.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '找不到此折價券';
  END IF;
  IF coupon.seller_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION '不能管理其他商家的優惠券';
  END IF;
  IF p_points_qty > coupon.qty THEN
    RAISE EXCEPTION '可兌換數量不可超過發行總數量';
  END IF;
  IF p_ends_on > coupon.end_on THEN
    RAISE EXCEPTION '點數兌換截止日不可晚於優惠券結束日';
  END IF;

  SELECT * INTO offer FROM public.seller_coupon_point_offers WHERE coupon_id = coupon.id FOR UPDATE;
  has_offer := FOUND;
  IF has_offer AND p_points_qty < offer.points_issued THEN
    RAISE EXCEPTION '可兌換數量不可低於已兌換數量';
  END IF;
  IF p_enabled THEN
    IF NOT coupon.active THEN
      RAISE EXCEPTION '請先上架此優惠券，再開放點數兌換';
    END IF;
    IF p_ends_on < day OR coupon.end_on < day THEN
      RAISE EXCEPTION '點數兌換截止日不可早於今天';
    END IF;
  END IF;

  IF has_offer THEN
    UPDATE public.seller_coupon_point_offers
    SET enabled = p_enabled,
        points_cost = p_points_cost,
        points_qty = p_points_qty,
        ends_on = p_ends_on,
        authorized_at = CASE WHEN p_enabled AND NOT offer.enabled THEN pg_catalog.now() ELSE offer.authorized_at END,
        updated_at = pg_catalog.now()
    WHERE coupon_id = coupon.id
      AND seller_id = uid
    RETURNING * INTO offer;
  ELSE
    INSERT INTO public.seller_coupon_point_offers (
      coupon_id, seller_id, enabled, points_cost, points_qty, ends_on, authorized_at
    )
    VALUES (
      coupon.id, uid, p_enabled, p_points_cost, p_points_qty, p_ends_on,
      CASE WHEN p_enabled THEN pg_catalog.now() END
    )
    RETURNING * INTO offer;
  END IF;

  RETURN public.point_offer_json(offer);
END;
$$;

COMMENT ON FUNCTION public.save_my_coupon_point_offer(uuid, boolean, integer, integer, date) IS
  '商家本人開啟或關閉自己券的 Pay 點數兌換，並設定所需點數、可兌換數量與截止日。';

CREATE FUNCTION public.list_my_coupon_point_offers()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
  SELECT coalesce(pg_catalog.jsonb_agg(public.point_offer_json(offer)), '[]'::jsonb)
  INTO result
  FROM public.seller_coupon_point_offers AS offer
  JOIN public.seller_coupons AS coupon ON coupon.id = offer.coupon_id
  WHERE offer.seller_id = uid
    AND coupon.seller_id = uid
    AND coupon.deleted_at IS NULL;
  RETURN result;
END;
$$;

CREATE FUNCTION public.list_point_offer_coupons()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date := public.taipei_today();
  bal integer;
  coupons jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT balance INTO bal FROM public.member_point_accounts WHERE user_id = uid;
  SELECT coalesce(pg_catalog.jsonb_agg(item.data ORDER BY item.authorized_at DESC), '[]'::jsonb)
  INTO coupons
  FROM (
    SELECT
      public.seller_coupon_json(coupon) || pg_catalog.jsonb_build_object(
        'sellerName', public.coupon_seller_name(coupon.seller_id),
        'held', EXISTS (
          SELECT 1 FROM public.member_coupon_holds AS hold
          WHERE hold.user_id = uid AND hold.coupon_id = coupon.id
        ),
        'offer', public.point_offer_json(offer)
      ) AS data,
      offer.authorized_at
    FROM public.seller_coupon_point_offers AS offer
    JOIN public.seller_coupons AS coupon ON coupon.id = offer.coupon_id
    WHERE offer.enabled
      AND offer.seller_id = coupon.seller_id
      AND coupon.seller_id <> uid
      AND coupon.active
      AND coupon.deleted_at IS NULL
      AND coupon.start_on <= day
      AND coupon.end_on >= day
      AND offer.ends_on >= day
      AND offer.points_issued < offer.points_qty
      AND coupon.issued_count < coupon.qty
      AND EXISTS (
        SELECT 1 FROM public.seller_applications AS sa
        WHERE sa.user_id = coupon.seller_id AND sa.status = 'approved'
      )
    ORDER BY offer.authorized_at DESC
    LIMIT 60
  ) AS item;
  RETURN pg_catalog.jsonb_build_object(
    'balance', coalesce(bal, 0),
    'coupons', coupons,
    'taipeiDay', pg_catalog.to_char(day, 'YYYY-MM-DD')
  );
END;
$$;

COMMENT ON FUNCTION public.list_point_offer_coupons() IS
  '購物優惠區唯讀清單。只列商家已授權、券與授權都在期限內、兩層庫存都有剩、商家仍通過審核的券。不列自己賣場的券。';

CREATE FUNCTION public.exchange_my_point_offer(p_coupon_id uuid, p_expected_cost integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date := public.taipei_today();
  account public.member_point_accounts;
  coupon public.seller_coupons;
  offer public.seller_coupon_point_offers;
  hold public.member_coupon_holds;
  prior public.reward_claims;
  v_claim_key text;
  meta jsonb;
  entry_id uuid;
  next_balance integer;
  v_expires date;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_coupon_id IS NULL THEN
    RAISE EXCEPTION '此優惠券未開放 Pay 點數兌換';
  END IF;

  v_claim_key := 'coupon_exchange:offer:' || p_coupon_id::text;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coupon-user:' || uid::text, 0));

  INSERT INTO public.member_point_accounts (user_id)
  VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO account FROM public.member_point_accounts WHERE user_id = uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無法鎖定點數帳戶';
  END IF;

  SELECT * INTO coupon FROM public.seller_coupons WHERE id = p_coupon_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '此優惠券未開放 Pay 點數兌換';
  END IF;

  SELECT * INTO hold FROM public.member_coupon_holds WHERE user_id = uid AND coupon_id = p_coupon_id;
  IF FOUND THEN
    SELECT * INTO prior
    FROM public.reward_claims AS claim
    WHERE claim.user_id = uid
      AND claim.claim_key = v_claim_key
      AND claim.kind = 'coupon_exchange';
    IF FOUND AND hold.source = 'points' THEN
      RETURN pg_catalog.jsonb_build_object(
        'replayed', true,
        'balance', account.balance,
        'cost', -prior.delta,
        'hold', public.member_coupon_hold_json(hold)
      );
    END IF;
    RAISE EXCEPTION '您已領取過此優惠券';
  END IF;

  SELECT * INTO offer FROM public.seller_coupon_point_offers WHERE coupon_id = p_coupon_id FOR UPDATE;
  IF NOT FOUND OR NOT offer.enabled OR offer.seller_id IS DISTINCT FROM coupon.seller_id THEN
    RAISE EXCEPTION '此優惠券未開放 Pay 點數兌換';
  END IF;
  IF coupon.seller_id = uid THEN
    RAISE EXCEPTION '不能兌換自己賣場的優惠券';
  END IF;
  IF coupon.deleted_at IS NOT NULL OR NOT coupon.active OR coupon.start_on > day OR NOT EXISTS (
    SELECT 1 FROM public.seller_applications AS sa
    WHERE sa.user_id = coupon.seller_id AND sa.status = 'approved'
  ) THEN
    RAISE EXCEPTION '此優惠券未開放 Pay 點數兌換';
  END IF;
  IF coupon.end_on < day OR offer.ends_on < day THEN
    RAISE EXCEPTION '此優惠券的點數兌換已過期';
  END IF;
  IF offer.points_issued >= offer.points_qty OR coupon.issued_count >= coupon.qty THEN
    RAISE EXCEPTION '此優惠券的點數兌換已兌完';
  END IF;
  IF p_expected_cost IS DISTINCT FROM offer.points_cost THEN
    RAISE EXCEPTION '兌換所需點數已變更，請重新整理後再確認';
  END IF;
  IF account.balance < offer.points_cost THEN
    RAISE EXCEPTION '點數不足';
  END IF;

  v_expires := public.coupon_hold_expiry(day, coupon.end_on);
  IF v_expires IS NULL OR v_expires < day THEN
    RAISE EXCEPTION '此優惠券的點數兌換已過期';
  END IF;

  PERFORM set_config('app.coupon_seller', 'off', true);
  PERFORM set_config('app.point_offer_seller', 'off', true);
  PERFORM set_config('app.reward_post', 'on', true);
  PERFORM set_config('app.coupon_issue', 'on', true);
  PERFORM set_config('app.point_offer_issue', 'on', true);

  next_balance := account.balance - offer.points_cost;
  meta := pg_catalog.jsonb_build_object(
    'couponId', coupon.id,
    'sellerId', coupon.seller_id,
    'source', 'point_offer',
    'pointsCost', offer.points_cost
  );

  INSERT INTO public.member_point_entries (
    user_id, delta, balance_after, kind, claim_key, taipei_day, metadata
  )
  VALUES (
    uid, -offer.points_cost, next_balance, 'coupon_exchange', v_claim_key, day, meta
  )
  RETURNING id INTO entry_id;

  UPDATE public.member_point_accounts
  SET balance = next_balance,
      updated_at = pg_catalog.now()
  WHERE user_id = uid;

  INSERT INTO public.reward_claims (
    user_id, kind, claim_key, taipei_day, delta, balance_after, point_entry_id, metadata
  )
  VALUES (
    uid, 'coupon_exchange', v_claim_key, day, -offer.points_cost, next_balance, entry_id, meta
  );

  UPDATE public.seller_coupons
  SET issued_count = issued_count + 1,
      updated_at = pg_catalog.now()
  WHERE id = coupon.id
    AND issued_count = coupon.issued_count
    AND issued_count < qty;
  IF NOT FOUND THEN
    RAISE EXCEPTION '此優惠券的點數兌換已兌完';
  END IF;

  UPDATE public.seller_coupon_point_offers
  SET points_issued = points_issued + 1,
      updated_at = pg_catalog.now()
  WHERE coupon_id = coupon.id
    AND points_issued = offer.points_issued
    AND points_issued < points_qty;
  IF NOT FOUND THEN
    RAISE EXCEPTION '此優惠券的點數兌換已兌完';
  END IF;

  INSERT INTO public.member_coupon_holds (
    user_id, coupon_id, seller_id, source, request_key,
    code, name, kind, amount, percent, max_discount, gift, min_spend,
    claimed_on, expires_on, scratch_play_id
  )
  VALUES (
    uid, coupon.id, coupon.seller_id, 'points', 'points:' || coupon.id::text,
    coupon.code, coupon.name, coupon.kind, coupon.amount, coupon.percent,
    coupon.max_discount, coupon.gift, coupon.min_spend,
    day, v_expires, NULL
  )
  RETURNING * INTO hold;

  RETURN pg_catalog.jsonb_build_object(
    'replayed', false,
    'balance', next_balance,
    'cost', offer.points_cost,
    'hold', public.member_coupon_hold_json(hold)
  );
END;
$$;

COMMENT ON FUNCTION public.exchange_my_point_offer(uuid, integer) IS
  '用商家自訂的 Pay 點數兌換已授權的券。p_expected_cost 必須等於目前授權點數，避免價格變動後誤扣。扣點、發券與兩層庫存在同一個交易。';

REVOKE ALL ON TABLE public.seller_coupon_point_offers FROM PUBLIC, anon, authenticated;
ALTER TABLE public.seller_coupon_point_offers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.guard_seller_coupon_point_offer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.point_offer_json(public.seller_coupon_point_offers) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_my_coupon_point_offer(uuid, boolean, integer, integer, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_coupon_point_offers() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_point_offer_coupons() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exchange_my_point_offer(uuid, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_my_coupon_point_offer(uuid, boolean, integer, integer, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_coupon_point_offers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_point_offer_coupons() TO authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_my_point_offer(uuid, integer) TO authenticated;

DO $revoke_point_offer_service$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON TABLE public.seller_coupon_point_offers FROM service_role;
    REVOKE ALL ON FUNCTION public.guard_seller_coupon_point_offer() FROM service_role;
    REVOKE ALL ON FUNCTION public.point_offer_json(public.seller_coupon_point_offers) FROM service_role;
    REVOKE ALL ON FUNCTION public.save_my_coupon_point_offer(uuid, boolean, integer, integer, date) FROM service_role;
    REVOKE ALL ON FUNCTION public.list_my_coupon_point_offers() FROM service_role;
    REVOKE ALL ON FUNCTION public.list_point_offer_coupons() FROM service_role;
    REVOKE ALL ON FUNCTION public.exchange_my_point_offer(uuid, integer) FROM service_role;
  END IF;
END
$revoke_point_offer_service$;

DO $point_offer_self_check$
DECLARE
  exchange_def text := pg_get_functiondef('public.exchange_my_point_offer(uuid, integer)'::regprocedure);
  list_def text := pg_get_functiondef('public.list_point_offer_coupons()'::regprocedure);
  fn text;
BEGIN
  IF exchange_def ~ E'(^|\n)[ \t]*EXCEPTION([ \t\r\n]|$)' THEN
    RAISE EXCEPTION '兌換函式不能吞掉錯誤';
  END IF;
  IF position('INSERT' IN list_def) > 0 OR position('UPDATE' IN list_def) > 0 OR position('DELETE' IN list_def) > 0 THEN
    RAISE EXCEPTION '購物優惠區清單只能讀取';
  END IF;
  FOREACH fn IN ARRAY ARRAY[
    'public.save_my_coupon_point_offer(uuid, boolean, integer, integer, date)',
    'public.list_my_coupon_point_offers()',
    'public.list_point_offer_coupons()',
    'public.exchange_my_point_offer(uuid, integer)'
  ]
  LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '點數兌換入口權限不正確：%', fn;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.point_offer_json(public.seller_coupon_point_offers)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.guard_seller_coupon_point_offer()', 'EXECUTE') THEN
    RAISE EXCEPTION '內部函式不能開放給 API';
  END IF;
  IF has_table_privilege('authenticated', 'public.seller_coupon_point_offers', 'SELECT')
     OR has_table_privilege('authenticated', 'public.seller_coupon_point_offers', 'INSERT')
     OR has_table_privilege('authenticated', 'public.seller_coupon_point_offers', 'UPDATE')
     OR has_table_privilege('anon', 'public.seller_coupon_point_offers', 'SELECT') THEN
    RAISE EXCEPTION '不能直接開放點數兌換授權表';
  END IF;
  IF EXISTS (SELECT 1 FROM public.seller_coupon_point_offers) THEN
    RAISE EXCEPTION '套用時不應自動建立任何授權';
  END IF;
END
$point_offer_self_check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
