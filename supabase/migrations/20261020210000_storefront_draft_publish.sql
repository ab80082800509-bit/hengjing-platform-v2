-- 賣場裝潢：草稿與已發布版本分離。
-- 不刪除既有列，不改商品價格、庫存或審核狀態。
-- 既有 storefronts 內容維持為買家目前看得到的正式版本，並複製一份到草稿欄位供繼續編輯。
-- 請人工審查後再執行。

BEGIN;

ALTER TABLE public.storefronts
  ADD COLUMN IF NOT EXISTS draft_banner_url text,
  ADD COLUMN IF NOT EXISTS draft_logo_url text,
  ADD COLUMN IF NOT EXISTS draft_intro text,
  ADD COLUMN IF NOT EXISTS draft_theme text,
  ADD COLUMN IF NOT EXISTS draft_featured_product_ids uuid[],
  ADD COLUMN IF NOT EXISTS draft_category_order text[],
  ADD COLUMN IF NOT EXISTS draft_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

ALTER TABLE public.storefronts DROP CONSTRAINT IF EXISTS storefronts_draft_theme_check;
ALTER TABLE public.storefronts
  ADD CONSTRAINT storefronts_draft_theme_check
  CHECK (draft_theme IS NULL OR draft_theme IN ('default', 'ink', 'forest', 'ocean', 'sand', 'rose'));

ALTER TABLE public.storefronts DROP CONSTRAINT IF EXISTS storefronts_draft_intro_len;
ALTER TABLE public.storefronts
  ADD CONSTRAINT storefronts_draft_intro_len
  CHECK (draft_intro IS NULL OR char_length(draft_intro) <= 400);

UPDATE public.storefronts
SET
  draft_banner_url = COALESCE(draft_banner_url, banner_url),
  draft_logo_url = COALESCE(draft_logo_url, logo_url),
  draft_intro = COALESCE(draft_intro, intro),
  draft_theme = COALESCE(draft_theme, theme),
  draft_featured_product_ids = COALESCE(draft_featured_product_ids, featured_product_ids),
  draft_category_order = COALESCE(draft_category_order, category_order),
  draft_updated_at = COALESCE(draft_updated_at, updated_at),
  published_at = COALESCE(published_at, updated_at);

CREATE OR REPLACE FUNCTION public.prepare_storefront(
  p_intro text,
  p_theme text,
  p_banner_url text,
  p_logo_url text,
  p_featured uuid[],
  p_categories text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cleaned text := btrim(coalesce(p_intro, ''));
  featured uuid[];
  categories text[];
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '通過賣家認證後才能設定賣場裝潢';
  END IF;
  IF char_length(cleaned) > 400 THEN
    RAISE EXCEPTION '賣場介紹最多 400 字';
  END IF;
  IF cleaned ~ '<[^>]*>' OR cleaned ~* 'javascript:' THEN
    RAISE EXCEPTION '賣場介紹不能包含 HTML 或程式碼';
  END IF;
  IF p_theme NOT IN ('default', 'ink', 'forest', 'ocean', 'sand', 'rose') THEN
    RAISE EXCEPTION '請選擇平台提供的配色';
  END IF;
  IF NOT public.store_media_url_ok(NULLIF(p_banner_url, '')) OR NOT public.store_media_url_ok(NULLIF(p_logo_url, '')) THEN
    RAISE EXCEPTION '封面與 Logo 必須放在自己的賣場媒體空間';
  END IF;

  SELECT coalesce(array_agg(x ORDER BY ord), ARRAY[]::uuid[])
  INTO featured
  FROM unnest(coalesce(p_featured, ARRAY[]::uuid[])) WITH ORDINALITY AS u(x, ord)
  WHERE EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = u.x
      AND p.seller_id = uid
      AND public.product_is_public(to_jsonb(p))
  );

  IF cardinality(coalesce(p_featured, ARRAY[]::uuid[])) IS DISTINCT FROM cardinality(featured) THEN
    RAISE EXCEPTION '精選商品必須是您已公開上架、且通過高價審核的商品';
  END IF;
  IF cardinality(featured) > 12 THEN
    RAISE EXCEPTION '精選商品最多 12 件';
  END IF;

  SELECT coalesce(array_agg(picked.c ORDER BY picked.ord), ARRAY[]::text[])
  INTO categories
  FROM (
    SELECT c, min(ord) AS ord
    FROM unnest(coalesce(p_categories, ARRAY[]::text[])) WITH ORDINALITY AS u(c, ord)
    WHERE EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.seller_id = uid
        AND p.category = c
        AND public.product_is_public(to_jsonb(p))
    )
    GROUP BY c
  ) picked;

  RETURN jsonb_build_object(
    'intro', cleaned,
    'theme', p_theme,
    'banner', NULLIF(p_banner_url, ''),
    'logo', NULLIF(p_logo_url, ''),
    'featured', to_jsonb(featured),
    'categories', to_jsonb(categories)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_storefront(
  p_intro text,
  p_theme text,
  p_banner_url text,
  p_logo_url text,
  p_featured uuid[],
  p_categories text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ready jsonb;
  featured uuid[];
  categories text[];
BEGIN
  ready := public.prepare_storefront(p_intro, p_theme, p_banner_url, p_logo_url, p_featured, p_categories);
  SELECT coalesce(array_agg(item.value::uuid ORDER BY item.ord), ARRAY[]::uuid[])
  INTO featured
  FROM jsonb_array_elements_text(ready -> 'featured') WITH ORDINALITY AS item(value, ord);
  SELECT coalesce(array_agg(item.value ORDER BY item.ord), ARRAY[]::text[])
  INTO categories
  FROM jsonb_array_elements_text(ready -> 'categories') WITH ORDINALITY AS item(value, ord);

  INSERT INTO public.storefronts (
    seller_user_id,
    draft_banner_url,
    draft_logo_url,
    draft_intro,
    draft_theme,
    draft_featured_product_ids,
    draft_category_order,
    draft_updated_at
  )
  VALUES (
    uid,
    ready ->> 'banner',
    ready ->> 'logo',
    ready ->> 'intro',
    ready ->> 'theme',
    featured,
    categories,
    now()
  )
  ON CONFLICT (seller_user_id) DO UPDATE
  SET
    draft_banner_url = EXCLUDED.draft_banner_url,
    draft_logo_url = EXCLUDED.draft_logo_url,
    draft_intro = EXCLUDED.draft_intro,
    draft_theme = EXCLUDED.draft_theme,
    draft_featured_product_ids = EXCLUDED.draft_featured_product_ids,
    draft_category_order = EXCLUDED.draft_category_order,
    draft_updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_storefront(
  p_intro text,
  p_theme text,
  p_banner_url text,
  p_logo_url text,
  p_featured uuid[],
  p_categories text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ready jsonb;
  featured uuid[];
  categories text[];
BEGIN
  ready := public.prepare_storefront(p_intro, p_theme, p_banner_url, p_logo_url, p_featured, p_categories);
  SELECT coalesce(array_agg(item.value::uuid ORDER BY item.ord), ARRAY[]::uuid[])
  INTO featured
  FROM jsonb_array_elements_text(ready -> 'featured') WITH ORDINALITY AS item(value, ord);
  SELECT coalesce(array_agg(item.value ORDER BY item.ord), ARRAY[]::text[])
  INTO categories
  FROM jsonb_array_elements_text(ready -> 'categories') WITH ORDINALITY AS item(value, ord);

  INSERT INTO public.storefronts (
    seller_user_id,
    banner_url,
    logo_url,
    intro,
    theme,
    featured_product_ids,
    category_order,
    updated_at,
    published_at,
    draft_banner_url,
    draft_logo_url,
    draft_intro,
    draft_theme,
    draft_featured_product_ids,
    draft_category_order,
    draft_updated_at
  )
  VALUES (
    uid,
    ready ->> 'banner',
    ready ->> 'logo',
    ready ->> 'intro',
    ready ->> 'theme',
    featured,
    categories,
    now(),
    now(),
    ready ->> 'banner',
    ready ->> 'logo',
    ready ->> 'intro',
    ready ->> 'theme',
    featured,
    categories,
    now()
  )
  ON CONFLICT (seller_user_id) DO UPDATE
  SET
    banner_url = EXCLUDED.banner_url,
    logo_url = EXCLUDED.logo_url,
    intro = EXCLUDED.intro,
    theme = EXCLUDED.theme,
    featured_product_ids = EXCLUDED.featured_product_ids,
    category_order = EXCLUDED.category_order,
    updated_at = now(),
    published_at = now(),
    draft_banner_url = EXCLUDED.draft_banner_url,
    draft_logo_url = EXCLUDED.draft_logo_url,
    draft_intro = EXCLUDED.draft_intro,
    draft_theme = EXCLUDED.draft_theme,
    draft_featured_product_ids = EXCLUDED.draft_featured_product_ids,
    draft_category_order = EXCLUDED.draft_category_order,
    draft_updated_at = now();
END;
$$;

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
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT sa.store_name INTO store_name
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
      'publishedLogoUrl', NULL
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
    'publishedLogoUrl', row.logo_url
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
BEGIN
  SELECT sa.store_name INTO store_name
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
      'categories', '[]'::jsonb
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
    'categories', to_jsonb(coalesce(row.category_order, ARRAY[]::text[]))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_storefront(text, text, text, text, uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_storefront(text, text, text, text, uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_storefront(text, text, text, text, uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_storefront() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_storefront(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_storefront(text, text, text, text, uuid[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_storefront(text, text, text, text, uuid[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_storefront() TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_storefront(uuid) TO anon, authenticated;

COMMIT;
