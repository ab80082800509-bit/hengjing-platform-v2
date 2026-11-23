-- 第七階段第 5 批草案：夢想商店街公開街景、按讚與拜訪人氣。
-- 狀態：提案，尚未執行。須經站長核准後，只在本機隔離 Supabase 套用驗證，不得直接套用正式專案。
-- 依賴：auth.users、public.profiles(id, public_nickname, avatar_url, avatar_tone)。
--
-- 私人 v3 經營存檔仍留在瀏覽器，本草案不建立、不讀取、不覆蓋那份存檔。
-- 公開資料只有店面等級、已開幕街邊店、裝潢，以及會員已公開的暱稱與頭像。
-- 不寫入金幣、經驗、庫存、訂單、Email、電話、地址、KYC 或 Pay 點數。
--
-- 規則：
--   1. 預設不公開。只有屋主呼叫 set_my_street_exhibit(true, ...) 之後，其他會員才讀得到。
--   2. 未公開與查無此人回傳同一種 closed，避免用會員編號探出誰有街景。
--   3. 按讚是每位會員對每條街一列，再按一次取消。有效讚數是 active = true 的列數。
--   4. 拜訪是每位會員、每條街、每個 Asia/Taipei 日一列。屋主讀自己的街不記拜訪。
--   5. 會員不能直接讀寫這三張表，也不能替別人發布街景或改別人的讚。
--   6. 等級、店面與裝潢來自會員瀏覽器的 v3 存檔，由前端投影後送入。
--      資料庫只檢查形狀與門檻是否自洽，不會把它當成伺服器已驗證的成就。
--      這些欄位只供參觀畫面，不得用來發放 Pay 點數或排行獎勵。
--   7. 取消公開不需要有效街景。存檔遺失或內容無效時，仍把已公開的列改回不公開。
--   8. auth.users 刪除時，外鍵連動必須能清掉這三張表。一般會員仍不能直接讀寫。
-- 第 6～9 批（好友互助、趣味偷貨、排行榜、長期活動）不在本草案。

BEGIN;

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

-- 本機隔離驗收：只建立兩位 example.invalid 測試會員，測完就刪除。
-- 通過後交易仍會提交資料表與函式；測試會員與他們的街景列不會留下。
-- 不修改既有會員資料表，也不刪除測試範圍以外的帳號。
DO $street_profiles$
DECLARE
  id_type text;
  nick_type text;
  avatar_type text;
  tone_type text;
BEGIN
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
     OR tone_type NOT IN ('smallint', 'integer') THEN
    RAISE EXCEPTION 'public.profiles 與公開街景不相容。需要 id uuid、public_nickname text、avatar_url text、avatar_tone smallint。本草案不修改會員資料表。';
  END IF;
  PERFORM id, public_nickname, avatar_url, avatar_tone
  FROM public.profiles
  WHERE false;
END
$street_profiles$;

DO $street_iso_seed$
DECLARE
  label text;
  new_id uuid;
  email text;
  inst uuid;
  col record;
  cols text;
  vals text;
  sep text;
  expr text;
  missing text;
  owner uuid;
  visitor uuid;
  result jsonb;
  view jsonb := '{"shopLevel":3,"buildings":["tea","gift"],"equipped":{"street":"lights","shops":{"main":"lantern","tea":"flower","gift":"mat"}}}'::jsonb;
  good_avatar text;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION '街景隔離測試必須由資料庫擁有者開始。交易會回復。';
  END IF;

  DROP TABLE IF EXISTS pg_temp.street_iso_before;
  DROP TABLE IF EXISTS pg_temp.street_iso_users;
  CREATE TEMP TABLE pg_temp.street_iso_before AS
  SELECT
    (SELECT count(*)::bigint FROM public.member_street_exhibits) AS exhibits,
    (SELECT count(*)::bigint FROM public.member_street_likes) AS likes,
    (SELECT count(*)::bigint FROM public.member_street_visits) AS visits,
    (SELECT count(*)::bigint FROM auth.users) AS users,
    (SELECT count(*)::bigint FROM public.profiles) AS profiles;
  CREATE TEMP TABLE pg_temp.street_iso_users (
    id uuid PRIMARY KEY
  );

  SELECT u.instance_id
  INTO inst
  FROM auth.users AS u
  WHERE u.instance_id IS NOT NULL
  LIMIT 1;
  IF inst IS NULL THEN
    inst := '00000000-0000-0000-0000-000000000000';
  END IF;

  FOREACH label IN ARRAY ARRAY['owner', 'visitor']
  LOOP
    new_id := pg_catalog.gen_random_uuid();
    email := 'street-iso-' || label || '-' || replace(new_id::text, '-', '') || '@example.invalid';
    cols := '';
    vals := '';
    sep := '';
    missing := '';
    FOR col IN
      SELECT c.column_name, c.is_nullable, c.column_default, c.is_generated, c.is_identity
      FROM information_schema.columns AS c
      WHERE c.table_schema = 'auth'
        AND c.table_name = 'users'
      ORDER BY c.ordinal_position
    LOOP
      IF col.is_generated IS DISTINCT FROM 'NEVER' OR col.is_identity = 'YES' THEN
        CONTINUE;
      END IF;
      expr := NULL;
      IF col.column_name = 'id' THEN
        expr := format('%L::uuid', new_id::text);
      ELSIF col.column_name = 'instance_id' THEN
        expr := format('%L::uuid', inst::text);
      ELSIF col.column_name = 'aud' OR col.column_name = 'role' THEN
        expr := quote_literal('authenticated');
      ELSIF col.column_name = 'email' THEN
        expr := quote_literal(email);
      ELSIF col.column_name = 'phone' THEN
        expr := 'NULL';
      ELSIF col.column_name IN (
        'encrypted_password', 'confirmation_token', 'recovery_token',
        'email_change_token_new', 'email_change', 'email_change_token_current',
        'phone_change', 'phone_change_token', 'reauthentication_token'
      ) THEN
        expr := quote_literal('');
      ELSIF col.column_name = 'raw_app_meta_data' THEN
        expr := quote_literal('{"provider":"email","providers":["email"]}') || '::jsonb';
      ELSIF col.column_name = 'raw_user_meta_data' THEN
        expr := quote_literal('{}') || '::jsonb';
      ELSIF col.column_name IN ('created_at', 'updated_at', 'email_confirmed_at') THEN
        expr := 'now()';
      ELSIF col.column_name IN ('is_super_admin', 'is_sso_user', 'is_anonymous') THEN
        expr := 'false';
      ELSIF col.column_name = 'email_change_confirm_status' THEN
        expr := '0';
      END IF;
      IF expr IS NOT NULL THEN
        cols := cols || sep || format('%I', col.column_name);
        vals := vals || sep || expr;
        sep := ', ';
      ELSIF col.is_nullable = 'NO' AND col.column_default IS NULL THEN
        missing := missing || col.column_name || ',';
      END IF;
    END LOOP;
    IF missing <> '' THEN
      RAISE EXCEPTION '街景隔離測試停止：auth.users 有未預期的必填欄位 %。交易會回復。', missing;
    END IF;
    EXECUTE format('INSERT INTO auth.users (%s) VALUES (%s)', cols, vals);

    IF to_regclass('auth.identities') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = new_id) THEN
      cols := '';
      vals := '';
      sep := '';
      missing := '';
      FOR col IN
        SELECT c.column_name, c.is_nullable, c.column_default, c.is_generated, c.is_identity
        FROM information_schema.columns AS c
        WHERE c.table_schema = 'auth'
          AND c.table_name = 'identities'
        ORDER BY c.ordinal_position
      LOOP
        IF col.is_generated IS DISTINCT FROM 'NEVER' OR col.is_identity = 'YES' THEN
          CONTINUE;
        END IF;
        expr := NULL;
        IF col.column_name = 'id' THEN
          expr := format('%L::uuid', pg_catalog.gen_random_uuid()::text);
        ELSIF col.column_name = 'user_id' THEN
          expr := format('%L::uuid', new_id::text);
        ELSIF col.column_name = 'provider' THEN
          expr := quote_literal('email');
        ELSIF col.column_name = 'provider_id' THEN
          expr := quote_literal(new_id::text);
        ELSIF col.column_name = 'identity_data' THEN
          expr := format('%L::jsonb', pg_catalog.jsonb_build_object('sub', new_id, 'email', email)::text);
        ELSIF col.column_name = 'email' THEN
          expr := quote_literal(email);
        ELSIF col.column_name IN ('created_at', 'updated_at', 'last_sign_in_at') THEN
          expr := 'now()';
        END IF;
        IF expr IS NOT NULL THEN
          cols := cols || sep || format('%I', col.column_name);
          vals := vals || sep || expr;
          sep := ', ';
        ELSIF col.is_nullable = 'NO' AND col.column_default IS NULL THEN
          missing := missing || col.column_name || ',';
        END IF;
      END LOOP;
      IF missing <> '' THEN
        RAISE EXCEPTION '街景隔離測試停止：auth.identities 有未預期的必填欄位 %。交易會回復。', missing;
      END IF;
      IF cols <> '' THEN
        EXECUTE format('INSERT INTO auth.identities (%s) VALUES (%s)', cols, vals);
      END IF;
    END IF;

    INSERT INTO pg_temp.street_iso_users (id) VALUES (new_id);
    PERFORM set_config('app.street_' || label, new_id::text, true);
  END LOOP;

  owner := current_setting('app.street_owner', true)::uuid;
  visitor := current_setting('app.street_visitor', true)::uuid;
  PERFORM set_config('app.nickname_write', 'on', true);
  INSERT INTO public.profiles (id, public_nickname, avatar_url, avatar_tone)
  VALUES (owner, '街景甲', 'https://evil.example/member-avatars/a.png', 2)
  ON CONFLICT (id) DO UPDATE
  SET public_nickname = EXCLUDED.public_nickname,
      avatar_url = EXCLUDED.avatar_url,
      avatar_tone = EXCLUDED.avatar_tone;
  PERFORM set_config('app.nickname_write', 'off', true);

  PERFORM set_config('request.jwt.claim.sub', owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', pg_catalog.json_build_object('sub', owner::text, 'role', 'authenticated', 'iss', 'http://127.0.0.1:54321/auth/v1')::text, true);
  PERFORM set_config('street.internal', 'off', true);

  result := public.set_my_street_exhibit(false, NULL);
  IF (result ->> 'ok')::boolean IS DISTINCT FROM true
     OR (result ->> 'published')::boolean IS DISTINCT FROM false
     OR result ->> 'shopLevel' IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.member_street_exhibits WHERE user_id = owner) THEN
    RAISE EXCEPTION '還沒有街景時，取消公開應成功且不寫入無效內容';
  END IF;
  BEGIN
    PERFORM public.set_my_street_exhibit(true, NULL);
    RAISE EXCEPTION '無效街景不該能公開';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '街景內容不正確' THEN
        RAISE;
      END IF;
  END;

  result := public.set_my_street_exhibit(true, view);
  IF (result ->> 'published')::boolean IS DISTINCT FROM true
     OR (result ->> 'shopLevel')::integer IS DISTINCT FROM 3
     OR result -> 'buildings' IS DISTINCT FROM '["tea"]'::jsonb THEN
    RAISE EXCEPTION '展示等級應保留前端送入的自洽數值，並只刪掉與此值矛盾的店面。這不是成就驗證。';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', visitor::text, true);
  PERFORM set_config('request.jwt.claims', pg_catalog.json_build_object('sub', visitor::text, 'role', 'authenticated', 'iss', 'http://127.0.0.1:54321/auth/v1')::text, true);
  result := public.set_my_street_exhibit(true, '{"shopLevel":1,"buildings":[],"equipped":{"street":null,"shops":{}}}'::jsonb);
  IF (result ->> 'published')::boolean IS DISTINCT FROM true OR (result ->> 'shopLevel')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '訪客的展示街沒有公開';
  END IF;
  result := public.get_public_street(owner);
  IF (result ->> 'ok')::boolean IS DISTINCT FROM true
     OR result ->> 'nickname' IS DISTINCT FROM '街景甲'
     OR result ->> 'avatarUrl' IS NOT NULL
     OR (result ->> 'avatarTone')::integer IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION '公開身份應留下暱稱，並丟掉非本站會員頭像桶的網址';
  END IF;
  result := public.toggle_street_like(owner);
  IF (result ->> 'ok')::boolean IS DISTINCT FROM true OR (result ->> 'likedByMe')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION '訪客按讚沒有成立';
  END IF;

  good_avatar := 'http://127.0.0.1:54321/storage/v1/object/public/member-avatars/' || owner::text || '/1.jpg';
  UPDATE public.profiles
  SET avatar_url = 'http://127.0.0.1:54321/storage/v1/object/public/member-avatars/' || visitor::text || '/1.jpg'
  WHERE id = owner;
  result := public.get_public_street(owner);
  IF result ->> 'avatarUrl' IS NOT NULL THEN
    RAISE EXCEPTION '不能借用其他會員的頭像路徑';
  END IF;
  UPDATE public.profiles SET avatar_url = good_avatar WHERE id = owner;
  result := public.get_public_street(owner);
  IF result ->> 'avatarUrl' IS DISTINCT FROM good_avatar THEN
    RAISE EXCEPTION '本站會員自己的頭像網址應可顯示';
  END IF;
  UPDATE public.profiles SET avatar_url = good_avatar || '?x=1' WHERE id = owner;
  result := public.get_public_street(owner);
  IF result ->> 'avatarUrl' IS NOT NULL THEN
    RAISE EXCEPTION '頭像網址不能帶查詢參數';
  END IF;
  UPDATE public.profiles
  SET avatar_url = 'https://example.supabase.co/storage/v1/object/public/member-avatars/' || owner::text || '/1.jpg'
  WHERE id = owner;
  result := public.get_public_street(owner);
  IF result ->> 'avatarUrl' IS NOT NULL THEN
    RAISE EXCEPTION '頭像網址必須跟這次登入的站台相同';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', owner::text, true);
  PERFORM set_config('request.jwt.claims', pg_catalog.json_build_object('sub', owner::text, 'role', 'authenticated', 'iss', 'http://127.0.0.1:54321/auth/v1')::text, true);
  result := public.toggle_street_like(visitor);
  IF (result ->> 'likedByMe')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION '屋主回讚沒有成立';
  END IF;

  PERFORM set_config('street.internal', 'off', true);
  BEGIN
    DELETE FROM public.member_street_exhibits WHERE user_id = owner;
    RAISE EXCEPTION '沒有交易旗標時不該直接刪除街景';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '街景互動只能由商店街交易更新' THEN
        RAISE;
      END IF;
  END;
  BEGIN
    DELETE FROM public.member_street_likes WHERE owner_id = owner;
    RAISE EXCEPTION '沒有交易旗標時不該直接刪除讚';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '街景互動只能由商店街交易更新' THEN
        RAISE;
      END IF;
  END;
  BEGIN
    DELETE FROM public.member_street_visits WHERE owner_id = owner;
    RAISE EXCEPTION '沒有交易旗標時不該直接刪除拜訪';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '街景互動只能由商店街交易更新' THEN
        RAISE;
      END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.member_street_exhibits WHERE user_id = owner AND published AND shop_level = 3)
     OR (SELECT count(*) FROM public.member_street_likes WHERE owner_id IN (owner, visitor) OR member_id IN (owner, visitor)) IS DISTINCT FROM 2
     OR (SELECT count(*) FROM public.member_street_visits WHERE owner_id = owner AND member_id = visitor) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '被拒絕的直接刪除仍改到了街景互動';
  END IF;
  PERFORM set_config('app.street_likes', '2', true);
  PERFORM set_config('app.street_visits', '1', true);
END
$street_iso_seed$;

SET LOCAL ROLE authenticated;

DO $street_iso_member$
DECLARE
  owner uuid := current_setting('app.street_owner', true)::uuid;
  result jsonb;
BEGIN
  IF auth.uid() IS DISTINCT FROM owner THEN
    RAISE EXCEPTION '無法模擬隔離會員。交易會回復。';
  END IF;
  result := public.set_my_street_exhibit(false, NULL);
  IF (result ->> 'published')::boolean IS DISTINCT FROM false
     OR (result ->> 'shopLevel')::integer IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '街景遺失時仍應能取消公開，並保留原本的展示內容';
  END IF;
  result := public.set_my_street_exhibit(false, '{"shopLevel":"nope"}'::jsonb);
  IF (result ->> 'published')::boolean IS DISTINCT FROM false
     OR (result ->> 'shopLevel')::integer IS DISTINCT FROM 3
     OR result -> 'buildings' IS DISTINCT FROM '["tea"]'::jsonb THEN
    RAISE EXCEPTION '無效街景不該覆寫已儲存的展示，也不該阻止取消公開';
  END IF;
  BEGIN
    PERFORM public.set_my_street_exhibit(true, NULL);
    RAISE EXCEPTION '無效街景不該能重新公開';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM '街景內容不正確' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    DELETE FROM public.member_street_exhibits WHERE user_id = owner;
    RAISE EXCEPTION '一般會員不該能直接刪除街景';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    INSERT INTO public.member_street_exhibits (user_id, published, shop_level, buildings, equipped)
    VALUES (owner, true, 1, '[]'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION '一般會員不該能直接新增街景';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    UPDATE public.member_street_exhibits SET published = true WHERE user_id = owner;
    RAISE EXCEPTION '一般會員不該能直接修改街景';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.member_street_exhibits;
    RAISE EXCEPTION '一般會員不該能直接讀取街景';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    DELETE FROM public.member_street_likes WHERE owner_id = owner;
    RAISE EXCEPTION '一般會員不該能直接刪除讚';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    DELETE FROM public.member_street_visits WHERE owner_id = owner;
    RAISE EXCEPTION '一般會員不該能直接刪除拜訪';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END
$street_iso_member$;

RESET ROLE;

DO $street_iso_as_visitor$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('app.street_visitor', true), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object(
      'sub', current_setting('app.street_visitor', true),
      'role', 'authenticated',
      'iss', 'http://127.0.0.1:54321/auth/v1'
    )::text,
    true
  );
END
$street_iso_as_visitor$;

SET LOCAL ROLE authenticated;

DO $street_iso_closed$
DECLARE
  owner uuid := current_setting('app.street_owner', true)::uuid;
  visitor uuid := current_setting('app.street_visitor', true)::uuid;
  result jsonb;
BEGIN
  IF auth.uid() IS DISTINCT FROM visitor THEN
    RAISE EXCEPTION '無法模擬來訪會員。交易會回復。';
  END IF;
  result := public.get_public_street(owner);
  IF result ->> 'reason' IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION '取消公開後，其他會員不該再讀到街景';
  END IF;
  result := public.toggle_street_like(owner);
  IF result ->> 'reason' IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION '取消公開後不該能再按讚';
  END IF;
END
$street_iso_closed$;

RESET ROLE;

DO $street_iso_delete$
DECLARE
  owner uuid := current_setting('app.street_owner', true)::uuid;
  visitor uuid := current_setting('app.street_visitor', true)::uuid;
  removed integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('street.internal', 'off', true);
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION '刪除隔離會員前必須回到資料庫擁有者';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.member_street_exhibits
    WHERE user_id = owner AND published = false AND shop_level = 3 AND buildings = '["tea"]'::jsonb
  ) THEN
    RAISE EXCEPTION '一般會員的操作改寫了取消公開後的展示內容';
  END IF;
  IF (SELECT count(*) FROM public.member_street_likes WHERE owner_id IN (owner, visitor) OR member_id IN (owner, visitor))::text
       IS DISTINCT FROM current_setting('app.street_likes', true)
     OR (SELECT count(*) FROM public.member_street_visits WHERE owner_id = owner AND member_id = visitor)::text
       IS DISTINCT FROM current_setting('app.street_visits', true) THEN
    RAISE EXCEPTION '取消公開或被拒絕的直接操作改變了讚或拜訪';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.street_iso_users WHERE id = owner)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = owner AND email LIKE 'street-iso-%@example.invalid') THEN
    RAISE EXCEPTION '拒絕刪除非本隔離測試建立的會員';
  END IF;
  IF to_regclass('auth.identities') IS NOT NULL THEN
    DELETE FROM auth.identities WHERE user_id = owner;
  END IF;
  DELETE FROM auth.users
  WHERE id = owner
    AND email LIKE 'street-iso-%@example.invalid'
    AND id IN (SELECT id FROM pg_temp.street_iso_users);
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '隔離會員刪除沒有剛好刪除一位測試會員';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_street_exhibits WHERE user_id = owner)
     OR EXISTS (SELECT 1 FROM public.member_street_likes WHERE owner_id = owner OR member_id = owner)
     OR EXISTS (SELECT 1 FROM public.member_street_visits WHERE owner_id = owner OR member_id = owner) THEN
    RAISE EXCEPTION '刪除會員後，他的街景、讚與拜訪沒有跟著移除';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.member_street_exhibits WHERE user_id = visitor AND published) THEN
    RAISE EXCEPTION '刪除一位會員時清掉了另一位的街景';
  END IF;
END
$street_iso_delete$;

DO $street_iso_delete_visitor$
DECLARE
  visitor uuid := current_setting('app.street_visitor', true)::uuid;
  removed integer;
  use_auth_admin boolean := EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin');
  has_identities boolean := to_regclass('auth.identities') IS NOT NULL;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.street_iso_users WHERE id = visitor)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = visitor AND email LIKE 'street-iso-%@example.invalid') THEN
    RAISE EXCEPTION '拒絕刪除非本隔離測試建立的會員';
  END IF;
  -- 本機 postgres 不是超級使用者，也不能取得保留角色 supabase_auth_admin。
  -- 前面已確認該角色能執行刪除守衛。切換失敗不該把整份交易擋下。
  IF use_auth_admin AND (
    pg_catalog.pg_has_role(current_user, 'supabase_auth_admin', 'MEMBER')
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = current_user AND rolsuper
    )
  ) THEN
    EXECUTE 'SET LOCAL ROLE supabase_auth_admin';
  ELSE
    use_auth_admin := false;
  END IF;
  IF has_identities THEN
    DELETE FROM auth.identities WHERE user_id = visitor;
  END IF;
  DELETE FROM auth.users
  WHERE id = visitor
    AND email LIKE 'street-iso-%@example.invalid';
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF use_auth_admin THEN
    EXECUTE 'RESET ROLE';
  END IF;
  IF removed IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '隔離會員刪除沒有剛好刪除一位測試會員';
  END IF;
END
$street_iso_delete_visitor$;

DO $street_iso_clean$
DECLARE
  before_row record;
BEGIN
  IF current_user IN ('authenticated', 'anon', 'supabase_auth_admin') THEN
    RAISE EXCEPTION '隔離測試結束時角色不正確';
  END IF;
  SELECT * INTO before_row FROM pg_temp.street_iso_before;
  IF (SELECT count(*) FROM public.member_street_exhibits) IS DISTINCT FROM before_row.exhibits
     OR (SELECT count(*) FROM public.member_street_likes) IS DISTINCT FROM before_row.likes
     OR (SELECT count(*) FROM public.member_street_visits) IS DISTINCT FROM before_row.visits
     OR (SELECT count(*) FROM auth.users) IS DISTINCT FROM before_row.users
     OR (SELECT count(*) FROM public.profiles) IS DISTINCT FROM before_row.profiles THEN
    RAISE EXCEPTION '隔離測試留下街景、會員或個人資料，交易會回復';
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE email LIKE 'street-iso-%@example.invalid'
  ) THEN
    RAISE EXCEPTION '隔離測試會員沒有刪乾淨';
  END IF;
  DROP TABLE pg_temp.street_iso_before;
  DROP TABLE pg_temp.street_iso_users;
END
$street_iso_clean$;

COMMIT;
