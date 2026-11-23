-- =============================================================================
-- 第八階段第 1 批後續：試營業起算、一次延長資格、核准當下寫入 15 天。
-- 請先套用 20261117010000_seller_subscription_apply.sql。
-- 本檔不設定啟用時間，不替任何賣家寫入日期，也不修改全站結帳開關。
-- 讀取 checkout_enabled 只放進賣家方案的顯示結果，不更新該欄位。
-- 啟用時間只會在站長呼叫 admin_enable_seller_subscriptions 時，用伺服器 now() 寫入。
-- 啟用當下已經審核通過的賣家，從該啟用時間起算完整 30 天。
-- 啟用之後才審核通過的賣家，從這次審核通過的伺服器時間起算 30 天。
-- 不讀申請送出時間，也不補歷史審核時間。
-- =============================================================================

BEGIN;

DO $seller_subscription_start_guard$
BEGIN
  IF to_regclass('public.seller_subscriptions') IS NULL
     OR to_regclass('public.seller_extension_requests') IS NULL
     OR to_regclass('public.seller_applications') IS NULL
     OR to_regprocedure('public.seller_subscription_eval(uuid, timestamptz)') IS NULL
     OR to_regprocedure('public.admin_review_seller_extension(uuid, boolean, text)') IS NULL
     OR to_regprocedure('public.is_platform_admin()') IS NULL THEN
    RAISE EXCEPTION '請先套用賣家訂閱第一份增量';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.seller_extension_requests
    GROUP BY seller_user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '已有賣家存在多筆延長申請，沒有自動合併';
  END IF;
END
$seller_subscription_start_guard$;

CREATE TABLE IF NOT EXISTS public.seller_subscription_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled_at timestamptz,
  enabled_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.seller_subscription_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.seller_subscription_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_subscription_settings FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS seller_extension_one_request
  ON public.seller_extension_requests (seller_user_id);

CREATE OR REPLACE FUNCTION public.seller_subscription_policy()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'enabled', enabled_at IS NOT NULL,
    'enabledAt', enabled_at,
    'enabledTaipei', public.seller_subscription_taipei(enabled_at)
  )
  FROM public.seller_subscription_settings
  WHERE singleton;
$$;

CREATE OR REPLACE FUNCTION public.seller_subscription_ensure_trial(p_seller uuid, p_approval_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  enabled_at timestamptz;
  start_at timestamptz;
  end_at timestamptz;
  sub public.seller_subscriptions%ROWTYPE;
BEGIN
  SELECT s.enabled_at INTO enabled_at
  FROM public.seller_subscription_settings s
  WHERE s.singleton;
  IF enabled_at IS NULL OR p_seller IS NULL THEN
    RETURN;
  END IF;

  IF p_approval_at IS NULL OR p_approval_at < enabled_at THEN
    start_at := enabled_at;
  ELSE
    start_at := p_approval_at;
  END IF;
  end_at := start_at + interval '30 days';

  PERFORM pg_advisory_xact_lock(hashtext('seller-subscription'), hashtext(p_seller::text));
  SELECT * INTO sub
  FROM public.seller_subscriptions
  WHERE seller_user_id = p_seller
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
    VALUES (p_seller, start_at, end_at);
    RETURN;
  END IF;

  IF sub.trial_starts_at = start_at AND sub.trial_ends_at = end_at THEN
    RETURN;
  END IF;

  IF sub.trial_starts_at IS NOT NULL OR sub.trial_ends_at IS NOT NULL THEN
    RAISE EXCEPTION '賣家 % 已有試營業 % 至 %，這次要寫入 % 至 %，沒有覆蓋',
      p_seller,
      public.seller_subscription_taipei(sub.trial_starts_at),
      public.seller_subscription_taipei(sub.trial_ends_at),
      public.seller_subscription_taipei(start_at),
      public.seller_subscription_taipei(end_at);
  END IF;

  IF sub.extension_starts_at IS NOT NULL OR sub.paid_starts_at IS NOT NULL OR sub.payment_status = 'paid' THEN
    RAISE EXCEPTION '賣家 % 已有延長或付費期限，沒有另外寫入試營業', p_seller;
  END IF;

  UPDATE public.seller_subscriptions
  SET trial_starts_at = start_at,
      trial_ends_at = end_at,
      updated_at = now()
  WHERE seller_user_id = p_seller;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_subscription_on_seller_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;
  PERFORM public.seller_subscription_ensure_trial(NEW.user_id, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seller_applications_subscription_trial ON public.seller_applications;
CREATE TRIGGER seller_applications_subscription_trial
  AFTER INSERT OR UPDATE OF status ON public.seller_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.seller_subscription_on_seller_approved();

CREATE OR REPLACE FUNCTION public.admin_enable_seller_subscriptions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.seller_subscription_settings%ROWTYPE;
  seller uuid;
  started integer := 0;
  v_at timestamptz;
BEGIN
  IF public.is_platform_admin() IS NOT TRUE OR uid IS NULL THEN
    RAISE EXCEPTION '沒有權限';
  END IF;

  SELECT * INTO row
  FROM public.seller_subscription_settings
  WHERE singleton
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '缺少賣家訂閱啟用設定';
  END IF;
  IF row.enabled_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'alreadyEnabled', true,
      'enabledAt', row.enabled_at,
      'enabledTaipei', public.seller_subscription_taipei(row.enabled_at),
      'sellersStarted', 0
    );
  END IF;

  v_at := now();
  UPDATE public.seller_subscription_settings
  SET enabled_at = v_at,
      enabled_by = uid,
      updated_at = v_at
  WHERE singleton;

  FOR seller IN
    SELECT sa.user_id
    FROM public.seller_applications sa
    WHERE sa.status = 'approved'
  LOOP
    PERFORM public.seller_subscription_ensure_trial(seller, NULL);
    started := started + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'alreadyEnabled', false,
    'enabledAt', v_at,
    'enabledTaipei', public.seller_subscription_taipei(v_at),
    'sellersStarted', started
  );
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
  request_status text;
  extension_approved boolean := false;
  qualification_used boolean := false;
  can_apply boolean := false;
  block_reason text := '試營業尚未起算，不能申請延長';
  schedule_note text := NULL;
  secs bigint;
  policy_at timestamptz;
  policy_enabled boolean := false;
BEGIN
  IF p_seller IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION '缺少賣家或伺服器時間';
  END IF;

  SELECT s.enabled_at INTO policy_at
  FROM public.seller_subscription_settings s
  WHERE s.singleton;
  policy_enabled := policy_at IS NOT NULL;

  SELECT * INTO sub FROM public.seller_subscriptions WHERE seller_user_id = p_seller;
  has_sub := FOUND;

  SELECT r.status INTO request_status
  FROM public.seller_extension_requests r
  WHERE r.seller_user_id = p_seller
  LIMIT 1;
  qualification_used := request_status IS NOT NULL;
  extension_approved := request_status = 'approved';

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
  ELSIF request_status = 'pending' THEN
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

  IF extension_approved AND (NOT has_sub OR sub.extension_starts_at IS NULL) THEN
    schedule_note := '已有核准紀錄但沒有 15 天期限，資料不一致，沒有自動補寫';
  END IF;

  IF win_start IS NULL AND has_sub THEN
    IF sub.extension_ends_at IS NOT NULL
       AND (sub.paid_ends_at IS NULL OR sub.extension_ends_at >= sub.paid_ends_at)
       AND (sub.trial_ends_at IS NULL OR sub.extension_ends_at >= sub.trial_ends_at) THEN
      win_start := sub.extension_starts_at;
      win_end := sub.extension_ends_at;
    ELSIF sub.paid_ends_at IS NOT NULL
       AND (sub.trial_ends_at IS NULL OR sub.paid_ends_at >= sub.trial_ends_at) THEN
      win_start := sub.paid_starts_at;
      win_end := sub.paid_ends_at;
    ELSIF sub.trial_ends_at IS NOT NULL THEN
      win_start := sub.trial_starts_at;
      win_end := sub.trial_ends_at;
    END IF;
  END IF;

  IF state = 'restricted' AND NOT qualification_used THEN
    can_apply := true;
    block_reason := NULL;
  ELSIF request_status = 'pending' THEN
    block_reason := '已經有待審申請';
  ELSIF qualification_used THEN
    block_reason := '每位賣家只能提出一次延長申請';
  ELSIF state = 'trial' OR state = 'extension_active' OR state = 'subscribed' THEN
    block_reason := '還沒到期，不能申請延長';
  ELSIF NOT policy_enabled THEN
    block_reason := '訂閱制度尚未啟用，不能申請延長';
  ELSE
    block_reason := '試營業尚未起算，不能申請延長';
  END IF;

  secs := CASE
    WHEN win_end IS NULL OR win_end <= p_at THEN NULL
    ELSE floor(extract(epoch FROM (win_end - p_at)))::bigint
  END;

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
    'extensionUsed', extension_approved,
    'extensionQualificationUsed', qualification_used,
    'scheduleNote', schedule_note,
    'paymentStatus', CASE WHEN has_sub THEN sub.payment_status ELSE 'unpaid' END,
    'quote', public.seller_plan_quote(),
    'policy', jsonb_build_object(
      'enabled', policy_enabled,
      'enabledTaipei', public.seller_subscription_taipei(policy_at)
    )
  );
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
  existing text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '通過賣家認證後才能申請延長';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('seller-subscription'), hashtext(uid::text));
  SELECT r.status INTO existing
  FROM public.seller_extension_requests r
  WHERE r.seller_user_id = uid;
  IF existing = 'pending' THEN
    RAISE EXCEPTION '已經有待審申請';
  END IF;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION '每位賣家只能提出一次延長申請';
  END IF;
  state := public.seller_subscription_eval(uid, now());
  IF coalesce((state->>'canApplyExtension')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', coalesce(state->>'applyBlockReason', '現在不能申請延長');
  END IF;
  BEGIN
    INSERT INTO public.seller_extension_requests (seller_user_id, status)
    VALUES (uid, 'pending');
  EXCEPTION
    WHEN unique_violation THEN
      IF EXISTS (
        SELECT 1 FROM public.seller_extension_requests
        WHERE seller_user_id = uid AND status = 'pending'
      ) THEN
        RAISE EXCEPTION '已經有待審申請';
      END IF;
      RAISE EXCEPTION '每位賣家只能提出一次延長申請';
  END;
  RETURN public.get_my_seller_subscription();
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
  sub public.seller_subscriptions%ROWTYPE;
  cleaned text := NULLIF(btrim(coalesce(p_note, '')), '');
  v_now timestamptz := now();
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
    SELECT * INTO sub
    FROM public.seller_subscriptions
    WHERE seller_user_id = row.seller_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '賣家 % 沒有訂閱期限，不能核准延長', row.seller_user_id;
    END IF;
    IF sub.extension_starts_at IS NOT NULL OR sub.extension_ends_at IS NOT NULL THEN
      RAISE EXCEPTION '賣家 % 已有延長期限 % 至 %，沒有覆蓋',
        row.seller_user_id,
        public.seller_subscription_taipei(sub.extension_starts_at),
        public.seller_subscription_taipei(sub.extension_ends_at);
    END IF;
    IF sub.payment_status = 'paid'
       AND sub.paid_starts_at IS NOT NULL
       AND sub.paid_starts_at <= v_now
       AND sub.paid_ends_at > v_now THEN
      RAISE EXCEPTION '賣家 % 已有有效訂閱至 %，核准延長不會進入延長中，沒有寫入',
        row.seller_user_id,
        public.seller_subscription_taipei(sub.paid_ends_at);
    END IF;
    UPDATE public.seller_extension_requests
    SET status = 'approved', reviewed_at = v_now, reviewed_by = uid, note = cleaned
    WHERE id = row.id;
    UPDATE public.seller_subscriptions
    SET extension_starts_at = v_now,
        extension_ends_at = v_now + interval '15 days',
        updated_at = v_now
    WHERE seller_user_id = row.seller_user_id;
  ELSE
    UPDATE public.seller_extension_requests
    SET status = 'rejected', reviewed_at = v_now, reviewed_by = uid, note = cleaned
    WHERE id = row.id;
  END IF;
  RETURN public.seller_subscription_eval(row.seller_user_id, now());
END;
$$;

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
  checkout_open boolean := false;
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
  SELECT s.checkout_enabled INTO checkout_open
  FROM public.commerce_settings s
  WHERE s.id = true;
  RETURN state || jsonb_build_object(
    'requests', requests,
    'checkoutOpen', coalesce(checkout_open, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seller_subscription_policy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_subscription_ensure_trial(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_subscription_on_seller_approved() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_enable_seller_subscriptions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_subscription_eval(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_my_seller_extension() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_review_seller_extension(uuid, boolean, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.seller_subscription_policy() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enable_seller_subscriptions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_my_seller_extension() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_seller_extension(uuid, boolean, text) TO authenticated;

COMMIT;
