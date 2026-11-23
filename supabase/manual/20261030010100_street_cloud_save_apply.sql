-- =============================================================================
-- 第七階段第 9 批正式套用版：夢想商店街會員雲端存檔。
-- 狀態：待站長確認，尚未執行。確認前不得在正式 Supabase 執行。
-- 先跑 20261030010000_street_cloud_save_readonly_check.sql，batch9_gate 顯示可以套用才執行本檔。
--
-- 依賴第 6 批：member_street_help_claims（互助獎勵領取紀錄）。
-- 依賴第 7 批：member_street_steal_claims（偷貨獎勵領取紀錄）。
-- 第 5～8 批的表、函式、觸發器與權限一律不改；互助、偷貨的次數、冷卻、開關與獎勵規則不變。
--
-- 對正式資料的影響：
--   新增 4 張表：street_cloud_settings（參數一列）、member_street_saves（每位會員一列存檔）、
--   member_street_save_credits（互助／偷貨獎勵入帳紀錄）、member_street_save_log（每次存檔的變動紀錄）。
--   新增 3 個會員可呼叫的函式：get_my_street_save()、import_my_street_save(jsonb, uuid)、
--   save_my_street(bigint, jsonb, uuid)，以及 5 個內部輔助函式（會員不能直接呼叫）。
--   不修改、不刪除任何既有資料列；只讀第 6、7 批的領取紀錄，不改它們。
--   不碰 member_point_*、reward_claims、優惠券、商品、庫存或訂單，不發 Pay 點數。整份包在單一交易。
--
-- 規則：
--   1. 會員身分只取 auth.uid()。四張表都開 RLS 且不開放任何直接讀寫，會員只能透過函式讀寫「自己」那一列。
--   2. 金幣、經驗、店面等級、街邊店與裝潢由資料庫重算，不採用前端送來的金幣與經驗數字：
--        新金幣 = 上一版金幣 + 這段時間的營業收入 + 伺服器確認的互助／偷貨獎勵 − 依規則計算的升級、開店、裝潢花費
--        新經驗 = 上一版經驗 + 這段時間的營業經驗 + 伺服器確認的獎勵經驗
--      營業收入與經驗用存檔裡只增不減的累計統計（served、itemsSold、earned、xpEarned）相減得到，
--      並以伺服器時間檢查上限：來客速度、製作速度、每件商品最高售價與經驗都照遊戲規則推算，超過就拒收。
--      店面只能升級不能降級，已開幕的店與已收藏的裝潢不能消失；金幣不夠、店長等級不夠就拒收。
--   3. 版本控制：每列有 revision。存檔必須帶上自己所根據的 revision，不同就回 conflict 並附上雲端最新版，
--      不會讓舊裝置覆蓋新裝置。每次請求帶 request_key，回覆遺失時用同一把鍵重送會回放結果，不會重算。
--   4. 互助、偷貨獎勵：存檔時把第 6、7 批領取紀錄中「還沒入帳」的領取鍵一次入帳，
--      member_street_save_credits 以（會員、來源、領取鍵）為主鍵，同一筆只會入帳一次。
--      重送、斷線、換裝置或存檔衝突都不會多加金幣。
--   5. 瀏覽器舊存檔一次性轉移（import_my_street_save）：
--      a. 每位會員只能轉移一次（member_street_saves 主鍵），之後只能用 save_my_street 依規則存檔。
--      b. 舊存檔沒有可信的伺服器來源，所以只接受內部一致的存檔：
--         花費（等級、開店、裝潢）不能超過「累計營收 + 伺服器確認過的獎勵」；
--         累計營收不能超過「賣出件數 × 最高單價」推得的上限，也不能超過 street_cloud_settings.import_earned_cap；
--         經驗不能超過「賣出件數 × 最高單件經驗 + 伺服器確認過的獎勵經驗」；店長等級要符合已買的東西。
--         金幣超過「營收 + 獎勵 − 花費」的部分會被調降並標記 import_adjusted。正常遊玩的存檔不會被調整。
--      c. 原始瀏覽器存檔另存在 import_raw，供站長查核；瀏覽器端的舊存檔也不刪除。
--      d. 轉移當下已存在的領取紀錄：只有舊存檔標記「已送出但尚未入帳」的那一把領取鍵會入帳，
--         其他領取紀錄視為已在舊存檔裡（只記錄、不加金幣），避免重複入帳。
--   6. 經營排行不在本批：營收仍由會員裝置上的遊戲計算，伺服器只能檢查上限，不足以公平排名。
--   7. 只有夢想金幣與經驗，不能兌換 Pay 點數。
-- =============================================================================

BEGIN;

DO $require_street_batch8$
BEGIN
  IF pg_catalog.to_regclass('public.member_street_help_claims') IS NULL
     OR pg_catalog.to_regprocedure('public.claim_my_street_help_rewards(uuid)') IS NULL THEN
    RAISE EXCEPTION '需要先完整套用第七階段第 6 批 20261029220200_street_friend_help_apply.sql';
  END IF;
  IF pg_catalog.to_regclass('public.member_street_steal_claims') IS NULL
     OR pg_catalog.to_regprocedure('public.claim_my_street_steal_rewards(uuid)') IS NULL THEN
    RAISE EXCEPTION '需要先完整套用第七階段第 7 批 20261029230100_street_steal_explore_apply.sql';
  END IF;
  IF (
    SELECT count(*) FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name IN ('member_street_help_claims', 'member_street_steal_claims')
      AND c.column_name IN ('user_id', 'claim_key', 'coins', 'xp')
  ) <> 8 THEN
    RAISE EXCEPTION '第 6、7 批領取紀錄欄位與雲端存檔不相容，本檔不修改既有資料表';
  END IF;
  IF pg_catalog.to_regclass('public.street_cloud_settings') IS NOT NULL
     OR pg_catalog.to_regclass('public.member_street_saves') IS NOT NULL
     OR pg_catalog.to_regclass('public.member_street_save_credits') IS NOT NULL
     OR pg_catalog.to_regclass('public.member_street_save_log') IS NOT NULL THEN
    RAISE EXCEPTION '第 9 批資料表已存在。為保護正式資料，本檔不重跑';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = proc.pronamespace
    WHERE nsp.nspname = 'public'
      AND proc.proname = ANY (ARRAY[
        'street_cloud_spec', 'street_cloud_int', 'street_cloud_ids', 'street_cloud_rank', 'street_cloud_build',
        'street_cloud_row_json', 'get_my_street_save', 'import_my_street_save', 'save_my_street'
      ])
  ) THEN
    RAISE EXCEPTION '第 9 批同名函式已存在。為避免覆蓋正式函式，本檔停止';
  END IF;
END
$require_street_batch8$;

-- ---------------------------------------------------------------------------
-- 資料表
-- ---------------------------------------------------------------------------

CREATE TABLE public.street_cloud_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  import_earned_cap bigint NOT NULL DEFAULT 1000000 CHECK (import_earned_cap BETWEEN 0 AND 1000000000),
  save_burst_guests integer NOT NULL DEFAULT 30 CHECK (save_burst_guests BETWEEN 0 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.street_cloud_settings (id) VALUES (true);

COMMENT ON TABLE public.street_cloud_settings IS
  '夢想商店街雲端存檔的唯一參數列。enabled 關閉時前端改回只存本機；import_earned_cap 是舊存檔轉移時累計營收的上限。只有資料庫擁有者可調整。';

CREATE TABLE public.member_street_saves (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  progress jsonb NOT NULL CHECK (jsonb_typeof(progress) = 'object'),
  coins bigint NOT NULL CHECK (coins BETWEEN 0 AND 1000000000),
  xp bigint NOT NULL CHECK (xp BETWEEN 0 AND 1000000000),
  shop_level smallint NOT NULL CHECK (shop_level BETWEEN 1 AND 5),
  import_source text NOT NULL CHECK (import_source IN ('browser', 'fresh')),
  import_adjusted boolean NOT NULL DEFAULT false,
  import_raw jsonb,
  last_request_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.member_street_saves IS
  '夢想商店街會員雲端存檔，每位會員一列。只能透過 get_my_street_save、import_my_street_save、save_my_street 讀寫自己的列；金幣與經驗由資料庫重算。';

CREATE TABLE public.member_street_save_credits (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('help', 'steal')),
  claim_key uuid NOT NULL,
  coins integer NOT NULL CHECK (coins BETWEEN 0 AND 1000000),
  xp integer NOT NULL CHECK (xp BETWEEN 0 AND 1000000),
  credited boolean NOT NULL,
  revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, claim_key)
);

COMMENT ON TABLE public.member_street_save_credits IS
  '互助／偷貨領取紀錄入帳到雲端存檔的紀錄。每把領取鍵一列，同一筆只入帳一次。credited = false 表示轉移時已在舊存檔裡，只記錄不加金幣。';

CREATE TABLE public.member_street_save_log (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('import', 'save')),
  d_served bigint NOT NULL,
  d_items bigint NOT NULL,
  d_earned bigint NOT NULL,
  d_xp bigint NOT NULL,
  spent bigint NOT NULL,
  credit_coins bigint NOT NULL,
  credit_xp bigint NOT NULL,
  coins_after bigint NOT NULL,
  xp_after bigint NOT NULL,
  shop_level_after smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, revision)
);

COMMENT ON TABLE public.member_street_save_log IS
  '每次雲端存檔被接受時的變動紀錄（營業增量、花費、獎勵入帳與存後結果），供查核與未來評估經營排行。只寫入。';

ALTER TABLE public.street_cloud_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_street_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_street_save_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_street_save_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.street_cloud_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_street_saves FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_street_save_credits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.member_street_save_log FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 內部輔助：遊戲規則常數（與 lib/arcade/street-rules.ts 相同）
-- ---------------------------------------------------------------------------

-- levels[i]：cum 升到該級的累計花費、rank 需要的店長等級、items 每單最多件數、mul 售價倍率、
-- price／xp 該級已解鎖商品的最高單價與單件經驗、make 最快製作毫秒（奶油餅乾 2200 × 製作倍率）。
CREATE FUNCTION public.street_cloud_spec()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT '{
    "levels": [
      {"cum": 0,    "rank": 1, "shelf": 3, "batch": 2, "stations": 1, "items": 2, "mul": 1.0, "price": 18, "xp": 6,  "make": 2200},
      {"cum": 150,  "rank": 2, "shelf": 4, "batch": 2, "stations": 2, "items": 2, "mul": 1.1, "price": 24, "xp": 8,  "make": 1980},
      {"cum": 570,  "rank": 4, "shelf": 5, "batch": 3, "stations": 2, "items": 3, "mul": 1.2, "price": 34, "xp": 11, "make": 1760},
      {"cum": 1570, "rank": 6, "shelf": 6, "batch": 3, "stations": 3, "items": 3, "mul": 1.3, "price": 46, "xp": 15, "make": 1584},
      {"cum": 3770, "rank": 9, "shelf": 8, "batch": 4, "stations": 3, "items": 3, "mul": 1.5, "price": 68, "xp": 22, "make": 1364}
    ],
    "buildings": {"tea": {"cost": 360, "rank": 3, "shop": 2}, "gift": {"cost": 980, "rank": 6, "shop": 4}},
    "decors": {
      "mat": {"cost": 60, "rank": 1, "shop": 1}, "lantern": {"cost": 90, "rank": 2, "shop": 1},
      "flower": {"cost": 150, "rank": 3, "shop": 2}, "bunting": {"cost": 120, "rank": 2, "shop": 1},
      "planters": {"cost": 170, "rank": 3, "shop": 2}, "lights": {"cost": 220, "rank": 4, "shop": 3}
    },
    "products": {
      "croissant": 1, "milktea": 1, "cookie": 1, "cocoa": 1, "cake": 2, "macaron": 2, "lemonade": 2,
      "roll": 3, "tart": 3, "coffee": 3, "giftbox": 4, "parfait": 4, "sandwich": 4, "choco": 5, "wedding": 5
    }
  }'::jsonb
$$;

CREATE FUNCTION public.street_cloud_int(p jsonb, lo bigint, hi bigint)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
  IF p IS NULL OR pg_catalog.jsonb_typeof(p) <> 'number' THEN
    RETURN lo;
  END IF;
  RETURN LEAST(hi, GREATEST(lo, pg_catalog.floor(LEAST(GREATEST((p #>> '{}')::numeric, -1e15), 1e15))::bigint));
END;
$$;

-- 只留下 allowed 裡的字串、去掉重複、保持原順序；不是陣列就回空陣列。
CREATE FUNCTION public.street_cloud_ids(p jsonb, allowed text[])
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  out_ids text[] := ARRAY[]::text[];
  item jsonb;
BEGIN
  IF p IS NULL OR pg_catalog.jsonb_typeof(p) <> 'array' THEN
    RETURN out_ids;
  END IF;
  FOR item IN SELECT e FROM pg_catalog.jsonb_array_elements(p) AS t(e) LOOP
    IF pg_catalog.jsonb_typeof(item) = 'string' AND (item #>> '{}') = ANY (allowed) AND NOT ((item #>> '{}') = ANY (out_ids)) THEN
      out_ids := out_ids || (item #>> '{}');
    END IF;
  END LOOP;
  RETURN out_ids;
END;
$$;

-- 店長等級：r 升 r+1 需要 50 + (r-1)*40 經驗，最高 30 級。
CREATE FUNCTION public.street_cloud_rank(p_xp bigint)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  r integer := 1;
  left_xp bigint := GREATEST(coalesce(p_xp, 0), 0);
BEGIN
  WHILE r < 30 AND left_xp >= 50 + (r - 1) * 40 LOOP
    left_xp := left_xp - (50 + (r - 1) * 40);
    r := r + 1;
  END LOOP;
  RETURN r;
END;
$$;

-- 驗證一份存檔並算出資料庫認可的版本。p_prev 為 NULL 表示舊存檔轉移（import）。
-- 不寫任何資料；回傳 {ok, reason} 或 {ok, progress, coins, xp, ...增量}。
CREATE FUNCTION public.street_cloud_build(
  p_prev jsonb,
  p_next jsonb,
  p_elapsed_s numeric,
  p_burst integer,
  p_credit_coins bigint,
  p_credit_xp bigint,
  p_reward_coins bigint,
  p_reward_xp bigint,
  p_import_cap bigint
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  big constant bigint := 1000000000;
  spec jsonb := public.street_cloud_spec();
  is_import boolean := p_prev IS NULL;
  ver integer;
  lv_old integer := 1;
  lv_new integer;
  lvl jsonb;
  b_all text[] := ARRAY['tea', 'gift'];
  d_all text[] := ARRAY['mat', 'lantern', 'flower', 'bunting', 'planters', 'lights'];
  b_old text[] := ARRAY[]::text[];
  b_new text[];
  d_old text[] := ARRAY[]::text[];
  d_new text[];
  b_keep text[] := ARRAY[]::text[];
  d_keep text[] := ARRAY[]::text[];
  item text;
  spent bigint := 0;
  need_rank integer := 1;
  s_old jsonb := '{}'::jsonb;
  s_src jsonb;
  stats jsonb := '{}'::jsonb;
  stat_key text;
  n_new bigint;
  n_old bigint;
  d_served bigint;
  d_items bigint;
  d_earned bigint;
  d_xp bigint;
  shops integer;
  stations integer;
  elapsed numeric := GREATEST(coalesce(p_elapsed_s, 0), 0);
  unit numeric;
  max_items numeric;
  budget bigint;
  v_coins bigint;
  v_xp bigint;
  adjusted boolean := false;
  shelf integer;
  stock jsonb := '{}'::jsonb;
  stock_src jsonb;
  prod record;
BEGIN
  IF p_next IS NULL OR pg_catalog.jsonb_typeof(p_next) <> 'object' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  IF pg_catalog.pg_column_size(p_next) > 32768 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'too_large');
  END IF;
  IF coalesce(pg_catalog.jsonb_typeof(p_next -> 'v'), '') <> 'number' OR (p_next ->> 'v') NOT IN ('1', '2', '3') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  ver := (p_next ->> 'v')::integer;

  lv_new := public.street_cloud_int(p_next -> 'shopLevel', 1, 5);
  lvl := spec -> 'levels' -> (lv_new - 1);
  IF ver >= 2 THEN
    FOREACH item IN ARRAY public.street_cloud_ids(p_next -> 'buildings', b_all) LOOP
      IF (spec -> 'buildings' -> item ->> 'shop')::integer <= lv_new THEN b_keep := b_keep || item; END IF;
    END LOOP;
    FOREACH item IN ARRAY public.street_cloud_ids(p_next -> 'ownedDecors', d_all) LOOP
      IF (spec -> 'decors' -> item ->> 'shop')::integer <= lv_new THEN d_keep := d_keep || item; END IF;
    END LOOP;
  END IF;
  b_new := b_keep;
  d_new := d_keep;

  IF NOT is_import THEN
    lv_old := public.street_cloud_int(p_prev -> 'shopLevel', 1, 5);
    b_old := public.street_cloud_ids(p_prev -> 'buildings', b_all);
    d_old := public.street_cloud_ids(p_prev -> 'ownedDecors', d_all);
    s_old := coalesce(p_prev -> 'stats', '{}'::jsonb);
    IF lv_new < lv_old OR NOT (b_old <@ b_new) OR NOT (d_old <@ d_new) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'regress');
    END IF;
  END IF;

  -- 依規則計算花費：只算這次新增的等級、街邊店與裝潢。
  spent := (lvl ->> 'cum')::bigint - (spec -> 'levels' -> (lv_old - 1) ->> 'cum')::bigint;
  IF lv_new > lv_old THEN need_rank := (lvl ->> 'rank')::integer; END IF;
  FOREACH item IN ARRAY b_new LOOP
    IF NOT (item = ANY (b_old)) THEN
      spent := spent + (spec -> 'buildings' -> item ->> 'cost')::bigint;
      need_rank := GREATEST(need_rank, (spec -> 'buildings' -> item ->> 'rank')::integer);
    END IF;
  END LOOP;
  FOREACH item IN ARRAY d_new LOOP
    IF NOT (item = ANY (d_old)) THEN
      spent := spent + (spec -> 'decors' -> item ->> 'cost')::bigint;
      need_rank := GREATEST(need_rank, (spec -> 'decors' -> item ->> 'rank')::integer);
    END IF;
  END LOOP;

  -- 統計：累計值只增不減。
  s_src := CASE WHEN pg_catalog.jsonb_typeof(p_next -> 'stats') = 'object' THEN p_next -> 'stats' ELSE '{}'::jsonb END;
  FOREACH stat_key IN ARRAY ARRAY['served', 'missed', 'itemsSold', 'earned', 'tips', 'streak', 'bestStreak', 'xpEarned'] LOOP
    n_new := public.street_cloud_int(s_src -> stat_key, 0, big);
    IF NOT is_import AND stat_key IN ('served', 'missed', 'itemsSold', 'earned', 'tips', 'xpEarned') THEN
      n_old := public.street_cloud_int(s_old -> stat_key, 0, big);
      IF n_new < n_old THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'regress');
      END IF;
    END IF;
    stats := stats || pg_catalog.jsonb_build_object(stat_key, n_new);
  END LOOP;
  stats := stats || pg_catalog.jsonb_build_object('bestStreak', GREATEST((stats ->> 'bestStreak')::bigint, (stats ->> 'streak')::bigint));

  d_served := (stats ->> 'served')::bigint - public.street_cloud_int(s_old -> 'served', 0, big);
  d_items := (stats ->> 'itemsSold')::bigint - public.street_cloud_int(s_old -> 'itemsSold', 0, big);
  d_earned := (stats ->> 'earned')::bigint - public.street_cloud_int(s_old -> 'earned', 0, big);
  d_xp := (stats ->> 'xpEarned')::bigint - public.street_cloud_int(s_old -> 'xpEarned', 0, big);

  -- 營業上限：件數不超過每單上限，營收不超過件數 × 最高單價（含禮盒加成、快速小費與連續好評）。
  unit := pg_catalog.ceil((lvl ->> 'price')::numeric * (lvl ->> 'mul')::numeric * 1.12);
  IF d_items > d_served * (lvl ->> 'items')::bigint
     OR d_earned > pg_catalog.ceil(d_items * unit * 1.2) + d_served * 12 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', CASE WHEN is_import THEN 'import_inconsistent' ELSE 'implausible' END);
  END IF;

  IF is_import THEN
    IF (stats ->> 'earned')::bigint > p_import_cap THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'import_cap');
    END IF;
    v_xp := public.street_cloud_int(p_next -> 'xp', 0, big);
    IF v_xp > (stats ->> 'itemsSold')::bigint * (lvl ->> 'xp')::bigint + coalesce(p_reward_xp, 0) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'import_inconsistent');
    END IF;
    budget := (stats ->> 'earned')::bigint + coalesce(p_reward_coins, 0);
    IF spent > budget THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'import_inconsistent');
    END IF;
    v_coins := public.street_cloud_int(p_next -> 'coins', 0, big);
    IF v_coins > budget - spent THEN
      v_coins := budget - spent;
      adjusted := true;
    END IF;
    v_coins := LEAST(big, v_coins + coalesce(p_credit_coins, 0));
    v_xp := LEAST(big, v_xp + coalesce(p_credit_xp, 0));
    -- 轉移時店面等級本身也要符合經驗；不只看新增的部分。
    need_rank := (lvl ->> 'rank')::integer;
    FOREACH item IN ARRAY b_new LOOP need_rank := GREATEST(need_rank, (spec -> 'buildings' -> item ->> 'rank')::integer); END LOOP;
    FOREACH item IN ARRAY d_new LOOP need_rank := GREATEST(need_rank, (spec -> 'decors' -> item ->> 'rank')::integer); END LOOP;
  ELSE
    -- 以伺服器時間檢查來客與製作速度：每間店最快約 1.8 秒來一位客人，工作台最快產能照規則推算。
    shops := 1 + coalesce(pg_catalog.array_length(b_new, 1), 0);
    stations := LEAST(4, (lvl ->> 'stations')::integer + CASE WHEN 'tea' = ANY (b_new) THEN 1 ELSE 0 END);
    max_items := LEAST(
      d_served * (lvl ->> 'items')::numeric,
      pg_catalog.ceil(stations * (lvl ->> 'batch')::numeric * elapsed * 1000 / (lvl ->> 'make')::numeric) + p_burst * 3
    );
    IF d_served > pg_catalog.ceil(shops * elapsed / 1.8) + p_burst OR d_items > max_items
       OR d_xp > d_items * (lvl ->> 'xp')::bigint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'implausible');
    END IF;
    v_coins := public.street_cloud_int(p_prev -> 'coins', 0, big) + d_earned + coalesce(p_credit_coins, 0) - spent;
    v_xp := LEAST(big, public.street_cloud_int(p_prev -> 'xp', 0, big) + d_xp + coalesce(p_credit_xp, 0));
    IF v_coins < 0 THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'coins');
    END IF;
    v_coins := LEAST(big, v_coins);
  END IF;

  IF public.street_cloud_rank(v_xp) < need_rank THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', CASE WHEN is_import THEN 'import_inconsistent' ELSE 'rank' END);
  END IF;

  -- 庫存夾在貨架上限內，未解鎖的商品歸零。
  shelf := (lvl ->> 'shelf')::integer + coalesce(pg_catalog.array_length(b_new, 1), 0);
  stock_src := CASE WHEN pg_catalog.jsonb_typeof(p_next -> 'stock') = 'object' THEN p_next -> 'stock' ELSE '{}'::jsonb END;
  FOR prod IN SELECT key, value::text::integer AS unlock FROM pg_catalog.jsonb_each(spec -> 'products') LOOP
    stock := stock || pg_catalog.jsonb_build_object(prod.key,
      CASE WHEN prod.unlock <= lv_new THEN public.street_cloud_int(stock_src -> prod.key, 0, shelf) ELSE 0 END);
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'progress', p_next || pg_catalog.jsonb_build_object(
      'v', 3,
      'shopLevel', lv_new,
      'coins', v_coins,
      'xp', v_xp,
      'buildings', pg_catalog.to_jsonb(b_new),
      'ownedDecors', pg_catalog.to_jsonb(d_new),
      'stats', stats,
      'stock', stock
    ),
    'coins', v_coins,
    'xp', v_xp,
    'shopLevel', lv_new,
    'spent', spent,
    'dServed', d_served,
    'dItems', d_items,
    'dEarned', d_earned,
    'dXp', d_xp,
    'adjusted', adjusted
  );
END;
$$;

CREATE FUNCTION public.street_cloud_row_json(p_row public.member_street_saves)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'revision', p_row.revision,
    'progress', p_row.progress,
    'updatedAt', p_row.updated_at,
    'importSource', p_row.import_source,
    'importAdjusted', p_row.import_adjusted
  )
$$;

REVOKE ALL ON FUNCTION public.street_cloud_spec() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_cloud_int(jsonb, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_cloud_ids(jsonb, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_cloud_rank(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.street_cloud_row_json(public.member_street_saves) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 會員函式
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.get_my_street_save()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.member_street_saves%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF NOT coalesce((SELECT s.enabled FROM public.street_cloud_settings AS s WHERE s.id), false) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;
  SELECT * INTO v_row FROM public.member_street_saves AS m WHERE m.user_id = v_uid;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'exists', false);
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'exists', true) || public.street_cloud_row_json(v_row);
END;
$$;

-- 一次性轉移：只有還沒有雲端存檔時才接受。p_request_key 讓回覆遺失時可以安全重送。
CREATE FUNCTION public.import_my_street_save(p_progress jsonb, p_request_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_set public.street_cloud_settings%ROWTYPE;
  v_row public.member_street_saves%ROWTYPE;
  v_built jsonb;
  v_help_pending text;
  v_steal_pending text;
  v_help_applied text[];
  v_steal_applied text[];
  v_help_keys uuid[];
  v_steal_keys uuid[];
  v_reward_coins bigint;
  v_reward_xp bigint;
  v_credit_coins bigint;
  v_credit_xp bigint;
  v_fresh boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT * INTO v_set FROM public.street_cloud_settings AS s WHERE s.id;
  IF NOT FOUND OR NOT v_set.enabled THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;
  IF p_request_key IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-cloud-save:' || v_uid::text, 0));

  SELECT * INTO v_row FROM public.member_street_saves AS m WHERE m.user_id = v_uid FOR UPDATE;
  IF FOUND THEN
    IF v_row.last_request_key = p_request_key THEN
      RETURN pg_catalog.jsonb_build_object('ok', true, 'replay', true) || public.street_cloud_row_json(v_row);
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'exists') || public.street_cloud_row_json(v_row);
  END IF;

  -- 舊存檔裡「已送出、尚未入帳」的領取鍵，與已入帳的鍵。
  v_help_pending := lower(p_progress ->> 'helpClaimPending');
  v_steal_pending := lower(p_progress ->> 'stealClaimPending');
  v_help_applied := ARRAY(SELECT lower(e) FROM pg_catalog.jsonb_array_elements_text(
    CASE WHEN pg_catalog.jsonb_typeof(p_progress -> 'helpClaimsApplied') = 'array' THEN p_progress -> 'helpClaimsApplied' ELSE '[]'::jsonb END) AS t(e));
  v_steal_applied := ARRAY(SELECT lower(e) FROM pg_catalog.jsonb_array_elements_text(
    CASE WHEN pg_catalog.jsonb_typeof(p_progress -> 'stealClaimsApplied') = 'array' THEN p_progress -> 'stealClaimsApplied' ELSE '[]'::jsonb END) AS t(e));

  -- 先記下這一刻的領取鍵；之後的入帳紀錄只寫這一批，並行的新領取留給下一次存檔。
  WITH claims AS (
    SELECT 'help'::text AS source, c.claim_key, c.coins, c.xp,
      coalesce(c.claim_key::text = v_help_pending AND NOT (c.claim_key::text = ANY (v_help_applied)), false) AS credited
    FROM public.member_street_help_claims AS c WHERE c.user_id = v_uid
    UNION ALL
    SELECT 'steal'::text, c.claim_key, c.coins, c.xp,
      coalesce(c.claim_key::text = v_steal_pending AND NOT (c.claim_key::text = ANY (v_steal_applied)), false)
    FROM public.member_street_steal_claims AS c WHERE c.user_id = v_uid
  )
  SELECT
    coalesce(array_agg(i.claim_key) FILTER (WHERE i.source = 'help'), ARRAY[]::uuid[]),
    coalesce(array_agg(i.claim_key) FILTER (WHERE i.source = 'steal'), ARRAY[]::uuid[]),
    coalesce(sum(i.coins), 0), coalesce(sum(i.xp), 0),
    coalesce(sum(i.coins) FILTER (WHERE i.credited), 0), coalesce(sum(i.xp) FILTER (WHERE i.credited), 0)
  INTO v_help_keys, v_steal_keys, v_reward_coins, v_reward_xp, v_credit_coins, v_credit_xp
  FROM claims AS i;

  v_built := public.street_cloud_build(NULL, p_progress, 0, v_set.save_burst_guests,
    v_credit_coins, v_credit_xp, v_reward_coins, v_reward_xp, v_set.import_earned_cap);
  IF NOT (v_built ->> 'ok')::boolean THEN
    RETURN v_built;
  END IF;

  -- 新店：沒有營業、沒有花費、沒有金幣與經驗。
  v_fresh := (v_built ->> 'coins')::bigint = 0 AND (v_built ->> 'xp')::bigint = 0
    AND (v_built ->> 'dServed')::bigint = 0 AND (v_built ->> 'spent')::bigint = 0;

  INSERT INTO public.member_street_saves (
    user_id, revision, progress, coins, xp, shop_level, import_source, import_adjusted, import_raw, last_request_key
  ) VALUES (
    v_uid, 1, v_built -> 'progress', (v_built ->> 'coins')::bigint, (v_built ->> 'xp')::bigint,
    (v_built ->> 'shopLevel')::smallint, CASE WHEN v_fresh THEN 'fresh' ELSE 'browser' END,
    (v_built ->> 'adjusted')::boolean, p_progress, p_request_key
  )
  RETURNING * INTO v_row;

  INSERT INTO public.member_street_save_credits (user_id, source, claim_key, coins, xp, credited, revision)
  SELECT v_uid, 'help', c.claim_key, c.coins, c.xp,
    coalesce(c.claim_key::text = v_help_pending AND NOT (c.claim_key::text = ANY (v_help_applied)), false), 1
  FROM public.member_street_help_claims AS c WHERE c.user_id = v_uid AND c.claim_key = ANY (v_help_keys)
  UNION ALL
  SELECT v_uid, 'steal', c.claim_key, c.coins, c.xp,
    coalesce(c.claim_key::text = v_steal_pending AND NOT (c.claim_key::text = ANY (v_steal_applied)), false), 1
  FROM public.member_street_steal_claims AS c WHERE c.user_id = v_uid AND c.claim_key = ANY (v_steal_keys);

  INSERT INTO public.member_street_save_log (
    user_id, revision, kind, d_served, d_items, d_earned, d_xp, spent, credit_coins, credit_xp, coins_after, xp_after, shop_level_after
  ) VALUES (
    v_uid, 1, 'import', (v_built ->> 'dServed')::bigint, (v_built ->> 'dItems')::bigint, (v_built ->> 'dEarned')::bigint,
    (v_built ->> 'dXp')::bigint, (v_built ->> 'spent')::bigint, v_credit_coins, v_credit_xp,
    v_row.coins, v_row.xp, v_row.shop_level
  );

  RETURN pg_catalog.jsonb_build_object('ok', true, 'replay', false,
    'credited', pg_catalog.jsonb_build_object('coins', v_credit_coins, 'xp', v_credit_xp)) || public.street_cloud_row_json(v_row);
END;
$$;

-- 一般存檔：必須根據雲端最新 revision；金幣與經驗由資料庫重算，並把尚未入帳的互助／偷貨獎勵一次入帳。
CREATE FUNCTION public.save_my_street(p_base_revision bigint, p_progress jsonb, p_request_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_set public.street_cloud_settings%ROWTYPE;
  v_row public.member_street_saves%ROWTYPE;
  v_built jsonb;
  v_help_keys uuid[];
  v_steal_keys uuid[];
  v_credit_coins bigint;
  v_credit_xp bigint;
  v_elapsed numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT * INTO v_set FROM public.street_cloud_settings AS s WHERE s.id;
  IF NOT FOUND OR NOT v_set.enabled THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;
  IF p_request_key IS NULL OR p_base_revision IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('street-cloud-save:' || v_uid::text, 0));

  SELECT * INTO v_row FROM public.member_street_saves AS m WHERE m.user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'missing');
  END IF;
  IF v_row.last_request_key = p_request_key THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'replay', true,
      'credited', pg_catalog.jsonb_build_object('coins', 0, 'xp', 0)) || public.street_cloud_row_json(v_row);
  END IF;
  IF v_row.revision <> p_base_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'conflict') || public.street_cloud_row_json(v_row);
  END IF;

  -- 第 6、7 批已領取、還沒入帳到雲端存檔的獎勵。先記下鍵，入帳只寫這一批，與並行的新領取互不影響。
  SELECT coalesce(array_agg(c.claim_key), ARRAY[]::uuid[]), coalesce(sum(c.coins), 0), coalesce(sum(c.xp), 0)
  INTO v_help_keys, v_credit_coins, v_credit_xp
  FROM public.member_street_help_claims AS c
  WHERE c.user_id = v_uid
    AND NOT EXISTS (SELECT 1 FROM public.member_street_save_credits AS x WHERE x.user_id = v_uid AND x.source = 'help' AND x.claim_key = c.claim_key);
  SELECT coalesce(array_agg(c.claim_key), ARRAY[]::uuid[]), v_credit_coins + coalesce(sum(c.coins), 0), v_credit_xp + coalesce(sum(c.xp), 0)
  INTO v_steal_keys, v_credit_coins, v_credit_xp
  FROM public.member_street_steal_claims AS c
  WHERE c.user_id = v_uid
    AND NOT EXISTS (SELECT 1 FROM public.member_street_save_credits AS x WHERE x.user_id = v_uid AND x.source = 'steal' AND x.claim_key = c.claim_key);

  v_elapsed := GREATEST(0, EXTRACT(epoch FROM (pg_catalog.now() - v_row.updated_at)));
  v_built := public.street_cloud_build(v_row.progress, p_progress, v_elapsed, v_set.save_burst_guests,
    v_credit_coins, v_credit_xp, 0, 0, 0);
  IF NOT (v_built ->> 'ok')::boolean THEN
    RETURN v_built || public.street_cloud_row_json(v_row);
  END IF;

  UPDATE public.member_street_saves AS m
  SET revision = m.revision + 1,
      progress = v_built -> 'progress',
      coins = (v_built ->> 'coins')::bigint,
      xp = (v_built ->> 'xp')::bigint,
      shop_level = (v_built ->> 'shopLevel')::smallint,
      last_request_key = p_request_key,
      updated_at = pg_catalog.now()
  WHERE m.user_id = v_uid
  RETURNING * INTO v_row;

  INSERT INTO public.member_street_save_credits (user_id, source, claim_key, coins, xp, credited, revision)
  SELECT v_uid, 'help', c.claim_key, c.coins, c.xp, true, v_row.revision
  FROM public.member_street_help_claims AS c WHERE c.user_id = v_uid AND c.claim_key = ANY (v_help_keys)
  UNION ALL
  SELECT v_uid, 'steal', c.claim_key, c.coins, c.xp, true, v_row.revision
  FROM public.member_street_steal_claims AS c WHERE c.user_id = v_uid AND c.claim_key = ANY (v_steal_keys);

  INSERT INTO public.member_street_save_log (
    user_id, revision, kind, d_served, d_items, d_earned, d_xp, spent, credit_coins, credit_xp, coins_after, xp_after, shop_level_after
  ) VALUES (
    v_uid, v_row.revision, 'save', (v_built ->> 'dServed')::bigint, (v_built ->> 'dItems')::bigint, (v_built ->> 'dEarned')::bigint,
    (v_built ->> 'dXp')::bigint, (v_built ->> 'spent')::bigint, v_credit_coins, v_credit_xp,
    v_row.coins, v_row.xp, v_row.shop_level
  );

  RETURN pg_catalog.jsonb_build_object('ok', true, 'replay', false,
    'credited', pg_catalog.jsonb_build_object('coins', v_credit_coins, 'xp', v_credit_xp)) || public.street_cloud_row_json(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_street_save() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_my_street_save(jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_my_street(bigint, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_street_save() TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_my_street_save(jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_street(bigint, jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_my_street_save() IS '讀取自己的夢想商店街雲端存檔。';
COMMENT ON FUNCTION public.import_my_street_save(jsonb, uuid) IS
  '把瀏覽器舊存檔一次性轉移到雲端。每位會員只能一次，只接受內部一致的存檔，多出的金幣會調降。';
COMMENT ON FUNCTION public.save_my_street(bigint, jsonb, uuid) IS
  '依 revision 存檔。金幣與經驗由資料庫重算，互助／偷貨獎勵每把領取鍵只入帳一次；版本不同回 conflict。';

-- ---------------------------------------------------------------------------
-- 自我檢查
-- ---------------------------------------------------------------------------

DO $street_cloud_self_check$
DECLARE
  fn text;
  def text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.get_my_street_save()',
    'public.import_my_street_save(jsonb, uuid)',
    'public.save_my_street(bigint, jsonb, uuid)'
  ] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '訪客不能執行 %', fn;
    END IF;
    IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '已登入會員應可執行 %', fn;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS proc
      WHERE proc.oid = fn::regprocedure
        AND (proc.prosecdef IS NOT TRUE OR NOT ('search_path=pg_catalog' = ANY (COALESCE(proc.proconfig, ARRAY[]::text[]))))
    ) THEN
      RAISE EXCEPTION '% 必須是 SECURITY DEFINER 並固定 search_path = pg_catalog', fn;
    END IF;
    def := pg_catalog.pg_get_functiondef(fn::regprocedure);
    IF position('post_member_reward' IN def) > 0 OR position('member_point' IN def) > 0
       OR position('reward_claims' IN def) > 0 OR position('member_perk' IN def) > 0 THEN
      RAISE EXCEPTION '% 不能碰 Pay 點數或平台獎勵', fn;
    END IF;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'public.street_cloud_spec()',
    'public.street_cloud_int(jsonb, bigint, bigint)',
    'public.street_cloud_ids(jsonb, text[])',
    'public.street_cloud_rank(bigint)',
    'public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint)',
    'public.street_cloud_row_json(public.member_street_saves)'
  ] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '內部函式 % 不能開放給會員', fn;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.member_street_saves', 'SELECT')
     OR has_table_privilege('authenticated', 'public.member_street_saves', 'INSERT')
     OR has_table_privilege('authenticated', 'public.member_street_saves', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.member_street_save_credits', 'INSERT')
     OR has_table_privilege('authenticated', 'public.member_street_save_log', 'SELECT')
     OR has_table_privilege('anon', 'public.member_street_saves', 'SELECT')
     OR has_table_privilege('authenticated', 'public.street_cloud_settings', 'UPDATE') THEN
    RAISE EXCEPTION '雲端存檔資料表不能直接讀寫';
  END IF;
  IF public.street_cloud_rank(0) <> 1 OR public.street_cloud_rank(50) <> 2 OR public.street_cloud_rank(140) <> 3
     OR public.street_cloud_rank(1000000000) <> 30 THEN
    RAISE EXCEPTION '店長等級計算與遊戲規則不一致';
  END IF;
END
$street_cloud_self_check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
