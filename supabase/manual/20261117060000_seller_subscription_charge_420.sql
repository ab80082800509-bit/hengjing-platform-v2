-- =============================================================================
-- 第八階段第 3 批後續：賣家月費金額定案。
-- 未稅 400.00、稅額 20.00、含稅實付 420。藍新 MPG 的 Amt 使用 420。
-- 舊的 523.95 未送出草稿保留原報價與空白實收金額，不改成 420。
-- 新付款單另建，通知只跟該張付款單的 gateway_amt 核對。
-- 付費起算與續期不在這份處理。不設定啟用時間，不打開全站結帳，不送出正式收款。
-- =============================================================================

BEGIN;

DO $seller_subscription_charge_guard$
DECLARE
  gross numeric;
BEGIN
  IF to_regclass('public.seller_subscription_payments') IS NULL
     OR to_regprocedure('public.seller_plan_quote()') IS NULL
     OR to_regprocedure('public.create_my_seller_subscription_payment()') IS NULL THEN
    RAISE EXCEPTION '請先套用賣家月費付款單';
  END IF;
  gross := (public.seller_plan_quote()->>'gross')::numeric;
  IF gross IS DISTINCT FROM 523.95 AND gross IS DISTINCT FROM 420.00 THEN
    RAISE EXCEPTION '目前方案報價不是 523.95 或 420，沒有覆蓋';
  END IF;
END
$seller_subscription_charge_guard$;

CREATE OR REPLACE FUNCTION public.seller_plan_quote()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'net', 400.00::numeric(12, 2),
    'tax', 20.00::numeric(12, 2),
    'gross', 420.00::numeric(12, 2),
    'chargeAmt', 420,
    'approxDisplay', 420,
    'approxIsCharge', true,
    'currency', 'TWD'
  );
$$;

ALTER TABLE public.seller_subscription_payments
  DROP CONSTRAINT IF EXISTS seller_subscription_payments_quote_check;

ALTER TABLE public.seller_subscription_payments
  ADD CONSTRAINT seller_subscription_payments_quote_check CHECK (
    (quote_net = 499.00 AND quote_tax = 24.95 AND quote_gross = 523.95 AND gateway_amt IS NULL)
    OR (quote_net = 400.00 AND quote_tax = 20.00 AND quote_gross = 420.00 AND gateway_amt = 420)
  );

DROP INDEX IF EXISTS public.seller_subscription_payments_one_open;

CREATE UNIQUE INDEX IF NOT EXISTS seller_subscription_payments_one_current
  ON public.seller_subscription_payments (seller_user_id)
  WHERE status = 'amount_pending' AND quote_gross = 420.00;

CREATE OR REPLACE FUNCTION public.seller_subscription_payment_json(p public.seller_subscription_payments)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'merchantOrderNo', p.merchant_order_no,
    'quoteNet', to_char(p.quote_net, 'FM999999990.00'),
    'quoteTax', to_char(p.quote_tax, 'FM999999990.00'),
    'quoteGross', to_char(p.quote_gross, 'FM999999990.00'),
    'approxDisplay', CASE WHEN p.gateway_amt IS NULL THEN 524 ELSE p.gateway_amt END,
    'approxIsCharge', p.gateway_amt IS NOT NULL,
    'gatewayAmt', p.gateway_amt,
    'mpgAmt', p.gateway_amt,
    'status', p.status,
    'tradeNo', p.trade_no,
    'paidTaipei', public.seller_subscription_taipei(p.paid_at),
    'failureCode', p.failure_code,
    'createdTaipei', public.seller_subscription_taipei(p.created_at),
    'periodWritten', false
  );
$$;

CREATE OR REPLACE FUNCTION public.create_my_seller_subscription_payment()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  quote jsonb;
  row public.seller_subscription_payments%ROWTYPE;
  order_no text;
  created_message constant text := '已建立新付款單。藍新 MPG 的 Amt 是 420。正式收款維持關閉，沒有送出，也不會寫成有效訂閱。';
  reused_message constant text := '沿用尚未送出的 420 元付款單。正式收款維持關閉，沒有送出，也不會寫成有效訂閱。';
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '通過賣家認證後才能建立月費付款單';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('seller-subscription-payment'), hashtext(uid::text));
  quote := public.seller_plan_quote();
  IF (quote->>'net')::numeric IS DISTINCT FROM 400.00
     OR (quote->>'tax')::numeric IS DISTINCT FROM 20.00
     OR (quote->>'gross')::numeric IS DISTINCT FROM 420.00
     OR (quote->>'chargeAmt')::integer IS DISTINCT FROM 420 THEN
    RAISE EXCEPTION '方案實付不是 420，沒有建立付款單';
  END IF;

  SELECT * INTO row
  FROM public.seller_subscription_payments
  WHERE seller_user_id = uid
    AND status = 'amount_pending'
    AND quote_gross = 420.00
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'code', 'mpg_amt_420',
      'credited', false,
      'gatewayReady', false,
      'collectionOpen', false,
      'mpgAmt', 420,
      'reused', true,
      'message', reused_message,
      'payment', public.seller_subscription_payment_json(row)
    );
  END IF;

  order_no := 'sub' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
  BEGIN
    INSERT INTO public.seller_subscription_payments (
      seller_user_id, merchant_order_no, quote_net, quote_tax, quote_gross, gateway_amt, status
    ) VALUES (
      uid,
      order_no,
      400.00,
      20.00,
      420.00,
      420,
      'amount_pending'
    )
    RETURNING * INTO row;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO row
      FROM public.seller_subscription_payments
      WHERE seller_user_id = uid
        AND status = 'amount_pending'
        AND quote_gross = 420.00;
      IF NOT FOUND THEN
        RAISE;
      END IF;
      RETURN jsonb_build_object(
        'ok', true,
        'code', 'mpg_amt_420',
        'credited', false,
        'gatewayReady', false,
        'collectionOpen', false,
        'mpgAmt', 420,
        'reused', true,
        'message', reused_message,
        'payment', public.seller_subscription_payment_json(row)
      );
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'mpg_amt_420',
    'credited', false,
    'gatewayReady', false,
    'collectionOpen', false,
    'mpgAmt', 420,
    'reused', false,
    'message', created_message,
    'payment', public.seller_subscription_payment_json(row)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_seller_subscription_payment_notice(p_notice jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  pay public.seller_subscription_payments%ROWTYPE;
  updated public.seller_subscription_payments%ROWTYPE;
  order_no text := coalesce(p_notice->>'merchantOrderNo', '');
  sha text := upper(coalesce(p_notice->>'tradeSha', ''));
  amt_text text := btrim(coalesce(p_notice->>'amt', ''));
  v_trade_no text := btrim(coalesce(p_notice->>'tradeNo', ''));
  outer_status text := btrim(coalesce(p_notice->>'outerStatus', ''));
  result_status text := btrim(coalesce(p_notice->>'resultStatus', ''));
  pay_time text := btrim(coalesce(p_notice->>'payTime', ''));
  outcome text;
  inserted uuid;
BEGIN
  IF coalesce((p_notice->>'verified')::boolean, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION '付款通知尚未通過驗證';
  END IF;
  IF sha !~ '^[0-9A-F]{64}$' OR order_no !~ '^[A-Za-z0-9_]{1,30}$' THEN
    RAISE EXCEPTION '付款通知的訂單編號或驗證碼格式不對';
  END IF;

  SELECT * INTO pay
  FROM public.seller_subscription_payments
  WHERE merchant_order_no = order_no
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'unknown_order', 'credited', false, 'periodWritten', false);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.seller_subscription_payment_notices n
    WHERE n.payment_id = pay.id AND n.trade_sha = sha
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'duplicate',
      'credited', false,
      'status', pay.status,
      'paidAt', pay.paid_at,
      'periodWritten', false
    );
  END IF;

  IF pay.gateway_amt IS NULL THEN
    outcome := 'amount_undecided';
  ELSIF pay.merchant_id IS NOT NULL AND (
    p_notice->>'outerMerchantId' IS DISTINCT FROM pay.merchant_id
    OR p_notice->>'resultMerchantId' IS DISTINCT FROM pay.merchant_id
  ) THEN
    outcome := 'merchant_mismatch';
  ELSIF amt_text !~ '^[0-9]+$' OR amt_text::numeric IS DISTINCT FROM pay.gateway_amt::numeric THEN
    outcome := 'amount_mismatch';
  ELSIF outer_status = 'SUCCESS' AND result_status = 'SUCCESS' AND pay_time <> '' THEN
    IF v_trade_no !~ '^[A-Za-z0-9]{1,20}$' THEN
      outcome := 'ignored';
    ELSIF pay.status = 'paid' THEN
      outcome := 'duplicate';
    ELSE
      outcome := 'credited';
    END IF;
  ELSIF outer_status = 'SUCCESS' AND result_status = 'SUCCESS' THEN
    outcome := 'not_payment';
  ELSIF pay.status = 'paid' THEN
    outcome := 'ignored';
  ELSIF pay.status = 'pending' AND outer_status <> 'SUCCESS' AND result_status <> 'SUCCESS' THEN
    outcome := 'failed';
  ELSE
    outcome := 'ignored';
  END IF;

  INSERT INTO public.seller_subscription_payment_notices (
    payment_id, trade_sha, outcome, outer_status, amt_text, trade_no
  ) VALUES (
    pay.id, sha, outcome, left(outer_status, 20), NULLIF(left(amt_text, 20), ''), NULLIF(left(v_trade_no, 30), '')
  )
  RETURNING id INTO inserted;

  IF outcome = 'credited' THEN
    UPDATE public.seller_subscription_payments
    SET status = 'paid',
        trade_no = v_trade_no,
        paid_at = now(),
        failure_code = NULL,
        updated_at = now()
    WHERE id = pay.id AND status <> 'paid'
    RETURNING * INTO updated;
    IF NOT FOUND THEN
      outcome := 'duplicate';
      UPDATE public.seller_subscription_payment_notices
      SET outcome = 'duplicate'
      WHERE id = inserted;
    ELSE
      pay := updated;
    END IF;
  ELSIF outcome = 'failed' THEN
    UPDATE public.seller_subscription_payments
    SET status = 'failed',
        failure_code = left(outer_status, 20),
        updated_at = now()
    WHERE id = pay.id AND status = 'pending'
    RETURNING * INTO updated;
    IF FOUND THEN
      pay := updated;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', outcome,
    'credited', outcome = 'credited',
    'status', pay.status,
    'paidAt', pay.paid_at,
    'noticeId', inserted,
    'periodWritten', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seller_plan_quote() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seller_plan_quote() TO authenticated;
REVOKE ALL ON FUNCTION public.seller_subscription_payment_json(public.seller_subscription_payments) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_my_seller_subscription_payment() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_seller_subscription_payment() TO authenticated;
REVOKE ALL ON FUNCTION public.record_seller_subscription_payment_notice(jsonb) FROM PUBLIC, anon, authenticated;

DO $seller_subscription_charge_service$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.record_seller_subscription_payment_notice(jsonb) TO service_role;
  END IF;
END
$seller_subscription_charge_service$;

COMMIT;
