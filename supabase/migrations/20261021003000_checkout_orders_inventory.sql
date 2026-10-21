-- =============================================================================
-- 第三階段第一批：持久購物車、多賣家訂單、庫存保留與權限（最終候選）
-- 請人工審查後在 Supabase SQL Editor 整段執行一次。本檔不執行。
--
-- 已確認 public.orders、public.order_items 是 0 筆的舊版空表，且只有主鍵。
-- 本檔只在再次確認為空、只有主鍵、沒有外鍵或檢視表依賴時，把它們改名封存。
-- 不刪除封存表，不 UPDATE / DELETE 既有 products、會員、賣家、聊天、賣場或跑馬燈資料。
-- 不修改 create_product_review、recognize_sale、create_support_ticket。
-- 不呼叫 recognize_sale，不寫 sales_recognitions，不把訂單標成已付款或已完成。
-- 不關閉 RLS，不把 service_role 交給前端。
--
-- 庫存意義（對齊商品編輯器，不猜測）：
-- 1. variants 超過一層且 combo_stock 是物件：每一組 combo key 是獨立庫存。
--    key 形式與前台相同：「規格名|選項::規格名|選項」。
-- 2. 其他商品若選項有 option_stock key（「規格名|選項」），該 key 是這個選項的上限。
-- 3. products.stock 一律是共享上限。非組合商品的不同規格會一起占用它。
--    組合商品同時占用自己的 combo key 與 products.stock，避免兩邊數字不一致時超賣。
-- 4. 本批不修改 products.stock / option_stock / combo_stock。
--    可售數量 = 欄位上的現貨 − 未到期的 held 保留。釋放只改保留狀態，所以重跑不會把庫存加兩次。
--
-- 尚未定案、本檔故意不啟用：
-- - 付款期限，以及保留到期要不要取消訂單。目錄中的 cancel_order_when_hold_expires 全部是 false。
-- - 貨到付款、銀行轉帳、超商取貨付款都不會因為 15 分鐘未收款而自動取消。
-- - 綠界、LINE Pay、物流、簡訊都未串接。orders.payment_integration 維持 not_connected。
-- - 賣家自行宣告的收款不會變成 payment_status = confirmed。
-- - 運費與優惠未定價，金額只含商品小計，不能解讀成免運或已折扣。
-- - place_checkout 固定拒絕建立訂單。checkout_enabled 不能改成 true。
-- - 訂單不能被寫成已付款、已出貨、已完成或已退款。check_and_auto_payout 若存在則停用。
--
-- 成功執行後不要重跑本檔。若已有訂單列，重跑會整段停止。後續修改請另開新的 migration。
-- 若雲端已經有訂單資料，本交易會直接停止。可先執行這段唯讀查詢：
--   SELECT to_regclass('public.orders') AS orders_table,
--          to_regclass('public.order_items') AS order_items_table;
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name IN ('orders', 'order_items')
--   ORDER BY table_name, ordinal_position;
-- =============================================================================

BEGIN;

DO $$
DECLARE
  legacy_orders boolean := false;
  legacy_items boolean := false;
  current_orders boolean := false;
  current_items boolean := false;
  obj record;
  fn record;
  ident text;
BEGIN
  IF to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION '缺少 public.products，本檔停止，沒有修改任何資料';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name IN (
        'id', 'seller_id', 'name', 'price', 'stock', 'variants',
        'option_stock', 'option_price', 'combo_stock', 'combo_price'
      )
  ) <> 10 THEN
    RAISE EXCEPTION 'products 缺少價格、規格或庫存欄位，本檔停止，沒有修改商品';
  END IF;
  IF to_regclass('public.seller_applications') IS NULL THEN
    RAISE EXCEPTION '缺少 public.seller_applications，本檔停止';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_platform_admin'
  ) THEN
    RAISE EXCEPTION '缺少 public.is_platform_admin()，本檔停止';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'product_is_public'
  ) THEN
    RAISE EXCEPTION '缺少 public.product_is_public()，本檔停止';
  END IF;
  IF to_regclass('public.notification_outbox') IS NULL THEN
    RAISE EXCEPTION '缺少 public.notification_outbox，請先執行既有聊天 migration。本檔停止。';
  END IF;

  legacy_orders := to_regclass('public.orders') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'display_no'
    );
  current_orders := to_regclass('public.orders') IS NOT NULL AND NOT legacy_orders;
  legacy_items := to_regclass('public.order_items') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'refunded_qty'
    );
  current_items := to_regclass('public.order_items') IS NOT NULL AND NOT legacy_items;

  IF (legacy_orders AND current_items) OR (current_orders AND legacy_items) THEN
    RAISE EXCEPTION 'orders 與 order_items 的結構不一致，本檔停止，沒有修改它們';
  END IF;

  IF current_orders THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders'
        AND column_name = 'id' AND udt_name <> 'uuid'
    ) THEN
      RAISE EXCEPTION 'public.orders.id 不是 uuid，本檔停止，沒有修改既有列';
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders'
        AND column_name = 'buyer_id' AND udt_name <> 'uuid'
    ) THEN
      RAISE EXCEPTION 'public.orders.buyer_id 不是 uuid，本檔停止，沒有修改既有列';
    END IF;
    IF EXISTS (SELECT 1 FROM public.orders) THEN
      RAISE EXCEPTION 'public.orders 已有資料列，本檔停止，沒有修改這些列';
    END IF;
  END IF;

  IF current_items THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_items'
        AND column_name = 'id' AND udt_name <> 'uuid'
    ) THEN
      RAISE EXCEPTION 'public.order_items.id 不是 uuid，本檔停止，沒有修改既有列';
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_items) THEN
      RAISE EXCEPTION 'public.order_items 已有資料列，本檔停止，沒有修改這些列';
    END IF;
  END IF;

  IF legacy_orders OR legacy_items THEN
    IF to_regclass('public.orders_legacy_empty_20261021') IS NOT NULL
       OR to_regclass('public.order_items_legacy_empty_20261021') IS NOT NULL THEN
      RAISE EXCEPTION '舊版封存表已存在，本檔停止，沒有覆蓋它們';
    END IF;
  END IF;

  IF legacy_items THEN
    LOCK TABLE public.order_items IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM public.order_items) THEN
      RAISE EXCEPTION 'public.order_items 已有資料列，本檔停止，沒有修改這些列';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.order_items'::regclass
        AND contype IN ('f', 'u', 'c', 'x')
    ) THEN
      RAISE EXCEPTION 'public.order_items 除了主鍵外還有其他約束，本檔停止，沒有修改它';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.order_items'::regclass AND contype = 'p'
    ) THEN
      RAISE EXCEPTION 'public.order_items 沒有主鍵，與已確認的舊版結構不符，本檔停止';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_constraint WHERE confrelid = 'public.order_items'::regclass
    ) THEN
      RAISE EXCEPTION '有其他資料表的外鍵指向 public.order_items，本檔停止，沒有修改它';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_depend d
      JOIN pg_rewrite rw ON rw.oid = d.objid
      JOIN pg_class v ON v.oid = rw.ev_class
      WHERE d.refobjid = 'public.order_items'::regclass
        AND v.relkind IN ('v', 'm')
        AND v.oid <> 'public.order_items'::regclass
    ) OR EXISTS (
      SELECT 1 FROM pg_rewrite
      WHERE ev_class = 'public.order_items'::regclass AND rulename <> '_RETURN'
    ) THEN
      RAISE EXCEPTION '有檢視表或改寫規則依賴 public.order_items，本檔停止，沒有修改它';
    END IF;

    ALTER TABLE public.order_items RENAME TO order_items_legacy_empty_20261021;
    FOR obj IN
      SELECT c.relname AS objname
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = 'public.order_items_legacy_empty_20261021'::regclass
    LOOP
      ident := left('l20261021_' || obj.objname, 63);
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', obj.objname, ident);
    END LOOP;
    FOR obj IN
      SELECT conname AS objname
      FROM pg_constraint
      WHERE conrelid = 'public.order_items_legacy_empty_20261021'::regclass
    LOOP
      ident := left('l20261021_' || obj.objname, 63);
      EXECUTE format(
        'ALTER TABLE public.order_items_legacy_empty_20261021 RENAME CONSTRAINT %I TO %I',
        obj.objname, ident
      );
    END LOOP;
    FOR obj IN
      SELECT tgname AS objname
      FROM pg_trigger
      WHERE tgrelid = 'public.order_items_legacy_empty_20261021'::regclass
        AND NOT tgisinternal
    LOOP
      ident := left('l20261021_' || obj.objname, 63);
      EXECUTE format(
        'ALTER TRIGGER %I ON public.order_items_legacy_empty_20261021 RENAME TO %I',
        obj.objname, ident
      );
    END LOOP;
    FOR obj IN
      SELECT polname AS objname
      FROM pg_policy
      WHERE polrelid = 'public.order_items_legacy_empty_20261021'::regclass
    LOOP
      EXECUTE format('DROP POLICY %I ON public.order_items_legacy_empty_20261021', obj.objname);
    END LOOP;
    ALTER TABLE public.order_items_legacy_empty_20261021 ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.order_items_legacy_empty_20261021 FROM PUBLIC, anon, authenticated;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      REVOKE ALL ON TABLE public.order_items_legacy_empty_20261021 FROM service_role;
    END IF;
    COMMENT ON TABLE public.order_items_legacy_empty_20261021 IS
      '2026-10-21 封存的舊版空訂單明細。封存時 0 筆，只有主鍵。新明細使用 public.order_items。';
  END IF;

  IF legacy_orders THEN
    LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM public.orders) THEN
      RAISE EXCEPTION 'public.orders 已有資料列，本檔停止，沒有修改這些列';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.orders'::regclass
        AND contype IN ('f', 'u', 'c', 'x')
    ) THEN
      RAISE EXCEPTION 'public.orders 除了主鍵外還有其他約束，本檔停止，沒有修改它';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.orders'::regclass AND contype = 'p'
    ) THEN
      RAISE EXCEPTION 'public.orders 沒有主鍵，與已確認的舊版結構不符，本檔停止';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_constraint WHERE confrelid = 'public.orders'::regclass
    ) THEN
      RAISE EXCEPTION '有其他資料表的外鍵指向 public.orders，本檔停止，沒有修改它';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_depend d
      JOIN pg_rewrite rw ON rw.oid = d.objid
      JOIN pg_class v ON v.oid = rw.ev_class
      WHERE d.refobjid = 'public.orders'::regclass
        AND v.relkind IN ('v', 'm')
        AND v.oid <> 'public.orders'::regclass
    ) OR EXISTS (
      SELECT 1 FROM pg_rewrite
      WHERE ev_class = 'public.orders'::regclass AND rulename <> '_RETURN'
    ) THEN
      RAISE EXCEPTION '有檢視表或改寫規則依賴 public.orders，本檔停止，沒有修改它';
    END IF;

    ALTER TABLE public.orders RENAME TO orders_legacy_empty_20261021;
    FOR obj IN
      SELECT c.relname AS objname
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = 'public.orders_legacy_empty_20261021'::regclass
    LOOP
      ident := left('l20261021_' || obj.objname, 63);
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', obj.objname, ident);
    END LOOP;
    FOR obj IN
      SELECT conname AS objname
      FROM pg_constraint
      WHERE conrelid = 'public.orders_legacy_empty_20261021'::regclass
    LOOP
      ident := left('l20261021_' || obj.objname, 63);
      EXECUTE format(
        'ALTER TABLE public.orders_legacy_empty_20261021 RENAME CONSTRAINT %I TO %I',
        obj.objname, ident
      );
    END LOOP;
    FOR obj IN
      SELECT tgname AS objname
      FROM pg_trigger
      WHERE tgrelid = 'public.orders_legacy_empty_20261021'::regclass
        AND NOT tgisinternal
    LOOP
      ident := left('l20261021_' || obj.objname, 63);
      EXECUTE format(
        'ALTER TRIGGER %I ON public.orders_legacy_empty_20261021 RENAME TO %I',
        obj.objname, ident
      );
    END LOOP;
    FOR obj IN
      SELECT polname AS objname
      FROM pg_policy
      WHERE polrelid = 'public.orders_legacy_empty_20261021'::regclass
    LOOP
      EXECUTE format('DROP POLICY %I ON public.orders_legacy_empty_20261021', obj.objname);
    END LOOP;
    ALTER TABLE public.orders_legacy_empty_20261021 ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.orders_legacy_empty_20261021 FROM PUBLIC, anon, authenticated;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      REVOKE ALL ON TABLE public.orders_legacy_empty_20261021 FROM service_role;
    END IF;
    COMMENT ON TABLE public.orders_legacy_empty_20261021 IS
      '2026-10-21 封存的舊版空訂單表。封存時 0 筆，只有主鍵。新訂單使用 public.orders。';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'check_and_auto_payout' AND p.prokind <> 'f'
  ) THEN
    RAISE EXCEPTION 'check_and_auto_payout 不是一般函式，本檔停止，沒有改寫它';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_trigger t ON t.tgfoid = p.oid AND NOT t.tgisinternal
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE n.nspname = 'public'
      AND p.proname = 'check_and_auto_payout'
      AND c.relname NOT IN (
        'orders', 'order_items',
        'orders_legacy_empty_20261021', 'order_items_legacy_empty_20261021'
      )
  ) THEN
    RAISE EXCEPTION 'check_and_auto_payout 被掛在訂單表以外，本檔停止，沒有改寫它';
  END IF;
  FOR fn IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'check_and_auto_payout'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.check_and_auto_payout(%s) RETURNS %s LANGUAGE plpgsql SET search_path = public, pg_catalog AS $fn$ BEGIN RAISE EXCEPTION %L; END $fn$',
      pg_get_function_identity_arguments(fn.oid),
      pg_get_function_result(fn.oid),
      '平台不代收、不代撥商品款。舊版模擬撥款已停用，沒有變更任何訂單或款項。'
    );
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.check_and_auto_payout(%s) FROM PUBLIC, anon, authenticated',
      pg_get_function_identity_arguments(fn.oid)
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 可調整限制。門檻寫在資料表，不寫死在交易流程裡。
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.commerce_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  inventory_hold_minutes integer NOT NULL DEFAULT 15,
  checkout_enabled boolean NOT NULL DEFAULT false,
  max_open_holds_per_buyer integer NOT NULL DEFAULT 24,
  max_reserved_units_per_buyer integer NOT NULL DEFAULT 60,
  max_qty_per_line integer NOT NULL DEFAULT 99,
  max_lines_per_checkout integer NOT NULL DEFAULT 40,
  max_checkouts_per_hour integer NOT NULL DEFAULT 15,
  max_buyer_cancels_per_hour integer NOT NULL DEFAULT 30,
  max_seller_cancels_per_hour integer NOT NULL DEFAULT 120,
  max_same_product_orders_per_hour integer NOT NULL DEFAULT 4,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_settings_hold_range CHECK (inventory_hold_minutes BETWEEN 5 AND 180),
  CONSTRAINT commerce_settings_open_holds CHECK (max_open_holds_per_buyer BETWEEN 1 AND 200),
  CONSTRAINT commerce_settings_reserved_units CHECK (max_reserved_units_per_buyer BETWEEN 1 AND 1000),
  CONSTRAINT commerce_settings_line_qty CHECK (max_qty_per_line BETWEEN 1 AND 999),
  CONSTRAINT commerce_settings_lines CHECK (max_lines_per_checkout BETWEEN 1 AND 100),
  CONSTRAINT commerce_settings_checkouts CHECK (max_checkouts_per_hour BETWEEN 1 AND 500),
  CONSTRAINT commerce_settings_buyer_cancels CHECK (max_buyer_cancels_per_hour BETWEEN 1 AND 500),
  CONSTRAINT commerce_settings_seller_cancels CHECK (max_seller_cancels_per_hour BETWEEN 1 AND 2000),
  CONSTRAINT commerce_settings_same_product CHECK (max_same_product_orders_per_hour BETWEEN 1 AND 100)
);

CREATE TABLE IF NOT EXISTS public.payment_method_catalog (
  code text PRIMARY KEY,
  label_zh text NOT NULL,
  sort_order integer NOT NULL,
  cancel_order_when_hold_expires boolean NOT NULL DEFAULT false,
  CONSTRAINT payment_method_catalog_code CHECK (code ~ '^[a-z0-9_]{2,32}$')
);

CREATE TABLE IF NOT EXISTS public.fulfillment_method_catalog (
  code text PRIMARY KEY,
  label_zh text NOT NULL,
  sort_order integer NOT NULL,
  CONSTRAINT fulfillment_method_catalog_code CHECK (code ~ '^[a-z0-9_]{2,32}$')
);

CREATE TABLE IF NOT EXISTS public.seller_payment_methods (
  seller_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  method_code text NOT NULL REFERENCES public.payment_method_catalog (code),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_user_id, method_code)
);

CREATE TABLE IF NOT EXISTS public.seller_fulfillment_methods (
  seller_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  method_code text NOT NULL REFERENCES public.fulfillment_method_catalog (code),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_user_id, method_code)
);

INSERT INTO public.payment_method_catalog (code, label_zh, sort_order, cancel_order_when_hold_expires)
VALUES
  ('ecpay', '綠界', 10, false),
  ('line_pay', 'LINE Pay', 20, false),
  ('bank_transfer', '銀行轉帳', 30, false),
  ('cvs_cod', '超商取貨付款', 40, false),
  ('home_cod', '宅配貨到付款', 50, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.fulfillment_method_catalog (code, label_zh, sort_order)
VALUES
  ('home_delivery', '宅配', 10),
  ('cvs_pickup', '超商取貨', 20)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 購物車、結帳批次、訂單、保留、事件、通知、可信退款殼
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.order_display_no_seq AS bigint START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS public.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  variant jsonb NOT NULL DEFAULT '{}'::jsonb,
  variant_fingerprint text NOT NULL,
  qty integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_variant_object CHECK (jsonb_typeof(variant) = 'object'),
  CONSTRAINT cart_items_qty_positive CHECK (qty > 0 AND qty <= 999),
  CONSTRAINT cart_items_owner_product_variant UNIQUE (user_id, product_id, variant_fingerprint)
);

CREATE TABLE IF NOT EXISTS public.checkout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkout_batches_buyer_key UNIQUE (buyer_id, idempotency_key),
  CONSTRAINT checkout_batches_hash_len CHECK (char_length(request_hash) BETWEEN 32 AND 64)
);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_no text NOT NULL,
  batch_id uuid NOT NULL REFERENCES public.checkout_batches (id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  seller_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lifecycle_status text NOT NULL DEFAULT 'open',
  payment_method text NOT NULL,
  payment_status text NOT NULL DEFAULT 'unpaid',
  payment_integration text NOT NULL DEFAULT 'not_connected',
  payment_due_at timestamptz,
  payment_confirmed_at timestamptz,
  payment_confirmation_source text,
  fulfillment_method text NOT NULL,
  fulfillment_status text NOT NULL DEFAULT 'not_ready',
  shipped_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  cancel_status text NOT NULL DEFAULT 'none',
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_actor_role text,
  cancel_reason_code text,
  refund_status text NOT NULL DEFAULT 'none',
  stock_hold_status text NOT NULL DEFAULT 'held',
  stock_hold_expires_at timestamptz NOT NULL,
  stock_released_at timestamptz,
  items_subtotal integer NOT NULL,
  shipping_fee integer NOT NULL DEFAULT 0,
  shipping_fee_status text NOT NULL DEFAULT 'unpriced',
  discount_amount integer NOT NULL DEFAULT 0,
  discount_status text NOT NULL DEFAULT 'not_applied',
  order_total integer NOT NULL,
  currency text NOT NULL DEFAULT 'TWD',
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL,
  recipient_address text NOT NULL,
  exception_code text,
  CONSTRAINT orders_display_no_unique UNIQUE (display_no),
  CONSTRAINT orders_display_no_shape CHECK (display_no ~ '^HJ[0-9]{8}-[0-9]{6,}$'),
  CONSTRAINT orders_not_self CHECK (buyer_id <> seller_id),
  CONSTRAINT orders_lifecycle CHECK (lifecycle_status IN ('open', 'cancelled')),
  CONSTRAINT orders_payment_method CHECK (
    payment_method IN ('ecpay', 'line_pay', 'bank_transfer', 'cvs_cod', 'home_cod')
  ),
  CONSTRAINT orders_payment_status CHECK (
    payment_status IN ('unpaid', 'awaiting_confirmation', 'confirmed', 'failed', 'refund_pending', 'refunded')
  ),
  CONSTRAINT orders_payment_integration CHECK (
    payment_integration IN ('not_connected', 'gateway_pending', 'gateway_verified')
  ),
  CONSTRAINT orders_confirmed_is_gateway CHECK (
    payment_status IS DISTINCT FROM 'confirmed'
    OR (
      payment_confirmation_source = 'gateway_verified'
      AND payment_confirmed_at IS NOT NULL
      AND payment_integration = 'gateway_verified'
    )
  ),
  CONSTRAINT orders_confirmation_source CHECK (
    payment_confirmation_source IS NULL
    OR payment_confirmation_source IN ('gateway_verified', 'seller_declared', 'admin')
  ),
  CONSTRAINT orders_fulfillment_method CHECK (fulfillment_method IN ('home_delivery', 'cvs_pickup')),
  CONSTRAINT orders_fulfillment_status CHECK (
    fulfillment_status IN ('not_ready', 'ready_to_ship', 'shipped', 'delivered', 'completed')
  ),
  CONSTRAINT orders_completed_pair CHECK (
    (fulfillment_status = 'completed' AND completed_at IS NOT NULL)
    OR (fulfillment_status <> 'completed' AND completed_at IS NULL)
  ),
  CONSTRAINT orders_cancel_pair CHECK (
    (
      lifecycle_status = 'cancelled'
      AND cancel_status = 'cancelled'
      AND cancelled_at IS NOT NULL
      AND cancel_actor_role IN ('buyer', 'seller', 'admin', 'system')
    )
    OR (
      lifecycle_status <> 'cancelled'
      AND cancel_status = 'none'
      AND cancelled_at IS NULL
      AND cancelled_by IS NULL
      AND cancel_actor_role IS NULL
    )
  ),
  CONSTRAINT orders_cancel_status CHECK (cancel_status IN ('none', 'cancelled')),
  CONSTRAINT orders_refund_status CHECK (refund_status IN ('none', 'pending', 'refunded', 'rejected')),
  CONSTRAINT orders_stock_hold CHECK (stock_hold_status IN ('held', 'released', 'consumed')),
  CONSTRAINT orders_stock_release_pair CHECK (
    (stock_hold_status = 'held' AND stock_released_at IS NULL)
    OR (stock_hold_status = 'released' AND stock_released_at IS NOT NULL)
    OR (stock_hold_status = 'consumed' AND stock_released_at IS NULL)
  ),
  CONSTRAINT orders_money_nonneg CHECK (
    items_subtotal >= 0 AND shipping_fee >= 0 AND discount_amount >= 0 AND order_total >= 0
  ),
  CONSTRAINT orders_total_math CHECK (order_total = items_subtotal + shipping_fee - discount_amount),
  CONSTRAINT orders_shipping_unpriced CHECK (
    (shipping_fee_status = 'unpriced' AND shipping_fee = 0)
    OR shipping_fee_status = 'confirmed'
  ),
  CONSTRAINT orders_shipping_status CHECK (shipping_fee_status IN ('unpriced', 'confirmed')),
  CONSTRAINT orders_discount_unapplied CHECK (
    (discount_status = 'not_applied' AND discount_amount = 0)
    OR discount_status = 'applied'
  ),
  CONSTRAINT orders_discount_status CHECK (discount_status IN ('not_applied', 'applied')),
  CONSTRAINT orders_currency CHECK (currency = 'TWD'),
  CONSTRAINT orders_recipient_len CHECK (
    char_length(btrim(recipient_name)) BETWEEN 1 AND 30
    AND char_length(recipient_phone) = 10
    AND char_length(btrim(recipient_address)) BETWEEN 8 AND 120
  )
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  seller_id uuid NOT NULL,
  product_name text NOT NULL,
  variant jsonb NOT NULL,
  variant_label text NOT NULL,
  variant_fingerprint text NOT NULL,
  stock_mode text NOT NULL,
  unit_price integer NOT NULL,
  quantity integer NOT NULL,
  line_total integer NOT NULL,
  refunded_qty integer NOT NULL DEFAULT 0,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_variant_object CHECK (jsonb_typeof(variant) = 'object'),
  CONSTRAINT order_items_stock_mode CHECK (stock_mode IN ('combo', 'option', 'product')),
  CONSTRAINT order_items_money CHECK (unit_price > 0 AND quantity > 0 AND line_total = unit_price * quantity),
  CONSTRAINT order_items_refunded_qty CHECK (refunded_qty >= 0 AND refunded_qty <= quantity),
  CONSTRAINT order_items_name_len CHECK (char_length(product_name) BETWEEN 1 AND 200)
);

CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES public.order_items (id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
  bucket_kind text NOT NULL,
  bucket_key text NOT NULL DEFAULT '',
  quantity integer NOT NULL,
  status text NOT NULL DEFAULT 'held',
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_reservations_bucket CHECK (bucket_kind IN ('product', 'option', 'combo')),
  CONSTRAINT inventory_reservations_qty CHECK (quantity > 0),
  CONSTRAINT inventory_reservations_status CHECK (status IN ('held', 'released', 'consumed')),
  CONSTRAINT inventory_reservations_release_pair CHECK (
    (status = 'held' AND released_at IS NULL)
    OR (status = 'released' AND released_at IS NOT NULL)
    OR (status = 'consumed' AND released_at IS NULL)
  ),
  CONSTRAINT inventory_reservations_item_bucket UNIQUE (order_item_id, bucket_kind, bucket_key)
);

CREATE TABLE IF NOT EXISTS public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_id uuid,
  actor_role text NOT NULL,
  from_lifecycle text,
  to_lifecycle text,
  from_payment text,
  to_payment text,
  from_fulfillment text,
  to_fulfillment text,
  from_stock_hold text,
  to_stock_hold text,
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text NOT NULL,
  CONSTRAINT order_events_role CHECK (actor_role IN ('buyer', 'seller', 'admin', 'system')),
  CONSTRAINT order_events_dedupe UNIQUE (dedupe_key)
);

CREATE TABLE IF NOT EXISTS public.order_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  event_key text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_notifications_event_key UNIQUE (event_key),
  CONSTRAINT order_notifications_text CHECK (
    char_length(title) BETWEEN 1 AND 40
    AND char_length(body) BETWEEN 1 AND 240
  )
);

CREATE TABLE IF NOT EXISTS public.order_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  order_item_id uuid REFERENCES public.order_items (id) ON DELETE RESTRICT,
  amount integer NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  source text NOT NULL,
  trusted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_refunds_amount CHECK (amount >= 0 AND quantity >= 0),
  CONSTRAINT order_refunds_status CHECK (status IN ('pending', 'refunded', 'rejected')),
  CONSTRAINT order_refunds_source CHECK (source IN ('gateway_verified', 'admin_verified')),
  CONSTRAINT order_refunds_trust CHECK (
    trusted = false OR source IN ('gateway_verified', 'admin_verified')
  )
);

CREATE INDEX IF NOT EXISTS cart_items_user_idx ON public.cart_items (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS checkout_batches_buyer_idx ON public.checkout_batches (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_buyer_idx ON public.orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_seller_idx ON public.orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_seller_status_idx ON public.orders (seller_id, payment_status, fulfillment_status);
CREATE INDEX IF NOT EXISTS orders_hold_expiry_idx ON public.orders (stock_hold_expires_at) WHERE stock_hold_status = 'held';
CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON public.order_items (product_id);
CREATE INDEX IF NOT EXISTS inventory_reservations_active_idx
  ON public.inventory_reservations (product_id, bucket_kind, bucket_key)
  WHERE status = 'held';
CREATE INDEX IF NOT EXISTS order_events_order_idx ON public.order_events (order_id, created_at);
CREATE INDEX IF NOT EXISTS order_notifications_user_idx ON public.order_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_refunds_order_idx ON public.order_refunds (order_id);

-- ---------------------------------------------------------------------------
-- 小工具
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.commerce_parse_int(p_text text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  t text := btrim(coalesce(p_text, ''));
BEGIN
  IF t !~ '^[0-9]+$' OR char_length(t) > 9 THEN
    RETURN NULL;
  END IF;
  RETURN t::integer;
END;
$$;

-- JSONB 文字輸出的鍵序固定。不以未跳脫的 &/= 拼接，避免不同規格共用同一個 fingerprint。
CREATE OR REPLACE FUNCTION public.commerce_variant_fingerprint(p_variant jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT md5((CASE WHEN jsonb_typeof(p_variant) = 'object' THEN p_variant ELSE '{}'::jsonb END)::text);
$$;

CREATE OR REPLACE FUNCTION public.order_buyer_stage(
  p_lifecycle text,
  p_payment text,
  p_fulfillment text,
  p_refund text,
  p_completed_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_refund = 'refunded' THEN
    RETURN 'refunded';
  END IF;
  IF p_refund = 'pending' THEN
    RETURN 'refunding';
  END IF;
  IF p_lifecycle = 'cancelled' THEN
    RETURN 'cancelled';
  END IF;
  IF p_completed_at IS NOT NULL AND p_fulfillment = 'completed' THEN
    RETURN 'done';
  END IF;
  IF p_fulfillment IN ('shipped', 'delivered') THEN
    RETURN 'to_receive';
  END IF;
  IF p_fulfillment = 'ready_to_ship' THEN
    RETURN 'to_ship';
  END IF;
  IF p_payment = 'confirmed' AND p_fulfillment = 'not_ready' THEN
    RETURN 'to_ship';
  END IF;
  IF p_payment = 'awaiting_confirmation' THEN
    RETURN 'confirming';
  END IF;
  RETURN 'unpaid';
END;
$$;

CREATE OR REPLACE FUNCTION public.order_stage_label(p_stage text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE p_stage
    WHEN 'unpaid' THEN '待付款'
    WHEN 'confirming' THEN '待確認付款'
    WHEN 'to_ship' THEN '待出貨'
    WHEN 'to_receive' THEN '待收貨'
    WHEN 'done' THEN '已完成'
    WHEN 'cancelled' THEN '已取消'
    WHEN 'refunding' THEN '退款中'
    WHEN 'refunded' THEN '已退款'
    ELSE '處理中'
  END
$$;

CREATE OR REPLACE FUNCTION public.order_buyer_bucket(p_stage text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE p_stage
    WHEN 'unpaid' THEN 'unpaid'
    WHEN 'confirming' THEN 'unpaid'
    WHEN 'to_ship' THEN 'toShip'
    WHEN 'to_receive' THEN 'shipping'
    WHEN 'done' THEN 'done'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'refunding' THEN 'refund'
    WHEN 'refunded' THEN 'refund'
    ELSE 'unpaid'
  END
$$;

CREATE OR REPLACE FUNCTION public.seller_store_name(p_seller uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(nullif(btrim(sa.store_name), ''), '賣場')
  FROM public.seller_applications sa
  WHERE sa.user_id = p_seller
  ORDER BY (sa.status = 'approved') DESC, sa.created_at DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.seller_accepts_orders(p_seller uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  approved boolean := false;
  has_flag boolean := false;
  blocked boolean := false;
BEGIN
  IF p_seller IS NULL THEN
    RETURN false;
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM public.seller_applications sa
    WHERE sa.user_id = p_seller
      AND sa.status = 'approved'
  ) INTO approved;
  IF NOT coalesce(approved, false) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seller_applications' AND column_name = 'suspended'
  ) INTO has_flag;
  IF has_flag THEN
    EXECUTE $q$
      SELECT coalesce(bool_or(lower(suspended::text) IN ('true', 't', '1')), false)
      FROM public.seller_applications
      WHERE user_id = $1 AND status = 'approved'
    $q$ INTO blocked USING p_seller;
    IF blocked THEN
      RETURN false;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seller_applications' AND column_name = 'banned'
  ) INTO has_flag;
  IF has_flag THEN
    EXECUTE $q$
      SELECT coalesce(bool_or(lower(banned::text) IN ('true', 't', '1')), false)
      FROM public.seller_applications
      WHERE user_id = $1 AND status = 'approved'
    $q$ INTO blocked USING p_seller;
    IF blocked THEN
      RETURN false;
    END IF;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_active_held(
  p_product_id uuid,
  p_kind text,
  p_key text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(sum(r.quantity), 0)::integer
  FROM public.inventory_reservations r
  WHERE r.product_id = p_product_id
    AND r.bucket_kind = p_kind
    AND r.bucket_key = p_key
    AND r.status = 'held'
    AND r.expires_at > now()
$$;

CREATE OR REPLACE FUNCTION public.commerce_allow_write()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM set_config('hengjing.commerce_write', 'on', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_settings_row()
RETURNS public.commerce_settings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT * FROM public.commerce_settings WHERE id = true
$$;

CREATE OR REPLACE FUNCTION public.commerce_buyer_lock(p_buyer uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('buyer-commerce:' || p_buyer::text));
END;
$$;

-- ---------------------------------------------------------------------------
-- 直接寫入攔截。真正的屏障仍是沒有把 INSERT / UPDATE 授給前端。
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.commerce_guard_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF coalesce(current_setting('hengjing.commerce_write', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '訂單資料只能透過交易程序變更';
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_block_untrusted_settlement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND coalesce(current_setting('hengjing.commerce_checkout', true), '') IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '正式結帳尚未開放，不能建立商品訂單';
  END IF;
  IF NEW.payment_status IS DISTINCT FROM 'unpaid'
     OR NEW.payment_integration IS DISTINCT FROM 'not_connected'
     OR NEW.payment_confirmed_at IS NOT NULL
     OR NEW.payment_confirmation_source IS NOT NULL
     OR NEW.fulfillment_status IS DISTINCT FROM 'not_ready'
     OR NEW.completed_at IS NOT NULL
     OR NEW.refund_status IS DISTINCT FROM 'none'
     OR NEW.lifecycle_status NOT IN ('open', 'cancelled') THEN
    RAISE EXCEPTION '金流尚未串接，不能把訂單標成已付款、已出貨、已完成或已退款';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_guard_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.checkout_enabled IS TRUE THEN
    RAISE EXCEPTION '金流與運費尚未串接，不能開放正式結帳';
  END IF;
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.is_platform_admin() IS TRUE THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '不能修改交易限制';
END;
$$;

CREATE OR REPLACE FUNCTION public.cart_items_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  max_qty integer := 99;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT s.max_qty_per_line INTO max_qty FROM public.commerce_settings s WHERE s.id = true;
  max_qty := coalesce(max_qty, 99);
  IF TG_OP = 'INSERT' THEN
    NEW.user_id := auth.uid();
    NEW.variant := CASE WHEN jsonb_typeof(NEW.variant) = 'object' THEN NEW.variant ELSE '{}'::jsonb END;
    NEW.variant_fingerprint := public.commerce_variant_fingerprint(NEW.variant);
    NEW.created_at := coalesce(NEW.created_at, now());
    NEW.updated_at := now();
    IF NEW.qty IS NULL OR NEW.qty < 1 OR NEW.qty > max_qty THEN
      RAISE EXCEPTION '購物車數量不正確';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION '不能修改這個購物車';
  END IF;
  NEW.user_id := OLD.user_id;
  NEW.product_id := OLD.product_id;
  NEW.variant := OLD.variant;
  NEW.variant_fingerprint := OLD.variant_fingerprint;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  IF NEW.qty IS NULL OR NEW.qty < 1 OR NEW.qty > max_qty THEN
    RAISE EXCEPTION '購物車數量不正確';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.order_items_match_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  owner uuid;
BEGIN
  IF coalesce(NEW.refunded_qty, 0) <> 0 THEN
    RAISE EXCEPTION '退貨數量尚未開放，不能改寫訂單明細';
  END IF;
  SELECT o.seller_id INTO owner FROM public.orders o WHERE o.id = NEW.order_id;
  IF owner IS NULL OR owner IS DISTINCT FROM NEW.seller_id THEN
    RAISE EXCEPTION '訂單明細與賣場不一致';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = NEW.product_id AND p.seller_id = NEW.seller_id
  ) THEN
    RAISE EXCEPTION '商品不屬於這個賣場';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commerce_settings_guard ON public.commerce_settings;
CREATE TRIGGER commerce_settings_guard
  BEFORE INSERT OR UPDATE ON public.commerce_settings
  FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_settings();

INSERT INTO public.commerce_settings (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS cart_items_guard_trigger ON public.cart_items;
CREATE TRIGGER cart_items_guard_trigger
  BEFORE INSERT OR UPDATE ON public.cart_items
  FOR EACH ROW EXECUTE FUNCTION public.cart_items_guard();

DROP TRIGGER IF EXISTS orders_guard_write ON public.orders;
CREATE TRIGGER orders_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_write();

DROP TRIGGER IF EXISTS orders_block_untrusted_settlement ON public.orders;
CREATE TRIGGER orders_block_untrusted_settlement
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.commerce_block_untrusted_settlement();

DROP TRIGGER IF EXISTS order_items_guard_write ON public.order_items;
CREATE TRIGGER order_items_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_write();

DROP TRIGGER IF EXISTS order_items_match_order_trigger ON public.order_items;
CREATE TRIGGER order_items_match_order_trigger
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.order_items_match_order();

DROP TRIGGER IF EXISTS inventory_reservations_guard_write ON public.inventory_reservations;
CREATE TRIGGER inventory_reservations_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_write();

DROP TRIGGER IF EXISTS checkout_batches_guard_write ON public.checkout_batches;
CREATE TRIGGER checkout_batches_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.checkout_batches
  FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_write();

DROP TRIGGER IF EXISTS order_events_guard_write ON public.order_events;
CREATE TRIGGER order_events_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_events
  FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_write();

DROP TRIGGER IF EXISTS order_notifications_guard_write ON public.order_notifications;
CREATE TRIGGER order_notifications_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_notifications
  FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_write();

DROP TRIGGER IF EXISTS order_refunds_guard_write ON public.order_refunds;
CREATE TRIGGER order_refunds_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.order_refunds
  FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_write();

DROP TRIGGER IF EXISTS seller_payment_methods_guard ON public.seller_payment_methods;
CREATE TRIGGER seller_payment_methods_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.seller_payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_write();

DROP TRIGGER IF EXISTS seller_fulfillment_methods_guard ON public.seller_fulfillment_methods;
CREATE TRIGGER seller_fulfillment_methods_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.seller_fulfillment_methods
  FOR EACH ROW EXECUTE FUNCTION public.commerce_guard_write();

-- ---------------------------------------------------------------------------
-- 報價：價格與庫存都從商品列現讀，不接受前端傳入的成交價。
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.commerce_build_plan(
  p_buyer uuid,
  p_lines jsonb,
  p_lock boolean,
  p_expected jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  settings public.commerce_settings%ROWTYPE;
  elem jsonb;
  raw jsonb := '[]'::jsonb;
  merged jsonb := '{}'::jsonb;
  line jsonb;
  issues jsonb := '[]'::jsonb;
  lines jsonb := '[]'::jsonb;
  product_ids uuid[] := ARRAY[]::uuid[];
  pid_text text;
  pid uuid;
  qty numeric;
  qty_int integer;
  variant jsonb;
  fingerprint text;
  merge_key text;
  seller uuid;
  product_name text;
  product_image text;
  price_text text;
  stock_text text;
  variants jsonb;
  option_stock jsonb;
  option_price jsonb;
  combo_stock jsonb;
  combo_price jsonb;
  is_public boolean;
  group_row record;
  group_name text;
  selected text;
  seen text[] := ARRAY[]::text[];
  labels text[] := ARRAY[]::text[];
  combo_parts text[] := ARRAY[]::text[];
  option_keys text[] := ARRAY[]::text[];
  invalid_variant boolean;
  is_combo boolean;
  combo_key text;
  opt_key text;
  price_hits integer;
  price_raw text;
  unit_price integer;
  buckets jsonb;
  bucket jsonb;
  on_hand integer;
  held integer;
  available integer;
  line_available integer;
  demand jsonb := '{}'::jsonb;
  demand_key text;
  demand_row jsonb;
  shortfall boolean;
  reveal boolean;
  in_cart boolean;
  seller_ok boolean;
  issue jsonb;
  line_issues jsonb;
  purchasable boolean;
  stock_mode text;
  expected_key text;
  expected_price integer;
  seller_ids uuid[] := ARRAY[]::uuid[];
  seller_id uuid;
  grouped jsonb := '[]'::jsonb;
  seller_lines jsonb;
  methods jsonb;
  ships jsonb;
  subtotal bigint;
  subtotal_known boolean;
  store_name text;
  line_amount integer;
BEGIN
  SELECT * INTO settings FROM public.commerce_settings WHERE id = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION '交易設定不存在';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'issues', jsonb_build_array(jsonb_build_object('code', 'empty', 'message', '請選擇要結帳的商品')),
      'lines', '[]'::jsonb,
      'sellers', '[]'::jsonb
    );
  END IF;

  FOR elem IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    pid_text := elem->>'productId';
    IF pid_text IS NULL OR pid_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'product_not_found',
        'message', '其中一件商品無法識別'
      ));
      CONTINUE;
    END IF;
    IF jsonb_typeof(elem->'qty') IS DISTINCT FROM 'number' THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'qty_invalid',
        'productId', pid_text,
        'message', '商品數量不正確'
      ));
      CONTINUE;
    END IF;
    qty := (elem->>'qty')::numeric;
    IF qty <> trunc(qty) OR qty < 1 OR qty > settings.max_qty_per_line THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'qty_invalid',
        'productId', pid_text,
        'message', '商品數量需為 1 到 ' || settings.max_qty_per_line::text || ' 的整數'
      ));
      CONTINUE;
    END IF;
    IF elem->'variant' IS NULL OR jsonb_typeof(elem->'variant') = 'null' THEN
      variant := '{}'::jsonb;
    ELSIF jsonb_typeof(elem->'variant') IS DISTINCT FROM 'object' THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'variant_invalid',
        'productId', pid_text,
        'message', '商品規格不正確'
      ));
      CONTINUE;
    ELSE
      variant := elem->'variant';
    END IF;
    fingerprint := public.commerce_variant_fingerprint(variant);
    merge_key := pid_text || '|' || fingerprint;
    IF merged ? merge_key THEN
      qty_int := (merged->merge_key->>'qty')::integer + qty::integer;
      IF qty_int > settings.max_qty_per_line THEN
        issues := issues || jsonb_build_array(jsonb_build_object(
          'code', 'qty_invalid',
          'productId', pid_text,
          'variantFingerprint', fingerprint,
          'message', '同一規格最多只能購買 ' || settings.max_qty_per_line::text || ' 件'
        ));
        CONTINUE;
      END IF;
      merged := jsonb_set(merged, ARRAY[merge_key, 'qty'], to_jsonb(qty_int), false);
    ELSE
      merged := merged || jsonb_build_object(
        merge_key, jsonb_build_object(
          'productId', pid_text,
          'cartItemId', elem->>'cartItemId',
          'variant', variant,
          'fingerprint', fingerprint,
          'qty', qty::integer
        )
      );
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(value ORDER BY value->>'productId', value->>'fingerprint'), '[]'::jsonb)
    INTO raw
  FROM jsonb_each(merged);

  IF jsonb_array_length(raw) > settings.max_lines_per_checkout THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'too_many_lines',
      'message', '一次最多結帳 ' || settings.max_lines_per_checkout::text || ' 項商品'
    ));
  END IF;
  IF jsonb_array_length(raw) = 0 OR jsonb_array_length(raw) > settings.max_lines_per_checkout THEN
    RETURN jsonb_build_object(
      'ok', jsonb_array_length(raw) = 0 AND jsonb_array_length(issues) = 0,
      'issues', issues,
      'lines', '[]'::jsonb,
      'sellers', '[]'::jsonb,
      'shippingFeeStatus', 'unpriced',
      'paymentIntegration', 'not_connected'
    );
  END IF;

  product_ids := ARRAY(
    SELECT DISTINCT (value->>'productId')::uuid FROM jsonb_array_elements(raw)
  );
  IF p_lock AND coalesce(array_length(product_ids, 1), 0) > 0 THEN
    PERFORM 1
    FROM public.products
    WHERE id = ANY (product_ids)
    ORDER BY id
    FOR UPDATE;
  END IF;

  FOR line IN SELECT value FROM jsonb_array_elements(raw) LOOP
    pid := (line->>'productId')::uuid;
    fingerprint := line->>'fingerprint';
    qty_int := (line->>'qty')::integer;
    variant := line->'variant';
    line_issues := '[]'::jsonb;
    purchasable := true;
    unit_price := NULL;
    line_available := NULL;
    seller := NULL;
    product_name := NULL;
    product_image := NULL;
    stock_mode := NULL;
    buckets := '[]'::jsonb;
    reveal := false;
    is_public := false;
    seller_ok := false;

    SELECT
      p.seller_id,
      p.name,
      p.image::text,
      p.price::text,
      p.stock::text,
      p.variants::jsonb,
      p.option_stock::jsonb,
      p.option_price::jsonb,
      p.combo_stock::jsonb,
      p.combo_price::jsonb,
      public.product_is_public(to_jsonb(p))
    INTO
      seller, product_name, product_image, price_text, stock_text,
      variants, option_stock, option_price, combo_stock, combo_price, is_public
    FROM public.products p
    WHERE p.id = pid;

    SELECT EXISTS (
      SELECT 1 FROM public.cart_items c
      WHERE c.user_id = p_buyer AND c.product_id = pid AND c.variant_fingerprint = fingerprint
    ) INTO in_cart;
    reveal := FOUND AND (is_public OR in_cart);

    IF seller IS NULL THEN
      line_issues := line_issues || jsonb_build_array(jsonb_build_object(
        'code', 'product_not_found',
        'productId', pid,
        'message', '找不到這個商品，可能已經刪除'
      ));
      purchasable := false;
    ELSE
      seller_ok := public.seller_accepts_orders(seller);
      reveal := is_public OR in_cart OR seller = p_buyer;
      IF NOT is_public THEN
        line_issues := line_issues || jsonb_build_array(jsonb_build_object(
          'code', 'not_purchasable',
          'productId', pid,
          'variantFingerprint', fingerprint,
          'message', CASE WHEN reveal AND product_name IS NOT NULL
            THEN '「' || product_name || '」目前已下架或尚未通過審核，不能結帳'
            ELSE '有一件商品目前不能購買' END
        ));
        purchasable := false;
      ELSIF NOT seller_ok THEN
        line_issues := line_issues || jsonb_build_array(jsonb_build_object(
          'code', 'seller_unavailable',
          'productId', pid,
          'sellerId', seller,
          'message', '「' || coalesce(public.seller_store_name(seller), '賣場') || '」目前不能接受新訂單'
        ));
        purchasable := false;
      ELSIF seller = p_buyer THEN
        line_issues := line_issues || jsonb_build_array(jsonb_build_object(
          'code', 'self_purchase',
          'productId', pid,
          'message', '不能購買自己賣場的商品'
        ));
        purchasable := false;
      END IF;
    END IF;

    invalid_variant := false;
    seen := ARRAY[]::text[];
    labels := ARRAY[]::text[];
    combo_parts := ARRAY[]::text[];
    option_keys := ARRAY[]::text[];
    IF purchasable THEN
      IF variants IS NULL OR jsonb_typeof(variants) <> 'array' OR jsonb_array_length(variants) = 0 THEN
        IF variant <> '{}'::jsonb THEN
          invalid_variant := true;
        END IF;
      ELSE
        FOR group_row IN
          SELECT g.elem, g.ordinality
          FROM jsonb_array_elements(variants) WITH ORDINALITY AS g(elem, ordinality)
          ORDER BY g.ordinality
        LOOP
          group_name := btrim(coalesce(group_row.elem->>'name', ''));
          selected := variant->>group_name;
          IF group_name = '' OR group_name = ANY (seen) OR selected IS NULL OR btrim(selected) = '' THEN
            invalid_variant := true;
            EXIT;
          END IF;
          IF jsonb_typeof(group_row.elem->'options') IS DISTINCT FROM 'array'
             OR NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(group_row.elem->'options') opt WHERE opt = selected
             ) THEN
            invalid_variant := true;
            EXIT;
          END IF;
          seen := seen || group_name;
          labels := labels || selected;
          combo_parts := combo_parts || (group_name || '|' || selected);
          option_keys := option_keys || (group_name || '|' || selected);
        END LOOP;
        IF EXISTS (
          SELECT 1
          FROM jsonb_object_keys(variant) AS extra(key)
          WHERE extra.key <> ALL (seen)
        ) THEN
          invalid_variant := true;
        END IF;
      END IF;
      IF invalid_variant THEN
        line_issues := line_issues || jsonb_build_array(jsonb_build_object(
          'code', 'variant_invalid',
          'productId', pid,
          'variantFingerprint', fingerprint,
          'message', '「' || coalesce(product_name, '商品') || '」的規格已失效，請重新選擇'
        ));
        purchasable := false;
      END IF;
    END IF;

    IF purchasable THEN
      is_combo := jsonb_array_length(variants) > 1
        AND combo_stock IS NOT NULL
        AND jsonb_typeof(combo_stock) = 'object';
      combo_key := array_to_string(combo_parts, '::');
      price_hits := 0;
      price_raw := NULL;
      IF is_combo AND combo_price IS NOT NULL AND jsonb_typeof(combo_price) = 'object' AND combo_price ? combo_key THEN
        price_raw := combo_price->>combo_key;
        price_hits := 1;
      ELSE
        FOREACH opt_key IN ARRAY option_keys LOOP
          IF option_price IS NOT NULL AND jsonb_typeof(option_price) = 'object' AND option_price ? opt_key THEN
            price_hits := price_hits + 1;
            price_raw := option_price->>opt_key;
          END IF;
        END LOOP;
        IF price_hits = 0 THEN
          price_raw := price_text;
        ELSIF price_hits > 1 THEN
          line_issues := line_issues || jsonb_build_array(jsonb_build_object(
            'code', 'price_invalid',
            'productId', pid,
            'variantFingerprint', fingerprint,
            'message', '「' || coalesce(product_name, '商品') || '」的規格價格無法判定，請賣家更正後再購買'
          ));
          purchasable := false;
        END IF;
      END IF;
    END IF;

    IF purchasable THEN
      unit_price := public.commerce_parse_int(price_raw);
      IF unit_price IS NULL OR unit_price <= 0 THEN
        line_issues := line_issues || jsonb_build_array(jsonb_build_object(
          'code', 'price_invalid',
          'productId', pid,
          'variantFingerprint', fingerprint,
          'message', '「' || coalesce(product_name, '商品') || '」目前沒有可用的整數售價'
        ));
        purchasable := false;
        unit_price := NULL;
      END IF;
    END IF;

    IF purchasable AND p_expected IS NOT NULL AND jsonb_typeof(p_expected) = 'object' THEN
      expected_key := pid::text || '|' || fingerprint;
      IF p_expected ? expected_key THEN
        expected_price := public.commerce_parse_int(p_expected->>expected_key);
        IF expected_price IS NULL OR expected_price IS DISTINCT FROM unit_price THEN
          line_issues := line_issues || jsonb_build_array(jsonb_build_object(
            'code', 'price_changed',
            'productId', pid,
            'variantFingerprint', fingerprint,
            'unitPrice', unit_price,
            'expectedPrice', p_expected->>expected_key,
            'message', '「' || coalesce(product_name, '商品') || '」的價格已變更，請確認後再結帳'
          ));
          purchasable := false;
        END IF;
      END IF;
    END IF;

    IF purchasable THEN
      on_hand := public.commerce_parse_int(stock_text);
      IF on_hand IS NULL THEN
        line_issues := line_issues || jsonb_build_array(jsonb_build_object(
          'code', 'stock_unreadable',
          'productId', pid,
          'message', '「' || coalesce(product_name, '商品') || '」的庫存資料無法確認，目前不能購買'
        ));
        purchasable := false;
      ELSE
        buckets := jsonb_build_array(jsonb_build_object('kind', 'product', 'key', '', 'onHand', on_hand));
        IF is_combo THEN
          stock_mode := 'combo';
          IF combo_stock ? combo_key THEN
            on_hand := public.commerce_parse_int(combo_stock->>combo_key);
          ELSE
            on_hand := 0;
          END IF;
          IF on_hand IS NULL THEN
            line_issues := line_issues || jsonb_build_array(jsonb_build_object(
              'code', 'stock_unreadable',
              'productId', pid,
              'message', '「' || coalesce(product_name, '商品') || '」的組合庫存無法確認，目前不能購買'
            ));
            purchasable := false;
          ELSE
            buckets := buckets || jsonb_build_array(jsonb_build_object(
              'kind', 'combo', 'key', combo_key, 'onHand', on_hand
            ));
          END IF;
        ELSE
          stock_mode := 'product';
          FOREACH opt_key IN ARRAY option_keys LOOP
            IF option_stock IS NOT NULL AND jsonb_typeof(option_stock) = 'object' AND option_stock ? opt_key THEN
              stock_mode := 'option';
              on_hand := public.commerce_parse_int(option_stock->>opt_key);
              IF on_hand IS NULL THEN
                line_issues := line_issues || jsonb_build_array(jsonb_build_object(
                  'code', 'stock_unreadable',
                  'productId', pid,
                  'message', '「' || coalesce(product_name, '商品') || '」的規格庫存無法確認，目前不能購買'
                ));
                purchasable := false;
                EXIT;
              END IF;
              buckets := buckets || jsonb_build_array(jsonb_build_object(
                'kind', 'option', 'key', opt_key, 'onHand', on_hand
              ));
            END IF;
          END LOOP;
        END IF;
      END IF;
    END IF;

    IF purchasable THEN
      line_available := NULL;
      FOR bucket IN SELECT value FROM jsonb_array_elements(buckets) LOOP
        held := public.commerce_active_held(pid, bucket->>'kind', bucket->>'key');
        available := greatest((bucket->>'onHand')::integer - held, 0);
        line_available := least(coalesce(line_available, available), available);
        demand_key := pid::text || '|' || (bucket->>'kind') || '|' || (bucket->>'key');
        IF demand ? demand_key THEN
          demand := jsonb_set(
            demand,
            ARRAY[demand_key, 'demand'],
            to_jsonb((demand->demand_key->>'demand')::integer + qty_int),
            false
          );
        ELSE
          demand := demand || jsonb_build_object(
            demand_key, jsonb_build_object(
              'productId', pid,
              'kind', bucket->>'kind',
              'key', bucket->>'key',
              'onHand', (bucket->>'onHand')::integer,
              'held', held,
              'available', available,
              'demand', qty_int,
              'name', product_name
            )
          );
        END IF;
      END LOOP;
    END IF;

    line_amount := NULL;
    IF purchasable AND unit_price IS NOT NULL THEN
      IF unit_price::bigint * qty_int > 2147483647 THEN
        line_issues := line_issues || jsonb_build_array(jsonb_build_object(
          'code', 'price_invalid',
          'productId', pid,
          'variantFingerprint', fingerprint,
          'message', '「' || coalesce(product_name, '商品') || '」的金額過大，目前不能一次結帳'
        ));
        purchasable := false;
        unit_price := NULL;
      ELSE
        line_amount := (unit_price::bigint * qty_int)::integer;
      END IF;
    END IF;

    issues := issues || line_issues;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'productId', pid,
      'cartItemId', line->>'cartItemId',
      'sellerId', seller,
      'name', CASE WHEN reveal THEN product_name ELSE NULL END,
      'image', CASE WHEN reveal AND is_public THEN product_image ELSE NULL END,
      'variant', variant,
      'variantFingerprint', fingerprint,
      'variantLabel', CASE
        WHEN NOT reveal THEN NULL
        WHEN coalesce(array_length(labels, 1), 0) = 0 THEN '標準規格'
        ELSE array_to_string(labels, ' / ')
      END,
      'qty', qty_int,
      'unitPrice', CASE WHEN reveal AND is_public THEN unit_price ELSE NULL END,
      'lineTotal', CASE WHEN reveal AND is_public THEN line_amount ELSE NULL END,
      'stockMode', stock_mode,
      'buckets', CASE WHEN purchasable THEN buckets ELSE '[]'::jsonb END,
      'availableQty', CASE WHEN reveal AND is_public THEN line_available ELSE NULL END,
      'purchasable', purchasable AND is_public AND seller_ok AND seller IS DISTINCT FROM p_buyer,
      'issues', line_issues
    ));
  END LOOP;

  FOR demand_row IN SELECT value FROM jsonb_each(demand) LOOP
    IF (demand_row->>'demand')::integer > (demand_row->>'available')::integer THEN
      shortfall := true;
      issue := jsonb_build_object(
        'code', 'out_of_stock',
        'productId', demand_row->>'productId',
        'availableQty', (demand_row->>'available')::integer,
        'requestedQty', (demand_row->>'demand')::integer,
        'message', '「' || coalesce(demand_row->>'name', '商品') || '」庫存不足，目前可保留 '
          || (demand_row->>'available') || ' 件'
      );
      issues := issues || jsonb_build_array(issue);
      lines := (
        SELECT coalesce(jsonb_agg(
          CASE
            WHEN item->>'productId' = demand_row->>'productId'
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements(item->'buckets') b
                WHERE b->>'kind' = demand_row->>'kind' AND b->>'key' = demand_row->>'key'
              )
            THEN jsonb_set(
              jsonb_set(item, '{purchasable}', 'false'::jsonb, false),
              '{issues}',
              (item->'issues') || jsonb_build_array(issue),
              false
            )
            ELSE item
          END
        ), '[]'::jsonb)
        FROM jsonb_array_elements(lines) item
      );
    END IF;
  END LOOP;

  SELECT coalesce(array_agg(DISTINCT (item->>'sellerId')::uuid), ARRAY[]::uuid[])
    INTO seller_ids
  FROM jsonb_array_elements(lines) item
  WHERE item->>'sellerId' IS NOT NULL;

  FOREACH seller_id IN ARRAY seller_ids LOOP
    seller_lines := (
      SELECT coalesce(jsonb_agg(item ORDER BY item->>'name', item->>'variantFingerprint'), '[]'::jsonb)
      FROM jsonb_array_elements(lines) item
      WHERE item->>'sellerId' = seller_id::text
    );
    SELECT coalesce(sum((item->>'lineTotal')::bigint), 0)
      INTO subtotal
    FROM jsonb_array_elements(seller_lines) item
    WHERE coalesce((item->>'purchasable')::boolean, false)
      AND item->>'lineTotal' IS NOT NULL;
    SELECT coalesce(bool_and(
      coalesce((item->>'purchasable')::boolean, false) AND item->>'lineTotal' IS NOT NULL
    ), false)
      INTO subtotal_known
    FROM jsonb_array_elements(seller_lines) item;
    store_name := public.seller_store_name(seller_id);
    IF subtotal > 2147483647 THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'price_invalid',
        'sellerId', seller_id,
        'message', '「' || coalesce(store_name, '賣場') || '」的金額過大，目前不能一次結帳'
      ));
      subtotal := 0;
      subtotal_known := false;
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'label', c.label_zh) ORDER BY c.sort_order), '[]'::jsonb)
      INTO methods
    FROM public.payment_method_catalog c
    JOIN public.seller_payment_methods m
      ON m.method_code = c.code AND m.seller_user_id = seller_id AND m.enabled
    ;
    SELECT coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'label', c.label_zh) ORDER BY c.sort_order), '[]'::jsonb)
      INTO ships
    FROM public.fulfillment_method_catalog c
    JOIN public.seller_fulfillment_methods m
      ON m.method_code = c.code AND m.seller_user_id = seller_id AND m.enabled
    ;
    grouped := grouped || jsonb_build_array(jsonb_build_object(
      'sellerId', seller_id,
      'storeName', store_name,
      'lines', seller_lines,
      'subtotal', subtotal,
      'subtotalKnown', coalesce(subtotal_known, false),
      'shippingFeeStatus', 'unpriced',
      'shippingFee', NULL,
      'discountStatus', 'not_applied',
      'discountAmount', 0,
      'paymentMethods', methods,
      'fulfillmentMethods', ships,
      'paymentIntegration', 'not_connected'
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(issues) = 0 AND jsonb_array_length(lines) > 0,
    'issues', issues,
    'lines', lines,
    'sellers', grouped,
    'shippingFeeStatus', 'unpriced',
    'paymentIntegration', 'not_connected'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_normalize_for_hash(
  p_lines jsonb,
  p_payment jsonb,
  p_fulfillment jsonb,
  p_name text,
  p_phone text,
  p_address text,
  p_expected jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  elem jsonb;
  merged jsonb := '{}'::jsonb;
  variant jsonb;
  fingerprint text;
  merge_key text;
  qty integer;
  lines jsonb;
BEGIN
  IF jsonb_typeof(p_lines) = 'array' THEN
    FOR elem IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      IF jsonb_typeof(elem->'variant') = 'object' THEN
        variant := elem->'variant';
      ELSE
        variant := '{}'::jsonb;
      END IF;
      fingerprint := public.commerce_variant_fingerprint(variant);
      merge_key := coalesce(elem->>'productId', '') || '|' || fingerprint;
      BEGIN
        qty := (elem->>'qty')::integer;
      EXCEPTION WHEN others THEN
        qty := NULL;
      END;
      IF merged ? merge_key AND qty IS NOT NULL AND (merged->merge_key->>'qty') ~ '^[0-9]+$' THEN
        merged := jsonb_set(
          merged,
          ARRAY[merge_key, 'qty'],
          to_jsonb((merged->merge_key->>'qty')::integer + qty),
          false
        );
      ELSE
        merged := merged || jsonb_build_object(
          merge_key, jsonb_build_object(
            'productId', elem->>'productId',
            'fingerprint', fingerprint,
            'qty', qty,
            'variant', variant
          )
        );
      END IF;
    END LOOP;
  END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'productId', value->>'fingerprint'), '[]'::jsonb)
    INTO lines
  FROM jsonb_each(merged);
  RETURN jsonb_build_object(
    'lines', lines,
    'payment', CASE WHEN jsonb_typeof(p_payment) = 'object' THEN p_payment ELSE '{}'::jsonb END,
    'fulfillment', CASE WHEN jsonb_typeof(p_fulfillment) = 'object' THEN p_fulfillment ELSE '{}'::jsonb END,
    'recipient', jsonb_build_object(
      'name', btrim(coalesce(p_name, '')),
      'phone', regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'),
      'address', btrim(coalesce(p_address, ''))
    ),
    'expected', CASE WHEN jsonb_typeof(p_expected) = 'object' THEN p_expected ELSE '{}'::jsonb END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_record_event(
  p_order_id uuid,
  p_type text,
  p_actor uuid,
  p_role text,
  p_from_lifecycle text,
  p_to_lifecycle text,
  p_from_payment text,
  p_to_payment text,
  p_from_fulfillment text,
  p_to_fulfillment text,
  p_from_hold text,
  p_to_hold text,
  p_reason text,
  p_dedupe text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM public.commerce_allow_write();
  INSERT INTO public.order_events (
    order_id, event_type, actor_id, actor_role,
    from_lifecycle, to_lifecycle, from_payment, to_payment,
    from_fulfillment, to_fulfillment, from_stock_hold, to_stock_hold,
    reason_code, dedupe_key
  ) VALUES (
    p_order_id, p_type, p_actor, p_role,
    p_from_lifecycle, p_to_lifecycle, p_from_payment, p_to_payment,
    p_from_fulfillment, p_to_fulfillment, p_from_hold, p_to_hold,
    p_reason, p_dedupe
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_notify(
  p_user_id uuid,
  p_order_id uuid,
  p_event_key text,
  p_kind text,
  p_title text,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  safe_title text := left(btrim(coalesce(p_title, '')), 40);
  safe_body text := left(btrim(coalesce(p_body, '')), 240);
BEGIN
  IF safe_title = '' OR safe_body = '' THEN
    RETURN;
  END IF;
  PERFORM public.commerce_allow_write();
  INSERT INTO public.order_notifications (user_id, order_id, event_key, kind, title, body)
  VALUES (p_user_id, p_order_id, p_event_key, p_kind, safe_title, safe_body)
  ON CONFLICT (event_key) DO NOTHING;

  INSERT INTO public.notification_outbox (event_key, kind, user_id, payload)
  VALUES (
    p_event_key,
    p_kind,
    p_user_id,
    jsonb_build_object('orderId', p_order_id, 'kind', p_kind)
  )
  ON CONFLICT (event_key) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- 購物車
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_cart_item(
  p_product_id uuid,
  p_variant jsonb,
  p_qty integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  settings public.commerce_settings%ROWTYPE;
  variant jsonb := CASE WHEN jsonb_typeof(p_variant) = 'object' THEN p_variant ELSE '{}'::jsonb END;
  fingerprint text;
  next_qty integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT * INTO settings FROM public.commerce_settings WHERE id = true;
  IF p_product_id IS NULL OR p_qty IS NULL OR p_qty < 1 OR p_qty > settings.max_qty_per_line THEN
    RAISE EXCEPTION '購物車數量不正確';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION '找不到這個商品';
  END IF;
  PERFORM public.commerce_buyer_lock(uid);
  fingerprint := public.commerce_variant_fingerprint(variant);
  SELECT c.qty INTO next_qty
  FROM public.cart_items c
  WHERE c.user_id = uid AND c.product_id = p_product_id AND c.variant_fingerprint = fingerprint;
  IF coalesce(next_qty, 0) + p_qty > settings.max_qty_per_line THEN
    RAISE EXCEPTION '同一規格最多只能放 % 件進購物車', settings.max_qty_per_line;
  END IF;
  INSERT INTO public.cart_items (user_id, product_id, variant, variant_fingerprint, qty)
  VALUES (uid, p_product_id, variant, fingerprint, p_qty)
  ON CONFLICT (user_id, product_id, variant_fingerprint)
  DO UPDATE SET qty = public.cart_items.qty + EXCLUDED.qty, updated_at = now()
  RETURNING qty INTO next_qty;
  IF next_qty > settings.max_qty_per_line THEN
    RAISE EXCEPTION '同一規格最多只能放 % 件進購物車', settings.max_qty_per_line;
  END IF;
  RETURN public.list_my_cart();
END;
$$;

CREATE OR REPLACE FUNCTION public.set_cart_item_qty(p_item_id uuid, p_qty integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  settings public.commerce_settings%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT * INTO settings FROM public.commerce_settings WHERE id = true;
  PERFORM public.commerce_buyer_lock(uid);
  IF p_qty IS NULL OR p_qty < 1 THEN
    DELETE FROM public.cart_items WHERE id = p_item_id AND user_id = uid;
  ELSIF p_qty > settings.max_qty_per_line THEN
    RAISE EXCEPTION '同一規格最多只能放 % 件進購物車', settings.max_qty_per_line;
  ELSE
    UPDATE public.cart_items
    SET qty = p_qty, updated_at = now()
    WHERE id = p_item_id AND user_id = uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION '找不到這個購物車商品';
    END IF;
  END IF;
  RETURN public.list_my_cart();
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_cart_item(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  PERFORM public.commerce_buyer_lock(uid);
  DELETE FROM public.cart_items WHERE id = p_item_id AND user_id = uid;
  RETURN public.list_my_cart();
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_cart()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  payload jsonb;
  plan jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'cartItemId', c.id,
    'productId', c.product_id,
    'variant', c.variant,
    'qty', c.qty
  ) ORDER BY c.created_at), '[]'::jsonb)
    INTO payload
  FROM public.cart_items c
  WHERE c.user_id = uid;
  plan := public.commerce_build_plan(uid, payload, false, NULL);
  RETURN plan || jsonb_build_object('cart', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_checkout(
  p_lines jsonb,
  p_expected_prices jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  plan jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  plan := public.commerce_build_plan(uid, p_lines, false, p_expected_prices);
  IF jsonb_array_length(coalesce(plan->'lines', '[]'::jsonb)) = 0
     AND jsonb_array_length(coalesce(plan->'issues', '[]'::jsonb)) = 0 THEN
    RETURN plan || jsonb_build_object(
      'ok', false,
      'issues', jsonb_build_array(jsonb_build_object('code', 'empty', 'message', '請選擇要結帳的商品'))
    );
  END IF;
  RETURN plan;
END;
$$;

-- ---------------------------------------------------------------------------
-- 結帳。整段在同一個交易：任一賣場失敗就全部不成立。
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.place_checkout(
  p_idempotency_key uuid,
  p_lines jsonb,
  p_payment_by_seller jsonb,
  p_fulfillment_by_seller jsonb,
  p_recipient_name text,
  p_recipient_phone text,
  p_recipient_address text,
  p_expected_prices jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  settings public.commerce_settings%ROWTYPE;
  canonical jsonb;
  request_hash text;
  existing_hash text;
  existing_result jsonb;
  plan jsonb;
  issues jsonb := '[]'::jsonb;
  seller_row jsonb;
  seller_id uuid;
  pay_code text;
  ship_code text;
  recipient_name text;
  recipient_phone text;
  recipient_address text;
  product_ids uuid[];
  open_holds integer;
  reserved_units integer;
  recent_checkouts integer;
  recent_same integer;
  requested_units integer := 0;
  requested_orders integer := 0;
  batch_id uuid;
  checkout_result jsonb;
  line jsonb;
  bucket jsonb;
  order_id uuid;
  item_id uuid;
  display_no text;
  seller_lines jsonb;
  items_subtotal integer;
  hold_until timestamptz;
  store_name text;
  orders_json jsonb := '[]'::jsonb;
  stage text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', '請重新整理後再結帳', 'issues', '[]'::jsonb);
  END IF;

  SELECT * INTO settings FROM public.commerce_settings WHERE id = true;
  recipient_name := btrim(coalesce(p_recipient_name, ''));
  recipient_phone := regexp_replace(coalesce(p_recipient_phone, ''), '[^0-9]', '', 'g');
  recipient_address := btrim(coalesce(p_recipient_address, ''));
  canonical := public.commerce_normalize_for_hash(
    p_lines, p_payment_by_seller, p_fulfillment_by_seller,
    recipient_name, recipient_phone, recipient_address, p_expected_prices
  );
  request_hash := md5(canonical::text);

  SELECT b.request_hash, b.result
    INTO existing_hash, existing_result
  FROM public.checkout_batches b
  WHERE b.buyer_id = uid AND b.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF existing_hash IS DISTINCT FROM request_hash THEN
      RAISE EXCEPTION '這組結帳識別碼已經用於不同內容，請重新整理後再結帳';
    END IF;
    IF existing_result IS NOT NULL THEN
      RETURN existing_result;
    END IF;
  END IF;

  PERFORM public.commerce_buyer_lock(uid);

  SELECT b.request_hash, b.result
    INTO existing_hash, existing_result
  FROM public.checkout_batches b
  WHERE b.buyer_id = uid AND b.idempotency_key = p_idempotency_key;
  IF FOUND AND existing_hash = request_hash AND existing_result IS NOT NULL THEN
    RETURN existing_result;
  END IF;
  IF FOUND AND existing_hash IS DISTINCT FROM request_hash THEN
    RAISE EXCEPTION '這組結帳識別碼已經用於不同內容，請重新整理後再結帳';
  END IF;

  -- 不讀 checkout_enabled。金流與運費串接前，改旗標也不能建立訂單。
  -- 已成立批次的同鍵重試已在上方回傳。
  RETURN jsonb_build_object(
    'ok', false,
    'code', 'checkout_unavailable',
    'message', '正式結帳尚未開放。付款與運費確認功能完成前，不能建立商品訂單。',
    'issues', '[]'::jsonb
  );

  product_ids := ARRAY(
    SELECT DISTINCT (value->>'productId')::uuid
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines ELSE '[]'::jsonb END) value
    WHERE value->>'productId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

  SELECT count(*) INTO open_holds
  FROM public.orders o
  WHERE o.buyer_id = uid AND o.stock_hold_status = 'held' AND o.stock_hold_expires_at > now();
  SELECT coalesce(sum(oi.quantity), 0) INTO reserved_units
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  WHERE o.buyer_id = uid AND o.stock_hold_status = 'held' AND o.stock_hold_expires_at > now();
  SELECT count(*) INTO recent_checkouts
  FROM public.checkout_batches b
  WHERE b.buyer_id = uid AND b.created_at > now() - interval '1 hour';
  IF coalesce(array_length(product_ids, 1), 0) > 0 THEN
    SELECT count(DISTINCT o.id) INTO recent_same
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.buyer_id = uid
      AND oi.product_id = ANY (product_ids)
      AND o.created_at > now() - interval '1 hour';
  ELSE
    recent_same := 0;
  END IF;

  IF recent_checkouts >= settings.max_checkouts_per_hour THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'limit_checkout_rate',
      'message', '結帳次數過於頻繁，請稍後再試'
    ));
  END IF;
  IF recent_same >= settings.max_same_product_orders_per_hour THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'limit_same_product',
      'message', '短時間內重複下單同一商品的次數過多，請稍後再試'
    ));
  END IF;
  IF char_length(recipient_name) < 1 OR char_length(recipient_name) > 30 THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code', 'recipient_invalid', 'message', '請填寫 1 到 30 個字的收件人姓名'));
  END IF;
  IF recipient_phone !~ '^09[0-9]{8}$' THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code', 'recipient_invalid', 'message', '請填寫有效的手機號碼'));
  END IF;
  IF char_length(recipient_address) < 8 OR char_length(recipient_address) > 120 THEN
    issues := issues || jsonb_build_array(jsonb_build_object('code', 'recipient_invalid', 'message', '請填寫完整收件地址'));
  END IF;

  plan := public.commerce_build_plan(uid, p_lines, true, p_expected_prices);
  issues := issues || coalesce(plan->'issues', '[]'::jsonb);

  requested_orders := jsonb_array_length(coalesce(plan->'sellers', '[]'::jsonb));
  SELECT coalesce(sum((e.value->>'qty')::integer), 0)::integer
    INTO requested_units
  FROM jsonb_array_elements(coalesce(plan->'lines', '[]'::jsonb)) AS e(value)
  WHERE coalesce((e.value->>'purchasable')::boolean, false);
  IF open_holds + requested_orders > settings.max_open_holds_per_buyer THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'limit_open_orders',
      'message', '未完成保留的訂單加上本次訂單已超過上限，請先處理既有訂單或稍後再試'
    ));
  END IF;
  IF reserved_units + requested_units > settings.max_reserved_units_per_buyer THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'limit_reserved_units',
      'message', '目前保留的商品數量加上本次商品已超過上限，請調整商品數量'
    ));
  END IF;
  IF jsonb_array_length(coalesce(plan->'lines', '[]'::jsonb)) = 0
     AND jsonb_array_length(coalesce(plan->'issues', '[]'::jsonb)) = 0 THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'empty',
      'message', '請選擇要結帳的商品'
    ));
  END IF;

  FOR seller_row IN SELECT value FROM jsonb_array_elements(coalesce(plan->'sellers', '[]'::jsonb)) LOOP
    seller_id := (seller_row->>'sellerId')::uuid;
    pay_code := CASE WHEN jsonb_typeof(p_payment_by_seller) = 'object' THEN btrim(p_payment_by_seller->>seller_id::text) ELSE NULL END;
    ship_code := CASE WHEN jsonb_typeof(p_fulfillment_by_seller) = 'object' THEN btrim(p_fulfillment_by_seller->>seller_id::text) ELSE NULL END;
    store_name := coalesce(seller_row->>'storeName', '賣場');
    IF pay_code IS NULL OR pay_code = '' OR NOT EXISTS (
      SELECT 1 FROM public.payment_method_catalog c WHERE c.code = pay_code
    ) THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'payment_method_invalid',
        'sellerId', seller_id,
        'message', '請為「' || store_name || '」選擇付款方式。不同賣場需要各自付款，平台不會代收。'
      ));
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.seller_payment_methods m
      WHERE m.seller_user_id = seller_id AND m.method_code = pay_code AND m.enabled
    ) THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'payment_method_disabled',
        'sellerId', seller_id,
        'message', '「' || store_name || '」尚未開啟這個付款方式'
      ));
    END IF;
    IF ship_code IS NULL OR ship_code = '' OR NOT EXISTS (
      SELECT 1 FROM public.fulfillment_method_catalog c WHERE c.code = ship_code
    ) THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'fulfillment_method_invalid',
        'sellerId', seller_id,
        'message', '請為「' || store_name || '」選擇配送方式'
      ));
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.seller_fulfillment_methods m
      WHERE m.seller_user_id = seller_id AND m.method_code = ship_code AND m.enabled
    ) THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'fulfillment_method_disabled',
        'sellerId', seller_id,
        'message', '「' || store_name || '」尚未開啟這個配送方式'
      ));
    END IF;
    IF (pay_code = 'cvs_cod' AND ship_code IS DISTINCT FROM 'cvs_pickup')
       OR (pay_code = 'home_cod' AND ship_code IS DISTINCT FROM 'home_delivery') THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'payment_fulfillment_mismatch',
        'sellerId', seller_id,
        'message', '「' || store_name || '」所選貨到付款與配送方式不相容'
      ));
    END IF;
  END LOOP;

  IF jsonb_array_length(issues) > 0 OR coalesce((plan->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', '訂單沒有成立，也沒有保留庫存。',
      'issues', issues,
      'sellers', coalesce(plan->'sellers', '[]'::jsonb),
      'shippingFeeStatus', 'unpriced',
      'paymentIntegration', 'not_connected'
    );
  END IF;

  -- 第二道鎖：即使拿掉上方的 RETURN，這一行仍會阻止寫入。開放結帳時兩處要一起改。
  RAISE EXCEPTION '正式結帳尚未開放。付款與運費確認功能完成前，不能建立商品訂單。';
  PERFORM public.commerce_allow_write();
  PERFORM set_config('hengjing.commerce_checkout', 'on', true);
  BEGIN
    INSERT INTO public.checkout_batches (buyer_id, idempotency_key, request_hash)
    VALUES (uid, p_idempotency_key, request_hash)
    RETURNING id INTO batch_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT b.request_hash, b.result INTO existing_hash, existing_result
    FROM public.checkout_batches b
    WHERE b.buyer_id = uid AND b.idempotency_key = p_idempotency_key;
    IF existing_hash IS DISTINCT FROM request_hash THEN
      RAISE EXCEPTION '這組結帳識別碼已經用於不同內容，請重新整理後再結帳';
    END IF;
    IF existing_result IS NULL THEN
      RAISE EXCEPTION '這筆結帳仍在處理，請稍後再試';
    END IF;
    RETURN existing_result;
  END;

  hold_until := now() + make_interval(mins => settings.inventory_hold_minutes);
  FOR seller_row IN SELECT value FROM jsonb_array_elements(plan->'sellers') LOOP
    seller_id := (seller_row->>'sellerId')::uuid;
    seller_lines := seller_row->'lines';
    items_subtotal := (seller_row->>'subtotal')::integer;
    pay_code := btrim(p_payment_by_seller->>seller_id::text);
    ship_code := btrim(p_fulfillment_by_seller->>seller_id::text);
    store_name := coalesce(seller_row->>'storeName', '賣場');
    display_no := 'HJ' || to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD')
      || '-' || lpad(nextval('public.order_display_no_seq')::text, 6, '0');
    INSERT INTO public.orders (
      display_no, batch_id, buyer_id, seller_id,
      payment_method, payment_status, payment_integration, payment_due_at,
      fulfillment_method, fulfillment_status,
      stock_hold_status, stock_hold_expires_at,
      items_subtotal, shipping_fee, shipping_fee_status,
      discount_amount, discount_status, order_total,
      recipient_name, recipient_phone, recipient_address
    ) VALUES (
      display_no, batch_id, uid, seller_id,
      pay_code, 'unpaid', 'not_connected', NULL,
      ship_code, 'not_ready',
      'held', hold_until,
      items_subtotal, 0, 'unpriced',
      0, 'not_applied', items_subtotal,
      recipient_name, recipient_phone, recipient_address
    ) RETURNING id INTO order_id;

    FOR line IN
      SELECT value FROM jsonb_array_elements(seller_lines) value WHERE coalesce((value->>'purchasable')::boolean, false)
    LOOP
      INSERT INTO public.order_items (
        order_id, product_id, seller_id, product_name, variant, variant_label,
        variant_fingerprint, stock_mode, unit_price, quantity, line_total, refunded_qty, image_url
      ) VALUES (
        order_id,
        (line->>'productId')::uuid,
        seller_id,
        left(coalesce(nullif(btrim(line->>'name'), ''), '未命名商品'), 200),
        line->'variant',
        coalesce(line->>'variantLabel', '標準規格'),
        line->>'variantFingerprint',
        coalesce(line->>'stockMode', 'product'),
        (line->>'unitPrice')::integer,
        (line->>'qty')::integer,
        (line->>'lineTotal')::integer,
        0,
        line->>'image'
      ) RETURNING id INTO item_id;

      FOR bucket IN SELECT value FROM jsonb_array_elements(line->'buckets') LOOP
        INSERT INTO public.inventory_reservations (
          order_item_id, order_id, product_id, bucket_kind, bucket_key, quantity, status, expires_at
        ) VALUES (
          item_id,
          order_id,
          (line->>'productId')::uuid,
          bucket->>'kind',
          bucket->>'key',
          (line->>'qty')::integer,
          'held',
          hold_until
        );
      END LOOP;

      DELETE FROM public.cart_items
      WHERE user_id = uid
        AND product_id = (line->>'productId')::uuid
        AND variant_fingerprint = line->>'variantFingerprint';
    END LOOP;

    PERFORM public.commerce_record_event(
      order_id, 'order_placed', uid, 'buyer',
      NULL, 'open', NULL, 'unpaid', NULL, 'not_ready', NULL, 'held',
      'placed', 'placed:' || order_id::text
    );
    PERFORM public.commerce_notify(
      uid, order_id, 'order_placed:' || order_id::text, 'order_placed',
      '訂單已成立',
      '訂單 ' || display_no || '（' || left(coalesce(store_name, '賣場'), 24) || '）已成立。尚未付款，也不代表已經成交。'
    );
    PERFORM public.commerce_notify(
      seller_id, order_id, 'order_received:' || order_id::text, 'order_received',
      '收到新訂單',
      '收到訂單 ' || display_no || '。請到訂單管理查看。這不是已確認收款。'
    );
    stage := public.order_buyer_stage('open', 'unpaid', 'not_ready', 'none', NULL);
    orders_json := orders_json || jsonb_build_array(jsonb_build_object(
      'orderId', order_id,
      'displayNo', display_no,
      'sellerId', seller_id,
      'storeName', store_name,
      'itemCount', jsonb_array_length(seller_lines),
      'itemsSubtotal', items_subtotal,
      'shippingFeeStatus', 'unpriced',
      'discountStatus', 'not_applied',
      'orderTotal', items_subtotal,
      'paymentMethod', pay_code,
      'paymentStatus', 'unpaid',
      'paymentIntegration', 'not_connected',
      'fulfillmentMethod', ship_code,
      'stockHoldStatus', 'held',
      'stockHoldExpiresAt', hold_until,
      'buyerStage', stage,
      'buyerStageLabel', public.order_stage_label(stage),
      'buyerBucket', public.order_buyer_bucket(stage),
      'notice', '此訂單只代表成立與庫存保留，不代表已付款、已出貨或已成交。不同賣場請各自付款，平台不代收商品款。'
    ));
  END LOOP;

  checkout_result := jsonb_build_object(
    'ok', true,
    'batchId', batch_id,
    'orders', orders_json,
    'message', '訂單已成立。庫存已暫時保留，但尚未付款，也尚未成交。',
    'shippingFeeStatus', 'unpriced',
    'paymentIntegration', 'not_connected'
  );
  UPDATE public.checkout_batches AS b SET result = checkout_result WHERE b.id = batch_id;
  RETURN checkout_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 取消與到期釋放。釋放只會把 held 改成 released 一次。
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.commerce_cancel_order(
  p_order_id uuid,
  p_actor_role text,
  p_reason_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.orders%ROWTYPE;
  settings public.commerce_settings%ROWTYPE;
  recent_cancels integer;
  store_name text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_actor_role NOT IN ('buyer', 'seller') THEN
    RAISE EXCEPTION '不能取消這張訂單';
  END IF;
  SELECT * INTO settings FROM public.commerce_settings WHERE id = true;
  PERFORM public.commerce_allow_write();
  SELECT * INTO row FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這張訂單';
  END IF;
  IF p_actor_role = 'buyer' AND row.buyer_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION '找不到這張訂單';
  END IF;
  IF p_actor_role = 'seller' AND row.seller_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION '找不到這張訂單';
  END IF;
  IF row.cancel_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'displayNo', row.display_no, 'message', '這張訂單已經取消');
  END IF;
  IF row.lifecycle_status IS DISTINCT FROM 'open'
     OR row.payment_status NOT IN ('unpaid', 'failed')
     OR row.fulfillment_status IS DISTINCT FROM 'not_ready'
     OR row.completed_at IS NOT NULL
     OR row.refund_status IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION '這張訂單目前不能取消';
  END IF;

  IF p_actor_role = 'buyer' THEN
    SELECT count(*) INTO recent_cancels
    FROM public.orders o
    WHERE o.buyer_id = uid
      AND o.cancelled_by = uid
      AND o.cancelled_at > now() - interval '1 hour';
    IF recent_cancels >= settings.max_buyer_cancels_per_hour THEN
      RAISE EXCEPTION '取消次數過多，請稍後再試';
    END IF;
  ELSE
    SELECT count(*) INTO recent_cancels
    FROM public.orders o
    WHERE o.seller_id = uid
      AND o.cancel_actor_role = 'seller'
      AND o.cancelled_at > now() - interval '1 hour';
    IF recent_cancels >= settings.max_seller_cancels_per_hour THEN
      RAISE EXCEPTION '取消次數過多，請稍後再試';
    END IF;
  END IF;

  UPDATE public.inventory_reservations
  SET status = 'released', released_at = now(), release_reason = 'cancelled'
  WHERE order_id = row.id AND status = 'held';

  UPDATE public.orders
  SET lifecycle_status = 'cancelled',
      cancel_status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = uid,
      cancel_actor_role = p_actor_role,
      cancel_reason_code = coalesce(nullif(btrim(p_reason_code), ''), 'cancelled'),
      stock_hold_status = CASE WHEN stock_hold_status = 'held' THEN 'released' ELSE stock_hold_status END,
      stock_released_at = CASE WHEN stock_hold_status = 'held' THEN now() ELSE stock_released_at END,
      updated_at = now()
  WHERE id = row.id AND cancel_status = 'none';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'displayNo', row.display_no, 'message', '這張訂單已經取消');
  END IF;

  store_name := public.seller_store_name(row.seller_id);
  PERFORM public.commerce_record_event(
    row.id, 'order_cancelled', uid, p_actor_role,
    row.lifecycle_status, 'cancelled', row.payment_status, row.payment_status,
    row.fulfillment_status, row.fulfillment_status, row.stock_hold_status, 'released',
    'cancelled', 'cancelled:' || row.id::text
  );
  PERFORM public.commerce_notify(
    row.buyer_id, row.id, 'order_cancelled:' || row.id::text || ':buyer', 'order_cancelled',
    '訂單已取消',
    '訂單 ' || row.display_no || '（' || left(coalesce(store_name, '賣場'), 24) || '）已取消。'
  );
  PERFORM public.commerce_notify(
    row.seller_id, row.id, 'order_cancelled:' || row.id::text || ':seller', 'order_cancelled',
    '訂單已取消',
    '訂單 ' || row.display_no || ' 已取消。'
  );
  RETURN jsonb_build_object('ok', true, 'already', false, 'displayNo', row.display_no, 'message', '訂單已取消，保留的庫存已釋放');
END;
$$;

CREATE OR REPLACE FUNCTION public.buyer_cancel_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN public.commerce_cancel_order(p_order_id, 'buyer', 'buyer_cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_cancel_unpaid_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN public.commerce_cancel_order(p_order_id, 'seller', 'seller_cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.release_expired_inventory_holds()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  row public.orders%ROWTYPE;
  released_count integer := 0;
  should_cancel boolean := false;
  store_name text;
BEGIN
  PERFORM public.commerce_allow_write();
  FOR row IN
    SELECT *
    FROM public.orders
    WHERE stock_hold_status = 'held'
      AND stock_hold_expires_at <= now()
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.inventory_reservations
    SET status = 'released', released_at = now(), release_reason = 'expired'
    WHERE order_id = row.id AND status = 'held' AND expires_at <= now();

    UPDATE public.orders
    SET stock_hold_status = 'released',
        stock_released_at = now(),
        exception_code = 'inventory_hold_expired',
        updated_at = now()
    WHERE id = row.id AND stock_hold_status = 'held';
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    released_count := released_count + 1;

    SELECT c.cancel_order_when_hold_expires
      INTO should_cancel
    FROM public.payment_method_catalog c
    WHERE c.code = row.payment_method;
    should_cancel := coalesce(should_cancel, false);

    PERFORM public.commerce_record_event(
      row.id, 'inventory_hold_expired', NULL, 'system',
      row.lifecycle_status, row.lifecycle_status, row.payment_status, row.payment_status,
      row.fulfillment_status, row.fulfillment_status, 'held', 'released',
      'hold_expired', 'hold_expired:' || row.id::text
    );
    store_name := public.seller_store_name(row.seller_id);
    PERFORM public.commerce_notify(
      row.buyer_id, row.id, 'inventory_hold_expired:' || row.id::text || ':buyer', 'inventory_hold_expired',
      '庫存保留已到期',
      '訂單 ' || row.display_no || '（' || left(coalesce(store_name, '賣場'), 24) || '）的庫存保留已到期並釋放。訂單沒有自動取消。'
    );
    PERFORM public.commerce_notify(
      row.seller_id, row.id, 'inventory_hold_expired:' || row.id::text || ':seller', 'inventory_hold_expired',
      '庫存保留已到期',
      '訂單 ' || row.display_no || ' 的庫存保留已到期並釋放。'
    );

    IF should_cancel
       AND row.lifecycle_status = 'open'
       AND row.payment_status IN ('unpaid', 'failed')
       AND row.fulfillment_status = 'not_ready'
       AND row.completed_at IS NULL THEN
      UPDATE public.orders
      SET lifecycle_status = 'cancelled',
          cancel_status = 'cancelled',
          cancelled_at = now(),
          cancel_actor_role = 'system',
          cancel_reason_code = 'hold_expired',
          updated_at = now()
      WHERE id = row.id AND cancel_status = 'none';
      PERFORM public.commerce_record_event(
        row.id, 'order_cancelled', NULL, 'system',
        'open', 'cancelled', row.payment_status, row.payment_status,
        'not_ready', 'not_ready', 'released', 'released',
        'hold_expired_cancel', 'cancelled:' || row.id::text
      );
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'releasedOrders', released_count);
END;
$$;

-- ---------------------------------------------------------------------------
-- 讀取。不接受呼叫者傳入的 buyer_id / seller_id。
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.commerce_order_json(p_order public.orders, p_include_recipient boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  stage text;
  can_cancel boolean;
  pay_label text;
  ship_label text;
BEGIN
  stage := public.order_buyer_stage(
    p_order.lifecycle_status, p_order.payment_status, p_order.fulfillment_status,
    p_order.refund_status, p_order.completed_at
  );
  can_cancel := p_order.lifecycle_status = 'open'
    AND p_order.payment_status IN ('unpaid', 'failed')
    AND p_order.fulfillment_status = 'not_ready'
    AND p_order.completed_at IS NULL
    AND p_order.refund_status = 'none'
    AND p_order.cancel_status = 'none';
  SELECT label_zh INTO pay_label FROM public.payment_method_catalog WHERE code = p_order.payment_method;
  SELECT label_zh INTO ship_label FROM public.fulfillment_method_catalog WHERE code = p_order.fulfillment_method;
  RETURN jsonb_build_object(
    'orderId', p_order.id,
    'displayNo', p_order.display_no,
    'batchId', p_order.batch_id,
    'sellerId', p_order.seller_id,
    'storeName', public.seller_store_name(p_order.seller_id),
    'createdAt', p_order.created_at,
    'buyerStage', stage,
    'buyerStageLabel', public.order_stage_label(stage),
    'buyerBucket', public.order_buyer_bucket(stage),
    'lifecycleStatus', p_order.lifecycle_status,
    'paymentMethod', p_order.payment_method,
    'paymentMethodLabel', coalesce(pay_label, p_order.payment_method),
    'paymentStatus', p_order.payment_status,
    'paymentIntegration', p_order.payment_integration,
    'paymentDueAt', p_order.payment_due_at,
    'paymentConfirmedAt', p_order.payment_confirmed_at,
    'paymentConfirmationSource', p_order.payment_confirmation_source,
    'fulfillmentMethod', p_order.fulfillment_method,
    'fulfillmentMethodLabel', coalesce(ship_label, p_order.fulfillment_method),
    'fulfillmentStatus', p_order.fulfillment_status,
    'completedAt', p_order.completed_at,
    'cancelStatus', p_order.cancel_status,
    'cancelledAt', p_order.cancelled_at,
    'refundStatus', p_order.refund_status,
    'stockHoldStatus', p_order.stock_hold_status,
    'stockHoldExpiresAt', p_order.stock_hold_expires_at,
    'stockReleasedAt', p_order.stock_released_at,
    'itemsSubtotal', p_order.items_subtotal,
    'shippingFeeStatus', p_order.shipping_fee_status,
    'shippingFee', CASE WHEN p_order.shipping_fee_status = 'confirmed' THEN p_order.shipping_fee ELSE NULL END,
    'discountStatus', p_order.discount_status,
    'discountAmount', CASE WHEN p_order.discount_status = 'applied' THEN p_order.discount_amount ELSE NULL END,
    'orderTotal', p_order.order_total,
    'currency', p_order.currency,
    'exceptionCode', p_order.exception_code,
    'canCancel', can_cancel,
    'actions', CASE WHEN can_cancel THEN jsonb_build_array('cancel') ELSE '[]'::jsonb END,
    'notice', '付款與物流尚未串接。訂單成立不等於已付款、已出貨或已成交。',
    'recipient', CASE WHEN p_include_recipient THEN jsonb_build_object(
      'name', p_order.recipient_name,
      'phone', p_order.recipient_phone,
      'address', p_order.recipient_address
    ) ELSE NULL END,
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'orderItemId', oi.id,
        'productId', oi.product_id,
        'name', oi.product_name,
        'variant', oi.variant,
        'variantLabel', oi.variant_label,
        'qty', oi.quantity,
        'unitPrice', oi.unit_price,
        'lineTotal', oi.line_total,
        'refundedQty', oi.refunded_qty,
        'image', oi.image_url
      ) ORDER BY oi.created_at), '[]'::jsonb)
      FROM public.order_items oi
      WHERE oi.order_id = p_order.id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_buyer_orders(p_bucket text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  bucket text := coalesce(nullif(btrim(p_bucket), ''), 'all');
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(item.payload ORDER BY item.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT o.created_at, public.commerce_order_json(o, false) AS payload
      FROM public.orders o
      WHERE o.buyer_id = uid
        AND (
          bucket = 'all'
          OR public.order_buyer_bucket(public.order_buyer_stage(
            o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at
          )) = bucket
          OR public.order_buyer_stage(
            o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at
          ) = bucket
        )
      ORDER BY o.created_at DESC
      LIMIT 100
    ) item
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_seller_orders(p_bucket text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  bucket text := coalesce(nullif(btrim(p_bucket), ''), 'all');
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(item.payload ORDER BY item.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT o.created_at, public.commerce_order_json(o, false) AS payload
      FROM public.orders o
      WHERE o.seller_id = uid
        AND (
          bucket = 'all'
          OR (
            bucket = 'pending'
            AND o.lifecycle_status = 'open'
            AND o.completed_at IS NULL
            AND o.cancel_status = 'none'
            AND public.order_buyer_stage(
              o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at
            ) IN ('unpaid', 'confirming', 'to_ship')
          )
          OR public.order_buyer_bucket(public.order_buyer_stage(
            o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at
          )) = bucket
          OR public.order_buyer_stage(
            o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at
          ) = bucket
        )
      ORDER BY o.created_at DESC
      LIMIT 100
    ) item
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_order_detail(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.orders%ROWTYPE;
  allowed boolean := false;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT * INTO row FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這張訂單';
  END IF;
  allowed := row.buyer_id = uid OR row.seller_id = uid OR public.is_platform_admin();
  IF NOT allowed THEN
    RAISE EXCEPTION '找不到這張訂單';
  END IF;
  RETURN public.commerce_order_json(row, true) || jsonb_build_object(
    'events', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'eventType', e.event_type,
        'actorRole', e.actor_role,
        'reasonCode', e.reason_code,
        'fromLifecycle', e.from_lifecycle,
        'toLifecycle', e.to_lifecycle,
        'fromPayment', e.from_payment,
        'toPayment', e.to_payment,
        'fromFulfillment', e.from_fulfillment,
        'toFulfillment', e.to_fulfillment,
        'fromStockHold', e.from_stock_hold,
        'toStockHold', e.to_stock_hold,
        'createdAt', e.created_at
      ) ORDER BY e.created_at), '[]'::jsonb)
      FROM public.order_events e
      WHERE e.order_id = row.id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_operations_report(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  placed_amount bigint := 0;
  placed_count integer := 0;
  confirmed_amount bigint := 0;
  confirmed_count integer := 0;
  completed_amount bigint := 0;
  completed_count integer := 0;
  pending_count integer := 0;
  cancelled_count integer := 0;
  cancelled_amount bigint := 0;
  refund_count integer := 0;
  refund_amount bigint := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION '請提供有效的日期區間';
  END IF;

  SELECT coalesce(sum(o.order_total), 0), count(*)
    INTO placed_amount, placed_count
  FROM public.orders o
  WHERE o.seller_id = uid AND o.created_at >= p_from AND o.created_at < p_to;

  SELECT coalesce(sum(o.order_total), 0), count(*)
    INTO confirmed_amount, confirmed_count
  FROM public.orders o
  WHERE o.seller_id = uid
    AND o.payment_status = 'confirmed'
    AND o.payment_confirmation_source = 'gateway_verified'
    AND o.payment_integration = 'gateway_verified'
    AND o.payment_confirmed_at >= p_from
    AND o.payment_confirmed_at < p_to;

  SELECT coalesce(sum((oi.quantity - oi.refunded_qty) * oi.unit_price), 0),
         count(DISTINCT o.id) FILTER (WHERE oi.quantity > oi.refunded_qty)
    INTO completed_amount, completed_count
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  WHERE o.seller_id = uid
    AND o.completed_at IS NOT NULL
    AND o.fulfillment_status = 'completed'
    AND o.completed_at >= p_from
    AND o.completed_at < p_to;

  SELECT count(*) INTO pending_count
  FROM public.orders o
  WHERE o.seller_id = uid
    AND o.lifecycle_status = 'open'
    AND o.completed_at IS NULL
    AND o.cancel_status = 'none'
    AND o.refund_status = 'none';

  SELECT count(*), coalesce(sum(o.order_total), 0)
    INTO cancelled_count, cancelled_amount
  FROM public.orders o
  WHERE o.seller_id = uid
    AND o.cancel_status = 'cancelled'
    AND o.cancelled_at >= p_from
    AND o.cancelled_at < p_to;

  SELECT count(*), coalesce(sum(r.amount), 0)
    INTO refund_count, refund_amount
  FROM public.order_refunds r
  JOIN public.orders o ON o.id = r.order_id
  WHERE o.seller_id = uid
    AND r.trusted IS TRUE
    AND r.status = 'refunded'
    AND r.source IN ('gateway_verified', 'admin_verified')
    AND r.created_at >= p_from
    AND r.created_at < p_to;

  RETURN jsonb_build_object(
    'rangeFrom', p_from,
    'rangeTo', p_to,
    'currency', 'TWD',
    'placedAmount', placed_amount,
    'placedCount', placed_count,
    'placedAmountNote', '此區間成立訂單的商品金額，不含未定價運費，不代表已收款',
    'confirmedCollectedAmount', confirmed_amount,
    'confirmedCollectedCount', confirmed_count,
    'confirmedCollectedTrust', 'none',
    'confirmedCollectedNote', '只統計第三方金流已驗證的收款。程序尚未啟用，因此為 0',
    'completedAmount', completed_amount,
    'completedCount', completed_count,
    'completedTrust', 'none',
    'completedNote', '只統計已完成且未全數退貨的明細。完成程序尚未啟用，因此為 0',
    'pendingCount', pending_count,
    'pendingIgnoresRange', true,
    'pendingNote', '目前仍待處理的訂單數，不受上面的日期區間影響',
    'cancelledCount', cancelled_count,
    'cancelledAmount', cancelled_amount,
    'refundCount', refund_count,
    'refundAmount', refund_amount,
    'refundTrust', 'none',
    'refundNote', '只統計可信退款紀錄。目前沒有寫入入口，因此為 0',
    'platformFeeIncluded', false,
    'shippingIncluded', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_orders_for_metric(
  p_metric text,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  metric text := btrim(coalesce(p_metric, ''));
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF metric <> 'pending' AND (p_from IS NULL OR p_to IS NULL OR p_to <= p_from) THEN
    RAISE EXCEPTION '請提供有效的日期區間';
  END IF;
  IF metric NOT IN ('placed', 'confirmed_collected', 'completed', 'pending', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION '找不到這個報表分類';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(item.payload ORDER BY item.sort_at DESC), '[]'::jsonb)
    FROM (
      SELECT DISTINCT o.created_at AS sort_at, jsonb_build_object(
        'orderId', o.id,
        'displayNo', o.display_no,
        'createdAt', o.created_at,
        'orderTotal', o.order_total,
        'buyerStage', public.order_buyer_stage(o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at),
        'buyerStageLabel', public.order_stage_label(public.order_buyer_stage(
          o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at
        ))
      ) AS payload
      FROM public.orders o
      LEFT JOIN public.order_items oi ON oi.order_id = o.id
      LEFT JOIN public.order_refunds r ON r.order_id = o.id
      WHERE o.seller_id = uid
        AND (
          (metric = 'placed' AND o.created_at >= p_from AND o.created_at < p_to)
          OR (
            metric = 'confirmed_collected'
            AND o.payment_status = 'confirmed'
            AND o.payment_confirmation_source = 'gateway_verified'
            AND o.payment_integration = 'gateway_verified'
            AND o.payment_confirmed_at >= p_from AND o.payment_confirmed_at < p_to
          )
          OR (
            metric = 'completed'
            AND o.completed_at IS NOT NULL
            AND o.fulfillment_status = 'completed'
            AND o.completed_at >= p_from AND o.completed_at < p_to
            AND oi.quantity > oi.refunded_qty
          )
          OR (
            metric = 'pending'
            AND o.lifecycle_status = 'open'
            AND o.completed_at IS NULL
            AND o.cancel_status = 'none'
            AND o.refund_status = 'none'
          )
          OR (
            metric = 'cancelled'
            AND o.cancel_status = 'cancelled'
            AND o.cancelled_at >= p_from AND o.cancelled_at < p_to
          )
          OR (
            metric = 'refunded'
            AND r.trusted IS TRUE
            AND r.status = 'refunded'
            AND r.source IN ('gateway_verified', 'admin_verified')
            AND r.created_at >= p_from AND r.created_at < p_to
          )
        )
      ORDER BY o.created_at DESC
      LIMIT 100
    ) item
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_order_notifications(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id,
      'kind', n.kind,
      'title', n.title,
      'body', n.body,
      'orderId', n.order_id,
      'displayNo', o.display_no,
      'readAt', n.read_at,
      'createdAt', n.created_at
    ) ORDER BY n.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT * FROM public.order_notifications
      WHERE user_id = uid
      ORDER BY created_at DESC
      LIMIT lim
    ) n
    JOIN public.orders o ON o.id = n.order_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_order_notification_read(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  PERFORM public.commerce_allow_write();
  UPDATE public.order_notifications
  SET read_at = now()
  WHERE id = p_id AND user_id = uid AND read_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_checkout_options(p_seller_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  payments jsonb;
  ships jsonb;
BEGIN
  IF p_seller_user_id IS NULL OR NOT public.seller_accepts_orders(p_seller_user_id) THEN
    RETURN jsonb_build_object(
      'available', false,
      'storeName', NULL,
      'payments', '[]'::jsonb,
      'fulfillments', '[]'::jsonb,
      'shippingFeeStatus', 'unpriced',
      'paymentIntegration', 'not_connected'
    );
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'label', c.label_zh) ORDER BY c.sort_order), '[]'::jsonb)
    INTO payments
  FROM public.payment_method_catalog c
  JOIN public.seller_payment_methods m
    ON m.method_code = c.code AND m.seller_user_id = p_seller_user_id AND m.enabled;
  SELECT coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'label', c.label_zh) ORDER BY c.sort_order), '[]'::jsonb)
    INTO ships
  FROM public.fulfillment_method_catalog c
  JOIN public.seller_fulfillment_methods m
    ON m.method_code = c.code AND m.seller_user_id = p_seller_user_id AND m.enabled;
  RETURN jsonb_build_object(
    'available', true,
    'sellerId', p_seller_user_id,
    'storeName', public.seller_store_name(p_seller_user_id),
    'payments', payments,
    'fulfillments', ships,
    'shippingFeeStatus', 'unpriced',
    'paymentIntegration', 'not_connected',
    'notice', '商品款由賣家各自收款，平台不代收、不撥款。金流尚未串接。'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_checkout_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  payments jsonb;
  ships jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.seller_accepts_orders(uid) THEN
    RAISE EXCEPTION '通過賣家認證後才能設定收款與配送方式';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'code', c.code,
    'label', c.label_zh,
    'enabled', coalesce(m.enabled, false)
  ) ORDER BY c.sort_order), '[]'::jsonb)
    INTO payments
  FROM public.payment_method_catalog c
  LEFT JOIN public.seller_payment_methods m
    ON m.method_code = c.code AND m.seller_user_id = uid;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'code', c.code,
    'label', c.label_zh,
    'enabled', coalesce(m.enabled, false)
  ) ORDER BY c.sort_order), '[]'::jsonb)
    INTO ships
  FROM public.fulfillment_method_catalog c
  LEFT JOIN public.seller_fulfillment_methods m
    ON m.method_code = c.code AND m.seller_user_id = uid;
  RETURN jsonb_build_object(
    'payments', payments,
    'fulfillments', ships,
    'paymentIntegration', 'not_connected',
    'notice', '開啟只代表買家可選擇這個方式。不會自動完成收款、出貨或成交。'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_seller_payment_method(p_code text, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.seller_accepts_orders(uid) THEN
    RAISE EXCEPTION '目前不能設定收款方式';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payment_method_catalog WHERE code = p_code) THEN
    RAISE EXCEPTION '沒有這個付款方式';
  END IF;
  PERFORM public.commerce_allow_write();
  INSERT INTO public.seller_payment_methods (seller_user_id, method_code, enabled, updated_at)
  VALUES (uid, p_code, coalesce(p_enabled, false), now())
  ON CONFLICT (seller_user_id, method_code)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
  RETURN public.get_my_checkout_settings();
END;
$$;

CREATE OR REPLACE FUNCTION public.set_seller_fulfillment_method(p_code text, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.seller_accepts_orders(uid) THEN
    RAISE EXCEPTION '目前不能設定配送方式';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fulfillment_method_catalog WHERE code = p_code) THEN
    RAISE EXCEPTION '沒有這個配送方式';
  END IF;
  PERFORM public.commerce_allow_write();
  INSERT INTO public.seller_fulfillment_methods (seller_user_id, method_code, enabled, updated_at)
  VALUES (uid, p_code, coalesce(p_enabled, false), now())
  ON CONFLICT (seller_user_id, method_code)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
  RETURN public.get_my_checkout_settings();
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_commerce_limits(
  p_inventory_hold_minutes integer,
  p_max_open_holds_per_buyer integer,
  p_max_reserved_units_per_buyer integer,
  p_max_qty_per_line integer,
  p_max_lines_per_checkout integer,
  p_max_checkouts_per_hour integer,
  p_max_buyer_cancels_per_hour integer,
  p_max_seller_cancels_per_hour integer,
  p_max_same_product_orders_per_hour integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF public.is_platform_admin() IS NOT TRUE THEN
    RAISE EXCEPTION '沒有權限';
  END IF;
  UPDATE public.commerce_settings
  SET inventory_hold_minutes = p_inventory_hold_minutes,
      max_open_holds_per_buyer = p_max_open_holds_per_buyer,
      max_reserved_units_per_buyer = p_max_reserved_units_per_buyer,
      max_qty_per_line = p_max_qty_per_line,
      max_lines_per_checkout = p_max_lines_per_checkout,
      max_checkouts_per_hour = p_max_checkouts_per_hour,
      max_buyer_cancels_per_hour = p_max_buyer_cancels_per_hour,
      max_seller_cancels_per_hour = p_max_seller_cancels_per_hour,
      max_same_product_orders_per_hour = p_max_same_product_orders_per_hour,
      updated_at = now()
  WHERE id = true;
  RETURN (
    SELECT jsonb_build_object(
      'inventoryHoldMinutes', inventory_hold_minutes,
      'maxOpenHoldsPerBuyer', max_open_holds_per_buyer,
      'maxReservedUnitsPerBuyer', max_reserved_units_per_buyer,
      'maxQtyPerLine', max_qty_per_line,
      'maxLinesPerCheckout', max_lines_per_checkout,
      'maxCheckoutsPerHour', max_checkouts_per_hour,
      'maxBuyerCancelsPerHour', max_buyer_cancels_per_hour,
      'maxSellerCancelsPerHour', max_seller_cancels_per_hour,
      'maxSameProductOrdersPerHour', max_same_product_orders_per_hour
    )
    FROM public.commerce_settings WHERE id = true
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS 與執行權限
-- ---------------------------------------------------------------------------

ALTER TABLE public.commerce_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_method_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fulfillment_method_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_fulfillment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_method_catalog_read ON public.payment_method_catalog;
CREATE POLICY payment_method_catalog_read
  ON public.payment_method_catalog FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS fulfillment_method_catalog_read ON public.fulfillment_method_catalog;
CREATE POLICY fulfillment_method_catalog_read
  ON public.fulfillment_method_catalog FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS seller_payment_methods_owner ON public.seller_payment_methods;
CREATE POLICY seller_payment_methods_owner
  ON public.seller_payment_methods FOR SELECT TO authenticated
  USING (seller_user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS seller_fulfillment_methods_owner ON public.seller_fulfillment_methods;
CREATE POLICY seller_fulfillment_methods_owner
  ON public.seller_fulfillment_methods FOR SELECT TO authenticated
  USING (seller_user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS cart_items_owner ON public.cart_items;
CREATE POLICY cart_items_owner
  ON public.cart_items FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS checkout_batches_owner ON public.checkout_batches;
CREATE POLICY checkout_batches_owner
  ON public.checkout_batches FOR SELECT TO authenticated
  USING (buyer_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS orders_participant ON public.orders;
CREATE POLICY orders_participant
  ON public.orders FOR SELECT TO authenticated
  USING (buyer_id = auth.uid() OR seller_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS order_items_participant ON public.order_items;
CREATE POLICY order_items_participant
  ON public.order_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid() OR public.is_platform_admin())
    )
  );

DROP POLICY IF EXISTS order_events_participant ON public.order_events;
CREATE POLICY order_events_participant
  ON public.order_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid() OR public.is_platform_admin())
    )
  );

DROP POLICY IF EXISTS order_notifications_owner ON public.order_notifications;
CREATE POLICY order_notifications_owner
  ON public.order_notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS order_refunds_participant ON public.order_refunds;
CREATE POLICY order_refunds_participant
  ON public.order_refunds FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid() OR public.is_platform_admin())
    )
  );

REVOKE ALL ON public.commerce_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.payment_method_catalog FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fulfillment_method_catalog FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_payment_methods FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_fulfillment_methods FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cart_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.checkout_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.order_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.inventory_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.order_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.order_notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.order_refunds FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.order_display_no_seq FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.payment_method_catalog TO anon, authenticated;
GRANT SELECT ON public.fulfillment_method_catalog TO anon, authenticated;
GRANT SELECT ON public.seller_payment_methods TO authenticated;
GRANT SELECT ON public.seller_fulfillment_methods TO authenticated;
GRANT SELECT, DELETE ON public.cart_items TO authenticated;
GRANT SELECT ON public.checkout_batches TO authenticated;
GRANT SELECT ON public.orders TO authenticated;
GRANT SELECT ON public.order_items TO authenticated;
GRANT SELECT ON public.order_events TO authenticated;
GRANT SELECT ON public.order_notifications TO authenticated;
GRANT SELECT ON public.order_refunds TO authenticated;

REVOKE ALL ON FUNCTION public.commerce_parse_int(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_variant_fingerprint(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_buyer_stage(text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_stage_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_buyer_bucket(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_store_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_accepts_orders(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_active_held(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_allow_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_settings_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_buyer_lock(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_guard_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_block_untrusted_settlement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_guard_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cart_items_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_items_match_order() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_build_plan(uuid, jsonb, boolean, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_normalize_for_hash(jsonb, jsonb, jsonb, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_record_event(uuid, text, uuid, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_notify(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_cancel_order(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commerce_order_json(public.orders, boolean) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.add_cart_item(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_cart_item_qty(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_cart_item(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_cart() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quote_checkout(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.place_checkout(uuid, jsonb, jsonb, jsonb, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.buyer_cancel_order(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_cancel_unpaid_order(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_expired_inventory_holds() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_buyer_orders(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_seller_orders(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_order_detail(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_operations_report(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seller_orders_for_metric(text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_order_notifications(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_order_notification_read(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_checkout_options(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_checkout_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_seller_payment_method(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_seller_fulfillment_method(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_commerce_limits(integer, integer, integer, integer, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_cart_item(uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_cart_item_qty(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_cart_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_cart() TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_checkout(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_checkout(uuid, jsonb, jsonb, jsonb, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buyer_cancel_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_cancel_unpaid_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_expired_inventory_holds() TO service_role;
GRANT EXECUTE ON FUNCTION public.list_my_buyer_orders(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_seller_orders(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_operations_report(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_orders_for_metric(text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_order_notifications(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_checkout_options(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_checkout_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_seller_payment_method(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_seller_fulfillment_method(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_commerce_limits(integer, integer, integer, integer, integer, integer, integer, integer, integer) TO authenticated;

COMMIT;
