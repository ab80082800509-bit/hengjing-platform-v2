-- =============================================================================
-- 第七階段第 9 批：補清明 2038、2042，以及三件限定收藏 2036–2050 的窗口。
-- 不改 20261030030700、20261030020100 已套用的內容，只新增列。
-- 順序：先套用那兩份歷史檔（若尚未套用），兌換若尚未開放則先跑
--       20261030020200_points_mall_open_purchase.sql（它仍檢查原版 30 筆），
--       最後才跑本檔。本檔不改商品編號、價格、持有紀錄，也不開啟 Pay 發放。
-- 重跑時既有列保持原樣；缺的列才補上。
-- =============================================================================

BEGIN;

DO $festival_gap_guard$
BEGIN
  IF to_regclass('public.game_live_festival_windows') IS NULL THEN
    RAISE EXCEPTION '請先套用 20261030030700_live_events_apply.sql';
  END IF;
  IF to_regclass('public.member_perk_sale_windows') IS NULL OR to_regclass('public.member_perk_catalog') IS NULL THEN
    RAISE EXCEPTION '請先套用 20261030020100_points_mall_v2_apply.sql';
  END IF;
  IF to_regclass('public.game_reward_policies') IS NOT NULL
     AND coalesce((SELECT bool_or(payout_enabled) FROM public.game_reward_policies), false) THEN
    RAISE EXCEPTION 'Pay 遊戲點數發放必須維持關閉';
  END IF;
  IF (SELECT count(*) FROM public.member_perk_catalog
      WHERE id IN ('collect-newyear', 'collect-moon', 'collect-snowman') AND cost = 168 AND sale_kind = 'festival') <> 3 THEN
    RAISE EXCEPTION '限定收藏的編號、價格或販售方式與原版不同';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.game_live_festival_windows
    WHERE festival_id = 'qingming' AND starts_on = DATE '2026-04-05' AND ends_on = DATE '2026-04-06'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.member_perk_sale_windows
    WHERE perk_id = 'collect-snowman' AND starts_on = DATE '2026-12-20' AND ends_on = DATE '2026-12-26'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.member_perk_sale_windows
    WHERE perk_id = 'collect-newyear' AND starts_on = DATE '2026-02-16' AND ends_on = DATE '2026-03-04'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.member_perk_sale_windows
    WHERE perk_id = 'collect-moon' AND starts_on = DATE '2026-09-24' AND ends_on = DATE '2026-09-26'
  ) THEN
    RAISE EXCEPTION '既有節慶或販售窗口與原版不同';
  END IF;
  PERFORM set_config('app.perk_catalog', 'on', true);
END
$festival_gap_guard$;

INSERT INTO public.game_live_festival_windows (festival_id, starts_on, ends_on) VALUES
  ('qingming', DATE '2038-04-05', DATE '2038-04-06'),
  ('qingming', DATE '2042-04-04', DATE '2042-04-05')
ON CONFLICT (festival_id, starts_on) DO NOTHING;

INSERT INTO public.member_perk_sale_windows (perk_id, starts_on, ends_on) VALUES
  ('collect-newyear', DATE '2036-01-27', DATE '2036-02-12'),
  ('collect-newyear', DATE '2037-02-14', DATE '2037-03-02'),
  ('collect-newyear', DATE '2038-02-03', DATE '2038-02-19'),
  ('collect-newyear', DATE '2039-01-23', DATE '2039-02-08'),
  ('collect-newyear', DATE '2040-02-11', DATE '2040-02-27'),
  ('collect-newyear', DATE '2041-01-31', DATE '2041-02-16'),
  ('collect-newyear', DATE '2042-01-21', DATE '2042-02-06'),
  ('collect-newyear', DATE '2043-02-09', DATE '2043-02-25'),
  ('collect-newyear', DATE '2044-01-29', DATE '2044-02-14'),
  ('collect-newyear', DATE '2045-02-16', DATE '2045-03-04'),
  ('collect-newyear', DATE '2046-02-05', DATE '2046-02-21'),
  ('collect-newyear', DATE '2047-01-25', DATE '2047-02-10'),
  ('collect-newyear', DATE '2048-02-13', DATE '2048-02-29'),
  ('collect-newyear', DATE '2049-02-01', DATE '2049-02-17'),
  ('collect-newyear', DATE '2050-01-22', DATE '2050-02-07'),
  ('collect-moon', DATE '2036-10-03', DATE '2036-10-05'),
  ('collect-moon', DATE '2037-09-23', DATE '2037-09-25'),
  ('collect-moon', DATE '2038-09-12', DATE '2038-09-14'),
  ('collect-moon', DATE '2039-10-01', DATE '2039-10-03'),
  ('collect-moon', DATE '2040-09-19', DATE '2040-09-21'),
  ('collect-moon', DATE '2041-09-09', DATE '2041-09-11'),
  ('collect-moon', DATE '2042-09-27', DATE '2042-09-29'),
  ('collect-moon', DATE '2043-09-16', DATE '2043-09-18'),
  ('collect-moon', DATE '2044-10-04', DATE '2044-10-06'),
  ('collect-moon', DATE '2045-09-24', DATE '2045-09-26'),
  ('collect-moon', DATE '2046-09-14', DATE '2046-09-16'),
  ('collect-moon', DATE '2047-10-03', DATE '2047-10-05'),
  ('collect-moon', DATE '2048-09-21', DATE '2048-09-23'),
  ('collect-moon', DATE '2049-09-10', DATE '2049-09-12'),
  ('collect-moon', DATE '2050-09-29', DATE '2050-10-01'),
  ('collect-snowman', DATE '2036-12-20', DATE '2036-12-26'),
  ('collect-snowman', DATE '2037-12-20', DATE '2037-12-26'),
  ('collect-snowman', DATE '2038-12-20', DATE '2038-12-26'),
  ('collect-snowman', DATE '2039-12-20', DATE '2039-12-26'),
  ('collect-snowman', DATE '2040-12-20', DATE '2040-12-26'),
  ('collect-snowman', DATE '2041-12-20', DATE '2041-12-26'),
  ('collect-snowman', DATE '2042-12-20', DATE '2042-12-26'),
  ('collect-snowman', DATE '2043-12-20', DATE '2043-12-26'),
  ('collect-snowman', DATE '2044-12-20', DATE '2044-12-26'),
  ('collect-snowman', DATE '2045-12-20', DATE '2045-12-26'),
  ('collect-snowman', DATE '2046-12-20', DATE '2046-12-26'),
  ('collect-snowman', DATE '2047-12-20', DATE '2047-12-26'),
  ('collect-snowman', DATE '2048-12-20', DATE '2048-12-26'),
  ('collect-snowman', DATE '2049-12-20', DATE '2049-12-26'),
  ('collect-snowman', DATE '2050-12-20', DATE '2050-12-26')
ON CONFLICT (perk_id, starts_on) DO NOTHING;

DO $festival_gap_check$
BEGIN
  IF (SELECT count(*) FROM public.game_live_festival_windows
      WHERE festival_id = 'qingming' AND starts_on IN (DATE '2038-04-05', DATE '2042-04-04')) <> 2
     OR (SELECT ends_on FROM public.game_live_festival_windows
         WHERE festival_id = 'qingming' AND starts_on = DATE '2038-04-05') IS DISTINCT FROM DATE '2038-04-06'
     OR (SELECT ends_on FROM public.game_live_festival_windows
         WHERE festival_id = 'qingming' AND starts_on = DATE '2042-04-04') IS DISTINCT FROM DATE '2042-04-05'
     OR (SELECT ends_on FROM public.game_live_festival_windows
         WHERE festival_id = 'qingming' AND starts_on = DATE '2026-04-05') IS DISTINCT FROM DATE '2026-04-06' THEN
    RAISE EXCEPTION '清明窗口補完後與曆表不一致';
  END IF;
  IF (SELECT count(*) FROM public.member_perk_sale_windows) <> 75
     OR (SELECT count(*) FROM public.member_perk_sale_windows WHERE starts_on < DATE '2036-01-01') <> 30
     OR EXISTS (
       SELECT 1 FROM public.member_perk_catalog AS c
       WHERE c.sale_kind = 'festival'
         AND (SELECT count(*) FROM public.member_perk_sale_windows AS w WHERE w.perk_id = c.id) <> 25
     ) THEN
    RAISE EXCEPTION '限定收藏販售窗口沒有補到 2050，或既有年份被改動';
  END IF;
  IF (SELECT coalesce(sum(cost), 0) FROM public.member_perk_catalog
      WHERE id IN ('collect-newyear', 'collect-moon', 'collect-snowman')) <> 504 THEN
    RAISE EXCEPTION '限定收藏價格被改動';
  END IF;
  PERFORM set_config('app.perk_catalog', 'off', true);
END
$festival_gap_check$;

COMMIT;
