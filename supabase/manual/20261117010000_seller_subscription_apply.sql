-- =============================================================================
-- 第八階段第 1 批：賣家月費訂閱的狀態、一次延長與新交易限制。
-- 平台只收賣家月費，不代收商品交易款。本批不收款，也不能把「立即訂閱」寫成已付款。
-- 不修改全站結帳開關，不改既有訂單、商品或聊天資料。
-- 試營業起算與核准後的 15 天由第二支增量負責。本檔不為任何正式賣家寫入日期。
-- 若已裝上第二支，或函式本文不是本檔的版本，必須在任何修改前停止，不能降回這支的舊函式。
-- =============================================================================

BEGIN;

DO $seller_subscription_downgrade_guard$
DECLARE
  eval_fp text;
  apply_fp text;
  review_fp text;
  mine_fp text;
  v1_eval constant text := '37820150568ae4daedbcb70e9c0472d5';
  v2_eval constant text := '03229c094d9e9ef928ffa57796d18d3b';
  v1_apply constant text := '0d85722e4bf292525fc30287008a9c3e';
  v2_apply constant text := 'd1915108eed25ec918b81099580f7127';
  v1_review constant text := 'bba0f414a85ee1b337dc5ee4502516e3';
  v2_review constant text := 'b6dec4a83a048080c517e5001075072b';
  v1_mine constant text := '6848026b62398cc0b6e4bef80c3affc5';
  v2_mine constant text := '7733b9733423ffaa5522b0dc283b8ba4';
BEGIN
  IF to_regclass('public.seller_subscription_settings') IS NOT NULL
     OR to_regprocedure('public.seller_subscription_policy()') IS NOT NULL
     OR to_regprocedure('public.seller_subscription_ensure_trial(uuid, timestamptz)') IS NOT NULL
     OR to_regprocedure('public.admin_enable_seller_subscriptions()') IS NOT NULL
     OR to_regprocedure('public.seller_subscription_on_seller_approved()') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'seller_extension_one_request'
     ) THEN
    RAISE EXCEPTION '偵測到第二支賣家訂閱增量，已停止，沒有降回第一支';
  END IF;

  SELECT md5(replace(p.prosrc, E'\r\n', E'\n')) INTO eval_fp
  FROM pg_proc AS p
  WHERE p.oid = to_regprocedure('public.seller_subscription_eval(uuid, timestamptz)');
  SELECT md5(replace(p.prosrc, E'\r\n', E'\n')) INTO apply_fp
  FROM pg_proc AS p
  WHERE p.oid = to_regprocedure('public.apply_my_seller_extension()');
  SELECT md5(replace(p.prosrc, E'\r\n', E'\n')) INTO review_fp
  FROM pg_proc AS p
  WHERE p.oid = to_regprocedure('public.admin_review_seller_extension(uuid, boolean, text)');
  SELECT md5(replace(p.prosrc, E'\r\n', E'\n')) INTO mine_fp
  FROM pg_proc AS p
  WHERE p.oid = to_regprocedure('public.get_my_seller_subscription()');

  IF eval_fp = v2_eval OR apply_fp = v2_apply OR review_fp = v2_review OR mine_fp = v2_mine THEN
    RAISE EXCEPTION '偵測到第二支賣家訂閱增量，已停止，沒有降回第一支';
  END IF;
  IF (eval_fp IS NOT NULL AND eval_fp IS DISTINCT FROM v1_eval)
     OR (apply_fp IS NOT NULL AND apply_fp IS DISTINCT FROM v1_apply)
     OR (review_fp IS NOT NULL AND review_fp IS DISTINCT FROM v1_review)
     OR (mine_fp IS NOT NULL AND mine_fp IS DISTINCT FROM v1_mine) THEN
    RAISE EXCEPTION '偵測到未知的賣家訂閱函式版本，已停止，沒有降回第一支';
  END IF;
END
$seller_subscription_downgrade_guard$;

DO $seller_subscription_shape$
BEGIN
  IF to_regprocedure('public.is_platform_admin()') IS NULL
     OR to_regprocedure('public.is_approved_seller()') IS NULL
     OR to_regprocedure('public.place_checkout(uuid, jsonb, jsonb, jsonb, text, text, text, jsonb)') IS NULL
     OR to_regclass('public.orders') IS NULL
     OR to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION '缺少賣家認證、結帳或訂單，停止';
  END IF;
END
$seller_subscription_shape$;

CREATE TABLE IF NOT EXISTS public.seller_subscriptions (
  seller_user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
  trial_starts_at timestamptz,
  trial_ends_at timestamptz,
  extension_starts_at timestamptz,
  extension_ends_at timestamptz,
  paid_starts_at timestamptz,
  paid_ends_at timestamptz,
  payment_status text NOT NULL DEFAULT 'unpaid',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_subscriptions_payment CHECK (payment_status IN ('unpaid', 'paid')),
  CONSTRAINT seller_subscriptions_trial_pair CHECK (
    (trial_starts_at IS NULL AND trial_ends_at IS NULL)
    OR (trial_starts_at IS NOT NULL AND trial_ends_at IS NOT NULL AND trial_starts_at < trial_ends_at)
  ),
  CONSTRAINT seller_subscriptions_extension_pair CHECK (
    (extension_starts_at IS NULL AND extension_ends_at IS NULL)
    OR (extension_starts_at IS NOT NULL AND extension_ends_at IS NOT NULL AND extension_starts_at < extension_ends_at)
  ),
  CONSTRAINT seller_subscriptions_paid_pair CHECK (
    (paid_starts_at IS NULL AND paid_ends_at IS NULL)
    OR (paid_starts_at IS NOT NULL AND paid_ends_at IS NOT NULL AND paid_starts_at < paid_ends_at)
  )
);

CREATE TABLE IF NOT EXISTS public.seller_extension_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  status text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  note text,
  CONSTRAINT seller_extension_requests_status CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT seller_extension_requests_note_len CHECK (note IS NULL OR char_length(note) <= 200),
  CONSTRAINT seller_extension_requests_review_pair CHECK (
    (status = 'pending' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS seller_extension_one_pending
  ON public.seller_extension_requests (seller_user_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS seller_extension_one_approved
  ON public.seller_extension_requests (seller_user_id)
  WHERE status = 'approved';

DO $seller_subscription_columns$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('seller_subscriptions', 'trial_starts_at'),
      ('seller_subscriptions', 'trial_ends_at'),
      ('seller_subscriptions', 'extension_starts_at'),
      ('seller_subscriptions', 'extension_ends_at'),
      ('seller_subscriptions', 'paid_starts_at'),
      ('seller_subscriptions', 'paid_ends_at'),
      ('seller_subscriptions', 'payment_status'),
      ('seller_extension_requests', 'status'),
      ('seller_extension_requests', 'reviewed_by')
    ) AS need(rel, col)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = need.rel AND column_name = need.col
    )
  ) THEN
    RAISE EXCEPTION '賣家訂閱資料表與這份增量不一致，停止';
  END IF;
END
$seller_subscription_columns$;

ALTER TABLE public.seller_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_extension_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_extension_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seller_plan_quote()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'net', 499.00::numeric(12, 2),
    'tax', 24.95::numeric(12, 2),
    'gross', 523.95::numeric(12, 2),
    'approxDisplay', 524,
    'approxIsCharge', false,
    'currency', 'TWD'
  );
$$;

CREATE OR REPLACE FUNCTION public.seller_subscription_taipei(p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_at IS NULL THEN NULL
    ELSE to_char(p_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI:SS')
  END;
$$;

CREATE OR REPLACE FUNCTION public.seller_subscription_remaining(p_end timestamptz, p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_end IS NULL OR p_at IS NULL OR p_end <= p_at THEN NULL
    WHEN floor(extract(epoch FROM (p_end - p_at)))::bigint < 60 THEN '不到 1 分鐘'
    ELSE (
      floor(extract(epoch FROM (p_end - p_at)) / 86400)::bigint::text || ' 天 '
      || floor(mod(extract(epoch FROM (p_end - p_at)), 86400) / 3600)::bigint::text || ' 小時 '
      || floor(mod(extract(epoch FROM (p_end - p_at)), 3600) / 60)::bigint::text || ' 分鐘'
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.seller_subscription_eval(p_seller uuid, p_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  sub public.seller_subscriptions%ROWTYPE;
  has_sub boolean := false;
  state text := 'unset';
  label text := '尚未起算';
  win_start timestamptz;
  win_end timestamptz;
  allowed boolean;
  pending_id uuid;
  approved_id uuid;
  extension_used boolean := false;
  can_apply boolean := false;
  block_reason text := '試營業尚未起算，不能申請延長';
  schedule_note text := NULL;
  secs bigint;
BEGIN
  IF p_seller IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION '缺少賣家或伺服器時間';
  END IF;

  SELECT * INTO sub FROM public.seller_subscriptions WHERE seller_user_id = p_seller;
  has_sub := FOUND;

  SELECT id INTO pending_id
  FROM public.seller_extension_requests
  WHERE seller_user_id = p_seller AND status = 'pending'
  LIMIT 1;
  SELECT id INTO approved_id
  FROM public.seller_extension_requests
  WHERE seller_user_id = p_seller AND status = 'approved'
  LIMIT 1;
  extension_used := approved_id IS NOT NULL;

  IF has_sub AND sub.payment_status = 'paid'
     AND sub.paid_starts_at IS NOT NULL AND sub.paid_starts_at <= p_at AND sub.paid_ends_at > p_at THEN
    state := 'subscribed';
    label := '有效訂閱';
    win_start := sub.paid_starts_at;
    win_end := sub.paid_ends_at;
    allowed := true;
  ELSIF has_sub AND sub.extension_starts_at IS NOT NULL
     AND sub.extension_starts_at <= p_at AND sub.extension_ends_at > p_at THEN
    state := 'extension_active';
    label := '延長中';
    win_start := sub.extension_starts_at;
    win_end := sub.extension_ends_at;
    allowed := true;
  ELSIF has_sub AND sub.trial_starts_at IS NOT NULL
     AND sub.trial_starts_at <= p_at AND sub.trial_ends_at > p_at THEN
    state := 'trial';
    label := '試營業';
    win_start := sub.trial_starts_at;
    win_end := sub.trial_ends_at;
    allowed := true;
  ELSIF pending_id IS NOT NULL THEN
    state := 'extension_pending';
    label := '延長待審';
    allowed := false;
  ELSIF has_sub AND (
    (sub.trial_ends_at IS NOT NULL AND sub.trial_ends_at <= p_at)
    OR (sub.extension_ends_at IS NOT NULL AND sub.extension_ends_at <= p_at)
    OR (sub.paid_ends_at IS NOT NULL AND sub.paid_ends_at <= p_at)
  ) THEN
    state := 'restricted';
    label := '到期限制';
    allowed := false;
  ELSE
    state := 'unset';
    label := '尚未起算';
    allowed := NULL;
  END IF;

  IF extension_used AND state = 'restricted'
     AND has_sub AND sub.extension_starts_at IS NULL THEN
    schedule_note := '已核准，15 天從何時起算尚未決定，所以期限還沒寫入，也不算延長中';
  END IF;

  IF state = 'restricted' AND NOT extension_used AND pending_id IS NULL THEN
    can_apply := true;
    block_reason := NULL;
  ELSIF state = 'trial' OR state = 'extension_active' OR state = 'subscribed' THEN
    block_reason := '還沒到期，不能申請延長';
  ELSIF pending_id IS NOT NULL THEN
    block_reason := '已經有待審申請';
  ELSIF extension_used THEN
    block_reason := '每位賣家只能申請一次延長';
  END IF;

  secs := CASE WHEN win_end IS NULL THEN NULL ELSE floor(extract(epoch FROM (win_end - p_at)))::bigint END;

  RETURN jsonb_build_object(
    'state', state,
    'label', label,
    'canStartNewTrade', allowed,
    'startsAt', win_start,
    'endsAt', win_end,
    'startsTaipei', public.seller_subscription_taipei(win_start),
    'endsTaipei', public.seller_subscription_taipei(win_end),
    'serverAt', p_at,
    'serverTaipei', public.seller_subscription_taipei(p_at),
    'remainingText', public.seller_subscription_remaining(win_end, p_at),
    'remainingSeconds', secs,
    'canApplyExtension', can_apply,
    'applyBlockReason', block_reason,
    'extensionUsed', extension_used,
    'scheduleNote', schedule_note,
    'paymentStatus', CASE WHEN has_sub THEN sub.payment_status ELSE 'unpaid' END,
    'quote', public.seller_plan_quote()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_subscription_new_trade_allowed(p_seller uuid, p_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT (public.seller_subscription_eval(p_seller, p_at)->>'canStartNewTrade')::boolean;
$$;

CREATE OR REPLACE FUNCTION public.seller_subscription_refuse_new_trades(p_lines jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  seller uuid;
BEGIN
  FOR seller IN
    SELECT DISTINCT p.seller_id
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines ELSE '[]'::jsonb END) AS line(value)
    JOIN public.products p ON p.id = (line.value->>'productId')::uuid
    WHERE (line.value->>'productId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND p.seller_id IS NOT NULL
  LOOP
    IF public.seller_subscription_new_trade_allowed(seller, now()) IS FALSE THEN
      RAISE EXCEPTION '賣家月費到期，不能建立新交易';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.orders_block_expired_seller_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND public.seller_subscription_new_trade_allowed(NEW.seller_id, now()) IS FALSE THEN
    RAISE EXCEPTION '賣家月費到期，不能建立新交易';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_seller_subscription_guard ON public.orders;
CREATE TRIGGER orders_seller_subscription_guard
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_block_expired_seller_subscription();

CREATE OR REPLACE FUNCTION public.get_my_seller_subscription()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  state jsonb;
  requests jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  state := public.seller_subscription_eval(uid, now());
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'statusLabel', CASE r.status WHEN 'pending' THEN '待審' WHEN 'approved' THEN '已核准' ELSE '已拒絕' END,
    'requestedTaipei', public.seller_subscription_taipei(r.requested_at),
    'reviewedTaipei', public.seller_subscription_taipei(r.reviewed_at),
    'note', r.note
  ) ORDER BY r.requested_at), '[]'::jsonb)
    INTO requests
  FROM public.seller_extension_requests r
  WHERE r.seller_user_id = uid;
  RETURN state || jsonb_build_object('requests', requests);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_my_seller_extension()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  state jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '通過賣家認證後才能申請延長';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('seller-subscription'), hashtext(uid::text));
  state := public.seller_subscription_eval(uid, now());
  IF coalesce((state->>'canApplyExtension')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', coalesce(state->>'applyBlockReason', '現在不能申請延長');
  END IF;
  INSERT INTO public.seller_extension_requests (seller_user_id, status)
  VALUES (uid, 'pending');
  RETURN public.get_my_seller_subscription();
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_seller_subscription_payment()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  paid_count integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT count(*) INTO paid_count
  FROM public.seller_subscriptions
  WHERE seller_user_id = uid AND payment_status = 'paid';
  RETURN jsonb_build_object(
    'ok', false,
    'code', 'payment_not_connected',
    'paymentStatus', CASE WHEN paid_count > 0 THEN 'paid' ELSE 'unpaid' END,
    'message', '付款尚未開放。按下不會建立付款，也不會變成有效訂閱。'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_seller_extensions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF public.is_platform_admin() IS NOT TRUE THEN
    RAISE EXCEPTION '沒有權限';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id,
      'sellerUserId', r.seller_user_id,
      'storeName', public.seller_store_name(r.seller_user_id),
      'status', r.status,
      'statusLabel', CASE r.status WHEN 'pending' THEN '待審' WHEN 'approved' THEN '已核准' ELSE '已拒絕' END,
      'requestedTaipei', public.seller_subscription_taipei(r.requested_at),
      'reviewedTaipei', public.seller_subscription_taipei(r.reviewed_at),
      'reviewedBy', r.reviewed_by,
      'note', r.note,
      'state', public.seller_subscription_eval(r.seller_user_id, now())
    ) ORDER BY (r.status = 'pending') DESC, r.requested_at)
    FROM public.seller_extension_requests r
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_seller_extension(p_id uuid, p_approve boolean, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.seller_extension_requests%ROWTYPE;
  cleaned text := NULLIF(btrim(coalesce(p_note, '')), '');
BEGIN
  IF public.is_platform_admin() IS NOT TRUE OR uid IS NULL THEN
    RAISE EXCEPTION '沒有權限';
  END IF;
  IF cleaned IS NOT NULL AND char_length(cleaned) > 200 THEN
    RAISE EXCEPTION '審核說明最多 200 字';
  END IF;
  SELECT * INTO row FROM public.seller_extension_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到延長申請';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('seller-subscription'), hashtext(row.seller_user_id::text));
  IF row.status <> 'pending' THEN
    RAISE EXCEPTION '這筆申請已經審過';
  END IF;
  IF coalesce(p_approve, false) THEN
    IF EXISTS (
      SELECT 1 FROM public.seller_extension_requests
      WHERE seller_user_id = row.seller_user_id AND status = 'approved' AND id <> row.id
    ) THEN
      RAISE EXCEPTION '這位賣家的延長已經核准過';
    END IF;
    UPDATE public.seller_extension_requests
    SET status = 'approved', reviewed_at = now(), reviewed_by = uid, note = cleaned
    WHERE id = row.id;
  ELSE
    UPDATE public.seller_extension_requests
    SET status = 'rejected', reviewed_at = now(), reviewed_by = uid, note = cleaned
    WHERE id = row.id;
  END IF;
  RETURN public.seller_subscription_eval(row.seller_user_id, now());
END;
$$;

REVOKE ALL ON FUNCTION public.seller_plan_quote() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_subscription_taipei(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_subscription_remaining(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_subscription_eval(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_subscription_new_trade_allowed(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_subscription_refuse_new_trades(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.orders_block_expired_seller_subscription() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_seller_subscription() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_my_seller_extension() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_seller_subscription_payment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_seller_extensions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_review_seller_extension(uuid, boolean, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.seller_plan_quote() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_subscription() TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_my_seller_extension() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_seller_subscription_payment() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_extensions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_seller_extension(uuid, boolean, text) TO authenticated;

DO $patch_place_checkout$
DECLARE
  def text;
  mark integer;
  ret_at integer := 0;
  next_rel integer;
BEGIN
  def := pg_get_functiondef('public.place_checkout(uuid, jsonb, jsonb, jsonb, text, text, text, jsonb)'::regprocedure);
  IF position('seller_subscription_refuse_new_trades' IN def) > 0 THEN
    RETURN;
  END IF;
  mark := position('''checkout_unavailable''' IN def);
  IF mark = 0 THEN
    RAISE EXCEPTION '結帳函式找不到尚未開放的回傳，停止';
  END IF;
  ret_at := 0;
  LOOP
    next_rel := strpos(substr(def, ret_at + 1, mark - ret_at), 'RETURN ');
    EXIT WHEN next_rel = 0;
    ret_at := ret_at + next_rel;
  END LOOP;
  IF ret_at = 0 OR ret_at > mark THEN
    RAISE EXCEPTION '結帳函式無法插入月費檢查，停止';
  END IF;
  def := substr(def, 1, ret_at - 1)
    || 'PERFORM public.seller_subscription_refuse_new_trades(p_lines);' || E'\n  '
    || substr(def, ret_at);
  EXECUTE def;
END
$patch_place_checkout$;

COMMIT;
