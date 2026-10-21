-- =============================================================================
-- 買家七大功能、真實銷量銜接、賣場裝潢
-- 請人工審查後在 Supabase SQL Editor 整段執行一次。本檔不執行。
-- 不 UPDATE / DELETE 既有 products、seller_applications、會員或訂單資料列。
-- 不關閉 RLS，不授權 service_role 給前端。
-- products.sold 若存在，只加觸發器凍結寫入，不覆寫舊數字。
-- 暱稱若已寫在 public_nickname，會標成已初始化，避免被當成第一次改名。
-- 不複製 name / legal_name，避免把實名或登入名稱當成公開暱稱。
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- profiles：公開暱稱與頭像。role 沿用既有欄位。
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'buyer'
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS public_nickname text,
  ADD COLUMN IF NOT EXISTS nickname_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS nickname_initialized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS avatar_tone smallint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
  ) THEN
    EXECUTE 'ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT ''buyer''';
  END IF;
END $$;

-- 只鎖定「已經有公開暱稱」的列，不把空白列當成已改過名。
-- 交易內暫時開放這次回填，避免重跑時被暱稱觸發器擋住。不會改暱稱文字。
SELECT set_config('app.nickname_write', 'on', true);

UPDATE public.profiles
SET
  nickname_initialized = true,
  nickname_changed_at = COALESCE(nickname_changed_at, now())
WHERE public_nickname IS NOT NULL
  AND btrim(public_nickname) <> ''
  AND nickname_initialized = false;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.guard_profile_sensitive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  actor text := coalesce(auth.role(), '');
  trusted_nickname boolean := current_setting('app.nickname_write', true) = 'on';
  next_avatar text;
  next_tone smallint;
  next_nickname text;
  next_changed timestamptz;
  next_initialized boolean;
BEGIN
  IF actor = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.role := 'buyer';
    IF NOT trusted_nickname THEN
      NEW.public_nickname := NULL;
      NEW.nickname_changed_at := NULL;
      NEW.nickname_initialized := false;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION '不能變更會員編號';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION '不能從個人資料變更會員角色或認證狀態';
  END IF;

  next_avatar := NEW.avatar_url;
  next_tone := NEW.avatar_tone;
  next_nickname := NEW.public_nickname;
  next_changed := NEW.nickname_changed_at;
  next_initialized := NEW.nickname_initialized;

  IF (
    next_nickname IS DISTINCT FROM OLD.public_nickname
    OR next_changed IS DISTINCT FROM OLD.nickname_changed_at
    OR next_initialized IS DISTINCT FROM OLD.nickname_initialized
  ) AND NOT trusted_nickname THEN
    RAISE EXCEPTION '暱稱只能透過正式修改流程更新';
  END IF;

  -- 先回到舊列，再只放行頭像與已授權的暱稱，避免改到認證、電話、地址或其他敏感欄位。
  NEW := OLD;
  NEW.avatar_url := next_avatar;
  NEW.avatar_tone := coalesce(next_tone, OLD.avatar_tone);
  IF trusted_nickname THEN
    NEW.public_nickname := next_nickname;
    NEW.nickname_changed_at := next_changed;
    NEW.nickname_initialized := next_initialized;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_sensitive ON public.profiles;
CREATE TRIGGER profiles_guard_sensitive
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_sensitive();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS profiles_update_own_public ON public.profiles;
CREATE POLICY profiles_update_own_public
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT INSERT (id) ON TABLE public.profiles TO authenticated;
GRANT UPDATE (avatar_url, avatar_tone) ON TABLE public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.profiles%ROWTYPE;
  next_at timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;

  INSERT INTO public.profiles (id)
  VALUES (uid)
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO row FROM public.profiles WHERE id = uid;

  next_at := CASE
    WHEN row.nickname_initialized AND row.nickname_changed_at IS NOT NULL
      THEN row.nickname_changed_at + interval '30 days'
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'publicNickname', row.public_nickname,
    'nicknameInitialized', row.nickname_initialized,
    'nicknameChangedAt', row.nickname_changed_at,
    'nextRenameAt', next_at,
    'canRename', next_at IS NULL OR next_at <= now(),
    'avatarUrl', row.avatar_url,
    'avatarTone', row.avatar_tone,
    'dbNow', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_public_nickname(p_nickname text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cleaned text := btrim(coalesce(p_nickname, ''));
  row public.profiles%ROWTYPE;
  next_at timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF cleaned = '' THEN
    RAISE EXCEPTION '暱稱不可空白';
  END IF;
  IF char_length(cleaned) < 2 OR char_length(cleaned) > 20 THEN
    RAISE EXCEPTION '暱稱需為 2 到 20 個字';
  END IF;
  IF cleaned ~ '[[:cntrl:]]' OR cleaned ~ '<[^>]*>' THEN
    RAISE EXCEPTION '暱稱包含無法使用的字元';
  END IF;

  INSERT INTO public.profiles (id)
  VALUES (uid)
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO row FROM public.profiles WHERE id = uid FOR UPDATE;

  IF row.nickname_initialized AND row.nickname_changed_at IS NOT NULL THEN
    next_at := row.nickname_changed_at + interval '30 days';
    IF next_at > now() THEN
      RAISE EXCEPTION '公開暱稱每 30 天只能修改一次，下次可修改時間為 %', to_char(next_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD HH24:MI');
    END IF;
  END IF;

  IF row.public_nickname IS NOT DISTINCT FROM cleaned THEN
    RAISE EXCEPTION '新暱稱與目前相同';
  END IF;

  PERFORM set_config('app.nickname_write', 'on', true);

  UPDATE public.profiles
  SET
    public_nickname = cleaned,
    nickname_initialized = true,
    nickname_changed_at = now()
  WHERE id = uid;

  RETURN public.get_my_profile();
END;
$$;

-- ---------------------------------------------------------------------------
-- 頭像 bucket。與 product-images、seller-kyc 分開。
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'member-avatars',
  'member-avatars',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS member_avatars_public_read ON storage.objects;
DROP POLICY IF EXISTS member_avatars_owner_insert ON storage.objects;
DROP POLICY IF EXISTS member_avatars_owner_update ON storage.objects;
DROP POLICY IF EXISTS member_avatars_owner_delete ON storage.objects;

CREATE POLICY member_avatars_public_read
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'member-avatars');

CREATE POLICY member_avatars_owner_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'member-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY member_avatars_owner_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'member-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'member-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY member_avatars_owner_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'member-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 收藏
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.product_favorites (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

ALTER TABLE public.product_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_favorites_own ON public.product_favorites;
CREATE POLICY product_favorites_own
  ON public.product_favorites
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.product_favorites FROM anon;
GRANT SELECT, INSERT, DELETE ON public.product_favorites TO authenticated;

-- ---------------------------------------------------------------------------
-- 關注賣家：seller_user_id = seller_applications.user_id
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.seller_follows (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  seller_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, seller_user_id),
  CONSTRAINT seller_follows_not_self CHECK (user_id <> seller_user_id)
);

ALTER TABLE public.seller_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_follows_select_own ON public.seller_follows;
CREATE POLICY seller_follows_select_own
  ON public.seller_follows
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.seller_follows FROM anon, authenticated;
GRANT SELECT ON public.seller_follows TO authenticated;

CREATE OR REPLACE FUNCTION public.follow_seller(p_seller_user_id uuid)
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

CREATE OR REPLACE FUNCTION public.unfollow_seller(p_seller_user_id uuid)
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

CREATE OR REPLACE FUNCTION public.public_follow_counts(p_ids uuid[])
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
-- 客服工單
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.support_tickets (
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

CREATE TABLE IF NOT EXISTS public.support_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  is_staff boolean NOT NULL DEFAULT false,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_tickets_select_own ON public.support_tickets;
CREATE POLICY support_tickets_select_own
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS support_replies_select_own ON public.support_replies;
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

REVOKE ALL ON public.support_tickets FROM anon, authenticated;
REVOKE ALL ON public.support_replies FROM anon, authenticated;
GRANT SELECT ON public.support_tickets TO authenticated;
GRANT SELECT ON public.support_replies TO authenticated;

CREATE OR REPLACE FUNCTION public.create_support_ticket(
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

CREATE OR REPLACE FUNCTION public.list_my_tickets()
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

CREATE OR REPLACE FUNCTION public.mark_ticket_read(p_id uuid)
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

CREATE OR REPLACE FUNCTION public.admin_list_tickets()
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

CREATE OR REPLACE FUNCTION public.admin_update_ticket(p_id uuid, p_status text, p_reply text)
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
-- 商品評價。送出函式在真實訂單明細存在前會拒絕。
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.product_reviews (
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

CREATE TABLE IF NOT EXISTS public.product_review_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.product_reviews (id) ON DELETE CASCADE,
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, path)
);

ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_review_photos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_reviews FROM anon, authenticated;
REVOKE ALL ON public.product_review_photos FROM anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'review-images',
  'review-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS review_images_public_read ON storage.objects;
DROP POLICY IF EXISTS review_images_owner_insert ON storage.objects;
DROP POLICY IF EXISTS review_images_owner_delete ON storage.objects;

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

CREATE OR REPLACE FUNCTION public.jsonb_min_price(j jsonb)
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

CREATE OR REPLACE FUNCTION public.spec_value(p_specs jsonb, p_keys text[])
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

CREATE OR REPLACE FUNCTION public.specific_name_tokens(p_name text)
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

CREATE OR REPLACE FUNCTION public.list_public_reviews(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT coalesce(jsonb_agg(item ORDER BY item.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT
        r.id,
        r.product_id,
        r.rating,
        r.body,
        r.created_at,
        r.seller_reply,
        r.seller_replied_at,
        coalesce(nullif(btrim(p.public_nickname), ''), '買家') AS nickname,
        coalesce(
          (
            SELECT jsonb_agg(ph.path ORDER BY ph.created_at)
            FROM public.product_review_photos ph
            WHERE ph.review_id = r.id
          ),
          '[]'::jsonb
        ) AS photos
      FROM public.product_reviews r
      LEFT JOIN public.profiles p ON p.id = r.user_id
      JOIN public.products pr ON pr.id = r.product_id
      WHERE r.product_id = ANY (coalesce(p_ids, ARRAY[]::uuid[]))
        AND (
          public.product_is_public(to_jsonb(pr))
          OR pr.seller_id = auth.uid()
        )
    ) item
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_reviews()
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

CREATE OR REPLACE FUNCTION public.create_product_review(
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

CREATE OR REPLACE FUNCTION public.attach_review_photo(p_review_id uuid, p_path text)
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

CREATE OR REPLACE FUNCTION public.reply_to_product_review(p_review_id uuid, p_text text)
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
-- 找相似。只讀公開商品與賣場名稱，不讀 KYC。
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.find_similar_products(
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
-- 真實銷量。來源是 sales_recognitions，不是 products.sold。
-- 第三階段完成交易後呼叫 recognize_sale；前端不能執行它。
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sales_recognitions (
  order_item_id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  seller_user_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_recognitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_recognitions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_verified_sales(p_ids uuid[])
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

CREATE OR REPLACE FUNCTION public.recognize_sale(
  p_order_item_id uuid,
  p_product_id uuid,
  p_seller_user_id uuid,
  p_quantity integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean := false;
BEGIN
  IF p_order_item_id IS NULL OR p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION '銷量認列資料不完整';
  END IF;
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION '銷量只能由訂單交易寫入';
  END IF;
  IF to_regclass('public.order_items') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'completed_at'
     ) THEN
    RAISE EXCEPTION '真實訂單尚未完成，不能認列銷量';
  END IF;

  BEGIN
    EXECUTE $q$
      SELECT oi.product_id = $2
         AND p.seller_id = $3
         AND o.completed_at IS NOT NULL
         AND GREATEST(oi.quantity - coalesce(oi.refunded_qty, 0), 0) = $4
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.id = $1
    $q$ INTO ok USING p_order_item_id, p_product_id, p_seller_user_id, p_quantity;
  EXCEPTION
    WHEN undefined_column OR undefined_table THEN
      RAISE EXCEPTION '真實訂單尚未完成，不能認列銷量';
  END;

  IF NOT coalesce(ok, false) THEN
    RAISE EXCEPTION '這筆訂單明細尚未達到可認列的完成狀態';
  END IF;

  INSERT INTO public.sales_recognitions (order_item_id, product_id, seller_user_id, quantity, updated_at)
  VALUES (p_order_item_id, p_product_id, p_seller_user_id, p_quantity, now())
  ON CONFLICT (order_item_id) DO UPDATE
  SET
    product_id = EXCLUDED.product_id,
    seller_user_id = EXCLUDED.seller_user_id,
    quantity = EXCLUDED.quantity,
    updated_at = now()
  WHERE public.sales_recognitions.quantity IS DISTINCT FROM EXCLUDED.quantity
     OR public.sales_recognitions.product_id IS DISTINCT FROM EXCLUDED.product_id;
END;
$$;

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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'sold'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS products_preserve_sold ON public.products';
    EXECUTE 'CREATE TRIGGER products_preserve_sold BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.preserve_product_sold()';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 賣場裝潢
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.storefronts (
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

ALTER TABLE public.storefronts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS storefronts_owner_select ON public.storefronts;
CREATE POLICY storefronts_owner_select
  ON public.storefronts
  FOR SELECT
  TO authenticated
  USING (seller_user_id = auth.uid() OR public.is_platform_admin());

REVOKE ALL ON public.storefronts FROM anon, authenticated;
GRANT SELECT ON public.storefronts TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'store-media',
  'store-media',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS store_media_public_read ON storage.objects;
DROP POLICY IF EXISTS store_media_seller_insert ON storage.objects;
DROP POLICY IF EXISTS store_media_seller_update ON storage.objects;
DROP POLICY IF EXISTS store_media_seller_delete ON storage.objects;

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

CREATE OR REPLACE FUNCTION public.store_media_url_ok(p_url text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  uid text := auth.uid()::text;
  issuer text := coalesce(auth.jwt() ->> 'iss', '');
  host text;
  host_re text;
  path text;
  filename text;
BEGIN
  IF p_url IS NULL OR btrim(p_url) = '' THEN
    RETURN true;
  END IF;
  IF uid IS NULL THEN
    RETURN false;
  END IF;
  host := substring(issuer FROM '^https://([a-z0-9-]+\.supabase\.co)/auth/v1$');
  IF host IS NULL THEN
    RETURN false;
  END IF;
  host_re := replace(host, '.', '\.');
  IF p_url !~ (
    '^https://' || host_re || '/storage/v1/object/public/store-media/'
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

  INSERT INTO public.storefronts (
    seller_user_id, banner_url, logo_url, intro, theme, featured_product_ids, category_order, updated_at
  )
  VALUES (
    uid,
    NULLIF(p_banner_url, ''),
    NULLIF(p_logo_url, ''),
    cleaned,
    p_theme,
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
    updated_at = now();
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
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT * INTO row FROM public.storefronts WHERE seller_user_id = uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'bannerUrl', NULL,
      'logoUrl', NULL,
      'intro', '',
      'theme', 'default',
      'featuredIds', '[]'::jsonb,
      'categories', '[]'::jsonb
    );
  END IF;
  RETURN jsonb_build_object(
    'bannerUrl', row.banner_url,
    'logoUrl', row.logo_url,
    'intro', row.intro,
    'theme', row.theme,
    'featuredIds', to_jsonb(row.featured_product_ids),
    'categories', to_jsonb(row.category_order)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.public_store_names(p_ids uuid[])
RETURNS TABLE (seller_user_id uuid, store_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (sa.user_id)
    sa.user_id,
    sa.store_name
  FROM public.seller_applications sa
  WHERE sa.user_id = ANY (coalesce(p_ids, ARRAY[]::uuid[]))
    AND sa.status = 'approved'
    AND nullif(btrim(sa.store_name), '') IS NOT NULL
  ORDER BY sa.user_id, sa.created_at DESC
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
  RETURN jsonb_build_object(
    'sellerUserId', p_seller_user_id,
    'storeName', store_name,
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
-- 執行權限
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_profile_sensitive() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_public_nickname(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.follow_seller(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unfollow_seller(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_follow_counts(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_support_ticket(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_tickets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_ticket_read(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_list_tickets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_ticket(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jsonb_max_price(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jsonb_min_price(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.product_is_public(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.spec_value(jsonb, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.specific_name_tokens(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_public_reviews(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_my_reviews() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_product_review(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_review_photo(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reply_to_product_review(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_similar_products(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_verified_sales(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recognize_sale(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preserve_product_sold() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_media_url_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_storefront(text, text, text, text, uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_storefront() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_store_names(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_storefront(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_public_nickname(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.follow_seller(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unfollow_seller(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_follow_counts(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_tickets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_ticket_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_tickets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_ticket(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_reviews(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_reviews() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_review(uuid, uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_review_photo(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reply_to_product_review(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_similar_products(uuid, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_verified_sales(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_storefront(text, text, text, text, uuid[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_storefront() TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_store_names(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_storefront(uuid) TO anon, authenticated;

COMMIT;
