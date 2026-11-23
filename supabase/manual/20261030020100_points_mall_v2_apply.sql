-- =============================================================================
-- 第七階段第 9 批：Pay 點數商城 v2（40 件虛擬商品）
-- 請先執行 20261030020000_points_mall_v2_readonly_check.sql，確認「可以套用」後，在 SQL Editor 一次執行整份。
--
-- 這份會做的事（單一交易，任何一步失敗整份回復）：
--   1. 商品分類由 4 種擴充為 12 種（聊天氣泡、寵物、商店街裝潢、方塊棋盤、遊戲場景、個人頁特效、節慶收藏、動態貼圖）。
--   2. 目錄新增欄位：解鎖條件、販售方式、數量上限、排序。原有 15 件的編號、分類與點數完全不變。
--   3. 新增 25 件商品（價格為建議價，須站長先確認價格表）。新增節慶販售期間表（2026–2035，依既有節慶規則換算）。
--   4. 裝備列新增 7 個欄位；購買、裝備、收藏讀取、公開裝備與商城總覽函式改為支援新分類。
--   5. 兌換交易內新增三項檢查：解鎖條件、販售期間、數量上限。扣點、帳本與入庫仍在同一個交易。
--
-- 這份不會做的事：
--   - 不打開 purchase_enabled（開放兌換是另一份 20261030020200_points_mall_open_purchase.sql）。
--   - 不刪除、不修改任何既有收藏、裝備、點數帳戶、帳本或優惠券。
--   - 不改 post_member_reward、post_perk_unlock_debit、簽到、刮刮卡、賣家點數券或 checkout_enabled。
-- =============================================================================

BEGIN;

DO $require_mall_v2$
BEGIN
  IF to_regclass('public.member_perk_catalog') IS NULL
     OR to_regclass('public.member_perk_holds') IS NULL
     OR to_regclass('public.member_perk_loadout') IS NULL
     OR to_regclass('public.member_perk_settings') IS NULL
     OR to_regprocedure('public.purchase_my_perk(text)') IS NULL
     OR to_regprocedure('public.post_perk_unlock_debit(uuid, text, jsonb)') IS NULL
     OR to_regprocedure('public.get_my_points_mall()') IS NULL
     OR to_regprocedure('public.taipei_today(timestamptz)') IS NULL THEN
    RAISE EXCEPTION '需要先套用第五批虛擬特權與點數商城總覽';
  END IF;
  IF to_regclass('public.member_perk_sale_windows') IS NOT NULL THEN
    RAISE EXCEPTION '點數商城 v2 已經套用過，本檔不重複執行';
  END IF;
  IF (SELECT count(*) FROM public.member_perk_catalog) IS DISTINCT FROM 15
     OR (SELECT coalesce(sum(cost), 0) FROM public.member_perk_catalog) IS DISTINCT FROM 2180 THEN
    RAISE EXCEPTION '目前目錄不是原本的 15 件，停止';
  END IF;
END
$require_mall_v2$;

-- ---------------------------------------------------------------------------
-- 1. 分類與目錄欄位
-- ---------------------------------------------------------------------------

ALTER TABLE public.member_perk_catalog DROP CONSTRAINT member_perk_catalog_category_check;
ALTER TABLE public.member_perk_catalog ADD CONSTRAINT member_perk_catalog_category_check
  CHECK (category IN ('frame', 'badge', 'title', 'skin', 'bubble', 'pet', 'decor', 'board', 'scene', 'effect', 'collection', 'sticker'));

ALTER TABLE public.member_perk_holds DROP CONSTRAINT member_perk_holds_category_check;
ALTER TABLE public.member_perk_holds ADD CONSTRAINT member_perk_holds_category_check
  CHECK (category IN ('frame', 'badge', 'title', 'skin', 'bubble', 'pet', 'decor', 'board', 'scene', 'effect', 'collection', 'sticker'));

ALTER TABLE public.member_perk_catalog
  ADD COLUMN unlock_metric text,
  ADD COLUMN unlock_target integer,
  ADD COLUMN sale_kind text NOT NULL DEFAULT 'always',
  ADD COLUMN stock_limit integer,
  ADD COLUMN sort integer NOT NULL DEFAULT 0;

ALTER TABLE public.member_perk_catalog
  ADD CONSTRAINT member_perk_catalog_unlock_check CHECK (
    (unlock_metric IS NULL AND unlock_target IS NULL)
    OR (unlock_metric IN ('merge.shop_level', 'street.rank', 'street.shop_level') AND unlock_target BETWEEN 1 AND 1000)
  ),
  ADD CONSTRAINT member_perk_catalog_sale_check CHECK (sale_kind IN ('always', 'festival')),
  ADD CONSTRAINT member_perk_catalog_stock_check CHECK (stock_limit IS NULL OR stock_limit BETWEEN 1 AND 100000);

COMMENT ON COLUMN public.member_perk_catalog.unlock_metric IS '解鎖條件來源。兌換交易內由 perk_unlock_progress 依伺服器資料重算，不接受瀏覽器回報。';
COMMENT ON COLUMN public.member_perk_catalog.sale_kind IS 'always 常態販售；festival 只在 member_perk_sale_windows 的期間內可兌換，已取得的收藏永久保留。';
COMMENT ON COLUMN public.member_perk_catalog.stock_limit IS '全站數量上限；NULL 為不限量。已售數量直接計算 member_perk_holds，不另存計數。';

CREATE TABLE public.member_perk_sale_windows (
  perk_id text NOT NULL REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  PRIMARY KEY (perk_id, starts_on),
  CONSTRAINT member_perk_sale_windows_range CHECK (ends_on > starts_on AND ends_on - starts_on <= 60)
);

COMMENT ON TABLE public.member_perk_sale_windows IS
  '節慶限定商品的販售期間（台北日期，含開始日、不含結束日）。由既有節慶規則換算 2026–2035 年，之後年份可再補列。會員不能修改。';

CREATE OR REPLACE FUNCTION public.guard_member_perk_sale_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF current_setting('app.perk_catalog', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '販售期間不可直接修改';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER member_perk_sale_windows_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_perk_sale_windows
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_member_perk_sale_window();

ALTER TABLE public.member_perk_loadout
  ADD COLUMN bubble_id text REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT,
  ADD COLUMN pet_id text REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT,
  ADD COLUMN decor_id text REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT,
  ADD COLUMN board_id text REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT,
  ADD COLUMN scene_id text REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT,
  ADD COLUMN effect_id text REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT,
  ADD COLUMN collection_id text REFERENCES public.member_perk_catalog (id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- 2. 新增 25 件商品與販售期間（價格為建議價，套用前須站長確認）
-- ---------------------------------------------------------------------------

DO $seed_mall_v2$
BEGIN
  PERFORM set_config('app.perk_catalog', 'on', true);

  UPDATE public.member_perk_catalog AS c
  SET sort = v.sort
  FROM (VALUES
    ('frame-founder', 10), ('frame-blackdiamond', 20), ('frame-koi', 30), ('frame-cyber', 40), ('frame-flame', 50),
    ('badge-honest', 60), ('badge-detail', 70), ('badge-fivestar', 80), ('badge-referee', 90),
    ('title-saver', 100), ('title-flash', 110), ('title-cart', 120), ('title-hunter', 130),
    ('skin-cyber', 140), ('skin-ink', 150)
  ) AS v(id, sort)
  WHERE c.id = v.id;

  INSERT INTO public.member_perk_catalog (id, category, cost, unlock_metric, unlock_target, sale_kind, stock_limit, sort)
  VALUES
    ('bubble-milktea', 'bubble', 80, NULL, NULL, 'always', NULL, 160),
    ('bubble-memo', 'bubble', 100, NULL, NULL, 'always', NULL, 170),
    ('bubble-neon', 'bubble', 150, NULL, NULL, 'always', NULL, 180),
    ('frame-sakura', 'frame', 160, NULL, NULL, 'always', NULL, 190),
    ('title-merge-boss', 'title', 180, 'merge.shop_level', 5, 'always', NULL, 200),
    ('title-street-star', 'title', 220, 'street.rank', 10, 'always', NULL, 210),
    ('pet-cat', 'pet', 120, NULL, NULL, 'always', NULL, 220),
    ('pet-shiba', 'pet', 120, NULL, NULL, 'always', NULL, 230),
    ('pet-penguin', 'pet', 200, NULL, NULL, 'always', NULL, 240),
    ('decor-balloon', 'decor', 120, 'street.shop_level', 2, 'always', NULL, 250),
    ('decor-neon', 'decor', 180, 'street.shop_level', 3, 'always', NULL, 260),
    ('decor-fountain', 'decor', 260, 'street.shop_level', 4, 'always', NULL, 270),
    ('board-wood', 'board', 90, NULL, NULL, 'always', NULL, 280),
    ('board-arcade', 'board', 140, NULL, NULL, 'always', NULL, 290),
    ('board-jade', 'board', 220, NULL, NULL, 'always', NULL, 300),
    ('scene-sakura', 'scene', 100, NULL, NULL, 'always', NULL, 310),
    ('scene-harbor', 'scene', 120, NULL, NULL, 'always', NULL, 320),
    ('scene-night', 'scene', 180, NULL, NULL, 'always', NULL, 330),
    ('effect-snow', 'effect', 100, NULL, NULL, 'always', NULL, 340),
    ('effect-hearts', 'effect', 120, NULL, NULL, 'always', NULL, 350),
    ('effect-coins', 'effect', 200, NULL, NULL, 'always', NULL, 360),
    ('collect-newyear', 'collection', 168, NULL, NULL, 'festival', 500, 370),
    ('collect-moon', 'collection', 168, NULL, NULL, 'festival', 500, 380),
    ('collect-snowman', 'collection', 168, NULL, NULL, 'festival', 500, 390),
    ('sticker-party', 'sticker', 150, NULL, NULL, 'always', NULL, 400);

  INSERT INTO public.member_perk_sale_windows (perk_id, starts_on, ends_on)
  VALUES
    ('collect-newyear', '2026-02-16', '2026-03-04'), ('collect-newyear', '2027-02-05', '2027-02-21'),
    ('collect-newyear', '2028-01-25', '2028-02-10'), ('collect-newyear', '2029-02-12', '2029-02-28'),
    ('collect-newyear', '2030-02-02', '2030-02-18'), ('collect-newyear', '2031-01-22', '2031-02-07'),
    ('collect-newyear', '2032-02-10', '2032-02-26'), ('collect-newyear', '2033-01-30', '2033-02-15'),
    ('collect-newyear', '2034-02-18', '2034-03-06'), ('collect-newyear', '2035-02-07', '2035-02-23'),
    ('collect-moon', '2026-09-24', '2026-09-26'), ('collect-moon', '2027-09-14', '2027-09-16'),
    ('collect-moon', '2028-10-02', '2028-10-04'), ('collect-moon', '2029-09-21', '2029-09-23'),
    ('collect-moon', '2030-09-11', '2030-09-13'), ('collect-moon', '2031-09-30', '2031-10-02'),
    ('collect-moon', '2032-09-18', '2032-09-20'), ('collect-moon', '2033-09-07', '2033-09-09'),
    ('collect-moon', '2034-09-26', '2034-09-28'), ('collect-moon', '2035-09-15', '2035-09-17'),
    ('collect-snowman', '2026-12-20', '2026-12-26'), ('collect-snowman', '2027-12-20', '2027-12-26'),
    ('collect-snowman', '2028-12-20', '2028-12-26'), ('collect-snowman', '2029-12-20', '2029-12-26'),
    ('collect-snowman', '2030-12-20', '2030-12-26'), ('collect-snowman', '2031-12-20', '2031-12-26'),
    ('collect-snowman', '2032-12-20', '2032-12-26'), ('collect-snowman', '2033-12-20', '2033-12-26'),
    ('collect-snowman', '2034-12-20', '2034-12-26'), ('collect-snowman', '2035-12-20', '2035-12-26');

  PERFORM set_config('app.perk_catalog', 'off', true);
END
$seed_mall_v2$;

-- ---------------------------------------------------------------------------
-- 3. 解鎖、販售期間與數量的伺服器判斷
-- ---------------------------------------------------------------------------

-- 解鎖進度只讀伺服器存檔：合成小舖讀 member_merge_shops，商店街讀雲端存檔 member_street_saves。
-- 某款遊戲的資料表還不存在時回傳 0，畫面會顯示真實的解鎖條件。
CREATE OR REPLACE FUNCTION public.perk_unlock_progress(p_user uuid, p_metric text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v integer;
BEGIN
  IF p_metric = 'merge.shop_level' THEN
    IF to_regclass('public.member_merge_shops') IS NULL THEN RETURN 0; END IF;
    EXECUTE 'SELECT shop_level FROM public.member_merge_shops WHERE user_id = $1' INTO v USING p_user;
  ELSIF p_metric = 'street.shop_level' THEN
    IF to_regclass('public.member_street_saves') IS NULL THEN RETURN 0; END IF;
    EXECUTE 'SELECT shop_level::integer FROM public.member_street_saves WHERE user_id = $1' INTO v USING p_user;
  ELSIF p_metric = 'street.rank' THEN
    IF to_regclass('public.member_street_saves') IS NULL OR to_regprocedure('public.street_cloud_rank(bigint)') IS NULL THEN RETURN 0; END IF;
    EXECUTE 'SELECT public.street_cloud_rank(xp) FROM public.member_street_saves WHERE user_id = $1' INTO v USING p_user;
  ELSE
    RETURN 0;
  END IF;
  RETURN coalesce(v, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.perk_sale_open(p_perk text, p_day date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN c.sale_kind = 'always' THEN true
    ELSE EXISTS (SELECT 1 FROM public.member_perk_sale_windows AS w WHERE w.perk_id = c.id AND w.starts_on <= p_day AND w.ends_on > p_day)
  END
  FROM public.member_perk_catalog AS c
  WHERE c.id = p_perk;
$$;

-- 每件商品對這位會員的狀態。先後順序：已擁有 > 兌換關閉 > 販售期間 > 售完 > 未解鎖 > 點數不足 > 可兌換。
CREATE OR REPLACE FUNCTION public.perk_mall_items_json(p_user uuid, p_balance integer, p_open boolean, p_day date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  out_items jsonb := '[]'::jsonb;
  c public.member_perk_catalog%ROWTYPE;
  v_owned boolean;
  v_progress integer;
  v_sold integer;
  v_open boolean;
  v_next date;
  v_until date;
  v_state text;
BEGIN
  FOR c IN SELECT * FROM public.member_perk_catalog WHERE active ORDER BY sort, id LOOP
    v_owned := EXISTS (SELECT 1 FROM public.member_perk_holds AS h WHERE h.user_id = p_user AND h.perk_id = c.id);
    v_progress := CASE WHEN c.unlock_metric IS NULL THEN NULL ELSE public.perk_unlock_progress(p_user, c.unlock_metric) END;
    v_sold := CASE WHEN c.stock_limit IS NULL THEN NULL ELSE (SELECT count(*)::integer FROM public.member_perk_holds AS h WHERE h.perk_id = c.id) END;
    v_open := public.perk_sale_open(c.id, p_day);
    v_next := NULL;
    v_until := NULL;
    IF c.sale_kind = 'festival' THEN
      SELECT min(w.starts_on) INTO v_next FROM public.member_perk_sale_windows AS w WHERE w.perk_id = c.id AND w.starts_on > p_day;
      SELECT max(w.ends_on) INTO v_until FROM public.member_perk_sale_windows AS w WHERE w.perk_id = c.id AND w.starts_on <= p_day;
    END IF;
    v_state := CASE
      WHEN v_owned THEN 'owned'
      WHEN NOT p_open THEN 'closed'
      WHEN NOT v_open AND v_next IS NOT NULL THEN 'not_started'
      WHEN NOT v_open THEN 'ended'
      WHEN c.stock_limit IS NOT NULL AND v_sold >= c.stock_limit THEN 'sold_out'
      WHEN c.unlock_metric IS NOT NULL AND v_progress < c.unlock_target THEN 'locked'
      WHEN p_balance < c.cost THEN 'short'
      ELSE 'available'
    END;
    out_items := out_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id', c.id,
      'category', c.category,
      'cost', c.cost,
      'state', v_state,
      'unlockMetric', c.unlock_metric,
      'unlockTarget', c.unlock_target,
      'unlockProgress', v_progress,
      'saleKind', c.sale_kind,
      'saleOpen', v_open,
      'opensOn', v_next,
      'closesOn', CASE WHEN v_open THEN v_until END,
      'stockLimit', c.stock_limit,
      'stockLeft', CASE WHEN c.stock_limit IS NULL THEN NULL ELSE GREATEST(c.stock_limit - v_sold, 0) END
    )));
  END LOOP;
  RETURN out_items;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. 收藏讀取、購買與裝備
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.perk_state_json(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  bal integer := 0;
  owned jsonb;
  equipped jsonb;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION '找不到會員';
  END IF;

  SELECT balance INTO bal FROM public.member_point_accounts WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    bal := 0;
  END IF;

  SELECT coalesce(pg_catalog.jsonb_agg(hold.perk_id ORDER BY hold.created_at, hold.perk_id), '[]'::jsonb)
  INTO owned
  FROM public.member_perk_holds AS hold
  WHERE hold.user_id = p_user_id;

  SELECT pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'frame', loadout.frame_id,
    'badge', loadout.badge_id,
    'title', loadout.title_id,
    'skin', loadout.skin_id,
    'bubble', loadout.bubble_id,
    'pet', loadout.pet_id,
    'decor', loadout.decor_id,
    'board', loadout.board_id,
    'scene', loadout.scene_id,
    'effect', loadout.effect_id,
    'collection', loadout.collection_id
  ))
  INTO equipped
  FROM public.member_perk_loadout AS loadout
  WHERE loadout.user_id = p_user_id;

  RETURN pg_catalog.jsonb_build_object(
    'balance', bal,
    'owned', owned,
    'equipped', coalesce(equipped, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_member_perk_loadout()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '裝備狀態不可刪除';
  END IF;
  IF current_setting('app.perk_equip', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '會員不能直接修改裝備狀態';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION '不能變更裝備狀態的會員';
  END IF;
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'frame', NEW.frame_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'badge', NEW.badge_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'title', NEW.title_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'skin', NEW.skin_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'bubble', NEW.bubble_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'pet', NEW.pet_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'decor', NEW.decor_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'board', NEW.board_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'scene', NEW.scene_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'effect', NEW.effect_id);
  PERFORM public.assert_owned_perk_slot(NEW.user_id, 'collection', NEW.collection_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_my_perk(p_perk_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  catalog public.member_perk_catalog%ROWTYPE;
  account public.member_point_accounts%ROWTYPE;
  hold public.member_perk_holds%ROWTYPE;
  posted jsonb;
  paid integer;
  metadata jsonb;
  v_claim_key text;
  purchases_open boolean;
  day date := public.taipei_today();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT settings.purchase_enabled
  INTO purchases_open
  FROM public.member_perk_settings AS settings
  WHERE settings.id = true;
  IF purchases_open IS DISTINCT FROM true THEN
    RAISE EXCEPTION '虛擬特權購買尚未開放';
  END IF;
  IF p_perk_id IS NULL OR p_perk_id !~ '^[a-z0-9-]{1,40}$' THEN
    RAISE EXCEPTION '這個虛擬特權無法購買';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('perk-user:' || uid::text, 0));

  SELECT *
  INTO catalog
  FROM public.member_perk_catalog
  WHERE id = p_perk_id
    AND active
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '這個虛擬特權無法購買';
  END IF;

  v_claim_key := 'perk_unlock:' || catalog.id;

  INSERT INTO public.member_point_accounts (user_id)
  VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT *
  INTO account
  FROM public.member_point_accounts
  WHERE user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '無法鎖定點數帳戶';
  END IF;

  SELECT *
  INTO hold
  FROM public.member_perk_holds
  WHERE user_id = uid
    AND perk_id = catalog.id;

  IF FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.reward_claims AS claim
      WHERE claim.user_id = uid
        AND claim.claim_key = v_claim_key
        AND claim.kind = 'perk_unlock'
        AND claim.delta = -hold.cost
        AND claim.point_entry_id = hold.point_entry_id
    ) THEN
      RETURN public.perk_state_json(uid) || pg_catalog.jsonb_build_object('replayed', true);
    END IF;
    RAISE EXCEPTION '虛擬特權購買沒有完成，點數與收藏都沒有變更';
  END IF;

  IF NOT public.perk_sale_open(catalog.id, day) THEN
    RAISE EXCEPTION '這件收藏不在販售期間';
  END IF;
  IF catalog.unlock_metric IS NOT NULL
     AND public.perk_unlock_progress(uid, catalog.unlock_metric) < catalog.unlock_target THEN
    RAISE EXCEPTION '尚未達成解鎖條件';
  END IF;
  IF catalog.stock_limit IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('perk-stock:' || catalog.id, 0));
    IF (SELECT count(*) FROM public.member_perk_holds AS h WHERE h.perk_id = catalog.id) >= catalog.stock_limit THEN
      RAISE EXCEPTION '這件收藏已經兌換完畢';
    END IF;
  END IF;

  IF account.balance < catalog.cost THEN
    RAISE EXCEPTION '點數不足';
  END IF;

  metadata := pg_catalog.jsonb_build_object(
    'perkId', catalog.id,
    'category', catalog.category,
    'cost', catalog.cost
  );

  PERFORM set_config('app.perk_purchase', 'on', true);
  PERFORM set_config('app.reward_post', 'on', true);
  posted := public.post_perk_unlock_debit(uid, catalog.id, metadata);
  PERFORM set_config('app.perk_purchase', 'off', true);
  PERFORM set_config('app.reward_post', 'off', true);

  paid := -1 * (posted->>'delta')::integer;
  IF (posted->>'replayed')::boolean IS DISTINCT FROM false OR paid IS DISTINCT FROM catalog.cost THEN
    RAISE EXCEPTION '虛擬特權購買沒有完成，點數與收藏都沒有變更';
  END IF;

  PERFORM set_config('app.perk_hold', 'on', true);
  INSERT INTO public.member_perk_holds (
    user_id, perk_id, category, cost, claim_key, point_entry_id
  )
  VALUES (
    uid, catalog.id, catalog.category, paid, v_claim_key, (posted->>'pointEntryId')::uuid
  );
  PERFORM set_config('app.perk_hold', 'off', true);

  RETURN public.perk_state_json(uid) || pg_catalog.jsonb_build_object('replayed', false);
END;
$$;

COMMENT ON FUNCTION public.purchase_my_perk(text) IS
  '登入會員用目錄定價兌換一件永久虛擬商品。購買開關關閉時拒絕；販售期間、解鎖條件與數量上限都在交易內重算。扣點、帳本與入庫同一個交易，重複請求不重複扣點。';

CREATE OR REPLACE FUNCTION public.set_my_perk_equipped(p_perk_id text, p_equipped boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  catalog public.member_perk_catalog%ROWTYPE;
  hold public.member_perk_holds%ROWTYPE;
  current_slot text;
  col text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_equipped IS NULL OR p_perk_id IS NULL OR p_perk_id !~ '^[a-z0-9-]{1,40}$' THEN
    RAISE EXCEPTION '這個虛擬特權無法裝備';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('perk-user:' || uid::text, 0));

  SELECT * INTO catalog FROM public.member_perk_catalog WHERE id = p_perk_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '這個虛擬特權無法裝備';
  END IF;

  SELECT * INTO hold FROM public.member_perk_holds WHERE user_id = uid AND perk_id = catalog.id;
  IF NOT FOUND OR hold.category IS DISTINCT FROM catalog.category THEN
    RAISE EXCEPTION '尚未擁有這個虛擬特權';
  END IF;

  IF catalog.category NOT IN ('frame', 'badge', 'title', 'skin', 'bubble', 'pet', 'decor', 'board', 'scene', 'effect', 'collection') THEN
    RAISE EXCEPTION '這件收藏擁有就能使用，不需要裝備';
  END IF;
  col := catalog.category || '_id';

  PERFORM set_config('app.perk_equip', 'on', true);
  INSERT INTO public.member_perk_loadout (user_id) VALUES (uid) ON CONFLICT (user_id) DO NOTHING;
  EXECUTE format('SELECT %I FROM public.member_perk_loadout WHERE user_id = $1 FOR UPDATE', col) INTO current_slot USING uid;

  IF (p_equipped AND current_slot IS NOT DISTINCT FROM catalog.id)
     OR (NOT p_equipped AND current_slot IS DISTINCT FROM catalog.id) THEN
    PERFORM set_config('app.perk_equip', 'off', true);
    RETURN public.perk_state_json(uid) || pg_catalog.jsonb_build_object('replayed', true);
  END IF;

  EXECUTE format('UPDATE public.member_perk_loadout SET %I = $1, updated_at = pg_catalog.now() WHERE user_id = $2', col)
    USING CASE WHEN p_equipped THEN catalog.id ELSE NULL END, uid;

  PERFORM set_config('app.perk_equip', 'off', true);
  RETURN public.perk_state_json(uid) || pg_catalog.jsonb_build_object('replayed', false);
END;
$$;

COMMENT ON FUNCTION public.set_my_perk_equipped(text, boolean) IS
  '登入會員裝備或卸下自己已擁有的虛擬商品。每個欄位只留一件；動態貼圖擁有即可使用，不佔欄位。不扣點。';

CREATE OR REPLACE FUNCTION public.public_equipped_perks(p_user_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(pg_catalog.jsonb_agg(rows.item), '[]'::jsonb)
  FROM (
    SELECT pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'userId', ids.id,
      'frame', loadout.frame_id,
      'badge', loadout.badge_id,
      'title', loadout.title_id,
      'skin', loadout.skin_id,
      'bubble', loadout.bubble_id,
      'pet', loadout.pet_id,
      'decor', loadout.decor_id,
      'board', loadout.board_id,
      'scene', loadout.scene_id,
      'effect', loadout.effect_id,
      'collection', loadout.collection_id,
      'stickers', (
        SELECT pg_catalog.jsonb_agg(h.perk_id ORDER BY h.perk_id)
        FROM public.member_perk_holds AS h
        WHERE h.user_id = ids.id AND h.category = 'sticker'
      )
    )) AS item
    FROM unnest((coalesce(p_user_ids, ARRAY[]::uuid[]))[1:40]) AS ids(id)
    LEFT JOIN public.member_perk_loadout AS loadout ON loadout.user_id = ids.id
    WHERE ids.id IS NOT NULL
  ) AS rows;
$$;

COMMENT ON FUNCTION public.public_equipped_perks(uuid[]) IS
  '公開讀取最多 40 位會員正在裝備的外觀與擁有的貼圖包。不包含未裝備收藏的清單，也不能修改。';

CREATE OR REPLACE FUNCTION public.get_my_points_mall()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  day date := public.taipei_today();
  bal integer := 0;
  perk_open boolean := false;
  coupons jsonb;
  held integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT balance INTO bal FROM public.member_point_accounts WHERE user_id = uid;
  bal := coalesce(bal, 0);
  SELECT settings.purchase_enabled INTO perk_open FROM public.member_perk_settings AS settings WHERE settings.id = true;
  SELECT coalesce(jsonb_agg(item.data ORDER BY item.created_at DESC), '[]'::jsonb)
  INTO coupons
  FROM (
    SELECT
      public.seller_coupon_json(coupon) || jsonb_build_object(
        'sellerName', public.coupon_seller_name(coupon.seller_id),
        'held', EXISTS (
          SELECT 1 FROM public.member_coupon_holds AS hold
          WHERE hold.user_id = uid AND hold.coupon_id = coupon.id
        )
      ) AS data,
      coupon.created_at
    FROM public.seller_coupons AS coupon
    WHERE coupon.game_pool
      AND coupon.active
      AND coupon.deleted_at IS NULL
      AND coupon.start_on <= day
      AND coupon.end_on >= day
      AND coupon.issued_count < coupon.qty
    ORDER BY coupon.created_at DESC
    LIMIT 60
  ) AS item;
  SELECT count(*)::integer INTO held
  FROM public.member_coupon_holds AS hold
  WHERE hold.user_id = uid AND hold.source = 'points';
  RETURN jsonb_build_object(
    'balance', bal,
    'perkPurchaseEnabled', coalesce(perk_open, false),
    'couponExchangeCost', 100,
    'coupons', coupons,
    'pointsCouponCount', held,
    'benefitsOpen', false,
    'taipeiDay', day,
    'catalogVersion', 2,
    'perks', public.perk_mall_items_json(uid, bal, coalesce(perk_open, false), day)
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_points_mall() IS
  '點數商城唯讀總覽。回傳每件虛擬商品對這位會員的真實狀態（已擁有、未開放、未開始、已結束、售完、未解鎖、點數不足、可兌換）。不扣點。';

-- ---------------------------------------------------------------------------
-- 5. 權限
-- ---------------------------------------------------------------------------

ALTER TABLE public.member_perk_sale_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_perk_sale_windows FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.guard_member_perk_sale_window() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.perk_unlock_progress(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.perk_sale_open(text, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.perk_mall_items_json(uuid, integer, boolean, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.perk_state_json(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_member_perk_loadout() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.purchase_my_perk(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_my_perk_equipped(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_equipped_perks(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_points_mall() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_my_perk(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_perk_equipped(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_equipped_perks(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_points_mall() TO authenticated;

DO $revoke_mall_v2_service$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.get_my_points_mall() FROM service_role;
  END IF;
END
$revoke_mall_v2_service$;

-- ---------------------------------------------------------------------------
-- 6. 自我檢查
-- ---------------------------------------------------------------------------

DO $mall_v2_check$
DECLARE
  purchase_def text := pg_get_functiondef('public.purchase_my_perk(text)'::regprocedure);
  equip_def text := pg_get_functiondef('public.set_my_perk_equipped(text, boolean)'::regprocedure);
  mall_def text := pg_get_functiondef('public.get_my_points_mall()'::regprocedure);
  items_def text := pg_get_functiondef('public.perk_mall_items_json(uuid, integer, boolean, date)'::regprocedure);
  fn text;
BEGIN
  IF (SELECT count(*) FROM public.member_perk_catalog) IS DISTINCT FROM 40 THEN
    RAISE EXCEPTION '商城目錄必須是 40 件';
  END IF;
  IF (SELECT coalesce(sum(cost), 0) FROM public.member_perk_catalog WHERE id IN (
       'frame-founder', 'frame-blackdiamond', 'frame-koi', 'frame-cyber', 'frame-flame',
       'badge-honest', 'badge-detail', 'badge-fivestar', 'badge-referee',
       'title-saver', 'title-flash', 'title-cart', 'title-hunter', 'skin-cyber', 'skin-ink'))
     IS DISTINCT FROM 2180 THEN
    RAISE EXCEPTION '原有 15 件的點數不能變動';
  END IF;
  IF (SELECT count(*) FROM public.member_perk_sale_windows) IS DISTINCT FROM 30
     OR EXISTS (SELECT 1 FROM public.member_perk_catalog AS c WHERE c.sale_kind = 'festival'
                AND NOT EXISTS (SELECT 1 FROM public.member_perk_sale_windows AS w WHERE w.perk_id = c.id)) THEN
    RAISE EXCEPTION '節慶商品必須有販售期間';
  END IF;
  IF position('member_perk_settings' IN purchase_def) = 0
     OR position('虛擬特權購買尚未開放' IN purchase_def) = 0
     OR position('perk_sale_open' IN purchase_def) = 0
     OR position('perk_unlock_progress' IN purchase_def) = 0
     OR position('stock_limit' IN purchase_def) = 0
     OR position('post_perk_unlock_debit' IN purchase_def) = 0
     OR position('post_member_reward' IN purchase_def) > 0 THEN
    RAISE EXCEPTION '兌換入口必須讀開關、販售期間、解鎖與數量，並走虛擬特權扣點';
  END IF;
  IF purchase_def ~ E'(^|\n)[ \t]*EXCEPTION([ \t\r\n]|$)' OR equip_def ~ E'(^|\n)[ \t]*EXCEPTION([ \t\r\n]|$)' THEN
    RAISE EXCEPTION '購買與裝備函式不能吞掉錯誤';
  END IF;
  IF position('member_perk_settings' IN equip_def) > 0 THEN
    RAISE EXCEPTION '裝備不能被購買開關擋住';
  END IF;
  IF position('INSERT' IN mall_def) > 0 OR position('UPDATE' IN mall_def) > 0 OR position('DELETE' IN mall_def) > 0
     OR position('INSERT' IN items_def) > 0 OR position('UPDATE' IN items_def) > 0 OR position('DELETE' IN items_def) > 0 THEN
    RAISE EXCEPTION '商城總覽只能讀取';
  END IF;
  FOREACH fn IN ARRAY ARRAY[
    'public.perk_unlock_progress(uuid, text)',
    'public.perk_sale_open(text, date)',
    'public.perk_mall_items_json(uuid, integer, boolean, date)',
    'public.perk_state_json(uuid)',
    'public.post_perk_unlock_debit(uuid, text, jsonb)'
  ] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '內部函式不能開放給 API：%', fn;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.purchase_my_perk(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_my_points_mall()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.purchase_my_perk(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.set_my_perk_equipped(text, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_my_points_mall()', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.public_equipped_perks(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION '商城入口權限不正確';
  END IF;
  IF has_table_privilege('authenticated', 'public.member_perk_sale_windows', 'SELECT')
     OR has_table_privilege('authenticated', 'public.member_perk_sale_windows', 'INSERT')
     OR has_table_privilege('authenticated', 'public.member_perk_catalog', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.member_perk_holds', 'INSERT')
     OR has_table_privilege('authenticated', 'public.member_perk_loadout', 'UPDATE') THEN
    RAISE EXCEPTION '不能直接開放商城資料表';
  END IF;
END
$mall_v2_check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
