-- =============================================================================
-- 高價商品：已退回後的明確重新送審
-- 請人工審查後在 Supabase SQL Editor 整段執行一次。本檔不執行。
-- 不 UPDATE / DELETE 既有商品，不關閉 RLS，不改已核准商品的價格、庫存、上下架門檻。
-- 一般賣家 UPDATE 仍不能改 review_hold、review_approved、reviewed_at。
-- 只有 resubmit_high_price_product() 能把「已退回」清回 pending，
-- 而且必須是商品擁有者且 seller_applications.status = approved。
-- pending：review_hold 且 reviewed_at IS NULL
-- rejected：review_hold 且 reviewed_at IS NOT NULL 且 review_approved 不是 true
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.products_enforce_seller_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.products_enforce_seller_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.products_enforce_seller_write() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.resubmit_high_price_product(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.resubmit_high_price_product(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resubmit_high_price_product(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resubmit_high_price_product(uuid) TO authenticated;

COMMIT;
