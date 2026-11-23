-- =============================================================================
-- Docker hengjing-stage45-local 專用候選版本；只可在本機隔離庫、完成備份及核實連線後套用。
--
-- 本檔放在 supabase/manual，不屬於會被自動執行的 migrations。
-- 採單一交易並在任何 DDL 前預檢；預檢失敗時整段交易回滾。
--
-- 不連接、不修改正式 Supabase。不 reset。不寫入假商品。
-- 不改 seller_applications、is_platform_admin、is_approved_seller、guard_profile_sensitive。
-- 不把 checkout_enabled 改成 true。
--
-- 26 欄、約束、索引、RLS、7 項政策、2 個觸發器，以及本機尚缺的價格與審核函式，
-- 轉錄自 2026-10-27 附件 payfu_products_reference_20261027.zip：
--   products_columns_from_screenshots.csv
--   products_catalog_definitions.csv
-- 附件沒有原始截圖。column_default 為 NULL 的欄位不寫 DEFAULT。
-- 目錄裡的 is_approved_seller() 原文不重建；本機既有函式的 md5 須維持不變。
-- jsonb_max_price、product_is_public、preserve_product_sold 與目錄匯出一致，沿用下一段。
-- 目錄匯出不含 ACL；本機最小授權置於尾段，不視為正式庫 ACL 原文。
-- =============================================================================

BEGIN;

-- 保護既有資料：若本機環境與 2026-10-27 基準不一致，立即回滾。
-- 仍須由操作者在 psql 連線外確認 host=127.0.0.1 port=54322、容器名稱、備份可用。
DO $local_preflight$
DECLARE
  v_rel text;
  v_fn text;
BEGIN
  -- 這些物件在正式 Supabase 已存在；禁止在既有商品庫執行。
  IF to_regclass('public.products') IS NOT NULL THEN
    RAISE EXCEPTION '停止：public.products 已存在。不得覆蓋現有商品表（確認是否誤連正式庫）';
  END IF;
  IF to_regclass('public.notification_outbox') IS NOT NULL THEN
    RAISE EXCEPTION '停止：notification_outbox 已存在，需先人工確認';
  END IF;
  FOREACH v_rel IN ARRAY ARRAY['profiles', 'seller_applications', 'member_point_entries', 'member_perk_holds', 'member_merge_shop_events'] LOOP
    IF to_regclass('public.' || v_rel) IS NULL THEN
      RAISE EXCEPTION '停止：隔離庫缺少既有基準資料表 %', v_rel;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.seller_applications'::regclass
      AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION '停止：seller_applications 未強制啟用 RLS';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.is_platform_admin()', 'public.is_approved_seller()',
    'public.guard_profile_sensitive()'
  ] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '停止：缺少既有安全函式 %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.jsonb_max_price(jsonb)', 'public.product_is_public(jsonb)',
    'public.preserve_product_sold()', 'public.product_top_price(numeric,jsonb,jsonb)',
    'public.product_requires_price_approval(numeric,jsonb,jsonb)',
    'public.products_enforce_seller_write()',
    'public.resubmit_high_price_product(uuid)',
    'public.review_high_price_product(uuid,boolean)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      RAISE EXCEPTION '停止：新函式已存在 %，不得 CREATE OR REPLACE', v_fn;
    END IF;
  END LOOP;
END
$local_preflight$;

-- -----------------------------------------------------------------------------
-- 僅在本機身分及預檢全部通過後執行。
-- 這一段函式與 notification_outbox 的來源只限既有 migration 裡可以整段抽出、
-- 而且本機目前不存在的物件。
-- 後段 public.products 改以 2026-10-27 正式庫目錄匯出為準。
-- -----------------------------------------------------------------------------

-- 來源：supabase/migrations/20261020120000_buyer_store_features.sql
-- jsonb_max_price：同檔第 734–774 行。product_is_public 會呼叫它。
-- 本機目前沒有這兩個函式，所以不是覆蓋。
-- 不同檔的 is_platform_admin()、guard_profile_sensitive() 不在這裡重建。

CREATE OR REPLACE FUNCTION public.jsonb_max_price(j jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  n numeric := 0;
  base numeric := 0;
  v text;
BEGIN
  IF j IS NULL THEN
    RETURN 0;
  END IF;
  BEGIN
    base := coalesce((j->>'price')::numeric, 0);
  EXCEPTION WHEN others THEN
    base := 0;
  END;
  n := base;
  IF jsonb_typeof(j->'option_price') = 'object' THEN
    FOR v IN SELECT value FROM jsonb_each_text(j->'option_price') LOOP
      BEGIN
        n := greatest(n, v::numeric);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END LOOP;
  END IF;
  IF jsonb_typeof(j->'combo_price') = 'object' THEN
    FOR v IN SELECT value FROM jsonb_each_text(j->'combo_price') LOOP
      BEGIN
        n := greatest(n, v::numeric);
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END LOOP;
  END IF;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.product_is_public(j jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF j IS NULL THEN
    RETURN false;
  END IF;
  IF coalesce(j->>'active', 'true') IN ('false', 'f', '0') THEN
    RETURN false;
  END IF;
  IF coalesce(j->>'draft', 'false') IN ('true', 't', '1') THEN
    RETURN false;
  END IF;
  IF coalesce(j->>'flagged', 'false') IN ('true', 't', '1') THEN
    RETURN false;
  END IF;
  IF coalesce(j->>'review_hold', 'false') IN ('true', 't', '1') THEN
    RETURN false;
  END IF;
  IF public.jsonb_max_price(j) > 50000
     AND coalesce(j->>'review_approved', 'false') NOT IN ('true', 't', '1') THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

-- 來源：同檔第 1734、1736、1747 行。只撤這三個新函式，不撤其他會員函式。
REVOKE ALL ON FUNCTION public.jsonb_max_price(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.product_is_public(jsonb) FROM PUBLIC, anon, authenticated;

-- 來源：同檔第 1378–1394 行。
-- 正式庫觸發器名稱 products_preserve_sold 與這份 migration 相同。
-- 2026-10-27 目錄匯出的 preserve_product_sold() 本文與此函式一致。
-- 觸發器在後段、public.products 建立之後才建立。

CREATE OR REPLACE FUNCTION public.preserve_product_sold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.sold := 0;
  ELSE
    NEW.sold := OLD.sold;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.preserve_product_sold() FROM PUBLIC, anon, authenticated;

-- 來源：supabase/migrations/20261020143000_chat_and_security_fixes.sql 第 258–266、270、295 行。
-- 只建 notification_outbox。不執行該檔其餘的聊天表、個人資料授權或 guard_profile_sensitive()。
-- 結帳 migration 會以 SECURITY DEFINER 寫入 event_key、kind、user_id、payload，
-- 並使用 ON CONFLICT (event_key)。event_key 的 UNIQUE 約束已包含在這張表。

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  user_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_outbox FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- public.products。來源：products_columns_from_screenshots.csv 的 26 欄，
-- 以及 products_catalog_definitions.csv 的約束、索引、RLS、政策、觸發器、函式。
-- 不重建 is_approved_seller()、is_platform_admin()、guard_profile_sensitive()。
-- 政策與 trg_products_enforce_seller_write 會呼叫本機既有的前兩個函式。
-- 本機 API 必要 ACL 明確列於檔案尾段。
-- 參數型別 products 依目錄原文，建立時須能解析到 public.products。
-- -----------------------------------------------------------------------------

-- 價格函式不依賴商品表，但政策與審核觸發器會呼叫它們。
-- 來源：06_FUNCTIONS product_top_price(numeric,jsonb,jsonb)
--        product_requires_price_approval(numeric,jsonb,jsonb)

CREATE OR REPLACE FUNCTION public.product_top_price(base_price numeric, option_price jsonb, combo_price jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT GREATEST(
    COALESCE(base_price, 0),
    COALESCE((
      SELECT pg_catalog.max(n.value::numeric)
      FROM pg_catalog.jsonb_each_text(
        CASE
          WHEN pg_catalog.jsonb_typeof(option_price) = 'object' THEN option_price
          ELSE '{}'::jsonb
        END
      ) AS n(key, value)
      WHERE n.value ~ '^[0-9]+(\.[0-9]+)?$'
    ), 0),
    COALESCE((
      SELECT pg_catalog.max(n.value::numeric)
      FROM pg_catalog.jsonb_each_text(
        CASE
          WHEN pg_catalog.jsonb_typeof(combo_price) = 'object' THEN combo_price
          ELSE '{}'::jsonb
        END
      ) AS n(key, value)
      WHERE n.value ~ '^[0-9]+(\.[0-9]+)?$'
    ), 0)
  );
$function$;

CREATE OR REPLACE FUNCTION public.product_requires_price_approval(base_price numeric, option_price jsonb, combo_price jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT public.product_top_price(base_price, option_price, combo_price) > 50000;
$function$;

-- 來源：products_columns_from_screenshots.csv。
-- column_default 為 NULL 的欄位沒有 DEFAULT 子句。
-- products_pkey 由主鍵建立，對應目錄裡的同名約束與唯一索引。

CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seller_id uuid,
  name text NOT NULL,
  category text,
  sub_category text,
  price numeric NOT NULL DEFAULT 0,
  image text,
  variants jsonb DEFAULT '[]'::jsonb,
  stock integer NOT NULL DEFAULT 0,
  sold integer NOT NULL DEFAULT 0,
  specs jsonb DEFAULT '{}'::jsonb,
  description text,
  reviews jsonb DEFAULT '[]'::jsonb,
  active boolean DEFAULT true,
  flagged boolean DEFAULT false,
  flag_reason text,
  review_hold boolean DEFAULT false,
  review_approved boolean DEFAULT false,
  option_stock jsonb DEFAULT '{}'::jsonb,
  option_price jsonb DEFAULT '{}'::jsonb,
  combo_stock jsonb DEFAULT '{}'::jsonb,
  combo_price jsonb DEFAULT '{}'::jsonb,
  draft boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT products_pkey PRIMARY KEY (id)
);

-- 來源：01_CONSTRAINTS products_seller_id_fkey。參照 auth.users(id)。

ALTER TABLE public.products
  ADD CONSTRAINT products_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES auth.users(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- 來源：02_INDEXES products_seller_id_idx。

CREATE INDEX products_seller_id_idx ON public.products USING btree (seller_id);

-- 來源：06_FUNCTIONS product_review_decision_only(products,products)
-- 複合型別 products 須在資料表建立之後才存在。

CREATE OR REPLACE FUNCTION public.product_review_decision_only(old_row products, new_row products)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT (
    pg_catalog.to_jsonb(old_row)
      - 'review_hold' - 'review_approved' - 'reviewed_at'
      - 'updated_at' - 'created_at' - 'modified_at' - 'inserted_at'
  ) = (
    pg_catalog.to_jsonb(new_row)
      - 'review_hold' - 'review_approved' - 'reviewed_at'
      - 'updated_at' - 'created_at' - 'modified_at' - 'inserted_at'
  );
$function$;

-- 來源：06_FUNCTIONS products_enforce_seller_write()
-- 由 trg_products_enforce_seller_write 呼叫。

CREATE OR REPLACE FUNCTION public.products_enforce_seller_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_top numeric;
  v_old_top numeric;
  v_new_high boolean;
  v_old_high boolean;
  v_material boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- 交易內旗標只由 resubmit_high_price_product() 設定。前端無法透過 PostgREST 設定。
  -- 即使旗標存在，仍要同時通過擁有權、已認證賣家、目前為已退回，且這次 UPDATE 不能改商品內容。
  IF TG_OP = 'UPDATE'
     AND pg_catalog.current_setting('hengjing.price_review_resubmit', true) IS NOT DISTINCT FROM OLD.id::text
  THEN
    IF NOT public.is_approved_seller() THEN
      RAISE EXCEPTION 'not an approved seller';
    END IF;
    IF OLD.seller_id IS NULL OR OLD.seller_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'cannot modify this product';
    END IF;
    IF OLD.review_hold IS NOT TRUE OR OLD.review_approved IS TRUE OR OLD.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'product is not rejected';
    END IF;
    IF NOT public.product_review_decision_only(OLD, NEW) THEN
      RAISE EXCEPTION 'resubmit cannot change product content';
    END IF;

    NEW.id := OLD.id;
    NEW.seller_id := OLD.seller_id;
    NEW.sold := OLD.sold;
    NEW.flagged := OLD.flagged;
    NEW.flag_reason := OLD.flag_reason;
    NEW.review_hold := true;
    NEW.review_approved := false;
    NEW.reviewed_at := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND public.is_platform_admin() AND public.product_review_decision_only(OLD, NEW) THEN
    v_old_high := public.product_requires_price_approval(
      OLD.price::numeric,
      OLD.option_price::jsonb,
      OLD.combo_price::jsonb
    );
    IF NOT v_old_high AND OLD.review_hold IS NOT TRUE THEN
      RAISE EXCEPTION 'product is not in price review';
    END IF;
    IF NEW.review_hold IS NULL OR NEW.review_approved IS NULL OR NEW.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'review status cannot be null';
    END IF;

    NEW.id := OLD.id;
    NEW.seller_id := OLD.seller_id;
    NEW.sold := OLD.sold;
    NEW.flagged := OLD.flagged;
    NEW.flag_reason := OLD.flag_reason;
    RETURN NEW;
  END IF;

  IF NOT public.is_approved_seller() THEN
    RAISE EXCEPTION 'not an approved seller';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.seller_id := auth.uid();
    NEW.sold := 0;
    NEW.flagged := false;
    NEW.flag_reason := NULL;
    NEW.review_approved := false;
    NEW.reviewed_at := NULL;
    NEW.review_hold := public.product_requires_price_approval(
      NEW.price::numeric,
      NEW.option_price::jsonb,
      NEW.combo_price::jsonb
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.seller_id IS NULL OR OLD.seller_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'cannot modify this product';
    END IF;

    NEW.id := OLD.id;
    NEW.seller_id := OLD.seller_id;
    NEW.sold := OLD.sold;
    NEW.flagged := OLD.flagged;
    NEW.flag_reason := OLD.flag_reason;

    v_top := public.product_top_price(
      NEW.price::numeric,
      NEW.option_price::jsonb,
      NEW.combo_price::jsonb
    );
    v_old_top := public.product_top_price(
      OLD.price::numeric,
      OLD.option_price::jsonb,
      OLD.combo_price::jsonb
    );
    v_new_high := public.product_requires_price_approval(
      NEW.price::numeric,
      NEW.option_price::jsonb,
      NEW.combo_price::jsonb
    );
    v_old_high := public.product_requires_price_approval(
      OLD.price::numeric,
      OLD.option_price::jsonb,
      OLD.combo_price::jsonb
    );
    v_material :=
      NEW.name IS DISTINCT FROM OLD.name
      OR NEW.image IS DISTINCT FROM OLD.image
      OR NEW.category IS DISTINCT FROM OLD.category
      OR NEW.sub_category IS DISTINCT FROM OLD.sub_category
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.price IS DISTINCT FROM OLD.price
      OR NEW.option_price IS DISTINCT FROM OLD.option_price
      OR NEW.combo_price IS DISTINCT FROM OLD.combo_price
      OR NEW.specs IS DISTINCT FROM OLD.specs
      OR NEW.variants IS DISTINCT FROM OLD.variants;

    -- 賣家不能自行改審核結果或 reviewed_at。既有鎖定不會因降價或一般編輯解除。
    -- 已核准的高價商品若改了名稱、圖片、類別、描述、售價或規格，回到 pending。
    -- 只改庫存（stock / option_stock / combo_stock）不會重新送審。
    -- 已退回商品的一般編輯保留 reviewed_at，不會變回 pending。
    IF OLD.review_hold IS TRUE THEN
      NEW.review_hold := true;
      NEW.review_approved := false;
      NEW.reviewed_at := OLD.reviewed_at;
    ELSIF OLD.review_approved IS TRUE AND v_old_high AND v_material THEN
      NEW.review_hold := true;
      NEW.review_approved := false;
      NEW.reviewed_at := NULL;
    ELSIF v_new_high AND (NOT v_old_high OR v_top > v_old_top) THEN
      NEW.review_hold := true;
      NEW.review_approved := false;
      NEW.reviewed_at := NULL;
    ELSE
      NEW.review_hold := OLD.review_hold;
      NEW.review_approved := OLD.review_approved;
      NEW.reviewed_at := OLD.reviewed_at;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

-- 來源：06_FUNCTIONS resubmit_high_price_product(uuid)

CREATE OR REPLACE FUNCTION public.resubmit_high_price_product(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row public.products;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '尚未登入';
  END IF;

  IF NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '只有已認證賣家可以重新送審';
  END IF;

  SELECT *
  INTO v_row
  FROM public.products
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到商品';
  END IF;

  IF v_row.seller_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION '不能重新送審別人的商品';
  END IF;

  IF v_row.review_hold IS TRUE
     AND v_row.review_approved IS NOT TRUE
     AND v_row.reviewed_at IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'already_pending',
      'product', pg_catalog.to_jsonb(v_row)
    );
  END IF;

  IF v_row.review_hold IS NOT TRUE
     OR v_row.review_approved IS TRUE
     OR v_row.reviewed_at IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'not_rejected',
      'product', pg_catalog.to_jsonb(v_row)
    );
  END IF;

  PERFORM pg_catalog.set_config('hengjing.price_review_resubmit', p_id::text, true);

  UPDATE public.products
  SET
    review_hold = true,
    review_approved = false,
    reviewed_at = NULL
  WHERE id = p_id
    AND seller_id = auth.uid()
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    PERFORM pg_catalog.set_config('hengjing.price_review_resubmit', '', true);
    RAISE EXCEPTION '重新送審寫入失敗';
  END IF;

  PERFORM pg_catalog.set_config('hengjing.price_review_resubmit', '', true);

  IF v_row.review_hold IS NOT TRUE
     OR v_row.review_approved IS TRUE
     OR v_row.reviewed_at IS NOT NULL THEN
    RAISE EXCEPTION '重新送審寫入失敗';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'status', 'updated',
    'product', pg_catalog.to_jsonb(v_row)
  );
END;
$function$;

-- 來源：06_FUNCTIONS review_high_price_product(uuid,boolean)
-- 簽章是 (uuid, boolean)。

CREATE OR REPLACE FUNCTION public.review_high_price_product(p_id uuid, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_row public.products;
  v_high boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '尚未登入';
  END IF;

  IF p_approve IS NULL THEN
    RAISE EXCEPTION '缺少審核決定';
  END IF;

  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION '只有管理員可以審核高價商品';
  END IF;

  SELECT *
  INTO v_row
  FROM public.products
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到商品';
  END IF;

  v_high := public.product_requires_price_approval(
    v_row.price::numeric,
    v_row.option_price::jsonb,
    v_row.combo_price::jsonb
  );

  IF NOT v_high AND v_row.review_hold IS NOT TRUE THEN
    RAISE EXCEPTION '此商品不在高價審核範圍';
  END IF;

  IF p_approve
     AND v_row.review_approved IS TRUE
     AND v_row.review_hold IS NOT TRUE
     AND v_row.reviewed_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'already_reviewed',
      'decision', 'approved',
      'product', pg_catalog.to_jsonb(v_row)
    );
  END IF;

  IF NOT p_approve
     AND v_row.review_approved IS NOT TRUE
     AND v_row.review_hold IS TRUE
     AND v_row.reviewed_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'already_reviewed',
      'decision', 'rejected',
      'product', pg_catalog.to_jsonb(v_row)
    );
  END IF;

  UPDATE public.products
  SET
    review_hold = NOT p_approve,
    review_approved = p_approve,
    reviewed_at = pg_catalog.statement_timestamp()
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION '審核寫入失敗';
  END IF;

  IF p_approve THEN
    IF v_row.review_approved IS NOT TRUE OR v_row.review_hold IS TRUE OR v_row.reviewed_at IS NULL THEN
      RAISE EXCEPTION '審核寫入失敗';
    END IF;
  ELSIF v_row.review_hold IS NOT TRUE OR v_row.review_approved IS TRUE OR v_row.reviewed_at IS NULL THEN
    RAISE EXCEPTION '審核寫入失敗';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'status', 'updated',
    'decision', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    'product', pg_catalog.to_jsonb(v_row)
  );
END;
$function$;

-- 來源：03_RLS_STATUS。enabled=true, forced=true。

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;

-- 來源：04_RLS_POLICIES。七項政策全文如下，不改條件。

CREATE POLICY products_delete_own ON public.products
  FOR DELETE
  TO authenticated
  USING ((seller_id = auth.uid()) AND is_approved_seller());

CREATE POLICY products_insert_own ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK ((seller_id = auth.uid()) AND is_approved_seller());

CREATE POLICY products_select_admin ON public.products
  FOR SELECT
  TO authenticated
  USING (is_platform_admin());

CREATE POLICY products_select_own ON public.products
  FOR SELECT
  TO authenticated
  USING ((seller_id = auth.uid()) AND is_approved_seller());

CREATE POLICY products_select_public ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (
    (active = true)
    AND (draft = false)
    AND (flagged = false)
    AND (review_hold = false)
    AND (
      (NOT product_requires_price_approval((price)::numeric, option_price, combo_price))
      OR (review_approved IS TRUE)
    )
  );

CREATE POLICY products_update_admin_review ON public.products
  FOR UPDATE
  TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY products_update_own ON public.products
  FOR UPDATE
  TO authenticated
  USING ((seller_id = auth.uid()) AND is_approved_seller())
  WITH CHECK ((seller_id = auth.uid()) AND is_approved_seller());

-- 來源：05_TRIGGERS。兩個都是 BEFORE INSERT OR UPDATE、FOR EACH ROW。

CREATE TRIGGER products_preserve_sold
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION preserve_product_sold();

CREATE TRIGGER trg_products_enforce_seller_write
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION products_enforce_seller_write();

-- 本機最小 ACL：RLS 決定可見及可寫的列；GRANT 只授權必要操作類型。
-- 沒有正式庫 ACL 原文，因此這些是本機驗收用設定，不代表正式 ACL。
REVOKE ALL ON TABLE public.products FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products TO authenticated;

-- 收斂 PostgreSQL 新建函式預設 PUBLIC EXECUTE；對外僅開放既有呼叫所需者。
REVOKE ALL ON FUNCTION public.product_top_price(numeric,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.product_requires_price_approval(numeric,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.product_review_decision_only(public.products,public.products) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.products_enforce_seller_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resubmit_high_price_product(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_high_price_product(uuid,boolean) FROM PUBLIC, anon, authenticated;

-- products_select_public 是 invoker RLS policy，價格判斷函式需要這兩角色可呼叫。
GRANT EXECUTE ON FUNCTION public.product_top_price(numeric,jsonb,jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_requires_price_approval(numeric,jsonb,jsonb) TO anon, authenticated;
-- trigger 所用其他函式只需由資料庫內部呼叫，不開放直接執行。
GRANT EXECUTE ON FUNCTION public.resubmit_high_price_product(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_high_price_product(uuid,boolean) TO authenticated;

COMMIT;

-- -----------------------------------------------------------------------------
-- 核准並真正套用之後，在同一個 Docker 容器執行的唯讀核對。
-- 套用前基準（2026-10-27，容器 supabase_db_hengjing-stage45-local）：
--   profiles 5、auth.users 11、seller_applications 1、
--   member_point_entries 8、member_perk_holds 1、member_merge_shop_events 407。
-- seller_applications 政策仍應是這 5 個：
--   seller_applications_insert_own、seller_applications_select_admin、
--   seller_applications_select_own、seller_applications_update_admin、
--   seller_applications_update_own_resubmit。
-- 觸發器仍應是 seller_applications_guard_update。
-- is_platform_admin() 與 is_approved_seller() 的 md5 應維持：
--   4808518d2a341a390d0163eea7659fbe、e6ff516d27dd492e7abfc08fbf702b71。
-- guard_profile_sensitive() 的 md5 應維持 1218ddd74a6860d48e7787f83a531b28。
-- -----------------------------------------------------------------------------
-- SELECT current_setting('data_directory') AS data_directory;
-- SELECT
--   (SELECT count(*) FROM public.profiles) AS profiles,
--   (SELECT count(*) FROM auth.users) AS users,
--   (SELECT count(*) FROM public.seller_applications) AS seller_applications,
--   (SELECT count(*) FROM public.member_point_entries) AS point_entries,
--   (SELECT count(*) FROM public.member_perk_holds) AS perk_holds,
--   (SELECT count(*) FROM public.member_merge_shop_events) AS merge_events;
-- SELECT count(*) AS product_columns
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'products';
-- SELECT polname FROM pg_policy
-- WHERE polrelid = 'public.products'::regclass
-- ORDER BY polname;
-- SELECT tgname FROM pg_trigger
-- WHERE tgrelid = 'public.products'::regclass AND NOT tgisinternal
-- ORDER BY tgname;
-- SELECT pg_get_function_identity_arguments(p.oid) AS args
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'review_high_price_product';
-- 另應存在：
--   product_top_price(numeric,jsonb,jsonb)
--   product_requires_price_approval(numeric,jsonb,jsonb)
--   product_review_decision_only(products,products)
--   products_enforce_seller_write()
--   resubmit_high_price_product(uuid)
-- is_approved_seller() 應仍是套用前的既有函式，本檔沒有重建它。
-- 約束應含 products_pkey、products_seller_id_fkey。
-- 索引應含 products_pkey、products_seller_id_idx。
-- relrowsecurity 與 relforcerowsecurity 都應為 true。
