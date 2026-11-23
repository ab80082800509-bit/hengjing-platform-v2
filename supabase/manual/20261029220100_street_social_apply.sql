-- =============================================================================
-- 第七階段第 5 批正式套用版：夢想商店街公開街景、按讚與拜訪人氣。
-- 狀態：待站長確認，尚未執行。確認前不得在正式 Supabase 執行。
-- 先跑 20261029220000_street_batch5_6_readonly_check.sql，batch5_gate 顯示可以套用才執行本檔。
--
-- 來源：20261027202000_street_social_preview.sql。資料表、函式、觸發器、權限與自我檢查逐字沿用。
-- 與草案的差異只有：
--   1. 移除草案第 716 行以後的本機驗收段落。正式版不建立、不刪除 auth.users／auth.identities
--      測試會員，不寫入或改寫 public.profiles，也不在正式庫留下任何測試列。
--   2. 開頭加上唯讀前置檢查。任何第 5 批資料表或函式已存在、或 profiles 欄位不相容，就整份停止。
--      因此不會用 CREATE OR REPLACE 蓋掉已上線的同名函式，也不會在既有表上重設權限。
--   3. 結尾通知 PostgREST 重新載入函式清單。
--
-- 對正式資料的影響：
--   只新增三張空表 member_street_exhibits、member_street_likes、member_street_visits 與其函式。
--   不讀寫既有會員、好友、邀請、點數、遊戲進度或資產資料列。
--   唯一讀取的既有資料是 street_public_identity 執行時讀 public.profiles 的暱稱與頭像（只讀）。
--   整份包在單一交易，任一檢查失敗即整份回復。
--
-- 規則（與草案相同）：
--   1. 預設不公開。只有屋主呼叫 set_my_street_exhibit(true, ...) 之後，其他會員才讀得到。
--   2. 未公開與查無此人回傳同一種 closed，避免用會員編號探出誰有街景。
--   3. 按讚是每位會員對每條街一列，再按一次取消。有效讚數是 active = true 的列數。
--   4. 拜訪是每位會員、每條街、每個 Asia/Taipei 日一列。屋主讀自己的街不記拜訪。
--   5. 會員不能直接讀寫這三張表，也不能替別人發布街景或改別人的讚。
--   6. 等級、店面與裝潢來自會員瀏覽器的 v3 存檔，只供參觀畫面，不得用來發放 Pay 點數或排行獎勵。
--   7. 取消公開不需要有效街景。
--   8. auth.users 刪除時，外鍵連動清掉這三張表的該會員列。一般會員仍不能直接讀寫。
-- =============================================================================

BEGIN;

DO $street_batch5_preflight$
DECLARE
  id_type text;
  nick_type text;
  avatar_type text;
  tone_type text;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 140000 THEN
    RAISE EXCEPTION '第 5 批需要 PostgreSQL 14 以上';
  END IF;
  IF pg_catalog.to_regclass('auth.users') IS NULL
     OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure('auth.jwt()') IS NULL THEN
    RAISE EXCEPTION '找不到 auth.users、auth.uid() 或 auth.jwt()，停止套用';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION '找不到 anon 或 authenticated 角色，停止套用';
  END IF;
  IF pg_catalog.to_regclass('public.member_street_exhibits') IS NOT NULL
     OR pg_catalog.to_regclass('public.member_street_likes') IS NOT NULL
     OR pg_catalog.to_regclass('public.member_street_visits') IS NOT NULL THEN
    RAISE EXCEPTION '第 5 批資料表已存在。為保護正式資料，本檔不重跑';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = proc.pronamespace
    WHERE nsp.nspname = 'public'
      AND proc.proname = ANY (ARRAY[
        'street_taipei_day', 'street_building_min_level', 'street_decor_min_level', 'street_decor_slot',
        'street_normalize_exhibit', 'street_social_counts', 'street_public_identity', 'street_exhibit_payload',
        'guard_street_social_write', 'get_my_street_social', 'set_my_street_exhibit', 'get_public_street',
        'toggle_street_like'
      ])
  ) THEN
    RAISE EXCEPTION '第 5 批同名函式已存在。為避免覆蓋正式函式，本檔停止';
  END IF;

  SELECT c.data_type INTO id_type
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public' AND c.table_name = 'profiles' AND c.column_name = 'id';
  SELECT c.data_type INTO nick_type
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public' AND c.table_name = 'profiles' AND c.column_name = 'public_nickname';
  SELECT c.data_type INTO avatar_type
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public' AND c.table_name = 'profiles' AND c.column_name = 'avatar_url';
  SELECT c.data_type INTO tone_type
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public' AND c.table_name = 'profiles' AND c.column_name = 'avatar_tone';
  IF id_type IS DISTINCT FROM 'uuid'
     OR nick_type IS DISTINCT FROM 'text'
     OR avatar_type IS DISTINCT FROM 'text'
     OR tone_type IS NULL OR tone_type NOT IN ('smallint', 'integer') THEN
    RAISE EXCEPTION 'public.profiles 與公開街景不相容。需要 id uuid、public_nickname text、avatar_url text、avatar_tone smallint。本檔不修改會員資料表';
  END IF;
END
$street_batch5_preflight$;

CREATE OR REPLACE FUNCTION public.street_taipei_day(instant timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT (instant AT TIME ZONE 'Asia/Taipei')::date
$$;

CREATE OR REPLACE FUNCTION public.street_building_min_level(p_id text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE p_id
    WHEN 'tea' THEN 2
    WHEN 'gift' THEN 4
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.street_decor_min_level(p_id text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE p_id
    WHEN 'mat' THEN 1
    WHEN 'lantern' THEN 1
    WHEN 'flower' THEN 2
    WHEN 'bunting' THEN 1
    WHEN 'planters' THEN 2
    WHEN 'lights' THEN 3
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.street_decor_slot(p_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE p_id
    WHEN 'mat' THEN 'shop'
    WHEN 'lantern' THEN 'shop'
    WHEN 'flower' THEN 'shop'
    WHEN 'bunting' THEN 'street'
    WHEN 'planters' THEN 'street'
    WHEN 'lights' THEN 'street'
    ELSE NULL
  END
$$;

-- 只留下展示需要的欄位。金幣、庫存、Email 或其他多餘欄位都不會進回傳值。
CREATE OR REPLACE FUNCTION public.street_normalize_exhibit(p_view jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  level integer;
  buildings jsonb := '[]'::jsonb;
  shops jsonb := '{}'::jsonb;
  street text;
  item text;
  shop_key text;
  decor text;
  equipped jsonb;
BEGIN
  IF p_view IS NULL OR jsonb_typeof(p_view) IS DISTINCT FROM 'object' OR octet_length(p_view::text) > 4000 THEN
    RAISE EXCEPTION '街景內容不正確';
  END IF;
  IF jsonb_typeof(p_view -> 'shopLevel') IS DISTINCT FROM 'number' OR (p_view ->> 'shopLevel') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION '街景內容不正確';
  END IF;
  level := (p_view ->> 'shopLevel')::integer;
  IF level < 1 OR level > 5 THEN
    RAISE EXCEPTION '街景內容不正確';
  END IF;

  IF jsonb_typeof(p_view -> 'buildings') = 'array' THEN
    FOR item IN SELECT jsonb_array_elements_text(p_view -> 'buildings')
    LOOP
      IF item = 'tea' AND level >= public.street_building_min_level('tea') AND NOT buildings @> '["tea"]'::jsonb THEN
        buildings := buildings || '["tea"]'::jsonb;
      ELSIF item = 'gift' AND level >= public.street_building_min_level('gift') AND NOT buildings @> '["gift"]'::jsonb THEN
        buildings := buildings || '["gift"]'::jsonb;
      END IF;
    END LOOP;
  END IF;

  equipped := p_view -> 'equipped';
  IF jsonb_typeof(equipped) IS DISTINCT FROM 'object' THEN
    equipped := '{}'::jsonb;
  END IF;
  street := equipped ->> 'street';
  IF public.street_decor_slot(street) IS DISTINCT FROM 'street'
     OR public.street_decor_min_level(street) IS NULL
     OR level < public.street_decor_min_level(street) THEN
    street := NULL;
  END IF;

  IF jsonb_typeof(equipped -> 'shops') = 'object' THEN
    FOR shop_key, decor IN SELECT key, value FROM jsonb_each_text(equipped -> 'shops')
    LOOP
      IF shop_key NOT IN ('main', 'tea', 'gift') THEN
        CONTINUE;
      END IF;
      IF shop_key <> 'main' AND NOT buildings @> jsonb_build_array(shop_key) THEN
        CONTINUE;
      END IF;
      IF public.street_decor_slot(decor) IS DISTINCT FROM 'shop' OR public.street_decor_min_level(decor) IS NULL THEN
        CONTINUE;
      END IF;
      IF level < public.street_decor_min_level(decor) THEN
        CONTINUE;
      END IF;
      shops := shops || jsonb_build_object(shop_key, decor);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'shopLevel', level,
    'buildings', buildings,
    'equipped', jsonb_build_object('street', to_jsonb(street), 'shops', shops)
  );
END;
$$;

CREATE TABLE IF NOT EXISTS public.member_street_exhibits (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  published boolean NOT NULL DEFAULT false,
  shop_level smallint NOT NULL CHECK (shop_level BETWEEN 1 AND 5),
  buildings jsonb NOT NULL,
  equipped jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_street_exhibits_buildings_array CHECK (jsonb_typeof(buildings) = 'array'),
  CONSTRAINT member_street_exhibits_equipped_object CHECK (jsonb_typeof(equipped) = 'object')
);

CREATE TABLE IF NOT EXISTS public.member_street_likes (
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  active boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, member_id),
  CONSTRAINT member_street_likes_not_self CHECK (owner_id <> member_id)
);

CREATE TABLE IF NOT EXISTS public.member_street_visits (
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  visit_day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, member_id, visit_day),
  CONSTRAINT member_street_visits_not_self CHECK (owner_id <> member_id)
);

CREATE INDEX IF NOT EXISTS member_street_likes_active
  ON public.member_street_likes (owner_id) WHERE active;
CREATE INDEX IF NOT EXISTS member_street_visits_owner_day
  ON public.member_street_visits (owner_id, visit_day);

CREATE OR REPLACE FUNCTION public.guard_street_social_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  user_gone boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- 外鍵連動發生在 auth.users 那一列已經從本交易消失之後，或包在外鍵觸發器裡。
    -- 這兩種都要放行，否則會員帳號刪不掉。一般連線直接刪這三張表時，會員還在且深度是 1，仍要擋住。
    IF pg_catalog.pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    IF TG_TABLE_NAME = 'member_street_exhibits' THEN
      user_gone := NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id);
    ELSIF TG_TABLE_NAME IN ('member_street_likes', 'member_street_visits') THEN
      user_gone := NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.owner_id)
        OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.member_id);
    END IF;
    IF user_gone THEN
      RETURN OLD;
    END IF;
  END IF;
  IF pg_catalog.current_setting('street.internal', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '街景互動只能由商店街交易更新';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_street_social_write() IS
  '擋下一般寫入。auth.users 外鍵連動刪除必須放行；一般會員直接刪除仍拒絕。';

DROP TRIGGER IF EXISTS member_street_exhibits_guard ON public.member_street_exhibits;
CREATE TRIGGER member_street_exhibits_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_street_exhibits
  FOR EACH ROW EXECUTE FUNCTION public.guard_street_social_write();

DROP TRIGGER IF EXISTS member_street_likes_guard ON public.member_street_likes;
CREATE TRIGGER member_street_likes_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_street_likes
  FOR EACH ROW EXECUTE FUNCTION public.guard_street_social_write();

DROP TRIGGER IF EXISTS member_street_visits_guard ON public.member_street_visits;
CREATE TRIGGER member_street_visits_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_street_visits
  FOR EACH ROW EXECUTE FUNCTION public.guard_street_social_write();

ALTER TABLE public.member_street_exhibits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_street_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_street_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_street_exhibits_none ON public.member_street_exhibits;
DROP POLICY IF EXISTS member_street_likes_none ON public.member_street_likes;
DROP POLICY IF EXISTS member_street_visits_none ON public.member_street_visits;

REVOKE ALL ON TABLE public.member_street_exhibits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_street_likes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_street_visits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.street_social_counts(p_owner uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'likes', (SELECT count(*)::integer FROM public.member_street_likes WHERE owner_id = p_owner AND active),
    'visitors', (SELECT count(DISTINCT member_id)::integer FROM public.member_street_visits WHERE owner_id = p_owner),
    'todayVisitors', (
      SELECT count(*)::integer FROM public.member_street_visits
      WHERE owner_id = p_owner AND visit_day = public.street_taipei_day(now())
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.street_public_identity(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  nick text;
  avatar text;
  tone integer;
  issuer text := '';
  origin text;
  folder text;
  object_name text;
BEGIN
  SELECT NULLIF(pg_catalog.btrim(public_nickname), ''), avatar_url, avatar_tone
    INTO nick, avatar, tone
  FROM public.profiles
  WHERE id = p_owner;

  nick := pg_catalog.left(pg_catalog.regexp_replace(COALESCE(nick, ''), '[[:cntrl:]]', '', 'g'), 20);
  IF pg_catalog.char_length(nick) < 2 THEN
    nick := '店長';
  END IF;

  -- 頭像只接受「這次登入令牌的同一個站台」上、該會員自己的 member-avatars 公開物件。
  -- 不能帶回任意 https 網址，也不能借用別的會員目錄。本機隔離庫的發行者是 http://127.0.0.1 或 localhost。
  IF pg_catalog.to_regprocedure('auth.jwt()') IS NOT NULL THEN
    issuer := COALESCE(auth.jwt() ->> 'iss', '');
  END IF;
  origin := NULL;
  IF issuer ~ '^https://[a-z0-9-]+\.supabase\.co/auth/v1$'
     OR issuer ~ '^http://127\.0\.0\.1:[0-9]{2,5}/auth/v1$'
     OR issuer ~ '^http://localhost:[0-9]{2,5}/auth/v1$' THEN
    origin := pg_catalog.regexp_replace(issuer, '/auth/v1$', '');
  END IF;
  folder := origin || '/storage/v1/object/public/member-avatars/' || pg_catalog.lower(p_owner::text) || '/';
  object_name := NULL;
  IF origin IS NOT NULL
     AND avatar IS NOT NULL
     AND pg_catalog.char_length(avatar) <= 500
     AND pg_catalog.strpos(avatar, '@') = 0
     AND pg_catalog.strpos(avatar, '?') = 0
     AND pg_catalog.strpos(avatar, '#') = 0
     AND pg_catalog.strpos(avatar, '%') = 0
     AND pg_catalog.strpos(avatar, pg_catalog.chr(92)) = 0
     AND pg_catalog.lower(avatar) LIKE pg_catalog.lower(folder) || '%' THEN
    object_name := pg_catalog.substr(pg_catalog.lower(avatar), pg_catalog.char_length(folder) + 1);
  END IF;
  IF object_name IS NULL
     OR object_name !~ '^[a-z0-9][a-z0-9._-]{0,80}\.(jpg|jpeg|png|webp)$'
     OR pg_catalog.strpos(object_name, '/') > 0
     OR pg_catalog.strpos(object_name, '..') > 0 THEN
    avatar := NULL;
  ELSE
    avatar := folder || object_name;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'nickname', nick,
    'avatarUrl', avatar,
    'avatarTone', LEAST(5, GREATEST(0, COALESCE(tone, 0)))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.street_exhibit_payload(
  p_row public.member_street_exhibits,
  p_caller uuid,
  p_identity boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  counts jsonb := public.street_social_counts(p_row.user_id);
  liked boolean := false;
  identity jsonb := '{}'::jsonb;
BEGIN
  SELECT active INTO liked
  FROM public.member_street_likes
  WHERE owner_id = p_row.user_id AND member_id = p_caller;
  IF p_identity THEN
    identity := public.street_public_identity(p_row.user_id);
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'published', p_row.published,
    'ownerId', CASE WHEN p_identity THEN p_row.user_id ELSE NULL END,
    'likes', (counts ->> 'likes')::integer,
    'visitors', (counts ->> 'visitors')::integer,
    'todayVisitors', (counts ->> 'todayVisitors')::integer,
    'likedByMe', coalesce(liked, false),
    'shopLevel', p_row.shop_level,
    'buildings', p_row.buildings,
    'equipped', p_row.equipped,
    'revision', p_row.revision,
    'updatedAt', p_row.updated_at
  ) || identity;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_street_social()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.member_street_exhibits%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT * INTO row FROM public.member_street_exhibits WHERE user_id = uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'published', false,
      'likes', 0,
      'visitors', 0,
      'todayVisitors', 0,
      'revision', 0,
      'updatedAt', NULL,
      'shopLevel', NULL
    );
  END IF;
  RETURN public.street_exhibit_payload(row, uid, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_street_exhibit(p_published boolean, p_view jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  view jsonb;
  view_ok boolean := false;
  row public.member_street_exhibits%ROWTYPE;
  result jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_published IS NULL THEN
    RAISE EXCEPTION '街景內容不正確';
  END IF;

  -- 打開公開仍要有效街景。關掉公開時，存檔遺失或內容無效不能擋住取消。
  IF p_published THEN
    view := public.street_normalize_exhibit(p_view);
    view_ok := true;
  ELSE
    BEGIN
      view := public.street_normalize_exhibit(p_view);
      view_ok := true;
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM IS DISTINCT FROM '街景內容不正確' THEN
          RAISE;
        END IF;
        view := NULL;
        view_ok := false;
    END;
  END IF;

  PERFORM pg_catalog.set_config('street.internal', 'on', true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-exhibit:' || uid::text, 0));

  IF NOT p_published AND NOT view_ok THEN
    UPDATE public.member_street_exhibits
    SET published = false,
        revision = CASE WHEN published THEN revision + 1 ELSE revision END,
        updated_at = CASE WHEN published THEN pg_catalog.now() ELSE updated_at END
    WHERE user_id = uid
    RETURNING * INTO row;
    IF NOT FOUND THEN
      PERFORM pg_catalog.set_config('street.internal', 'off', true);
      RETURN pg_catalog.jsonb_build_object(
        'ok', true,
        'published', false,
        'likes', 0,
        'visitors', 0,
        'todayVisitors', 0,
        'revision', 0,
        'updatedAt', NULL,
        'shopLevel', NULL
      );
    END IF;
  ELSE
    INSERT INTO public.member_street_exhibits (user_id, published, shop_level, buildings, equipped, revision)
    VALUES (
      uid,
      p_published,
      (view ->> 'shopLevel')::smallint,
      view -> 'buildings',
      view -> 'equipped',
      1
    )
    ON CONFLICT (user_id) DO UPDATE SET
      published = EXCLUDED.published,
      shop_level = EXCLUDED.shop_level,
      buildings = EXCLUDED.buildings,
      equipped = EXCLUDED.equipped,
      revision = public.member_street_exhibits.revision + 1,
      updated_at = pg_catalog.now()
    RETURNING * INTO row;
  END IF;

  result := public.street_exhibit_payload(row, uid, false);
  PERFORM pg_catalog.set_config('street.internal', 'off', true);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_street(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.member_street_exhibits%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed');
  END IF;
  SELECT * INTO row
  FROM public.member_street_exhibits
  WHERE user_id = p_owner AND published;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed');
  END IF;
  IF uid IS DISTINCT FROM p_owner THEN
    PERFORM pg_catalog.set_config('street.internal', 'on', true);
    INSERT INTO public.member_street_visits (owner_id, member_id, visit_day)
    VALUES (p_owner, uid, public.street_taipei_day(pg_catalog.now()))
    ON CONFLICT DO NOTHING;
    PERFORM pg_catalog.set_config('street.internal', 'off', true);
  END IF;
  RETURN public.street_exhibit_payload(row, uid, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_street_like(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  liked boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_owner IS NULL OR uid = p_owner THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.member_street_exhibits WHERE user_id = p_owner AND published
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed');
  END IF;
  PERFORM pg_catalog.set_config('street.internal', 'on', true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-like:' || p_owner::text || ':' || uid::text, 0));
  INSERT INTO public.member_street_likes (owner_id, member_id, active)
  VALUES (p_owner, uid, true)
  ON CONFLICT (owner_id, member_id) DO UPDATE SET
    active = NOT public.member_street_likes.active,
    updated_at = pg_catalog.now()
  RETURNING active INTO liked;
  PERFORM pg_catalog.set_config('street.internal', 'off', true);
  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'likes', (SELECT count(*)::integer FROM public.member_street_likes WHERE owner_id = p_owner AND active),
    'likedByMe', liked
  );
END;
$$;

REVOKE ALL ON FUNCTION public.street_taipei_day(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_building_min_level(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_decor_min_level(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_decor_slot(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_normalize_exhibit(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_social_counts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_public_identity(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_exhibit_payload(public.member_street_exhibits, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_street_social_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_street_social() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_street_exhibit(boolean, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_public_street(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.toggle_street_like(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_street_social() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_street_exhibit(boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_street(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_street_like(uuid) TO authenticated;

COMMENT ON TABLE public.member_street_exhibits IS
  '會員同意公開的夢想商店街展示。不含金幣、庫存、訂單或私人聯絡資料。等級與裝潢來自瀏覽器存檔，不是伺服器已驗證的成就。';
COMMENT ON COLUMN public.member_street_exhibits.shop_level IS
  '瀏覽器 v3 存檔投影的展示等級。只檢查形狀是否自洽，不是伺服器驗證的成就，不得用來發放 Pay 點數或排行獎勵。';
COMMENT ON COLUMN public.member_street_exhibits.buildings IS
  '瀏覽器 v3 存檔投影的已開幕店面。未經伺服器重算，只供參觀畫面。';
COMMENT ON COLUMN public.member_street_exhibits.equipped IS
  '瀏覽器 v3 存檔投影的裝潢。未經伺服器重算，只供參觀畫面。';
COMMENT ON TABLE public.member_street_likes IS
  '每位會員對每條商店街最多一列讚，active 取消後不再計入。';
COMMENT ON TABLE public.member_street_visits IS
  '每位會員對每條商店街每個台北日最多一列。屋主自己的進出不寫入。';

-- 刪除 auth.users 的角色必須能執行守衛，否則 REVOKE PUBLIC 會讓外鍵連動在進函數前就失敗。
DO $street_guard_grant$
DECLARE
  auth_owner text;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(cls.relowner)
    INTO auth_owner
  FROM pg_catalog.pg_class AS cls
  WHERE cls.oid = 'auth.users'::regclass;
  IF auth_owner IS NOT NULL AND auth_owner NOT IN ('anon', 'authenticated', 'public') THEN
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.guard_street_social_write() TO %I', auth_owner);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin')
     AND auth_owner IS DISTINCT FROM 'supabase_auth_admin' THEN
    GRANT EXECUTE ON FUNCTION public.guard_street_social_write() TO supabase_auth_admin;
  END IF;
END
$street_guard_grant$;

DO $$
DECLARE
  actor text;
  rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['member_street_exhibits', 'member_street_likes', 'member_street_visits']
  LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || rel)::regclass) THEN
      RAISE EXCEPTION '% 未啟用 RLS', rel;
    END IF;
    FOREACH actor IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF has_table_privilege(actor, 'public.' || rel, 'SELECT')
         OR has_table_privilege(actor, 'public.' || rel, 'INSERT')
         OR has_table_privilege(actor, 'public.' || rel, 'UPDATE')
         OR has_table_privilege(actor, 'public.' || rel, 'DELETE') THEN
        RAISE EXCEPTION '% 仍可直接存取 %', actor, rel;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid IN (
      'public.member_street_exhibits'::regclass,
      'public.member_street_likes'::regclass,
      'public.member_street_visits'::regclass
    )
  ) THEN
    RAISE EXCEPTION '街景社交表不該有直接讀寫政策';
  END IF;

  IF has_function_privilege('anon', 'public.get_public_street(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.toggle_street_like(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.set_my_street_exhibit(boolean, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_my_street_social()', 'EXECUTE') THEN
    RAISE EXCEPTION '匿名不可使用街景社交';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.get_public_street(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.toggle_street_like(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.set_my_street_exhibit(boolean, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_my_street_social()', 'EXECUTE') THEN
    RAISE EXCEPTION '已登入會員應可使用街景社交函式';
  END IF;

  IF has_function_privilege('authenticated', 'public.street_normalize_exhibit(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.street_public_identity(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.street_public_identity(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.street_social_counts(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.street_exhibit_payload(public.member_street_exhibits, uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.guard_street_social_write()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.guard_street_social_write()', 'EXECUTE')
     OR has_function_privilege('public', 'public.guard_street_social_write()', 'EXECUTE') THEN
    RAISE EXCEPTION '內部街景函式不該被直接呼叫';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin')
     AND NOT has_function_privilege('supabase_auth_admin', 'public.guard_street_social_write()', 'EXECUTE') THEN
    RAISE EXCEPTION '會員刪除角色必須能執行街景刪除守衛，否則外鍵連動會被權限擋住';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = proc.pronamespace
    WHERE nsp.nspname = 'public'
      AND proc.proname = ANY (ARRAY[
        'street_taipei_day', 'street_building_min_level', 'street_decor_min_level', 'street_decor_slot',
        'street_normalize_exhibit', 'street_social_counts', 'street_public_identity', 'street_exhibit_payload',
        'guard_street_social_write', 'get_my_street_social', 'set_my_street_exhibit', 'get_public_street',
        'toggle_street_like'
      ])
      AND NOT ('search_path=pg_catalog' = ANY (COALESCE(proc.proconfig, ARRAY[]::text[])))
  ) THEN
    RAISE EXCEPTION '街景函式必須固定 search_path = pg_catalog';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = proc.pronamespace
    WHERE nsp.nspname = 'public'
      AND proc.proname = ANY (ARRAY[
        'street_social_counts', 'street_public_identity', 'street_exhibit_payload',
        'get_my_street_social', 'set_my_street_exhibit', 'get_public_street', 'toggle_street_like'
      ])
      AND proc.prosecdef IS NOT TRUE
  ) THEN
    RAISE EXCEPTION '讀寫街景資料的函式必須是 SECURITY DEFINER，避免會員直接碰表';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
