-- =============================================================================
-- 3001 隔離試玩（hengjing-stage45-local Docker）缺失資料庫物件補齊
-- 只限本機 Docker 執行（缺少 PGOPTIONS 標記時整份拒絕）：
--   Get-Content <本檔> -Raw | docker exec -i -e PGOPTIONS="-c app.hengjing_local_docker=on" supabase_db_hengjing-stage45-local psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- 只新增 3001 缺少的物件；任一目標物件已存在就整份中止，不覆蓋。
-- 定義逐段取自既有 migration：
--   公告              ← migrations/20261020233000_platform_announcements.sql
--   收藏/關注/工單/評價/找相似/銷量/賣場 ← migrations/20261020120000_buyer_store_features.sql
--   賣場草稿與發布    ← migrations/20261020210000_storefront_draft_publish.sql
--   買賣家聊天        ← migrations/20261020143000_chat_and_security_fixes.sql（只取聊天段）
-- 刻意不執行的段落（3001 已有且已驗收）：
--   profiles 欄位/觸發器/RLS/GRANT、is_platform_admin、guard_profile_sensitive、get_my_profile、
--   set_public_nickname、member-avatars、jsonb_max_price、product_is_public、preserve_product_sold、
--   products_preserve_sold、list_public_reviews、public_store_names、notification_outbox、recognize_sale。
--   seller_applications.certified_at 與其觸發器（20261020223000）不補：會改動已驗收的賣家審核表。
--   get_my_storefront / public_storefront 因此採 20261020210000 版本（不含 certifiedAt，前台視為 null）。
-- 與原檔不同之處：
--   product_favorites 另外 REVOKE authenticated 的預設全權限後只授 SELECT/INSERT/DELETE
--     （Supabase 預設權限含 TRUNCATE，會繞過 RLS）。
--   store_media_url_ok 為本機版本：保留 https://*.supabase.co 規則，另外只接受 Docker GoTrue
--     簽發的 issuer http://127.0.0.1:54321/auth/v1 與同源 store-media 網址。正式 migration 不變。
-- 不 UPDATE / DELETE 任何既有資料列。
-- =============================================================================

BEGIN;

DO $$
DECLARE
  missing text;
  present text;
BEGIN
  IF coalesce(current_setting('app.hengjing_local_docker', true), '') <> 'on' THEN
    RAISE EXCEPTION '本檔只限 3001 本機 Docker；缺少 app.hengjing_local_docker=on';
  END IF;

  SELECT string_agg(x, ', ') INTO missing
  FROM unnest(ARRAY[
    'public.is_platform_admin()', 'public.is_approved_seller()',
    'public.product_is_public(jsonb)', 'public.jsonb_max_price(jsonb)',
    'public.list_public_reviews(uuid[])'
  ]) AS x
  WHERE to_regprocedure(x) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '缺少既有函式：%', missing;
  END IF;

  SELECT string_agg(x, ', ') INTO missing
  FROM unnest(ARRAY[
    'public.profiles', 'public.products', 'public.seller_applications',
    'public.notification_outbox', 'public.member_perk_loadout'
  ]) AS x
  WHERE to_regclass(x) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '缺少既有資料表：%', missing;
  END IF;

  SELECT string_agg(x, ', ') INTO present
  FROM unnest(ARRAY[
    'public.platform_announcements', 'public.product_favorites', 'public.seller_follows',
    'public.support_tickets', 'public.support_replies', 'public.product_reviews',
    'public.product_review_photos', 'public.sales_recognitions', 'public.storefronts',
    'public.seller_chats', 'public.seller_chat_messages'
  ]) AS x
  WHERE to_regclass(x) IS NOT NULL;
  IF present IS NOT NULL THEN
    RAISE EXCEPTION '資料表已存在，不覆蓋：%', present;
  END IF;

  SELECT string_agg(p.proname, ', ') INTO present
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY (ARRAY[
      'announcement_plain', 'list_enabled_announcements', 'admin_list_announcements',
      'admin_upsert_announcement', 'admin_delete_announcement',
      'follow_seller', 'unfollow_seller', 'public_follow_counts',
      'create_support_ticket', 'list_my_tickets', 'mark_ticket_read', 'admin_list_tickets', 'admin_update_ticket',
      'jsonb_min_price', 'spec_value', 'specific_name_tokens',
      'list_my_reviews', 'create_product_review', 'attach_review_photo', 'reply_to_product_review',
      'find_similar_products', 'public_verified_sales',
      'store_media_url_ok', 'prepare_storefront', 'save_storefront', 'publish_storefront',
      'get_my_storefront', 'public_storefront',
      'open_seller_chat', 'send_seller_chat_message', 'list_seller_chats',
      'list_seller_chat_messages', 'mark_seller_chat_read'
    ]);
  IF present IS NOT NULL THEN
    RAISE EXCEPTION '函式已存在，不覆蓋：%', present;
  END IF;

  SELECT string_agg(id, ', ') INTO present
  FROM storage.buckets WHERE id IN ('review-images', 'store-media');
  IF present IS NOT NULL THEN
    RAISE EXCEPTION 'Storage bucket 已存在，不覆蓋：%', present;
  END IF;

  SELECT string_agg(policyname, ', ') INTO present
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND (policyname LIKE 'review\_images\_%' OR policyname LIKE 'store\_media\_%');
  IF present IS NOT NULL THEN
    RAISE EXCEPTION 'Storage 政策已存在，不覆蓋：%', present;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 平台跑馬燈公告（20261020233000）
-- ---------------------------------------------------------------------------

CREATE TABLE public.platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_announcements_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 180),
  CONSTRAINT platform_announcements_plain_text CHECK (body !~ '[<>]'),
  CONSTRAINT platform_announcements_sort_range CHECK (sort_order BETWEEN 0 AND 999)
);

ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_announcements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_announcements TO anon, authenticated;

CREATE POLICY platform_announcements_read_enabled
  ON public.platform_announcements
  FOR SELECT
  TO anon, authenticated
  USING (enabled = true);

CREATE FUNCTION public.announcement_plain(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  cleaned text;
BEGIN
  cleaned := btrim(regexp_replace(coalesce(raw, ''), '[[:cntrl:]]', '', 'g'));
  IF cleaned = '' OR char_length(cleaned) > 180 THEN
    RAISE EXCEPTION '公告需為 1 到 180 個字';
  END IF;
  IF cleaned ~ '[<>]' THEN
    RAISE EXCEPTION '公告只接受純文字';
  END IF;
  RETURN cleaned;
END;
$$;

CREATE FUNCTION public.list_enabled_announcements()
RETURNS TABLE (id uuid, body text, sort_order integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT a.id, a.body, a.sort_order
  FROM public.platform_announcements a
  WHERE a.enabled = true
  ORDER BY a.sort_order ASC, a.created_at ASC;
$$;

CREATE FUNCTION public.admin_list_announcements()
RETURNS TABLE (
  id uuid,
  body text,
  enabled boolean,
  sort_order integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION '只有平台管理員可以管理公告';
  END IF;
  RETURN QUERY
  SELECT a.id, a.body, a.enabled, a.sort_order, a.updated_at
  FROM public.platform_announcements a
  ORDER BY a.sort_order ASC, a.created_at ASC;
END;
$$;

CREATE FUNCTION public.admin_upsert_announcement(
  p_id uuid,
  p_body text,
  p_enabled boolean,
  p_sort integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_body text;
  next_sort integer;
  saved uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION '只有平台管理員可以管理公告';
  END IF;
  next_body := public.announcement_plain(p_body);
  next_sort := coalesce(p_sort, 0);
  IF next_sort < 0 OR next_sort > 999 THEN
    RAISE EXCEPTION '排序需介於 0 到 999';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.platform_announcements (body, enabled, sort_order)
    VALUES (next_body, coalesce(p_enabled, false), next_sort)
    RETURNING platform_announcements.id INTO saved;
    RETURN saved;
  END IF;

  UPDATE public.platform_announcements
  SET body = next_body,
      enabled = coalesce(p_enabled, false),
      sort_order = next_sort,
      updated_at = now()
  WHERE platform_announcements.id = p_id
  RETURNING platform_announcements.id INTO saved;

  IF saved IS NULL THEN
    RAISE EXCEPTION '找不到這則公告';
  END IF;
  RETURN saved;
END;
$$;

CREATE FUNCTION public.admin_delete_announcement(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION '只有平台管理員可以管理公告';
  END IF;
  DELETE FROM public.platform_announcements WHERE id = p_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 收藏（20261020120000）
-- ---------------------------------------------------------------------------

CREATE TABLE public.product_favorites (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

ALTER TABLE public.product_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_favorites_own
  ON public.product_favorites
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.product_favorites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.product_favorites TO authenticated;

-- ---------------------------------------------------------------------------
-- 關注賣家（20261020120000）
-- ---------------------------------------------------------------------------

CREATE TABLE public.seller_follows (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  seller_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, seller_user_id),
  CONSTRAINT seller_follows_not_self CHECK (user_id <> seller_user_id)
);

ALTER TABLE public.seller_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY seller_follows_select_own
  ON public.seller_follows
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.seller_follows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_follows TO authenticated;

CREATE FUNCTION public.follow_seller(p_seller_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_seller_user_id IS NULL OR p_seller_user_id = uid THEN
    RAISE EXCEPTION '無法關注這個賣場';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.seller_applications
    WHERE user_id = p_seller_user_id AND status = 'approved'
  ) THEN
    RAISE EXCEPTION '只能關注已核准的賣場';
  END IF;
  INSERT INTO public.seller_follows (user_id, seller_user_id)
  VALUES (uid, p_seller_user_id)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE FUNCTION public.unfollow_seller(p_seller_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  DELETE FROM public.seller_follows
  WHERE user_id = uid AND seller_user_id = p_seller_user_id;
END;
$$;

CREATE FUNCTION public.public_follow_counts(p_ids uuid[])
RETURNS TABLE (seller_user_id uuid, followers integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sa.user_id, count(f.user_id)::integer
  FROM public.seller_applications sa
  LEFT JOIN public.seller_follows f ON f.seller_user_id = sa.user_id
  WHERE sa.status = 'approved'
    AND sa.user_id = ANY (coalesce(p_ids, ARRAY[]::uuid[]))
  GROUP BY sa.user_id
$$;

-- ---------------------------------------------------------------------------
-- 客服工單（20261020120000）
-- ---------------------------------------------------------------------------

CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('buyer', 'seller')),
  category text NOT NULL CHECK (char_length(btrim(category)) BETWEEN 1 AND 40),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 2 AND 60),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 5 AND 500),
  order_ref text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'replied', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  buyer_last_read_at timestamptz
);

CREATE TABLE public.support_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  is_staff boolean NOT NULL DEFAULT false,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY support_tickets_select_own
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

CREATE POLICY support_replies_select_own
  ON public.support_replies
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.support_tickets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.support_replies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_tickets TO authenticated;
GRANT SELECT ON public.support_replies TO authenticated;

CREATE FUNCTION public.create_support_ticket(
  p_role text,
  p_category text,
  p_subject text,
  p_body text,
  p_order_ref text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  new_id uuid;
  owns boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_role NOT IN ('buyer', 'seller') THEN
    RAISE EXCEPTION '工單身分不正確';
  END IF;
  IF p_order_ref IS NOT NULL AND btrim(p_order_ref) <> '' THEN
    IF to_regclass('public.orders') IS NULL THEN
      RAISE EXCEPTION '尚無真實訂單可關聯';
    END IF;
    BEGIN
      EXECUTE $q$
        SELECT EXISTS (
          SELECT 1 FROM public.orders
          WHERE id::text = $1 AND buyer_id = auth.uid()
        )
      $q$ INTO owns USING btrim(p_order_ref);
    EXCEPTION
      WHEN undefined_column OR undefined_table OR invalid_text_representation THEN
        RAISE EXCEPTION '這筆訂單無法關聯，或您沒有查看權限';
    END;
    IF NOT coalesce(owns, false) THEN
      RAISE EXCEPTION '只能關聯自己的真實訂單';
    END IF;
  END IF;

  INSERT INTO public.support_tickets (user_id, role, category, subject, body, order_ref, status)
  VALUES (uid, p_role, btrim(p_category), btrim(p_subject), btrim(p_body), NULLIF(btrim(coalesce(p_order_ref, '')), ''), 'pending')
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE FUNCTION public.list_my_tickets()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(item ORDER BY item.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT
        t.id,
        t.user_id,
        t.role,
        t.category,
        t.subject,
        t.body,
        t.status,
        t.created_at,
        t.buyer_last_read_at,
        (
          SELECT r.body FROM public.support_replies r
          WHERE r.ticket_id = t.id AND r.is_staff
          ORDER BY r.created_at DESC
          LIMIT 1
        ) AS reply,
        (
          SELECT r.created_at FROM public.support_replies r
          WHERE r.ticket_id = t.id AND r.is_staff
          ORDER BY r.created_at DESC
          LIMIT 1
        ) AS replied_at
      FROM public.support_tickets t
      WHERE t.user_id = uid
    ) item
  );
END;
$$;

CREATE FUNCTION public.mark_ticket_read(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  UPDATE public.support_tickets
  SET buyer_last_read_at = now()
  WHERE id = p_id AND user_id = auth.uid();
END;
$$;

CREATE FUNCTION public.admin_list_tickets()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION '沒有客服管理權限';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(item ORDER BY item.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT
        t.id,
        t.user_id,
        t.role,
        t.category,
        t.subject,
        t.body,
        t.status,
        t.created_at,
        coalesce(nullif(btrim(p.public_nickname), ''), '會員') AS author,
        (
          SELECT r.body FROM public.support_replies r
          WHERE r.ticket_id = t.id AND r.is_staff
          ORDER BY r.created_at DESC LIMIT 1
        ) AS reply,
        (
          SELECT r.created_at FROM public.support_replies r
          WHERE r.ticket_id = t.id AND r.is_staff
          ORDER BY r.created_at DESC LIMIT 1
        ) AS replied_at,
        (
          SELECT max(r.created_at) FROM public.support_replies r
          WHERE r.ticket_id = t.id AND r.is_staff
        ) > coalesce(t.buyer_last_read_at, '-infinity'::timestamptz) AS unread
      FROM public.support_tickets t
      LEFT JOIN public.profiles p ON p.id = t.user_id
    ) item
  );
END;
$$;

CREATE FUNCTION public.admin_update_ticket(p_id uuid, p_status text, p_reply text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  reply text := btrim(coalesce(p_reply, ''));
  next_status text := p_status;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION '沒有客服管理權限';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = p_id) THEN
    RAISE EXCEPTION '找不到工單';
  END IF;
  IF next_status NOT IN ('pending', 'processing', 'replied', 'closed') THEN
    RAISE EXCEPTION '工單狀態不正確';
  END IF;
  IF next_status = 'replied' AND reply = '' THEN
    RAISE EXCEPTION '標記已回覆時必須寫入真實回覆';
  END IF;
  IF reply <> '' THEN
    INSERT INTO public.support_replies (ticket_id, author_id, is_staff, body)
    VALUES (p_id, uid, true, reply);
    IF next_status = 'pending' THEN
      next_status := 'replied';
    END IF;
  END IF;
  UPDATE public.support_tickets
  SET status = next_status, updated_at = now()
  WHERE id = p_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 商品評價（20261020120000）。送出函式在真實完成訂單存在前會拒絕。
-- ---------------------------------------------------------------------------

CREATE TABLE public.product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text NOT NULL DEFAULT '',
  seller_reply text,
  seller_replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_reviews_one_per_item UNIQUE (order_item_id),
  CONSTRAINT product_reviews_body_len CHECK (char_length(body) <= 500)
);

CREATE TABLE public.product_review_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.product_reviews (id) ON DELETE CASCADE,
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, path)
);

ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_review_photos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_reviews FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.product_review_photos FROM PUBLIC, anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'review-images',
  'review-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
);

CREATE POLICY review_images_public_read
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'review-images');

CREATE POLICY review_images_owner_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'review-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY review_images_owner_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'review-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE FUNCTION public.jsonb_min_price(j jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  n numeric := 0;
  base numeric := 0;
  seen boolean := false;
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
  seen := true;
  IF jsonb_typeof(j->'option_price') = 'object' THEN
    FOR v IN SELECT value FROM jsonb_each_text(j->'option_price') LOOP
      BEGIN
        IF seen THEN n := least(n, v::numeric); ELSE n := v::numeric; END IF;
        seen := true;
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END LOOP;
  END IF;
  IF jsonb_typeof(j->'combo_price') = 'object' THEN
    FOR v IN SELECT value FROM jsonb_each_text(j->'combo_price') LOOP
      BEGIN
        IF seen THEN n := least(n, v::numeric); ELSE n := v::numeric; END IF;
        seen := true;
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END LOOP;
  END IF;
  RETURN n;
END;
$$;

CREATE FUNCTION public.spec_value(p_specs jsonb, p_keys text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(pair.value)
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(coalesce(p_specs, '[]'::jsonb)) = 'array' THEN coalesce(p_specs, '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  ) elem
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN jsonb_typeof(elem) = 'array' THEN elem->>0
        ELSE elem->>'name'
      END AS key,
      CASE
        WHEN jsonb_typeof(elem) = 'array' THEN elem->>1
        ELSE coalesce(elem->>'value', elem->>'text')
      END AS value
  ) pair
  WHERE lower(pair.key) = ANY (SELECT lower(k) FROM unnest(p_keys) AS k)
    AND pair.value IS NOT NULL
    AND btrim(pair.value) <> ''
  LIMIT 1
$$;

CREATE FUNCTION public.specific_name_tokens(p_name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT token), ARRAY[]::text[])
  FROM (
    SELECT token
    FROM regexp_split_to_table(lower(coalesce(p_name, '')), '[^0-9a-zA-Z一-龥]+') AS token
    WHERE char_length(token) >= 2
      AND token NOT IN (
        '耳機','手機','商品','新款','現貨','台灣','通用','配件','正品','全新','二手',
        '優惠','特價','免運','官方','旗艦','家用','專用','套裝','公司','男女'
      )
  ) s
$$;

CREATE FUNCTION public.list_my_reviews()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(item ORDER BY item.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT r.id, r.product_id, r.rating, r.body, r.created_at, pr.name AS product_name
      FROM public.product_reviews r
      JOIN public.products pr ON pr.id = r.product_id
      WHERE r.user_id = uid
    ) item
  );
END;
$$;

CREATE FUNCTION public.create_product_review(
  p_order_item_id uuid,
  p_product_id uuid,
  p_rating integer,
  p_body text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  ok boolean := false;
  new_id uuid;
  cleaned text := btrim(coalesce(p_body, ''));
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION '評分需為 1 到 5';
  END IF;
  IF char_length(cleaned) > 500 THEN
    RAISE EXCEPTION '心得最多 500 字';
  END IF;
  IF to_regclass('public.order_items') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'completed_at'
     ) THEN
    RAISE EXCEPTION '真實訂單尚未完成，目前不能建立評價';
  END IF;

  BEGIN
    EXECUTE $q$
      SELECT (o.buyer_id = auth.uid())
         AND o.completed_at IS NOT NULL
         AND oi.product_id = $2
         AND coalesce(oi.refunded_qty, 0) < oi.quantity
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = $1
    $q$ INTO ok USING p_order_item_id, p_product_id;
  EXCEPTION
    WHEN undefined_column OR undefined_table THEN
      RAISE EXCEPTION '真實訂單尚未完成，目前不能建立評價';
  END;

  IF NOT coalesce(ok, false) THEN
    RAISE EXCEPTION '只有本人已完成且未全數退貨的訂單明細可以評價';
  END IF;

  INSERT INTO public.product_reviews (user_id, product_id, order_item_id, rating, body)
  VALUES (uid, p_product_id, p_order_item_id, p_rating, cleaned)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE FUNCTION public.attach_review_photo(p_review_id uuid, p_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_path IS NULL OR split_part(p_path, '/', 1) <> uid::text OR p_path !~ '^[^/]+/[^/]+/[^/]+$' THEN
    RAISE EXCEPTION '評價照片路徑不正確';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_reviews WHERE id = p_review_id AND user_id = uid
  ) THEN
    RAISE EXCEPTION '只能為自己的評價附加照片';
  END IF;
  IF (
    SELECT count(*) FROM public.product_review_photos WHERE review_id = p_review_id
  ) >= 3 THEN
    RAISE EXCEPTION '每則評價最多 3 張照片';
  END IF;
  INSERT INTO public.product_review_photos (review_id, path)
  VALUES (p_review_id, p_path)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE FUNCTION public.reply_to_product_review(p_review_id uuid, p_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cleaned text := btrim(coalesce(p_text, ''));
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF char_length(cleaned) < 1 OR char_length(cleaned) > 300 THEN
    RAISE EXCEPTION '回覆需為 1 到 300 字';
  END IF;
  UPDATE public.product_reviews r
  SET seller_reply = cleaned, seller_replied_at = now()
  FROM public.products p
  WHERE r.id = p_review_id
    AND p.id = r.product_id
    AND p.seller_id = uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION '只能回覆自己商品上的真實評價';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 找相似（20261020120000）。只讀公開商品與賣場名稱，不讀 KYC。
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.find_similar_products(
  p_product_id uuid,
  p_limit integer DEFAULT 12,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lim integer := least(greatest(coalesce(p_limit, 12), 1), 24);
  off integer := least(greatest(coalesce(p_offset, 0), 0), 200);
  src jsonb;
  src_seller uuid;
BEGIN
  SELECT to_jsonb(p), p.seller_id INTO src, src_seller
  FROM public.products p
  WHERE p.id = p_product_id;

  IF src IS NULL OR NOT public.product_is_public(src) THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN (
    SELECT coalesce(
      jsonb_agg(
        to_jsonb(hit)
        ORDER BY (hit.seller_id = src_seller), hit.match_score DESC, hit.price ASC
      ),
      '[]'::jsonb
    )
    FROM (
      SELECT *
      FROM (
        SELECT
          p.id,
          p.name,
          prices.min_price AS price,
          CASE WHEN prices.min_price IS DISTINCT FROM prices.max_price THEN '起價' ELSE '售價' END AS price_label,
          coalesce(p.image, '') AS image,
          p.seller_id,
          coalesce(store.store_name, '賣場') AS store_name,
          coalesce(p.category, '') AS category,
          coalesce(p.sub_category, '') AS sub_category,
          left(coalesce(spec_line.note, ''), 160) AS spec_note,
          CASE
            WHEN same_model.is_same THEN 'same'
            ELSE 'similar'
          END AS match_kind,
          (
            CASE WHEN same_model.is_same THEN 1000 ELSE 0 END
            + coalesce(token_overlap.n, 0) * 10
            + CASE WHEN p.category IS NOT DISTINCT FROM src->>'category' THEN 5 ELSE 0 END
            + CASE
                WHEN nullif(src->>'sub_category', '') IS NOT NULL
                 AND p.sub_category IS NOT DISTINCT FROM src->>'sub_category' THEN 8
                ELSE 0
              END
            + CASE WHEN p.seller_id IS DISTINCT FROM src_seller THEN 3 ELSE 0 END
          ) AS match_score,
          (
            public.product_is_public(to_jsonb(p))
            AND coalesce(p.stock, 0) > 0
          ) AS purchasable,
          coalesce(p.stock, 0) AS stock
        FROM (
          SELECT cand.*
          FROM public.products cand
          WHERE cand.id <> p_product_id
            AND public.product_is_public(to_jsonb(cand))
            AND EXISTS (
              SELECT 1 FROM public.seller_applications sa
              WHERE sa.user_id = cand.seller_id AND sa.status = 'approved'
            )
            AND (
              cand.category IS NOT DISTINCT FROM src->>'category'
              OR (
                nullif(src->>'sub_category', '') IS NOT NULL
                AND cand.sub_category IS NOT DISTINCT FROM src->>'sub_category'
              )
              OR EXISTS (
                SELECT 1
                FROM unnest(public.specific_name_tokens(src->>'name')) tok
                WHERE char_length(tok) >= 3
                  AND position(tok IN lower(coalesce(cand.name, ''))) > 0
              )
            )
          ORDER BY CASE WHEN cand.category IS NOT DISTINCT FROM src->>'category' THEN 0 ELSE 1 END, cand.id
          LIMIT 80
        ) p
        CROSS JOIN LATERAL (
          SELECT
            public.jsonb_max_price(to_jsonb(p)) AS max_price,
            public.jsonb_min_price(to_jsonb(p)) AS min_price
        ) prices
        CROSS JOIN LATERAL (
          SELECT (
            SELECT sa.store_name
            FROM public.seller_applications sa
            WHERE sa.user_id = p.seller_id AND sa.status = 'approved'
            ORDER BY sa.created_at DESC
            LIMIT 1
          ) AS store_name
        ) store
        CROSS JOIN LATERAL (
          SELECT cardinality(
            ARRAY(
              SELECT unnest(public.specific_name_tokens(src->>'name'))
              INTERSECT
              SELECT unnest(public.specific_name_tokens(p.name))
            )
          ) AS n
        ) token_overlap
        CROSS JOIN LATERAL (
          SELECT
            nullif(public.spec_value(src->'specs', ARRAY['品牌', 'brand']), '') AS src_brand,
            nullif(public.spec_value(to_jsonb(p)->'specs', ARRAY['品牌', 'brand']), '') AS brand,
            nullif(public.spec_value(src->'specs', ARRAY['型號', 'model', '型号']), '') AS src_model,
            nullif(public.spec_value(to_jsonb(p)->'specs', ARRAY['型號', 'model', '型号']), '') AS model
        ) ident
        CROSS JOIN LATERAL (
          SELECT
            ident.src_brand IS NOT NULL
            AND ident.brand IS NOT NULL
            AND lower(ident.src_brand) = lower(ident.brand)
            AND ident.src_model IS NOT NULL
            AND ident.model IS NOT NULL
            AND lower(ident.src_model) = lower(ident.model)
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(ARRAY['容量', '尺寸', '規格', '顏色', '版本', '數量', 'size', 'color']) AS k(key)
              WHERE nullif(public.spec_value(src->'specs', ARRAY[k.key]), '') IS NOT NULL
                AND nullif(public.spec_value(to_jsonb(p)->'specs', ARRAY[k.key]), '') IS NOT NULL
                AND lower(public.spec_value(src->'specs', ARRAY[k.key]))
                    IS DISTINCT FROM lower(public.spec_value(to_jsonb(p)->'specs', ARRAY[k.key]))
            )
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(ARRAY['容量', '尺寸', '規格', '顏色', '版本', '數量']) AS k(key)
              WHERE (
                nullif(public.spec_value(src->'specs', ARRAY[k.key]), '') IS NULL
              ) IS DISTINCT FROM (
                nullif(public.spec_value(to_jsonb(p)->'specs', ARRAY[k.key]), '') IS NULL
              )
            ) AS is_same
        ) same_model
        CROSS JOIN LATERAL (
          SELECT string_agg(pair.txt, '・') AS note
          FROM (
            SELECT concat(pair.key, ' ', pair.value) AS txt
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(coalesce(to_jsonb(p)->'specs', '[]'::jsonb)) = 'array'
                  THEN coalesce(to_jsonb(p)->'specs', '[]'::jsonb)
                ELSE '[]'::jsonb
              END
            ) elem
            CROSS JOIN LATERAL (
              SELECT
                CASE WHEN jsonb_typeof(elem) = 'array' THEN elem->>0 ELSE elem->>'name' END AS key,
                CASE WHEN jsonb_typeof(elem) = 'array' THEN elem->>1 ELSE coalesce(elem->>'value', '') END AS value
            ) pair
            WHERE pair.key IS NOT NULL AND btrim(pair.value) <> ''
            LIMIT 4
          ) pair
        ) spec_line
        WHERE p.id <> p_product_id
          AND store.store_name IS NOT NULL
          AND public.product_is_public(to_jsonb(p))
          AND (
            p.category IS NOT DISTINCT FROM src->>'category'
            OR (
              nullif(src->>'sub_category', '') IS NOT NULL
              AND p.sub_category IS NOT DISTINCT FROM src->>'sub_category'
            )
            OR coalesce(token_overlap.n, 0) > 0
          )
      ) ranked
      ORDER BY (ranked.seller_id = src_seller), ranked.match_score DESC, ranked.price ASC
      OFFSET off
      LIMIT lim
    ) hit
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 真實銷量（20261020120000）。只建資料表與公開讀取函式；
-- recognize_sale 屬結帳流程，checkout_enabled=false，本檔不補。
-- ---------------------------------------------------------------------------

CREATE TABLE public.sales_recognitions (
  order_item_id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  seller_user_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_recognitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_recognitions FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.public_verified_sales(p_ids uuid[])
RETURNS TABLE (product_id uuid, units integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ids.id,
         coalesce(sum(s.quantity), 0)::integer AS units
  FROM unnest(coalesce(p_ids, ARRAY[]::uuid[])) AS ids(id)
  LEFT JOIN public.sales_recognitions s ON s.product_id = ids.id
  WHERE EXISTS (
    SELECT 1
    FROM public.products pr
    WHERE pr.id = ids.id
      AND (
        public.product_is_public(to_jsonb(pr))
        OR pr.seller_id = auth.uid()
      )
  )
  GROUP BY ids.id
$$;

-- ---------------------------------------------------------------------------
-- 賣場裝潢（20261020120000 + 20261020210000 草稿欄位）
-- ---------------------------------------------------------------------------

CREATE TABLE public.storefronts (
  seller_user_id uuid PRIMARY KEY,
  banner_url text,
  logo_url text,
  intro text NOT NULL DEFAULT '',
  theme text NOT NULL DEFAULT 'default',
  featured_product_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  category_order text[] NOT NULL DEFAULT ARRAY[]::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storefronts_theme_check CHECK (theme IN ('default', 'ink', 'forest', 'ocean', 'sand', 'rose')),
  CONSTRAINT storefronts_intro_len CHECK (char_length(intro) <= 400)
);

ALTER TABLE public.storefronts
  ADD COLUMN draft_banner_url text,
  ADD COLUMN draft_logo_url text,
  ADD COLUMN draft_intro text,
  ADD COLUMN draft_theme text,
  ADD COLUMN draft_featured_product_ids uuid[],
  ADD COLUMN draft_category_order text[],
  ADD COLUMN draft_updated_at timestamptz,
  ADD COLUMN published_at timestamptz;

ALTER TABLE public.storefronts
  ADD CONSTRAINT storefronts_draft_theme_check
  CHECK (draft_theme IS NULL OR draft_theme IN ('default', 'ink', 'forest', 'ocean', 'sand', 'rose'));

ALTER TABLE public.storefronts
  ADD CONSTRAINT storefronts_draft_intro_len
  CHECK (draft_intro IS NULL OR char_length(draft_intro) <= 400);

ALTER TABLE public.storefronts ENABLE ROW LEVEL SECURITY;

CREATE POLICY storefronts_owner_select
  ON public.storefronts
  FOR SELECT
  TO authenticated
  USING (seller_user_id = auth.uid() OR public.is_platform_admin());

REVOKE ALL ON public.storefronts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.storefronts TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'store-media',
  'store-media',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
);

CREATE POLICY store_media_public_read
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'store-media');

CREATE POLICY store_media_seller_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'store-media'
    AND public.is_approved_seller()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY store_media_seller_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'store-media'
    AND public.is_approved_seller()
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'store-media'
    AND public.is_approved_seller()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY store_media_seller_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'store-media'
    AND public.is_approved_seller()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 本機版本：正式 *.supabase.co 規則不變；額外白名單只有 Docker GoTrue 的 loopback issuer。
-- 網址主機必須與 issuer 同源，路徑規則與檔案存在檢查與正式版相同。
CREATE FUNCTION public.store_media_url_ok(p_url text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  uid text := auth.uid()::text;
  issuer text := coalesce(auth.jwt() ->> 'iss', '');
  origin text;
  origin_re text;
  path text;
  filename text;
BEGIN
  IF p_url IS NULL OR btrim(p_url) = '' THEN
    RETURN true;
  END IF;
  IF uid IS NULL THEN
    RETURN false;
  END IF;
  origin := 'https://' || substring(issuer FROM '^https://([a-z0-9-]+\.supabase\.co)/auth/v1$');
  IF origin IS NULL THEN
    origin := CASE issuer
      WHEN 'http://127.0.0.1:54321/auth/v1' THEN 'http://127.0.0.1:54321'
      ELSE NULL
    END;
  END IF;
  IF origin IS NULL THEN
    RETURN false;
  END IF;
  origin_re := replace(origin, '.', '\.');
  IF p_url !~ (
    '^' || origin_re || '/storage/v1/object/public/store-media/'
    || uid || '/[A-Za-z0-9._-]{1,180}$'
  ) THEN
    RETURN false;
  END IF;
  path := substring(p_url FROM '/store-media/([0-9a-f-]{36}/[A-Za-z0-9._-]{1,180})$');
  filename := split_part(path, '/', 2);
  IF split_part(path, '/', 1) IS DISTINCT FROM uid
     OR filename IS NULL
     OR filename = ''
     OR filename ~ '\.\.'
     OR split_part(path, '/', 3) <> '' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'store-media'
      AND name = path
  );
END;
$$;

CREATE FUNCTION public.prepare_storefront(
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

CREATE FUNCTION public.save_storefront(
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

CREATE FUNCTION public.publish_storefront(
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

CREATE FUNCTION public.get_my_storefront()
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

CREATE FUNCTION public.public_storefront(p_seller_user_id uuid)
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

-- ---------------------------------------------------------------------------
-- 買賣家聊天（20261020143000 聊天段）。notification_outbox 已存在，不重建。
-- ---------------------------------------------------------------------------

CREATE TABLE public.seller_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL,
  seller_user_id uuid NOT NULL,
  product_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  buyer_last_read_at timestamptz,
  seller_last_read_at timestamptz,
  CONSTRAINT seller_chats_not_self CHECK (buyer_id <> seller_user_id),
  CONSTRAINT seller_chats_pair_unique UNIQUE (buyer_id, seller_user_id)
);

CREATE TABLE public.seller_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.seller_chats (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_chat_messages_body_len CHECK (char_length(body) BETWEEN 1 AND 500)
);

CREATE INDEX seller_chats_seller_recent_idx
  ON public.seller_chats (seller_user_id, last_message_at DESC);
CREATE INDEX seller_chats_buyer_recent_idx
  ON public.seller_chats (buyer_id, last_message_at DESC);
CREATE INDEX seller_chat_messages_chat_idx
  ON public.seller_chat_messages (chat_id, created_at);
CREATE INDEX seller_chat_messages_sender_recent_idx
  ON public.seller_chat_messages (sender_id, created_at DESC);

ALTER TABLE public.seller_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY seller_chats_participant_select
  ON public.seller_chats
  FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid() OR seller_user_id = auth.uid());

CREATE POLICY seller_chat_messages_participant_select
  ON public.seller_chat_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.seller_chats c
      WHERE c.id = chat_id
        AND (c.buyer_id = auth.uid() OR c.seller_user_id = auth.uid())
    )
  );

REVOKE ALL ON public.seller_chats FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_chat_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_chats TO authenticated;
GRANT SELECT ON public.seller_chat_messages TO authenticated;

CREATE FUNCTION public.open_seller_chat(p_seller_user_id uuid, p_product_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  chat_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_seller_user_id IS NULL OR p_seller_user_id = uid THEN
    RAISE EXCEPTION '不能向這個賣場建立對話';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.seller_applications sa
    WHERE sa.user_id = p_seller_user_id
      AND sa.status = 'approved'
  ) THEN
    RAISE EXCEPTION '只能聯繫已核准的賣場';
  END IF;
  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.seller_id = p_seller_user_id
      AND public.product_is_public(to_jsonb(p))
  ) THEN
    RAISE EXCEPTION '這個商品目前不能附在對話中';
  END IF;

  INSERT INTO public.seller_chats (buyer_id, seller_user_id, product_id)
  VALUES (uid, p_seller_user_id, p_product_id)
  ON CONFLICT (buyer_id, seller_user_id) DO UPDATE
  SET product_id = COALESCE(EXCLUDED.product_id, public.seller_chats.product_id)
  RETURNING id INTO chat_id;

  RETURN chat_id;
END;
$$;

CREATE FUNCTION public.send_seller_chat_message(p_chat_id uuid, p_body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cleaned text := btrim(coalesce(p_body, ''));
  chat public.seller_chats%ROWTYPE;
  message_id uuid;
  recipient uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF cleaned = '' OR char_length(cleaned) > 500 THEN
    RAISE EXCEPTION '訊息需為 1 到 500 個字';
  END IF;
  IF cleaned ~ '[[:cntrl:]]' AND cleaned ~ '[^[:space:]]' AND cleaned ~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]' THEN
    RAISE EXCEPTION '訊息包含無法使用的字元';
  END IF;

  SELECT * INTO chat FROM public.seller_chats WHERE id = p_chat_id;
  IF NOT FOUND OR (chat.buyer_id <> uid AND chat.seller_user_id <> uid) THEN
    RAISE EXCEPTION '不能在這則對話發言';
  END IF;
  IF chat.seller_user_id = uid AND NOT public.is_approved_seller() THEN
    RAISE EXCEPTION '通過賣家認證後才能回覆買家';
  END IF;
  IF (
    SELECT count(*)
    FROM public.seller_chat_messages
    WHERE sender_id = uid
      AND created_at > now() - interval '1 minute'
  ) >= 10 THEN
    RAISE EXCEPTION '傳送過於頻繁，請稍後再試';
  END IF;

  INSERT INTO public.seller_chat_messages (chat_id, sender_id, body)
  VALUES (p_chat_id, uid, cleaned)
  RETURNING id INTO message_id;

  UPDATE public.seller_chats
  SET last_message_at = now()
  WHERE id = p_chat_id;

  recipient := CASE WHEN chat.buyer_id = uid THEN chat.seller_user_id ELSE chat.buyer_id END;
  INSERT INTO public.notification_outbox (event_key, kind, user_id, payload)
  VALUES (
    'seller_chat_message:' || message_id::text,
    'seller_chat_message',
    recipient,
    jsonb_build_object('chatId', p_chat_id, 'messageId', message_id)
  )
  ON CONFLICT (event_key) DO NOTHING;

  RETURN jsonb_build_object(
    'id', message_id,
    'chat_id', p_chat_id,
    'sender_id', uid,
    'body', cleaned,
    'created_at', now()
  );
END;
$$;

CREATE FUNCTION public.list_seller_chats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(item ORDER BY item.last_at DESC NULLS LAST), '[]'::jsonb)
    FROM (
      SELECT
        c.id,
        c.buyer_id,
        c.seller_user_id,
        c.product_id,
        CASE
          WHEN pr.id IS NOT NULL AND (pr.seller_id = uid OR public.product_is_public(to_jsonb(pr)))
            THEN pr.name
          ELSE NULL
        END AS product_name,
        CASE
          WHEN pr.id IS NOT NULL AND (pr.seller_id = uid OR public.product_is_public(to_jsonb(pr)))
            THEN pr.image
          ELSE NULL
        END AS product_image,
        CASE
          WHEN pr.id IS NOT NULL AND (pr.seller_id = uid OR public.product_is_public(to_jsonb(pr)))
            THEN pr.price
          ELSE NULL
        END AS product_price,
        (pr.id IS NOT NULL AND (pr.seller_id = uid OR public.product_is_public(to_jsonb(pr)))) AS product_visible,
        CASE
          WHEN c.buyer_id = uid THEN coalesce(store.store_name, '賣場')
          ELSE coalesce(nullif(btrim(buyer.public_nickname), ''), '買家')
        END AS peer_name,
        CASE
          WHEN c.buyer_id = uid THEN sf.logo_url
          ELSE buyer.avatar_url
        END AS peer_avatar,
        last_msg.body AS last_body,
        coalesce(c.last_message_at, c.created_at) AS last_at,
        (
          SELECT count(*)::integer
          FROM public.seller_chat_messages m
          WHERE m.chat_id = c.id
            AND m.sender_id <> uid
            AND m.created_at > CASE
              WHEN c.buyer_id = uid THEN coalesce(c.buyer_last_read_at, '-infinity'::timestamptz)
              ELSE coalesce(c.seller_last_read_at, '-infinity'::timestamptz)
            END
        ) AS unread
      FROM public.seller_chats c
      LEFT JOIN public.products pr ON pr.id = c.product_id
      LEFT JOIN public.profiles buyer ON buyer.id = c.buyer_id
      LEFT JOIN LATERAL (
        SELECT sa.store_name
        FROM public.seller_applications sa
        WHERE sa.user_id = c.seller_user_id AND sa.status = 'approved'
        ORDER BY sa.created_at DESC
        LIMIT 1
      ) store ON true
      LEFT JOIN public.storefronts sf ON sf.seller_user_id = c.seller_user_id
      LEFT JOIN LATERAL (
        SELECT m.body
        FROM public.seller_chat_messages m
        WHERE m.chat_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) last_msg ON true
      WHERE c.buyer_id = uid OR c.seller_user_id = uid
    ) item
  );
END;
$$;

CREATE FUNCTION public.list_seller_chat_messages(p_chat_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.seller_chats c
    WHERE c.id = p_chat_id
      AND (c.buyer_id = uid OR c.seller_user_id = uid)
  ) THEN
    RAISE EXCEPTION '不能查看這則對話';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(item ORDER BY item.created_at), '[]'::jsonb)
    FROM (
      SELECT m.id, m.chat_id, m.sender_id, m.body, m.created_at
      FROM public.seller_chat_messages m
      WHERE m.chat_id = p_chat_id
      ORDER BY m.created_at DESC
      LIMIT 200
    ) item
  );
END;
$$;

CREATE FUNCTION public.mark_seller_chat_read(p_chat_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  UPDATE public.seller_chats
  SET
    buyer_last_read_at = CASE WHEN buyer_id = uid THEN now() ELSE buyer_last_read_at END,
    seller_last_read_at = CASE WHEN seller_user_id = uid THEN now() ELSE seller_last_read_at END
  WHERE id = p_chat_id
    AND (buyer_id = uid OR seller_user_id = uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION '不能更新這則對話的已讀狀態';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_chats;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_chat_messages;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 執行權限：與原 migration 相同。輔助函式不授權給前端。
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.announcement_plain(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_enabled_announcements() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_announcements() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_upsert_announcement(uuid, text, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_delete_announcement(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.follow_seller(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unfollow_seller(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_follow_counts(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_support_ticket(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_tickets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_ticket_read(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_tickets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_ticket(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jsonb_min_price(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spec_value(jsonb, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.specific_name_tokens(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_reviews() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_product_review(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_review_photo(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reply_to_product_review(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_similar_products(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_verified_sales(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_media_url_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_storefront(text, text, text, text, uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_storefront(text, text, text, text, uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_storefront(text, text, text, text, uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_storefront() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_storefront(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_seller_chat(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_seller_chat_message(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_seller_chats() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_seller_chat_messages(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_seller_chat_read(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_enabled_announcements() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_announcements() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_announcement(uuid, text, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_announcement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.follow_seller(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unfollow_seller(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_follow_counts(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_tickets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_ticket_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_tickets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_ticket(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_reviews() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_review(uuid, uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_review_photo(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reply_to_product_review(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_similar_products(uuid, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_verified_sales(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_storefront(text, text, text, text, uuid[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_storefront(text, text, text, text, uuid[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_storefront() TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_storefront(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_seller_chat(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_seller_chat_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_seller_chats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_seller_chat_messages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_seller_chat_read(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
