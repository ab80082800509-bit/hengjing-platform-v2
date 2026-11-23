-- =============================================================================
-- 第七階段第 6 批正式套用版：夢想商店街好友互助。
-- 狀態：待站長確認，尚未執行。確認前不得在正式 Supabase 執行。
-- 順序：先套用 20261029220100_street_social_apply.sql（第 5 批），
--       再跑 20261029220000_street_batch5_6_readonly_check.sql，batch6_gate 顯示可以套用才執行本檔。
-- 依賴第 5 批：member_street_exhibits（判斷對方是否公開）、street_taipei_day（台北日）、
--             street_public_identity（好友卡片暱稱與頭像），以及第 5 批的 street.internal 交易旗標慣例。
--
-- 來源：20261028050000_street_friend_help_preview.sql。與草案的差異：
--   1. 開頭檢查第 5 批已完整套用，且任何第 6 批資料表或函式已存在就整份停止，不覆蓋正式資料。
--   2. 領取改為可重試：claim_my_street_help_rewards(p_claim_key uuid)。
--      前端先把領取鍵寫進自己的存檔再呼叫。第一次呼叫把互助列標記已領，並把總額寫進
--      member_street_help_claims；同一把鍵重送只回放那一筆，不再標記、不再加總。
--      回覆在網路上遺失時，前端用同一把鍵重領即可拿回同一筆，存檔記著已入帳的鍵，不會加兩次。
--   3. 互助列記下由哪一把領取鍵領走（helper_claim_key、owner_claim_key），領過後時間與鍵都不能再改。
--   4. 自我檢查加上 search_path 與 SECURITY DEFINER 檢查，以及領取紀錄表的權限檢查。
--
-- 對正式資料的影響：
--   只新增 street_help_settings（插入唯一一列預設參數）、member_street_friends、
--   member_street_friend_requests、member_street_helps、member_street_help_claims 與其函式。
--   不讀寫既有會員、邀請碼、點數、遊戲進度或資產資料列。整份包在單一交易。
--
-- 規則：
--   1. 好友是雙方同意的一列。只能對已公開商店街的會員送出邀請，避免用會員編號探人。
--      對方也邀請過你時，直接成為好友。拒絕會刪掉邀請，同一天不能再對同一人重送。
--   2. 互助只限已成為好友、而且對方商店街仍公開。自己不能幫自己。
--   3. 次數、冷卻、好友上限與獎勵數值都只放在 street_help_settings 一列，函式每次讀取。
--      同一位幫手每個台北日對同一位好友只能幫一次；每日總次數、屋主每日可收次數與兩次幫忙之間的冷卻都由資料庫判斷。
--   4. 前端每次幫忙帶一把 request_key。同一把鑰匙重送只回 duplicate，不會再記一筆。
--   5. 獎勵只是夢想商店街的夢想金幣與經驗，寫在該筆互助紀錄上。
--      幫手與屋主各自用 claim_my_street_help_rewards(p_claim_key) 領取，領過的列標記時間與領取鍵，不能再領。
--      不呼叫 post_member_reward，不寫 member_point_entries、reward_claims 或 member_point_accounts，不能換 Pay 點數。
--   6. 會員不能直接讀寫這五張表，只能走下面的函式；auth.users 刪除時外鍵連動仍可清除。
-- 第 7 批（趣味偷貨）不在本檔。
-- =============================================================================

BEGIN;

DO $require_street_batch5$
BEGIN
  IF pg_catalog.to_regclass('public.member_street_exhibits') IS NULL
     OR pg_catalog.to_regclass('public.member_street_likes') IS NULL
     OR pg_catalog.to_regclass('public.member_street_visits') IS NULL
     OR pg_catalog.to_regprocedure('public.street_taipei_day(timestamptz)') IS NULL
     OR pg_catalog.to_regprocedure('public.street_public_identity(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.set_my_street_exhibit(boolean, jsonb)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
       WHERE NOT tgisinternal AND tgname = 'member_street_exhibits_guard'
         AND tgrelid = pg_catalog.to_regclass('public.member_street_exhibits')
     ) THEN
    RAISE EXCEPTION '需要先完整套用第七階段第 5 批 20261029220100_street_social_apply.sql';
  END IF;
  IF pg_catalog.to_regclass('public.street_help_settings') IS NOT NULL
     OR pg_catalog.to_regclass('public.member_street_friends') IS NOT NULL
     OR pg_catalog.to_regclass('public.member_street_friend_requests') IS NOT NULL
     OR pg_catalog.to_regclass('public.member_street_helps') IS NOT NULL
     OR pg_catalog.to_regclass('public.member_street_help_claims') IS NOT NULL THEN
    RAISE EXCEPTION '第 6 批資料表已存在。為保護正式資料，本檔不重跑';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = proc.pronamespace
    WHERE nsp.nspname = 'public'
      AND proc.proname = ANY (ARRAY[
        'guard_street_help_write', 'street_friend_status', 'street_help_status_json', 'street_friend_card',
        'get_my_street_friends', 'request_street_friend', 'respond_street_friend', 'remove_street_friend',
        'help_street_friend', 'claim_my_street_help_rewards'
      ])
  ) THEN
    RAISE EXCEPTION '第 6 批同名函式已存在。為避免覆蓋正式函式，本檔停止';
  END IF;
END
$require_street_batch5$;

CREATE TABLE IF NOT EXISTS public.street_help_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  daily_help_limit smallint NOT NULL DEFAULT 5 CHECK (daily_help_limit BETWEEN 0 AND 50),
  daily_receive_limit smallint NOT NULL DEFAULT 10 CHECK (daily_receive_limit BETWEEN 0 AND 100),
  help_cooldown_seconds integer NOT NULL DEFAULT 60 CHECK (help_cooldown_seconds BETWEEN 0 AND 86400),
  daily_request_limit smallint NOT NULL DEFAULT 10 CHECK (daily_request_limit BETWEEN 0 AND 50),
  max_friends smallint NOT NULL DEFAULT 50 CHECK (max_friends BETWEEN 1 AND 500),
  helper_coins integer NOT NULL DEFAULT 30 CHECK (helper_coins BETWEEN 0 AND 1000),
  helper_xp integer NOT NULL DEFAULT 8 CHECK (helper_xp BETWEEN 0 AND 1000),
  owner_coins integer NOT NULL DEFAULT 20 CHECK (owner_coins BETWEEN 0 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.street_help_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.street_help_settings IS
  '好友互助的唯一參數列。只有資料庫擁有者可調整；獎勵只是夢想金幣與經驗，不能兌換 Pay 點數。';

CREATE TABLE IF NOT EXISTS public.member_street_friends (
  user_low uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  PRIMARY KEY (user_low, user_high),
  CONSTRAINT member_street_friends_order CHECK (user_low < user_high),
  CONSTRAINT member_street_friends_requester CHECK (requested_by IN (user_low, user_high)),
  CONSTRAINT member_street_friends_status CHECK (status IN ('pending', 'accepted')),
  CONSTRAINT member_street_friends_accepted_at CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS member_street_friends_high ON public.member_street_friends (user_high);

CREATE TABLE IF NOT EXISTS public.member_street_friend_requests (
  requester_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  request_day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id, request_day),
  CONSTRAINT member_street_friend_requests_not_self CHECK (requester_id <> target_id)
);

CREATE INDEX IF NOT EXISTS member_street_friend_requests_day
  ON public.member_street_friend_requests (requester_id, request_day);

CREATE TABLE IF NOT EXISTS public.member_street_helps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  helper_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  help_day date NOT NULL,
  request_key uuid NOT NULL,
  helper_coins integer NOT NULL CHECK (helper_coins BETWEEN 0 AND 1000),
  helper_xp integer NOT NULL CHECK (helper_xp BETWEEN 0 AND 1000),
  owner_coins integer NOT NULL CHECK (owner_coins BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  helper_claimed_at timestamptz,
  owner_claimed_at timestamptz,
  helper_claim_key uuid,
  owner_claim_key uuid,
  CONSTRAINT member_street_helps_not_self CHECK (helper_id <> owner_id),
  CONSTRAINT member_street_helps_pair_day UNIQUE (helper_id, owner_id, help_day),
  CONSTRAINT member_street_helps_request_key UNIQUE (helper_id, request_key),
  CONSTRAINT member_street_helps_helper_claim_pair CHECK ((helper_claimed_at IS NULL) = (helper_claim_key IS NULL)),
  CONSTRAINT member_street_helps_owner_claim_pair CHECK ((owner_claimed_at IS NULL) = (owner_claim_key IS NULL))
);

CREATE TABLE IF NOT EXISTS public.member_street_help_claims (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  claim_key uuid NOT NULL,
  coins integer NOT NULL CHECK (coins BETWEEN 0 AND 1000000),
  xp integer NOT NULL CHECK (xp BETWEEN 0 AND 1000000),
  entries jsonb NOT NULL CHECK (jsonb_typeof(entries) = 'array'),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, claim_key)
);

CREATE INDEX IF NOT EXISTS member_street_helps_helper_time ON public.member_street_helps (helper_id, created_at DESC);
CREATE INDEX IF NOT EXISTS member_street_helps_owner_day ON public.member_street_helps (owner_id, help_day);
CREATE INDEX IF NOT EXISTS member_street_helps_helper_unclaimed ON public.member_street_helps (helper_id) WHERE helper_claimed_at IS NULL;
CREATE INDEX IF NOT EXISTS member_street_helps_owner_unclaimed ON public.member_street_helps (owner_id) WHERE owner_claimed_at IS NULL;

COMMENT ON TABLE public.member_street_friends IS '夢想商店街好友。每對會員一列，pending 為邀請中，accepted 為雙方同意。';
COMMENT ON TABLE public.member_street_friend_requests IS '好友邀請送出紀錄，用來限制每日次數與同日重送。';
COMMENT ON TABLE public.member_street_helps IS
  '好友互助紀錄。每位幫手每台北日對同一位好友最多一列；獎勵為夢想金幣與經驗，雙方各領一次。';
COMMENT ON TABLE public.member_street_help_claims IS
  '每次領取互助獎勵的伺服器紀錄。同一位會員同一把領取鍵只有一列，重送時回放同一筆，不重複發獎。只寫入、不修改。';

CREATE OR REPLACE FUNCTION public.guard_street_help_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  user_gone boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_catalog.pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    IF TG_TABLE_NAME = 'member_street_friends' THEN
      user_gone := NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_low)
        OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_high);
    ELSIF TG_TABLE_NAME = 'member_street_friend_requests' THEN
      user_gone := NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.requester_id)
        OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.target_id);
    ELSIF TG_TABLE_NAME = 'member_street_helps' THEN
      user_gone := NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.helper_id)
        OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.owner_id);
    ELSIF TG_TABLE_NAME = 'member_street_help_claims' THEN
      user_gone := NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id);
    END IF;
    IF user_gone THEN
      RETURN OLD;
    END IF;
    IF TG_TABLE_NAME IN ('member_street_helps', 'member_street_friend_requests', 'member_street_help_claims') THEN
      RAISE EXCEPTION '互助紀錄不可刪除';
    END IF;
  END IF;
  IF pg_catalog.current_setting('street.internal', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '好友互助只能由商店街交易更新';
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'member_street_helps' THEN
    IF (NEW.id, NEW.helper_id, NEW.owner_id, NEW.help_day, NEW.request_key, NEW.helper_coins, NEW.helper_xp, NEW.owner_coins, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.helper_id, OLD.owner_id, OLD.help_day, OLD.request_key, OLD.helper_coins, OLD.helper_xp, OLD.owner_coins, OLD.created_at)
       OR (OLD.helper_claimed_at IS NOT NULL
           AND (NEW.helper_claimed_at, NEW.helper_claim_key) IS DISTINCT FROM (OLD.helper_claimed_at, OLD.helper_claim_key))
       OR (OLD.owner_claimed_at IS NOT NULL
           AND (NEW.owner_claimed_at, NEW.owner_claim_key) IS DISTINCT FROM (OLD.owner_claimed_at, OLD.owner_claim_key)) THEN
      RAISE EXCEPTION '互助紀錄只能標記領取一次';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('member_street_friend_requests', 'member_street_help_claims') THEN
    RAISE EXCEPTION '互助紀錄不可修改';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_street_friends_guard ON public.member_street_friends;
CREATE TRIGGER member_street_friends_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_street_friends
  FOR EACH ROW EXECUTE FUNCTION public.guard_street_help_write();

DROP TRIGGER IF EXISTS member_street_friend_requests_guard ON public.member_street_friend_requests;
CREATE TRIGGER member_street_friend_requests_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_street_friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_street_help_write();

DROP TRIGGER IF EXISTS member_street_helps_guard ON public.member_street_helps;
CREATE TRIGGER member_street_helps_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_street_helps
  FOR EACH ROW EXECUTE FUNCTION public.guard_street_help_write();

DROP TRIGGER IF EXISTS member_street_help_claims_guard ON public.member_street_help_claims;
CREATE TRIGGER member_street_help_claims_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_street_help_claims
  FOR EACH ROW EXECUTE FUNCTION public.guard_street_help_write();

ALTER TABLE public.street_help_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_street_friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_street_friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_street_helps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_street_help_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.street_help_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_street_friends FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_street_friend_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_street_helps FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_street_help_claims FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 內部輔助
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.street_friend_status(p_me uuid, p_other uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN f.status = 'accepted' THEN 'accepted'
    WHEN f.status = 'pending' AND f.requested_by = p_me THEN 'outgoing'
    WHEN f.status = 'pending' THEN 'incoming'
    ELSE 'none'
  END
  FROM (SELECT 1) AS one
  LEFT JOIN public.member_street_friends AS f
    ON f.user_low = LEAST(p_me, p_other) AND f.user_high = GREATEST(p_me, p_other)
$$;

CREATE OR REPLACE FUNCTION public.street_help_status_json(p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  s public.street_help_settings%ROWTYPE;
  day date := public.street_taipei_day(pg_catalog.now());
  used integer;
  received integer;
  last_at timestamptz;
  unclaimed_coins integer;
  unclaimed_xp integer;
  unclaimed_count integer;
BEGIN
  SELECT * INTO s FROM public.street_help_settings WHERE id;
  SELECT count(*)::integer INTO used FROM public.member_street_helps WHERE helper_id = p_uid AND help_day = day;
  SELECT count(*)::integer INTO received FROM public.member_street_helps WHERE owner_id = p_uid AND help_day = day;
  SELECT max(created_at) INTO last_at FROM public.member_street_helps WHERE helper_id = p_uid;
  SELECT
    coalesce(sum(CASE WHEN helper_id = p_uid AND helper_claimed_at IS NULL THEN helper_coins ELSE 0 END), 0)
      + coalesce(sum(CASE WHEN owner_id = p_uid AND owner_claimed_at IS NULL THEN owner_coins ELSE 0 END), 0),
    coalesce(sum(CASE WHEN helper_id = p_uid AND helper_claimed_at IS NULL THEN helper_xp ELSE 0 END), 0),
    count(*) FILTER (WHERE (helper_id = p_uid AND helper_claimed_at IS NULL) OR (owner_id = p_uid AND owner_claimed_at IS NULL))
  INTO unclaimed_coins, unclaimed_xp, unclaimed_count
  FROM public.member_street_helps
  WHERE (helper_id = p_uid AND helper_claimed_at IS NULL) OR (owner_id = p_uid AND owner_claimed_at IS NULL);
  RETURN pg_catalog.jsonb_build_object(
    'enabled', s.enabled,
    'day', day,
    'usedToday', used,
    'dailyLimit', s.daily_help_limit,
    'receivedToday', received,
    'receiveLimit', s.daily_receive_limit,
    'cooldownSeconds', s.help_cooldown_seconds,
    'cooldownUntil', CASE
      WHEN last_at IS NOT NULL AND last_at + pg_catalog.make_interval(secs => s.help_cooldown_seconds) > pg_catalog.now()
      THEN last_at + pg_catalog.make_interval(secs => s.help_cooldown_seconds)
      ELSE NULL
    END,
    'requestLimit', s.daily_request_limit,
    'maxFriends', s.max_friends,
    'helperCoins', s.helper_coins,
    'helperXp', s.helper_xp,
    'ownerCoins', s.owner_coins,
    'unclaimedCoins', unclaimed_coins::integer,
    'unclaimedXp', unclaimed_xp::integer,
    'unclaimedCount', unclaimed_count::integer
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.street_friend_card(p_me uuid, p_other uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  day date := public.street_taipei_day(pg_catalog.now());
BEGIN
  RETURN pg_catalog.jsonb_build_object(
    'userId', p_other,
    'published', EXISTS (SELECT 1 FROM public.member_street_exhibits WHERE user_id = p_other AND published),
    'helpedToday', EXISTS (SELECT 1 FROM public.member_street_helps WHERE helper_id = p_me AND owner_id = p_other AND help_day = day),
    'helpedMeToday', EXISTS (SELECT 1 FROM public.member_street_helps WHERE helper_id = p_other AND owner_id = p_me AND help_day = day)
  ) || public.street_public_identity(p_other);
END;
$$;

-- ---------------------------------------------------------------------------
-- 會員入口
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_street_friends()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'friends', coalesce((
      SELECT pg_catalog.jsonb_agg(public.street_friend_card(uid, other.id) ORDER BY other.accepted_at DESC)
      FROM (
        SELECT CASE WHEN f.user_low = uid THEN f.user_high ELSE f.user_low END AS id, f.accepted_at
        FROM public.member_street_friends AS f
        WHERE (f.user_low = uid OR f.user_high = uid) AND f.status = 'accepted'
        LIMIT 500
      ) AS other
    ), '[]'::jsonb),
    'incoming', coalesce((
      SELECT pg_catalog.jsonb_agg(public.street_friend_card(uid, f.requested_by) ORDER BY f.created_at DESC)
      FROM public.member_street_friends AS f
      WHERE (f.user_low = uid OR f.user_high = uid) AND f.status = 'pending' AND f.requested_by <> uid
    ), '[]'::jsonb),
    'outgoing', coalesce((
      SELECT pg_catalog.jsonb_agg(public.street_friend_card(uid, CASE WHEN f.user_low = uid THEN f.user_high ELSE f.user_low END) ORDER BY f.created_at DESC)
      FROM public.member_street_friends AS f
      WHERE (f.user_low = uid OR f.user_high = uid) AND f.status = 'pending' AND f.requested_by = uid
    ), '[]'::jsonb),
    'help', public.street_help_status_json(uid)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_street_friend(p_other uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  s public.street_help_settings%ROWTYPE;
  day date := public.street_taipei_day(pg_catalog.now());
  f public.member_street_friends%ROWTYPE;
  has_row boolean;
  sent integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_other IS NULL OR p_other = uid THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'self');
  END IF;
  SELECT * INTO s FROM public.street_help_settings WHERE id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-friend:' || LEAST(uid, p_other)::text || ':' || GREATEST(uid, p_other)::text, 0));
  SELECT * INTO f FROM public.member_street_friends
  WHERE user_low = LEAST(uid, p_other) AND user_high = GREATEST(uid, p_other);
  has_row := FOUND;
  IF has_row AND f.status = 'accepted' THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'accepted');
  END IF;
  IF has_row AND f.requested_by = uid THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'pending');
  END IF;
  IF (SELECT count(*) FROM public.member_street_friends WHERE (user_low = uid OR user_high = uid) AND status = 'accepted') >= s.max_friends
     OR (SELECT count(*) FROM public.member_street_friends WHERE (user_low = p_other OR user_high = p_other) AND status = 'accepted') >= s.max_friends THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'full');
  END IF;
  PERFORM pg_catalog.set_config('street.internal', 'on', true);
  IF has_row THEN
    UPDATE public.member_street_friends SET status = 'accepted', accepted_at = pg_catalog.now()
    WHERE user_low = f.user_low AND user_high = f.user_high;
    PERFORM pg_catalog.set_config('street.internal', 'off', true);
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'accepted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.member_street_exhibits WHERE user_id = p_other AND published) THEN
    PERFORM pg_catalog.set_config('street.internal', 'off', true);
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'closed');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-friend-request:' || uid::text, 0));
  SELECT count(*)::integer INTO sent FROM public.member_street_friend_requests WHERE requester_id = uid AND request_day = day;
  IF sent >= s.daily_request_limit THEN
    PERFORM pg_catalog.set_config('street.internal', 'off', true);
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'limit');
  END IF;
  INSERT INTO public.member_street_friend_requests (requester_id, target_id, request_day)
  VALUES (uid, p_other, day)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    PERFORM pg_catalog.set_config('street.internal', 'off', true);
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'duplicate');
  END IF;
  INSERT INTO public.member_street_friends (user_low, user_high, requested_by, status)
  VALUES (LEAST(uid, p_other), GREATEST(uid, p_other), uid, 'pending');
  PERFORM pg_catalog.set_config('street.internal', 'off', true);
  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'outgoing');
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_street_friend(p_other uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  s public.street_help_settings%ROWTYPE;
  f public.member_street_friends%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_other IS NULL OR p_other = uid OR p_accept IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;
  SELECT * INTO s FROM public.street_help_settings WHERE id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-friend:' || LEAST(uid, p_other)::text || ':' || GREATEST(uid, p_other)::text, 0));
  SELECT * INTO f FROM public.member_street_friends
  WHERE user_low = LEAST(uid, p_other) AND user_high = GREATEST(uid, p_other)
    AND status = 'pending' AND requested_by = p_other;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;
  IF p_accept AND (
    (SELECT count(*) FROM public.member_street_friends WHERE (user_low = uid OR user_high = uid) AND status = 'accepted') >= s.max_friends
    OR (SELECT count(*) FROM public.member_street_friends WHERE (user_low = p_other OR user_high = p_other) AND status = 'accepted') >= s.max_friends
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'full');
  END IF;
  PERFORM pg_catalog.set_config('street.internal', 'on', true);
  IF p_accept THEN
    UPDATE public.member_street_friends SET status = 'accepted', accepted_at = pg_catalog.now()
    WHERE user_low = f.user_low AND user_high = f.user_high;
  ELSE
    DELETE FROM public.member_street_friends WHERE user_low = f.user_low AND user_high = f.user_high;
  END IF;
  PERFORM pg_catalog.set_config('street.internal', 'off', true);
  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', CASE WHEN p_accept THEN 'accepted' ELSE 'none' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_street_friend(p_other uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  removed integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_other IS NULL OR p_other = uid THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-friend:' || LEAST(uid, p_other)::text || ':' || GREATEST(uid, p_other)::text, 0));
  PERFORM pg_catalog.set_config('street.internal', 'on', true);
  DELETE FROM public.member_street_friends
  WHERE user_low = LEAST(uid, p_other) AND user_high = GREATEST(uid, p_other)
    AND (status = 'accepted' OR requested_by = uid);
  GET DIAGNOSTICS removed = ROW_COUNT;
  PERFORM pg_catalog.set_config('street.internal', 'off', true);
  IF removed = 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'none');
END;
$$;

CREATE OR REPLACE FUNCTION public.help_street_friend(p_owner uuid, p_request_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  s public.street_help_settings%ROWTYPE;
  day date := public.street_taipei_day(pg_catalog.now());
  last_at timestamptz;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_request_key IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  IF p_owner IS NULL OR p_owner = uid THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'self');
  END IF;
  SELECT * INTO s FROM public.street_help_settings WHERE id;
  IF NOT s.enabled THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'disabled', 'help', public.street_help_status_json(uid));
  END IF;
  -- 幫手與屋主各一把鎖，鍵名空間不同，雙方互幫時不會互等。
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-help-helper:' || uid::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-help-owner:' || p_owner::text, 0));
  IF EXISTS (SELECT 1 FROM public.member_street_helps WHERE helper_id = uid AND request_key = p_request_key) THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'duplicate', true, 'help', public.street_help_status_json(uid));
  END IF;
  IF public.street_friend_status(uid, p_owner) IS DISTINCT FROM 'accepted' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_friend', 'help', public.street_help_status_json(uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.member_street_exhibits WHERE user_id = p_owner AND published) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'closed', 'help', public.street_help_status_json(uid));
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_street_helps WHERE helper_id = uid AND owner_id = p_owner AND help_day = day) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'already', 'help', public.street_help_status_json(uid));
  END IF;
  IF (SELECT count(*) FROM public.member_street_helps WHERE helper_id = uid AND help_day = day) >= s.daily_help_limit THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'limit', 'help', public.street_help_status_json(uid));
  END IF;
  IF (SELECT count(*) FROM public.member_street_helps WHERE owner_id = p_owner AND help_day = day) >= s.daily_receive_limit THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'owner_full', 'help', public.street_help_status_json(uid));
  END IF;
  SELECT max(created_at) INTO last_at FROM public.member_street_helps WHERE helper_id = uid;
  IF last_at IS NOT NULL AND last_at + pg_catalog.make_interval(secs => s.help_cooldown_seconds) > pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'cooldown', 'help', public.street_help_status_json(uid));
  END IF;
  PERFORM pg_catalog.set_config('street.internal', 'on', true);
  INSERT INTO public.member_street_helps (helper_id, owner_id, help_day, request_key, helper_coins, helper_xp, owner_coins)
  VALUES (uid, p_owner, day, p_request_key, s.helper_coins, s.helper_xp, s.owner_coins);
  PERFORM pg_catalog.set_config('street.internal', 'off', true);
  RETURN pg_catalog.jsonb_build_object('ok', true, 'duplicate', false, 'help', public.street_help_status_json(uid));
END;
$$;

-- 前端先把 p_claim_key 寫進存檔再呼叫。同一位會員同一把鍵只會真的領一次，之後重送回放同一筆。
CREATE OR REPLACE FUNCTION public.claim_my_street_help_rewards(p_claim_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  coins integer := 0;
  xp integer := 0;
  entries jsonb := '[]'::jsonb;
  item record;
  prior public.member_street_help_claims%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_claim_key IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-help-claim:' || uid::text, 0));
  SELECT * INTO prior FROM public.member_street_help_claims WHERE user_id = uid AND claim_key = p_claim_key;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'replay', true, 'claimKey', p_claim_key,
      'coins', prior.coins, 'xp', prior.xp, 'entries', prior.entries,
      'help', public.street_help_status_json(uid)
    );
  END IF;
  PERFORM pg_catalog.set_config('street.internal', 'on', true);
  FOR item IN
    UPDATE public.member_street_helps
    SET helper_claimed_at = pg_catalog.now(), helper_claim_key = p_claim_key
    WHERE id IN (
      SELECT id FROM public.member_street_helps
      WHERE helper_id = uid AND helper_claimed_at IS NULL
      ORDER BY created_at
      LIMIT 50
    ) AND helper_claimed_at IS NULL
    RETURNING owner_id AS other_id, helper_coins AS c, helper_xp AS x, created_at
  LOOP
    coins := coins + item.c;
    xp := xp + item.x;
    entries := entries || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'role', 'helper', 'coins', item.c, 'xp', item.x, 'at', item.created_at,
      'nickname', public.street_public_identity(item.other_id) ->> 'nickname'
    ));
  END LOOP;
  FOR item IN
    UPDATE public.member_street_helps
    SET owner_claimed_at = pg_catalog.now(), owner_claim_key = p_claim_key
    WHERE id IN (
      SELECT id FROM public.member_street_helps
      WHERE owner_id = uid AND owner_claimed_at IS NULL
      ORDER BY created_at
      LIMIT 50
    ) AND owner_claimed_at IS NULL
    RETURNING helper_id AS other_id, owner_coins AS c, created_at
  LOOP
    coins := coins + item.c;
    entries := entries || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'role', 'owner', 'coins', item.c, 'xp', 0, 'at', item.created_at,
      'nickname', public.street_public_identity(item.other_id) ->> 'nickname'
    ));
  END LOOP;
  -- 沒領到任何列時不留紀錄；同一把鍵之後再送，就把那時新增的互助列一起領走，前端仍只入帳一次。
  IF pg_catalog.jsonb_array_length(entries) > 0 THEN
    INSERT INTO public.member_street_help_claims (user_id, claim_key, coins, xp, entries)
    VALUES (uid, p_claim_key, coins, xp, entries);
  END IF;
  PERFORM pg_catalog.set_config('street.internal', 'off', true);
  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'replay', false, 'claimKey', p_claim_key,
    'coins', coins, 'xp', xp, 'entries', entries,
    'help', public.street_help_status_json(uid)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 權限
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.guard_street_help_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_friend_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_help_status_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_friend_card(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_street_friends() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_street_friend(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_street_friend(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_street_friend(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.help_street_friend(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_my_street_help_rewards(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_street_friends() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_street_friend(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_street_friend(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_street_friend(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.help_street_friend(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_my_street_help_rewards(uuid) TO authenticated;

DO $street_help_guard_grant$
DECLARE
  auth_owner text;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(cls.relowner) INTO auth_owner
  FROM pg_catalog.pg_class AS cls WHERE cls.oid = 'auth.users'::regclass;
  IF auth_owner IS NOT NULL AND auth_owner NOT IN ('anon', 'authenticated', 'public') THEN
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.guard_street_help_write() TO %I', auth_owner);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin')
     AND auth_owner IS DISTINCT FROM 'supabase_auth_admin' THEN
    GRANT EXECUTE ON FUNCTION public.guard_street_help_write() TO supabase_auth_admin;
  END IF;
END
$street_help_guard_grant$;

-- ---------------------------------------------------------------------------
-- 自我檢查
-- ---------------------------------------------------------------------------

DO $street_help_self_check$
DECLARE
  fn text;
  def text;
  rel text;
  actor text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.get_my_street_friends()', 'public.request_street_friend(uuid)', 'public.respond_street_friend(uuid, boolean)',
    'public.remove_street_friend(uuid)', 'public.help_street_friend(uuid, uuid)', 'public.claim_my_street_help_rewards(uuid)',
    'public.street_help_status_json(uuid)', 'public.street_friend_card(uuid, uuid)'
  ] LOOP
    def := pg_catalog.pg_get_functiondef(fn::regprocedure);
    IF position('post_member_reward' IN def) > 0 OR position('member_point' IN def) > 0
       OR position('reward_claims' IN def) > 0 OR position('member_perk' IN def) > 0 THEN
      RAISE EXCEPTION '好友互助不能碰 Pay 點數或虛擬特權：%', fn;
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '訪客不能執行 %', fn;
    END IF;
  END LOOP;

  FOREACH fn IN ARRAY ARRAY[
    'public.get_my_street_friends()', 'public.request_street_friend(uuid)', 'public.respond_street_friend(uuid, boolean)',
    'public.remove_street_friend(uuid)', 'public.help_street_friend(uuid, uuid)', 'public.claim_my_street_help_rewards(uuid)'
  ] LOOP
    IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '已登入會員應可執行 %', fn;
    END IF;
  END LOOP;

  IF has_function_privilege('authenticated', 'public.street_help_status_json(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.street_friend_status(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.street_friend_card(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.guard_street_help_write()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.guard_street_help_write()', 'EXECUTE') THEN
    RAISE EXCEPTION '內部互助函式不該被直接呼叫';
  END IF;

  FOREACH rel IN ARRAY ARRAY[
    'street_help_settings', 'member_street_friends', 'member_street_friend_requests',
    'member_street_helps', 'member_street_help_claims'
  ] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = ('public.' || rel)::regclass) THEN
      RAISE EXCEPTION '% 未啟用 RLS', rel;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = ('public.' || rel)::regclass) THEN
      RAISE EXCEPTION '% 不該有直接讀寫政策', rel;
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

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin')
     AND NOT has_function_privilege('supabase_auth_admin', 'public.guard_street_help_write()', 'EXECUTE') THEN
    RAISE EXCEPTION '會員刪除角色必須能執行互助刪除守衛，否則外鍵連動會被權限擋住';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = proc.pronamespace
    WHERE nsp.nspname = 'public'
      AND proc.proname = ANY (ARRAY[
        'guard_street_help_write', 'street_friend_status', 'street_help_status_json', 'street_friend_card',
        'get_my_street_friends', 'request_street_friend', 'respond_street_friend', 'remove_street_friend',
        'help_street_friend', 'claim_my_street_help_rewards'
      ])
      AND NOT ('search_path=pg_catalog' = ANY (COALESCE(proc.proconfig, ARRAY[]::text[])))
  ) THEN
    RAISE EXCEPTION '互助函式必須固定 search_path = pg_catalog';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = proc.pronamespace
    WHERE nsp.nspname = 'public'
      AND proc.proname = ANY (ARRAY[
        'street_friend_status', 'street_help_status_json', 'street_friend_card',
        'get_my_street_friends', 'request_street_friend', 'respond_street_friend', 'remove_street_friend',
        'help_street_friend', 'claim_my_street_help_rewards'
      ])
      AND proc.prosecdef IS NOT TRUE
  ) THEN
    RAISE EXCEPTION '讀寫互助資料的函式必須是 SECURITY DEFINER，避免會員直接碰表';
  END IF;

  IF pg_catalog.to_regprocedure('public.claim_my_street_help_rewards()') IS NOT NULL THEN
    RAISE EXCEPTION '不可留下沒有領取鍵的舊領取函式';
  END IF;

  IF (SELECT count(*) FROM public.street_help_settings) <> 1 THEN
    RAISE EXCEPTION '互助參數必須只有一列';
  END IF;
END
$street_help_self_check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
