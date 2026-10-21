-- 記錄賣家首次通過平台認證的時間，供「新店」30 天判斷使用。
-- 既有 seller_applications 沒有可信的首次認證時間：created_at 是送審時間，不是通過時間。
-- 本檔不回填、不更新既有列。舊賣家 certified_at 維持 NULL，前台因此不顯示「新店」。
-- 請人工審查後再執行。不要用這份 SQL 猜測任何既有賣家的開店日期。

BEGIN;

ALTER TABLE public.seller_applications
  ADD COLUMN IF NOT EXISTS certified_at timestamptz;

CREATE OR REPLACE FUNCTION public.stamp_seller_certified_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.certified_at IS NOT NULL THEN
      NEW.certified_at := OLD.certified_at;
      RETURN NEW;
    END IF;
    IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
      NEW.certified_at := now();
      RETURN NEW;
    END IF;
    NEW.certified_at := OLD.certified_at;
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' THEN
    NEW.certified_at := now();
  ELSE
    NEW.certified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seller_applications_stamp_certified_at ON public.seller_applications;
CREATE TRIGGER seller_applications_stamp_certified_at
  BEFORE INSERT OR UPDATE OF status, certified_at ON public.seller_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_seller_certified_at();

CREATE OR REPLACE FUNCTION public.get_my_storefront()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.storefronts%ROWTYPE;
  store_name text;
  certified_at timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT sa.store_name, sa.certified_at
  INTO store_name, certified_at
  FROM public.seller_applications sa
  WHERE sa.user_id = uid AND sa.status = 'approved'
  ORDER BY sa.created_at DESC
  LIMIT 1;
  SELECT * INTO row FROM public.storefronts WHERE seller_user_id = uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'separated', true,
      'published', false,
      'storeName', store_name,
      'bannerUrl', NULL,
      'logoUrl', NULL,
      'intro', '',
      'theme', 'default',
      'featuredIds', '[]'::jsonb,
      'categories', '[]'::jsonb,
      'publishedBannerUrl', NULL,
      'publishedLogoUrl', NULL,
      'certifiedAt', certified_at
    );
  END IF;
  RETURN jsonb_build_object(
    'separated', true,
    'published', row.published_at IS NOT NULL,
    'storeName', store_name,
    'sellerUserId', uid,
    'bannerUrl', COALESCE(row.draft_banner_url, row.banner_url),
    'logoUrl', COALESCE(row.draft_logo_url, row.logo_url),
    'intro', COALESCE(row.draft_intro, row.intro, ''),
    'theme', COALESCE(row.draft_theme, row.theme, 'default'),
    'featuredIds', to_jsonb(COALESCE(row.draft_featured_product_ids, row.featured_product_ids)),
    'categories', to_jsonb(COALESCE(row.draft_category_order, row.category_order)),
    'publishedBannerUrl', row.banner_url,
    'publishedLogoUrl', row.logo_url,
    'certifiedAt', certified_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.public_storefront(p_seller_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.storefronts%ROWTYPE;
  store_name text;
  certified_at timestamptz;
BEGIN
  SELECT sa.store_name, sa.certified_at
  INTO store_name, certified_at
  FROM public.seller_applications sa
  WHERE sa.user_id = p_seller_user_id AND sa.status = 'approved'
  ORDER BY sa.created_at DESC
  LIMIT 1;
  IF store_name IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO row FROM public.storefronts WHERE seller_user_id = p_seller_user_id;
  IF NOT FOUND OR row.published_at IS NULL THEN
    RETURN jsonb_build_object(
      'sellerUserId', p_seller_user_id,
      'storeName', store_name,
      'published', false,
      'bannerUrl', NULL,
      'logoUrl', NULL,
      'intro', '',
      'theme', 'default',
      'featuredIds', '[]'::jsonb,
      'categories', '[]'::jsonb,
      'certifiedAt', certified_at
    );
  END IF;
  RETURN jsonb_build_object(
    'sellerUserId', p_seller_user_id,
    'storeName', store_name,
    'published', true,
    'bannerUrl', row.banner_url,
    'logoUrl', row.logo_url,
    'intro', coalesce(row.intro, ''),
    'theme', coalesce(row.theme, 'default'),
    'featuredIds', to_jsonb(coalesce(row.featured_product_ids, ARRAY[]::uuid[])),
    'categories', to_jsonb(coalesce(row.category_order, ARRAY[]::text[])),
    'certifiedAt', certified_at
  );
END;
$$;

DROP FUNCTION IF EXISTS public.public_store_names(uuid[]);

CREATE FUNCTION public.public_store_names(p_ids uuid[])
RETURNS TABLE (seller_user_id uuid, store_name text, certified_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (sa.user_id)
    sa.user_id,
    sa.store_name,
    sa.certified_at
  FROM public.seller_applications sa
  WHERE sa.user_id = ANY (coalesce(p_ids, ARRAY[]::uuid[]))
    AND sa.status = 'approved'
    AND nullif(btrim(sa.store_name), '') IS NOT NULL
  ORDER BY sa.user_id, sa.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.stamp_seller_certified_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_store_names(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_store_names(uuid[]) TO anon, authenticated;

COMMIT;
