-- 第七階段第 9 批：三款遊戲成就整合（成就 v2）。正式套用前須經站長確認。
-- 前置：20261026160000_stage6_rewards_achievements_preview.sql（成就資料表、同步與展示函式）。
--   注意：第六階段那份檔案也會重建 get_my_points_mall。若點數商城 v2 已套用，必須在第六階段之後重新套用
--   20261030020100_points_mall_v2_apply.sql，否則商城會退回 v1 介面。建議順序：第六階段 → 商城 v2 → 本檔。
-- 影響範圍：
--   1. game_achievement_catalog 新增 16 項：合成 3 項（Lv.6、水果線、圖鑑 20 件）、商店街 9 項、方塊 4 項。原有 11 項不動。
--   2. game_achievement_metric：新增 street.*（讀資料庫重算過的雲端存檔 member_street_saves）與
--      block.*（讀伺服器重算過的排行賽 block_ranked_runs，只算 verified）。合成部分邏輯不變。
--   3. game_achievement_available：資料來源還沒套用時回 false，成就牆顯示「待開放」，同步也不會解鎖。
--   4. game_achievement_state_json：每項多回傳 available。
-- 不讀前端數字、不接受完成宣告；不寫點數帳本、不發 Pay 點、不碰 Inventory。已解鎖的成就不會被刪除或改動。

BEGIN;

DO $achv_v2_precheck$
BEGIN
  IF to_regclass('public.game_achievement_catalog') IS NULL
     OR to_regclass('public.member_game_achievements') IS NULL
     OR to_regclass('public.member_game_showcase') IS NULL
     OR to_regprocedure('public.sync_my_game_achievements()') IS NULL
     OR to_regprocedure('public.game_achievement_metric(uuid, text)') IS NULL
     OR to_regprocedure('public.game_achievement_state_json(uuid, jsonb)') IS NULL THEN
    RAISE EXCEPTION '找不到第六階段成就物件，請先套用 20261026160000_stage6_rewards_achievements_preview.sql';
  END IF;
END
$achv_v2_precheck$;

INSERT INTO public.game_achievement_catalog (id, game_id, metric, target, tier, sort)
VALUES
  ('merge_level_six', 'merge_shop', 'merge.shop_level', 6, 'legend', 120),
  ('merge_fruit_master', 'merge_shop', 'merge.has:fruit-5', 1, 'gold', 130),
  ('merge_codex_twenty', 'merge_shop', 'merge.catalog', 20, 'legend', 140),
  ('street_first_guest', 'dream_street', 'street.served', 1, 'bronze', 210),
  ('street_regulars', 'dream_street', 'street.served', 100, 'silver', 220),
  ('street_famous', 'dream_street', 'street.served', 500, 'gold', 230),
  ('street_level_three', 'dream_street', 'street.shop_level', 3, 'silver', 240),
  ('street_flagship', 'dream_street', 'street.shop_level', 5, 'legend', 250),
  ('street_full_street', 'dream_street', 'street.buildings', 2, 'gold', 260),
  ('street_decorator', 'dream_street', 'street.decors', 4, 'silver', 270),
  ('street_decor_all', 'dream_street', 'street.decors', 8, 'legend', 280),
  ('street_earned_10k', 'dream_street', 'street.earned', 10000, 'gold', 290),
  ('block_ranked_first', 'block_challenge', 'block.ranked_runs', 1, 'bronze', 310),
  ('block_ranked_ten', 'block_challenge', 'block.ranked_runs', 10, 'silver', 320),
  ('block_score_3k', 'block_challenge', 'block.best_score', 3000, 'gold', 330),
  ('block_score_8k', 'block_challenge', 'block.best_score', 8000, 'legend', 340)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.game_achievement_available(p_metric text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_metric LIKE 'merge.%' THEN to_regclass('public.member_merge_shops') IS NOT NULL
    WHEN p_metric LIKE 'street.%' THEN to_regclass('public.member_street_saves') IS NOT NULL
    WHEN p_metric LIKE 'block.%' THEN to_regclass('public.block_ranked_runs') IS NOT NULL
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.game_achievement_metric(p_user uuid, p_metric text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  shop public.member_merge_shops%ROWTYPE;
  street jsonb;
  street_level integer;
  value bigint;
BEGIN
  IF NOT public.game_achievement_available(p_metric) THEN
    RETURN 0;
  END IF;
  IF p_metric LIKE 'merge.%' THEN
    SELECT * INTO shop FROM public.member_merge_shops WHERE user_id = p_user;
    IF NOT FOUND THEN
      RETURN 0;
    END IF;
    IF p_metric = 'merge.lifetime_orders' THEN
      RETURN shop.lifetime_orders;
    ELSIF p_metric = 'merge.shop_level' THEN
      RETURN shop.shop_level;
    ELSIF p_metric = 'merge.catalog' THEN
      RETURN jsonb_array_length(shop.catalog);
    ELSIF p_metric LIKE 'merge.has:%' THEN
      RETURN CASE WHEN shop.catalog @> jsonb_build_array(substr(p_metric, 11)) THEN 1 ELSE 0 END;
    ELSIF p_metric = 'merge.chests' THEN
      RETURN (
        SELECT count(*)::integer
        FROM public.member_merge_shop_events AS events
        WHERE events.user_id = p_user AND events.action_type = 'claim_quest'
      );
    END IF;
  ELSIF p_metric LIKE 'street.%' THEN
    EXECUTE 'SELECT progress, shop_level FROM public.member_street_saves WHERE user_id = $1' INTO street, street_level USING p_user;
    IF street IS NULL THEN
      RETURN 0;
    END IF;
    IF p_metric = 'street.shop_level' THEN
      value := street_level;
    ELSIF p_metric = 'street.buildings' THEN
      value := CASE WHEN jsonb_typeof(street -> 'buildings') = 'array' THEN jsonb_array_length(street -> 'buildings') ELSE 0 END;
    ELSIF p_metric = 'street.decors' THEN
      value := CASE WHEN jsonb_typeof(street -> 'ownedDecors') = 'array' THEN jsonb_array_length(street -> 'ownedDecors') ELSE 0 END;
    ELSIF p_metric IN ('street.served', 'street.earned') THEN
      value := CASE WHEN jsonb_typeof(street #> ARRAY['stats', substr(p_metric, 8)]) = 'number'
        THEN floor((street #>> ARRAY['stats', substr(p_metric, 8)])::numeric)::bigint ELSE 0 END;
    END IF;
    RETURN LEAST(coalesce(value, 0), 1000000000)::integer;
  ELSIF p_metric LIKE 'block.%' THEN
    IF p_metric = 'block.ranked_runs' THEN
      EXECUTE 'SELECT count(*) FROM public.block_ranked_runs WHERE user_id = $1 AND status = ''verified''' INTO value USING p_user;
    ELSIF p_metric = 'block.best_score' THEN
      EXECUTE 'SELECT coalesce(max(score), 0) FROM public.block_ranked_runs WHERE user_id = $1 AND status = ''verified''' INTO value USING p_user;
    END IF;
    RETURN LEAST(coalesce(value, 0), 1000000000)::integer;
  END IF;
  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.game_achievement_state_json(p_user uuid, p_new jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  items jsonb;
  badge text;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', catalog.id,
    'gameId', catalog.game_id,
    'tier', catalog.tier,
    'target', catalog.target,
    'progress', LEAST(public.game_achievement_metric(p_user, catalog.metric), catalog.target),
    'unlocked', owned.achievement_id IS NOT NULL,
    'unlockedAt', owned.unlocked_at,
    'available', owned.achievement_id IS NOT NULL OR public.game_achievement_available(catalog.metric)
  ) ORDER BY catalog.sort, catalog.id), '[]'::jsonb)
  INTO items
  FROM public.game_achievement_catalog AS catalog
  LEFT JOIN public.member_game_achievements AS owned
    ON owned.user_id = p_user AND owned.achievement_id = catalog.id
  WHERE catalog.active;

  SELECT showcase.achievement_id INTO badge FROM public.member_game_showcase AS showcase WHERE showcase.user_id = p_user;

  RETURN jsonb_build_object(
    'achievements', items,
    'showcase', badge,
    'newlyUnlocked', coalesce(p_new, '[]'::jsonb),
    'catalogVersion', 2
  );
END;
$$;

REVOKE ALL ON FUNCTION public.game_achievement_available(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_achievement_metric(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_achievement_state_json(uuid, jsonb) FROM PUBLIC, anon, authenticated;

DO $achv_v2_self_check$
DECLARE
  def text := pg_get_functiondef('public.game_achievement_metric(uuid, text)'::regprocedure);
BEGIN
  IF (SELECT count(*) FROM public.game_achievement_catalog WHERE active) < 27 THEN
    RAISE EXCEPTION '成就目錄數量不足';
  END IF;
  IF (SELECT count(DISTINCT game_id) FROM public.game_achievement_catalog WHERE active) <> 3 THEN
    RAISE EXCEPTION '三款遊戲都要有成就';
  END IF;
  IF position('member_point' IN def) > 0 OR position('post_member_reward' IN def) > 0 OR position('p_payload' IN def) > 0 THEN
    RAISE EXCEPTION '成就只能讀伺服器遊戲進度';
  END IF;
  IF public.game_achievement_metric('00000000-0000-4000-8000-0000000000ff', 'street.served') <> 0
     OR public.game_achievement_metric('00000000-0000-4000-8000-0000000000ff', 'block.best_score') <> 0
     OR public.game_achievement_metric('00000000-0000-4000-8000-0000000000ff', 'nope.x') <> 0 THEN
    RAISE EXCEPTION '沒有進度的會員成就值要是 0';
  END IF;
END
$achv_v2_self_check$;

COMMIT;
