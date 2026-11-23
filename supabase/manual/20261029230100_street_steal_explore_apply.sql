-- =============================================================================
-- 第七階段第 7 批正式套用版：全民趣味偷貨、探索商店街。
-- 狀態：待站長確認，尚未執行。確認前不得在正式 Supabase 執行。
-- 先跑 20261029230000_street_steal_explore_readonly_check.sql，batch7_gate 顯示可以套用才執行本檔。
--
-- 依賴第 5 批：member_street_exhibits（公開狀態）、street_taipei_day、street_public_identity、street.internal 交易旗標。
-- 依賴第 6 批：street_friend_status（探索列表顯示好友關係）。第 6 批的表、函式、互助規則與領獎機制一律不改。
-- 加好友直接沿用第 6 批 request_street_friend / respond_street_friend，本檔不另建好友系統。
--
-- 對正式資料的影響：
--   只新增 street_steal_settings（插入唯一一列預設參數）、member_street_steal_prefs、
--   member_street_steals、member_street_steal_claims 與其函式。
--   不讀寫既有會員、好友、互助、點數、遊戲進度、商品、庫存、優惠券或訂單資料列。整份包在單一交易。
--
-- 規則：
--   1. 偷貨不需要好友關係。對象必須是已公開的商店街，屋主開放偷貨（未設定時沿用 default_allow），且不是自己。
--   2. 偷貨者必須參與夢想商店街：在 member_street_exhibits 有一列（公開或不公開都可以）。
--   3. 偷到的是系統另外生成的夢想金幣與經驗，寫在偷貨紀錄上，不扣屋主任何東西。
--      屋主沒有任何資產列在資料庫，本檔也不寫屋主的存檔；屋主只會在紀錄裡看到誰來偷過。
--   4. 每日次數、同一屋主每日次數、屋主每日被偷上限、冷卻、成功率與獎勵都只放在 street_steal_settings 一列。
--   5. 前端每次偷貨帶 request_key。同一把鍵重送回放同一筆結果（含成功或失敗），不會再擲一次、不會再記一筆。
--   6. 偷貨獎勵用 claim_my_street_steal_rewards(p_claim_key) 回到自己的街才入帳，可安全重試，與好友互助的領取分開。
--   7. 不呼叫 post_member_reward，不寫 member_point_entries、reward_claims 或 member_point_accounts，不能換 Pay 點數。
--   8. 會員不能直接讀寫這四張表，只能走下面的函式；auth.users 刪除時外鍵連動仍可清除。
--   9. 探索只列出已公開的商店街，回傳公開暱稱、頭像、展示等級與店面，不含 Email、電話、地址或任何私人存檔。
-- 第 8 批（社交排行榜）不在本檔。
-- =============================================================================

BEGIN;

DO $require_street_batch6$
BEGIN
  IF pg_catalog.to_regclass('public.member_street_exhibits') IS NULL
     OR pg_catalog.to_regprocedure('public.street_taipei_day(timestamptz)') IS NULL
     OR pg_catalog.to_regprocedure('public.street_public_identity(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.street_social_counts(uuid)') IS NULL THEN
    RAISE EXCEPTION '需要先完整套用第七階段第 5 批 20261029220100_street_social_apply.sql';
  END IF;
  IF pg_catalog.to_regclass('public.member_street_friends') IS NULL
     OR pg_catalog.to_regprocedure('public.street_friend_status(uuid, uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.request_street_friend(uuid)') IS NULL THEN
    RAISE EXCEPTION '需要先完整套用第七階段第 6 批 20261029220200_street_friend_help_apply.sql';
  END IF;
  IF pg_catalog.to_regclass('public.street_steal_settings') IS NOT NULL
     OR pg_catalog.to_regclass('public.member_street_steal_prefs') IS NOT NULL
     OR pg_catalog.to_regclass('public.member_street_steals') IS NOT NULL
     OR pg_catalog.to_regclass('public.member_street_steal_claims') IS NOT NULL THEN
    RAISE EXCEPTION '第 7 批資料表已存在。為保護正式資料，本檔不重跑';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = proc.pronamespace
    WHERE nsp.nspname = 'public'
      AND proc.proname = ANY (ARRAY[
        'guard_street_steal_write', 'street_steal_allowed', 'street_steal_status_json',
        'get_my_street_steal', 'set_my_street_steal', 'get_street_steal_target',
        'steal_street_goods', 'claim_my_street_steal_rewards', 'explore_public_streets'
      ])
  ) THEN
    RAISE EXCEPTION '第 7 批同名函式已存在。為避免覆蓋正式函式，本檔停止';
  END IF;
END
$require_street_batch6$;

CREATE TABLE IF NOT EXISTS public.street_steal_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  default_allow boolean NOT NULL DEFAULT true,
  daily_steal_limit smallint NOT NULL DEFAULT 8 CHECK (daily_steal_limit BETWEEN 0 AND 50),
  pair_daily_limit smallint NOT NULL DEFAULT 1 CHECK (pair_daily_limit BETWEEN 0 AND 10),
  owner_daily_limit smallint NOT NULL DEFAULT 20 CHECK (owner_daily_limit BETWEEN 0 AND 200),
  steal_cooldown_seconds integer NOT NULL DEFAULT 30 CHECK (steal_cooldown_seconds BETWEEN 0 AND 86400),
  success_percent smallint NOT NULL DEFAULT 70 CHECK (success_percent BETWEEN 0 AND 100),
  coins_min integer NOT NULL DEFAULT 8 CHECK (coins_min BETWEEN 0 AND 1000),
  coins_max integer NOT NULL DEFAULT 20 CHECK (coins_max BETWEEN 0 AND 1000),
  steal_xp integer NOT NULL DEFAULT 3 CHECK (steal_xp BETWEEN 0 AND 1000),
  explore_page_size smallint NOT NULL DEFAULT 20 CHECK (explore_page_size BETWEEN 1 AND 50),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT street_steal_settings_coin_range CHECK (coins_min <= coins_max)
);

INSERT INTO public.street_steal_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.street_steal_settings IS
  '趣味偷貨與探索的唯一參數列。只有資料庫擁有者可調整；獎勵只是夢想金幣與經驗，不能兌換 Pay 點數。';

CREATE TABLE IF NOT EXISTS public.member_street_steal_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  allow_steal boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.member_street_steals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thief_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  steal_day date NOT NULL,
  request_key uuid NOT NULL,
  outcome text NOT NULL,
  coins integer NOT NULL CHECK (coins BETWEEN 0 AND 1000),
  xp integer NOT NULL CHECK (xp BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_key uuid,
  CONSTRAINT member_street_steals_not_self CHECK (thief_id <> owner_id),
  CONSTRAINT member_street_steals_request_key UNIQUE (thief_id, request_key),
  CONSTRAINT member_street_steals_outcome CHECK (outcome IN ('success', 'miss')),
  CONSTRAINT member_street_steals_miss_empty CHECK (outcome = 'success' OR (coins = 0 AND xp = 0)),
  CONSTRAINT member_street_steals_claim_pair CHECK ((claimed_at IS NULL) = (claim_key IS NULL))
);

CREATE TABLE IF NOT EXISTS public.member_street_steal_claims (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  claim_key uuid NOT NULL,
  coins integer NOT NULL CHECK (coins BETWEEN 0 AND 1000000),
  xp integer NOT NULL CHECK (xp BETWEEN 0 AND 1000000),
  entries jsonb NOT NULL CHECK (jsonb_typeof(entries) = 'array'),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, claim_key)
);

CREATE INDEX IF NOT EXISTS member_street_steals_thief_day ON public.member_street_steals (thief_id, steal_day);
CREATE INDEX IF NOT EXISTS member_street_steals_thief_time ON public.member_street_steals (thief_id, created_at DESC);
CREATE INDEX IF NOT EXISTS member_street_steals_owner_time ON public.member_street_steals (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS member_street_steals_owner_day ON public.member_street_steals (owner_id, steal_day);
CREATE INDEX IF NOT EXISTS member_street_steals_unclaimed ON public.member_street_steals (thief_id)
  WHERE claimed_at IS NULL AND outcome = 'success';
CREATE INDEX IF NOT EXISTS member_street_exhibits_published_time ON public.member_street_exhibits (updated_at DESC, user_id)
  WHERE published;

COMMENT ON TABLE public.member_street_steal_prefs IS '屋主是否允許其他玩家趣味偷貨。沒有列時沿用 street_steal_settings.default_allow。';
COMMENT ON TABLE public.member_street_steals IS
  '趣味偷貨紀錄。獎勵由系統另外生成，只發給偷貨者的夢想商店街，不扣屋主任何資產。同一把請求鍵只有一列。';
COMMENT ON TABLE public.member_street_steal_claims IS
  '每次領取偷貨獎勵的伺服器紀錄。同一位會員同一把領取鍵只有一列，重送時回放同一筆。只寫入、不修改。';

CREATE OR REPLACE FUNCTION public.guard_street_steal_write()
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
    IF TG_TABLE_NAME = 'member_street_steal_prefs' THEN
      user_gone := NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id);
    ELSIF TG_TABLE_NAME = 'member_street_steals' THEN
      user_gone := NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.thief_id)
        OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.owner_id);
    ELSIF TG_TABLE_NAME = 'member_street_steal_claims' THEN
      user_gone := NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id);
    END IF;
    IF user_gone THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '偷貨紀錄不可刪除';
  END IF;
  IF pg_catalog.current_setting('street.internal', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '趣味偷貨只能由商店街交易更新';
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'member_street_steals' THEN
    IF (NEW.id, NEW.thief_id, NEW.owner_id, NEW.steal_day, NEW.request_key, NEW.outcome, NEW.coins, NEW.xp, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.thief_id, OLD.owner_id, OLD.steal_day, OLD.request_key, OLD.outcome, OLD.coins, OLD.xp, OLD.created_at)
       OR (OLD.claimed_at IS NOT NULL AND (NEW.claimed_at, NEW.claim_key) IS DISTINCT FROM (OLD.claimed_at, OLD.claim_key)) THEN
      RAISE EXCEPTION '偷貨紀錄只能標記領取一次';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'member_street_steal_claims' THEN
    RAISE EXCEPTION '偷貨領取紀錄不可修改';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS member_street_steal_prefs_guard ON public.member_street_steal_prefs;
CREATE TRIGGER member_street_steal_prefs_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_street_steal_prefs
  FOR EACH ROW EXECUTE FUNCTION public.guard_street_steal_write();

DROP TRIGGER IF EXISTS member_street_steals_guard ON public.member_street_steals;
CREATE TRIGGER member_street_steals_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_street_steals
  FOR EACH ROW EXECUTE FUNCTION public.guard_street_steal_write();

DROP TRIGGER IF EXISTS member_street_steal_claims_guard ON public.member_street_steal_claims;
CREATE TRIGGER member_street_steal_claims_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_street_steal_claims
  FOR EACH ROW EXECUTE FUNCTION public.guard_street_steal_write();

ALTER TABLE public.street_steal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_street_steal_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_street_steals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_street_steal_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.street_steal_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_street_steal_prefs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_street_steals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_street_steal_claims FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 內部輔助
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.street_steal_allowed(p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT allow_steal FROM public.member_street_steal_prefs WHERE user_id = p_owner),
    (SELECT default_allow FROM public.street_steal_settings WHERE id),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.street_steal_status_json(p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  s public.street_steal_settings%ROWTYPE;
  day date := public.street_taipei_day(pg_catalog.now());
  used integer;
  last_at timestamptz;
  unclaimed_coins integer;
  unclaimed_xp integer;
  unclaimed_count integer;
BEGIN
  SELECT * INTO s FROM public.street_steal_settings WHERE id;
  SELECT count(*)::integer INTO used FROM public.member_street_steals WHERE thief_id = p_uid AND steal_day = day;
  SELECT max(created_at) INTO last_at FROM public.member_street_steals WHERE thief_id = p_uid;
  SELECT coalesce(sum(coins), 0)::integer, coalesce(sum(xp), 0)::integer, count(*)::integer
    INTO unclaimed_coins, unclaimed_xp, unclaimed_count
  FROM public.member_street_steals
  WHERE thief_id = p_uid AND claimed_at IS NULL AND outcome = 'success';
  RETURN pg_catalog.jsonb_build_object(
    'enabled', s.enabled,
    'day', day,
    'usedToday', used,
    'dailyLimit', s.daily_steal_limit,
    'pairLimit', s.pair_daily_limit,
    'ownerLimit', s.owner_daily_limit,
    'cooldownSeconds', s.steal_cooldown_seconds,
    'cooldownUntil', CASE
      WHEN last_at IS NOT NULL AND last_at + pg_catalog.make_interval(secs => s.steal_cooldown_seconds) > pg_catalog.now()
      THEN last_at + pg_catalog.make_interval(secs => s.steal_cooldown_seconds)
      ELSE NULL
    END,
    'successPercent', s.success_percent,
    'coinsMin', s.coins_min,
    'coinsMax', s.coins_max,
    'xp', s.steal_xp,
    'unclaimedCoins', unclaimed_coins,
    'unclaimedXp', unclaimed_xp,
    'unclaimedCount', unclaimed_count
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 會員入口
-- ---------------------------------------------------------------------------

-- 屋主自己的設定、今日被偷次數與最近 20 筆紀錄。
CREATE OR REPLACE FUNCTION public.get_my_street_steal()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date := public.street_taipei_day(pg_catalog.now());
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'allowSteal', public.street_steal_allowed(uid),
    'stolenToday', (SELECT count(*)::integer FROM public.member_street_steals WHERE owner_id = uid AND steal_day = day),
    'log', coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'nickname', public.street_public_identity(r.thief_id) ->> 'nickname',
        'outcome', r.outcome,
        'coins', r.coins,
        'at', r.created_at
      ) ORDER BY r.created_at DESC)
      FROM (
        SELECT thief_id, outcome, coins, created_at
        FROM public.member_street_steals
        WHERE owner_id = uid
        ORDER BY created_at DESC
        LIMIT 20
      ) AS r
    ), '[]'::jsonb),
    'steal', public.street_steal_status_json(uid)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_street_steal(p_allow boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_allow IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  PERFORM pg_catalog.set_config('street.internal', 'on', true);
  INSERT INTO public.member_street_steal_prefs (user_id, allow_steal)
  VALUES (uid, p_allow)
  ON CONFLICT (user_id) DO UPDATE SET allow_steal = EXCLUDED.allow_steal, updated_at = pg_catalog.now();
  PERFORM pg_catalog.set_config('street.internal', 'off', true);
  RETURN pg_catalog.jsonb_build_object('ok', true, 'allowSteal', p_allow);
END;
$$;

-- 拜訪別人的街時，顯示能不能偷、今天在這條街偷過幾次。未公開與查無此人一樣回 closed。
CREATE OR REPLACE FUNCTION public.get_street_steal_target(p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date := public.street_taipei_day(pg_catalog.now());
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_owner IS NULL OR p_owner = uid THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'self');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.member_street_exhibits WHERE user_id = p_owner AND published) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'closed');
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'allowSteal', public.street_steal_allowed(p_owner),
    'player', EXISTS (SELECT 1 FROM public.member_street_exhibits WHERE user_id = uid),
    'triedToday', (SELECT count(*)::integer FROM public.member_street_steals WHERE thief_id = uid AND owner_id = p_owner AND steal_day = day),
    'ownerToday', (SELECT count(*)::integer FROM public.member_street_steals WHERE owner_id = p_owner AND steal_day = day),
    'steal', public.street_steal_status_json(uid)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.steal_street_goods(p_owner uuid, p_request_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  s public.street_steal_settings%ROWTYPE;
  day date := public.street_taipei_day(pg_catalog.now());
  prior public.member_street_steals%ROWTYPE;
  last_at timestamptz;
  won boolean;
  got_coins integer := 0;
  got_xp integer := 0;
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
  -- 偷貨者與屋主各一把鎖，鍵名空間不同，兩人互偷時不會互等；同一人並發送出只會一筆一筆判斷。
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-steal-thief:' || uid::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-steal-owner:' || p_owner::text, 0));
  SELECT * INTO prior FROM public.member_street_steals WHERE thief_id = uid AND request_key = p_request_key;
  IF FOUND THEN
    IF prior.owner_id <> p_owner THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'replay', true, 'outcome', prior.outcome, 'coins', prior.coins, 'xp', prior.xp,
      'steal', public.street_steal_status_json(uid)
    );
  END IF;
  SELECT * INTO s FROM public.street_steal_settings WHERE id;
  IF NOT s.enabled THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'disabled', 'steal', public.street_steal_status_json(uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.member_street_exhibits WHERE user_id = p_owner AND published) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'closed', 'steal', public.street_steal_status_json(uid));
  END IF;
  IF NOT public.street_steal_allowed(p_owner) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'owner_off', 'steal', public.street_steal_status_json(uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.member_street_exhibits WHERE user_id = uid) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'not_player', 'steal', public.street_steal_status_json(uid));
  END IF;
  IF (SELECT count(*) FROM public.member_street_steals WHERE thief_id = uid AND owner_id = p_owner AND steal_day = day) >= s.pair_daily_limit THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'already', 'steal', public.street_steal_status_json(uid));
  END IF;
  IF (SELECT count(*) FROM public.member_street_steals WHERE thief_id = uid AND steal_day = day) >= s.daily_steal_limit THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'limit', 'steal', public.street_steal_status_json(uid));
  END IF;
  IF (SELECT count(*) FROM public.member_street_steals WHERE owner_id = p_owner AND steal_day = day) >= s.owner_daily_limit THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'owner_full', 'steal', public.street_steal_status_json(uid));
  END IF;
  SELECT max(created_at) INTO last_at FROM public.member_street_steals WHERE thief_id = uid;
  IF last_at IS NOT NULL AND last_at + pg_catalog.make_interval(secs => s.steal_cooldown_seconds) > pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'cooldown', 'steal', public.street_steal_status_json(uid));
  END IF;
  won := pg_catalog.random() * 100 < s.success_percent;
  IF won THEN
    got_coins := s.coins_min + pg_catalog.floor(pg_catalog.random() * (s.coins_max - s.coins_min + 1))::integer;
    got_coins := LEAST(s.coins_max, got_coins);
    got_xp := s.steal_xp;
  END IF;
  PERFORM pg_catalog.set_config('street.internal', 'on', true);
  INSERT INTO public.member_street_steals (thief_id, owner_id, steal_day, request_key, outcome, coins, xp)
  VALUES (uid, p_owner, day, p_request_key, CASE WHEN won THEN 'success' ELSE 'miss' END, got_coins, got_xp);
  PERFORM pg_catalog.set_config('street.internal', 'off', true);
  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'replay', false, 'outcome', CASE WHEN won THEN 'success' ELSE 'miss' END,
    'coins', got_coins, 'xp', got_xp,
    'steal', public.street_steal_status_json(uid)
  );
END;
$$;

-- 前端先把 p_claim_key 寫進存檔再呼叫。同一位會員同一把鍵只會真的領一次，之後重送回放同一筆。
CREATE OR REPLACE FUNCTION public.claim_my_street_steal_rewards(p_claim_key uuid)
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
  prior public.member_street_steal_claims%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_claim_key IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-steal-claim:' || uid::text, 0));
  SELECT * INTO prior FROM public.member_street_steal_claims WHERE user_id = uid AND claim_key = p_claim_key;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'replay', true, 'claimKey', p_claim_key,
      'coins', prior.coins, 'xp', prior.xp, 'entries', prior.entries,
      'steal', public.street_steal_status_json(uid)
    );
  END IF;
  PERFORM pg_catalog.set_config('street.internal', 'on', true);
  FOR item IN
    UPDATE public.member_street_steals
    SET claimed_at = pg_catalog.now(), claim_key = p_claim_key
    WHERE id IN (
      SELECT id FROM public.member_street_steals
      WHERE thief_id = uid AND claimed_at IS NULL AND outcome = 'success'
      ORDER BY created_at
      LIMIT 50
    ) AND claimed_at IS NULL
    RETURNING owner_id AS other_id, member_street_steals.coins AS c, member_street_steals.xp AS x, created_at
  LOOP
    coins := coins + item.c;
    xp := xp + item.x;
    entries := entries || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'coins', item.c, 'xp', item.x, 'at', item.created_at,
      'nickname', public.street_public_identity(item.other_id) ->> 'nickname'
    ));
  END LOOP;
  IF pg_catalog.jsonb_array_length(entries) > 0 THEN
    INSERT INTO public.member_street_steal_claims (user_id, claim_key, coins, xp, entries)
    VALUES (uid, p_claim_key, coins, xp, entries);
  END IF;
  PERFORM pg_catalog.set_config('street.internal', 'off', true);
  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'replay', false, 'claimKey', p_claim_key,
    'coins', coins, 'xp', xp, 'entries', entries,
    'steal', public.street_steal_status_json(uid)
  );
END;
$$;

-- 探索：只列出已公開的商店街，排除自己。回傳的欄位與拜訪頁相同，沒有任何私人資料。
CREATE OR REPLACE FUNCTION public.explore_public_streets(p_offset integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  size integer;
  skip integer := LEAST(500, GREATEST(0, COALESCE(p_offset, 0)));
  day date := public.street_taipei_day(pg_catalog.now());
  found_rows jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT explore_page_size INTO size FROM public.street_steal_settings WHERE id;
  SELECT coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'ownerId', e.user_id,
      'shopLevel', e.shop_level,
      'buildings', e.buildings,
      'likes', (public.street_social_counts(e.user_id) ->> 'likes')::integer,
      'todayVisitors', (public.street_social_counts(e.user_id) ->> 'todayVisitors')::integer,
      'friend', public.street_friend_status(uid, e.user_id),
      'allowSteal', public.street_steal_allowed(e.user_id),
      'triedToday', (SELECT count(*)::integer FROM public.member_street_steals AS t
                     WHERE t.thief_id = uid AND t.owner_id = e.user_id AND t.steal_day = day),
      'updatedAt', e.updated_at
    ) || public.street_public_identity(e.user_id)
    ORDER BY e.updated_at DESC, e.user_id
  ), '[]'::jsonb)
  INTO found_rows
  FROM (
    SELECT user_id, shop_level, buildings, updated_at
    FROM public.member_street_exhibits
    WHERE published AND user_id <> uid
    ORDER BY updated_at DESC, user_id
    OFFSET skip
    LIMIT size + 1
  ) AS e;
  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'offset', skip,
    'hasMore', pg_catalog.jsonb_array_length(found_rows) > size,
    'streets', CASE WHEN pg_catalog.jsonb_array_length(found_rows) > size THEN found_rows - size ELSE found_rows END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 權限
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.guard_street_steal_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_steal_allowed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_steal_status_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_street_steal() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_street_steal(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_street_steal_target(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.steal_street_goods(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_my_street_steal_rewards(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.explore_public_streets(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_street_steal() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_street_steal(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_street_steal_target(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.steal_street_goods(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_my_street_steal_rewards(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.explore_public_streets(integer) TO authenticated;

DO $street_steal_guard_grant$
DECLARE
  auth_owner text;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(cls.relowner) INTO auth_owner
  FROM pg_catalog.pg_class AS cls WHERE cls.oid = 'auth.users'::regclass;
  IF auth_owner IS NOT NULL AND auth_owner NOT IN ('anon', 'authenticated', 'public') THEN
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.guard_street_steal_write() TO %I', auth_owner);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin')
     AND auth_owner IS DISTINCT FROM 'supabase_auth_admin' THEN
    GRANT EXECUTE ON FUNCTION public.guard_street_steal_write() TO supabase_auth_admin;
  END IF;
END
$street_steal_guard_grant$;

-- ---------------------------------------------------------------------------
-- 自我檢查
-- ---------------------------------------------------------------------------

DO $street_steal_self_check$
DECLARE
  fn text;
  def text;
  rel text;
  actor text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.get_my_street_steal()', 'public.set_my_street_steal(boolean)', 'public.get_street_steal_target(uuid)',
    'public.steal_street_goods(uuid, uuid)', 'public.claim_my_street_steal_rewards(uuid)', 'public.explore_public_streets(integer)',
    'public.street_steal_status_json(uuid)', 'public.street_steal_allowed(uuid)'
  ] LOOP
    def := pg_catalog.pg_get_functiondef(fn::regprocedure);
    IF position('post_member_reward' IN def) > 0 OR position('member_point' IN def) > 0
       OR position('reward_claims' IN def) > 0 OR position('member_perk' IN def) > 0
       OR position('member_street_helps' IN def) > 0 OR position('products' IN def) > 0
       OR position('coupon' IN def) > 0 OR position('orders' IN def) > 0 THEN
      RAISE EXCEPTION '趣味偷貨不能碰 Pay 點數、互助、商品、優惠券或訂單：%', fn;
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '訪客不能執行 %', fn;
    END IF;
  END LOOP;

  FOREACH fn IN ARRAY ARRAY[
    'public.get_my_street_steal()', 'public.set_my_street_steal(boolean)', 'public.get_street_steal_target(uuid)',
    'public.steal_street_goods(uuid, uuid)', 'public.claim_my_street_steal_rewards(uuid)', 'public.explore_public_streets(integer)'
  ] LOOP
    IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '已登入會員應可執行 %', fn;
    END IF;
  END LOOP;

  IF has_function_privilege('authenticated', 'public.street_steal_status_json(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.street_steal_allowed(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.guard_street_steal_write()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.guard_street_steal_write()', 'EXECUTE') THEN
    RAISE EXCEPTION '內部偷貨函式不該被直接呼叫';
  END IF;

  FOREACH rel IN ARRAY ARRAY['street_steal_settings', 'member_street_steal_prefs', 'member_street_steals', 'member_street_steal_claims']
  LOOP
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
     AND NOT has_function_privilege('supabase_auth_admin', 'public.guard_street_steal_write()', 'EXECUTE') THEN
    RAISE EXCEPTION '會員刪除角色必須能執行偷貨刪除守衛，否則外鍵連動會被權限擋住';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = proc.pronamespace
    WHERE nsp.nspname = 'public'
      AND proc.proname = ANY (ARRAY[
        'guard_street_steal_write', 'street_steal_allowed', 'street_steal_status_json',
        'get_my_street_steal', 'set_my_street_steal', 'get_street_steal_target',
        'steal_street_goods', 'claim_my_street_steal_rewards', 'explore_public_streets'
      ])
      AND NOT ('search_path=pg_catalog' = ANY (COALESCE(proc.proconfig, ARRAY[]::text[])))
  ) THEN
    RAISE EXCEPTION '偷貨函式必須固定 search_path = pg_catalog';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = proc.pronamespace
    WHERE nsp.nspname = 'public'
      AND proc.proname = ANY (ARRAY[
        'street_steal_allowed', 'street_steal_status_json',
        'get_my_street_steal', 'set_my_street_steal', 'get_street_steal_target',
        'steal_street_goods', 'claim_my_street_steal_rewards', 'explore_public_streets'
      ])
      AND proc.prosecdef IS NOT TRUE
  ) THEN
    RAISE EXCEPTION '讀寫偷貨資料的函式必須是 SECURITY DEFINER，避免會員直接碰表';
  END IF;

  IF (SELECT count(*) FROM public.street_steal_settings) <> 1 THEN
    RAISE EXCEPTION '偷貨參數必須只有一列';
  END IF;
END
$street_steal_self_check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
