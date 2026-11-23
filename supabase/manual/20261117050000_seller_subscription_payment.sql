-- =============================================================================
-- 第八階段第 3 批：賣家月費的單次付款單與藍新付款通知核對。
-- 平台只向賣家收月費，不代收商品交易款。
-- 方案維持未稅 499.00、稅額 24.95、含稅 523.95。約 524 不是扣款金額，這裡不進位。
-- 藍新 MPG 的 Amt 是整數新台幣。實收整數尚未定案，所以付款單不寫 gateway_amt，
-- 也不送出測試環境或正式環境。
-- 通知入帳只改這一筆付款單。不寫 seller_subscriptions 的付費期限，
-- 因為試營業、延長與付費期限怎麼銜接還沒有規則。
-- 不設定啟用時間，不修改全站結帳開關，不啟用自動續扣，不開立發票。
-- =============================================================================

BEGIN;

DO $seller_subscription_payment_guard$
DECLARE
  quote jsonb;
BEGIN
  IF to_regclass('public.seller_subscriptions') IS NULL
     OR to_regprocedure('public.seller_plan_quote()') IS NULL
     OR to_regprocedure('public.is_approved_seller()') IS NULL
     OR to_regprocedure('public.seller_subscription_taipei(timestamptz)') IS NULL THEN
    RAISE EXCEPTION '請先套用賣家訂閱增量';
  END IF;
  quote := public.seller_plan_quote();
  IF (quote->>'net')::numeric IS DISTINCT FROM 499.00
     OR (quote->>'tax')::numeric IS DISTINCT FROM 24.95
     OR (quote->>'gross')::numeric IS DISTINCT FROM 523.95
     OR coalesce((quote->>'approxIsCharge')::boolean, true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '方案報價已改變，這份增量沒有改方案，停止';
  END IF;
END
$seller_subscription_payment_guard$;

CREATE TABLE IF NOT EXISTS public.seller_subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  merchant_order_no text NOT NULL,
  quote_net numeric(12, 2) NOT NULL,
  quote_tax numeric(12, 2) NOT NULL,
  quote_gross numeric(12, 2) NOT NULL,
  gateway_amt integer,
  merchant_id text,
  status text NOT NULL DEFAULT 'amount_pending',
  trade_no text,
  paid_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_subscription_payments_order_no_unique UNIQUE (merchant_order_no),
  CONSTRAINT seller_subscription_payments_order_no_check CHECK (merchant_order_no ~ '^[A-Za-z0-9_]{1,30}$'),
  CONSTRAINT seller_subscription_payments_quote_check CHECK (
    quote_net = 499.00 AND quote_tax = 24.95 AND quote_gross = 523.95
  ),
  CONSTRAINT seller_subscription_payments_status_check CHECK (
    status IN ('amount_pending', 'pending', 'paid', 'failed')
  ),
  CONSTRAINT seller_subscription_payments_gateway_check CHECK (
    gateway_amt IS NULL OR gateway_amt > 0
  ),
  CONSTRAINT seller_subscription_payments_merchant_check CHECK (
    merchant_id IS NULL OR merchant_id ~ '^[A-Za-z0-9]{1,15}$'
  ),
  CONSTRAINT seller_subscription_payments_paid_check CHECK (
    status <> 'paid'
    OR (trade_no IS NOT NULL AND paid_at IS NOT NULL AND gateway_amt IS NOT NULL)
  ),
  CONSTRAINT seller_subscription_payments_failure_check CHECK (
    failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 20
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS seller_subscription_payments_one_open
  ON public.seller_subscription_payments (seller_user_id)
  WHERE status = 'amount_pending';

CREATE INDEX IF NOT EXISTS seller_subscription_payments_seller_idx
  ON public.seller_subscription_payments (seller_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.seller_subscription_payment_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.seller_subscription_payments (id) ON DELETE RESTRICT,
  trade_sha text NOT NULL,
  outcome text NOT NULL,
  outer_status text NOT NULL,
  amt_text text,
  trade_no text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_subscription_payment_notices_once UNIQUE (payment_id, trade_sha),
  CONSTRAINT seller_subscription_payment_notices_sha_check CHECK (trade_sha ~ '^[0-9A-F]{64}$'),
  CONSTRAINT seller_subscription_payment_notices_outcome_check CHECK (
    outcome IN (
      'credited', 'duplicate', 'failed', 'amount_mismatch', 'amount_undecided',
      'merchant_mismatch', 'not_payment', 'ignored'
    )
  )
);

ALTER TABLE public.seller_subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_subscription_payment_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_subscription_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_subscription_payment_notices FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seller_subscription_payments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.seller_user_id IS DISTINCT FROM OLD.seller_user_id
     OR NEW.merchant_order_no IS DISTINCT FROM OLD.merchant_order_no
     OR NEW.quote_net IS DISTINCT FROM OLD.quote_net
     OR NEW.quote_tax IS DISTINCT FROM OLD.quote_tax
     OR NEW.quote_gross IS DISTINCT FROM OLD.quote_gross
     OR NEW.gateway_amt IS DISTINCT FROM OLD.gateway_amt
     OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION '付款單的賣家、方案金額、實收金額與訂單編號不能事後修改';
  END IF;
  IF OLD.status = 'paid' AND (
    NEW.status IS DISTINCT FROM 'paid'
    OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
    OR NEW.trade_no IS DISTINCT FROM OLD.trade_no
  ) THEN
    RAISE EXCEPTION '已入帳的付款單不能改成未入帳或改寫交易序號';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seller_subscription_payments_guard ON public.seller_subscription_payments;
CREATE TRIGGER seller_subscription_payments_guard
  BEFORE UPDATE ON public.seller_subscription_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.seller_subscription_payments_guard();

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
    'approxDisplay', 524,
    'approxIsCharge', false,
    'gatewayAmt', p.gateway_amt,
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
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '通過賣家認證後才能建立月費付款單';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('seller-subscription-payment'), hashtext(uid::text));
  quote := public.seller_plan_quote();
  IF (quote->>'gross')::numeric IS DISTINCT FROM 523.95 THEN
    RAISE EXCEPTION '方案含稅不是 523.95，沒有建立付款單';
  END IF;

  SELECT * INTO row
  FROM public.seller_subscription_payments
  WHERE seller_user_id = uid AND status = 'amount_pending'
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'code', 'charge_amount_not_integer',
      'credited', false,
      'gatewayReady', false,
      'reused', true,
      'message', '已有一張尚未送出的付款單。方案含稅是 523.95 元，藍新 Amt 只收整數新台幣，實收整數尚未定案，沒有進位，也不會寫成有效訂閱。',
      'payment', public.seller_subscription_payment_json(row)
    );
  END IF;

  order_no := 'sub' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
  BEGIN
    INSERT INTO public.seller_subscription_payments (
      seller_user_id, merchant_order_no, quote_net, quote_tax, quote_gross, status
    ) VALUES (
      uid,
      order_no,
      (quote->>'net')::numeric,
      (quote->>'tax')::numeric,
      (quote->>'gross')::numeric,
      'amount_pending'
    )
    RETURNING * INTO row;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO row
      FROM public.seller_subscription_payments
      WHERE seller_user_id = uid AND status = 'amount_pending';
      IF NOT FOUND THEN
        RAISE;
      END IF;
      RETURN jsonb_build_object(
        'ok', true,
        'code', 'charge_amount_not_integer',
        'credited', false,
        'gatewayReady', false,
        'reused', true,
        'message', '已有一張尚未送出的付款單。方案含稅是 523.95 元，藍新 Amt 只收整數新台幣，實收整數尚未定案，沒有進位，也不會寫成有效訂閱。',
        'payment', public.seller_subscription_payment_json(row)
      );
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'charge_amount_not_integer',
    'credited', false,
    'gatewayReady', false,
    'reused', false,
    'message', '已建立付款單，但沒有送出藍新。方案含稅是 523.95 元，藍新 Amt 只收整數新台幣，實收整數尚未定案，沒有進位，也不會寫成有效訂閱。',
    'payment', public.seller_subscription_payment_json(row)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_seller_subscription_payments()
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
  RETURN coalesce((
    SELECT jsonb_agg(public.seller_subscription_payment_json(p) ORDER BY p.created_at DESC)
    FROM public.seller_subscription_payments p
    WHERE p.seller_user_id = uid
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_seller_subscription_payment(p_order text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.seller_subscription_payments%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT * INTO row
  FROM public.seller_subscription_payments
  WHERE seller_user_id = uid AND merchant_order_no = coalesce(p_order, '');
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'not_found',
      'message', '找不到這張付款單。這一頁只顯示伺服器查到的結果。'
    );
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'message', '這是伺服器上的付款單，不是付款頁帶回的狀態。',
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

  IF pay.gateway_amt IS NULL OR pay.merchant_id IS NULL THEN
    outcome := 'amount_undecided';
  ELSIF p_notice->>'outerMerchantId' IS DISTINCT FROM pay.merchant_id
     OR p_notice->>'resultMerchantId' IS DISTINCT FROM pay.merchant_id THEN
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

REVOKE ALL ON FUNCTION public.seller_subscription_payments_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_subscription_payment_json(public.seller_subscription_payments) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_my_seller_subscription_payment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_seller_subscription_payments() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_seller_subscription_payment(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_seller_subscription_payment_notice(jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_my_seller_subscription_payment() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_seller_subscription_payments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_seller_subscription_payment(text) TO authenticated;

DO $seller_subscription_payment_service$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.record_seller_subscription_payment_notice(jsonb) TO service_role;
  END IF;
END
$seller_subscription_payment_service$;

COMMIT;
