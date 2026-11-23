-- =============================================================================
-- 第八階段第 2 批：賣家進入「到期限制」時的站內提醒。
-- 期限判斷沿用 seller_subscription_eval，不另寫一套。
-- 畫面裡的「到期前 7 天、3 天」是尚未串接的簡訊預覽，不是已上線的提醒時點。
-- 本批只在試營業、核准延長或有效訂閱結束、狀態成為到期限制時寫一則站內通知。
-- 同一賣家、同一期限只寫一次。發送前用伺服器 now() 再呼叫既有判定；
-- 若已進入延長中或有效訂閱，或期限仍未到，就跳過，不補寫舊期限。
-- 訂閱制度尚未啟用時直接返回，不通知任何正式賣家。
-- 不設定啟用時間，不修改全站結帳開關，不收款。
-- =============================================================================

BEGIN;

DO $seller_subscription_reminder_guard$
BEGIN
  IF to_regclass('public.seller_subscriptions') IS NULL
     OR to_regclass('public.seller_subscription_settings') IS NULL
     OR to_regclass('public.seller_applications') IS NULL
     OR to_regprocedure('public.seller_subscription_eval(uuid, timestamptz)') IS NULL
     OR to_regprocedure('public.seller_subscription_taipei(timestamptz)') IS NULL THEN
    RAISE EXCEPTION '請先套用賣家訂閱前兩支增量';
  END IF;
END
$seller_subscription_reminder_guard$;

CREATE TABLE IF NOT EXISTS public.seller_subscription_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  period_ends_at timestamptz NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_subscription_reminders_once UNIQUE (seller_user_id, period_ends_at),
  CONSTRAINT seller_subscription_reminders_text CHECK (
    char_length(title) BETWEEN 1 AND 40
    AND char_length(body) BETWEEN 1 AND 240
    AND title = '賣家方案已到期'
    AND body LIKE '%目前無法接新訂單，仍可處理既有訂單與回覆聊聊%'
  )
);

CREATE INDEX IF NOT EXISTS seller_subscription_reminders_user_idx
  ON public.seller_subscription_reminders (seller_user_id, created_at DESC);

ALTER TABLE public.seller_subscription_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_subscription_reminders FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seller_subscription_remind_one(p_seller uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  policy_at timestamptz;
  sub public.seller_subscriptions%ROWTYPE;
  state jsonb;
  ends_at timestamptz;
  inserted uuid;
  notice_body text;
BEGIN
  IF p_seller IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.enabled_at INTO policy_at
  FROM public.seller_subscription_settings s
  WHERE s.singleton;
  IF policy_at IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.seller_applications
    WHERE user_id = p_seller AND status = 'approved'
  ) THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('seller-subscription'), hashtext(p_seller::text));

  SELECT s.enabled_at INTO policy_at
  FROM public.seller_subscription_settings s
  WHERE s.singleton;
  IF policy_at IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.seller_applications
    WHERE user_id = p_seller AND status = 'approved'
  ) THEN
    RETURN false;
  END IF;

  SELECT * INTO sub
  FROM public.seller_subscriptions
  WHERE seller_user_id = p_seller
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  state := public.seller_subscription_eval(p_seller, now());
  IF state->>'state' IS DISTINCT FROM 'restricted' THEN
    RETURN false;
  END IF;
  ends_at := NULLIF(state->>'endsAt', '')::timestamptz;
  IF ends_at IS NULL OR ends_at > now() THEN
    RETURN false;
  END IF;

  notice_body := '您的期限已於 '
    || public.seller_subscription_taipei(ends_at)
    || '（台北時間）到期。目前無法接新訂單，仍可處理既有訂單與回覆聊聊。';

  INSERT INTO public.seller_subscription_reminders (seller_user_id, period_ends_at, title, body)
  VALUES (p_seller, ends_at, '賣家方案已到期', notice_body)
  ON CONFLICT (seller_user_id, period_ends_at) DO NOTHING
  RETURNING id INTO inserted;

  RETURN inserted IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_seller_subscription_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  policy_at timestamptz;
  seller uuid;
  sent integer := 0;
  skipped integer := 0;
  examined integer := 0;
BEGIN
  SELECT s.enabled_at INTO policy_at
  FROM public.seller_subscription_settings s
  WHERE s.singleton;
  IF policy_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'enabled', false,
      'sent', 0,
      'skipped', 0,
      'examined', 0
    );
  END IF;

  FOR seller IN
    SELECT DISTINCT sa.user_id
    FROM public.seller_applications sa
    JOIN public.seller_subscriptions sub ON sub.seller_user_id = sa.user_id
    WHERE sa.status = 'approved'
  LOOP
    examined := examined + 1;
    IF public.seller_subscription_remind_one(seller) THEN
      sent := sent + 1;
    ELSE
      skipped := skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'enabled', true,
    'sent', sent,
    'skipped', skipped,
    'examined', examined
  );
END;
$$;

COMMENT ON FUNCTION public.dispatch_seller_subscription_reminders() IS
  '排程入口。賣家進入到期限制時寫一則站內通知；重複執行或同時執行不會為同一期限再寫一則。';

CREATE OR REPLACE FUNCTION public.list_my_seller_subscription_reminders()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id,
      'title', n.title,
      'body', n.body,
      'endsTaipei', public.seller_subscription_taipei(n.period_ends_at),
      'readAt', n.read_at,
      'createdTaipei', public.seller_subscription_taipei(n.created_at)
    ) ORDER BY n.created_at DESC), '[]'::jsonb)
    FROM public.seller_subscription_reminders n
    WHERE n.seller_user_id = uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_my_seller_subscription_reminders_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  marked integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  UPDATE public.seller_subscription_reminders
  SET read_at = now()
  WHERE seller_user_id = uid
    AND read_at IS NULL;
  GET DIAGNOSTICS marked = ROW_COUNT;
  RETURN marked;
END;
$$;

REVOKE ALL ON FUNCTION public.seller_subscription_remind_one(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_seller_subscription_reminders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_seller_subscription_reminders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_my_seller_subscription_reminders_read() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_my_seller_subscription_reminders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_my_seller_subscription_reminders_read() TO authenticated;

DO $seller_subscription_reminder_service$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.dispatch_seller_subscription_reminders() TO service_role;
  END IF;
END
$seller_subscription_reminder_service$;

COMMIT;
