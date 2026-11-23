-- =============================================================================
-- 第七階段第 9 批：點數商城 v2 唯讀預檢。只讀，結尾 ROLLBACK，不改任何資料。
-- 套用前與套用後各跑一次，比對「既有資料列數」與「點數總額」必須相同。
-- =============================================================================

BEGIN READ ONLY;

SELECT
  CASE
    WHEN to_regclass('public.member_perk_catalog') IS NULL THEN '不可套用：缺少第五批虛擬特權'
    WHEN to_regprocedure('public.get_my_points_mall()') IS NULL THEN '不可套用：缺少點數商城總覽'
    WHEN to_regclass('public.member_perk_sale_windows') IS NOT NULL AND (SELECT count(*) FROM public.member_perk_catalog) = 40 THEN '已套用 v2（40 件）'
    WHEN (SELECT count(*) FROM public.member_perk_catalog) = 15 AND (SELECT sum(cost) FROM public.member_perk_catalog) = 2180 THEN '可以套用'
    ELSE '不可套用：目錄狀態不是原本的 15 件'
  END AS mall_v2_gate;

-- 依賴：解鎖條件會讀這兩張表；不存在時解鎖進度為 0（對應商品顯示「未解鎖」）。
SELECT
  to_regclass('public.member_merge_shops') IS NOT NULL AS has_merge_shops,
  to_regclass('public.member_street_saves') IS NOT NULL AS has_street_saves,
  to_regprocedure('public.street_cloud_rank(bigint)') IS NOT NULL AS has_street_rank;

-- 既有資料：套用前後必須一致。
SELECT
  (SELECT count(*) FROM public.member_perk_catalog) AS catalog_rows,
  (SELECT count(*) FROM public.member_perk_holds) AS hold_rows,
  (SELECT count(DISTINCT user_id) FROM public.member_perk_holds) AS members_with_holds,
  (SELECT count(*) FROM public.member_perk_loadout) AS loadout_rows,
  (SELECT count(*) FROM public.member_point_accounts) AS point_accounts,
  (SELECT coalesce(sum(balance), 0) FROM public.member_point_accounts) AS point_balance_total,
  (SELECT count(*) FROM public.member_point_entries) AS point_entries,
  (SELECT count(*) FROM public.reward_claims) AS reward_claims,
  (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) AS purchase_enabled;

-- 每件原有特權的持有人數（套用後不可變少）。
SELECT c.id, c.category, c.cost, count(h.user_id) AS holders
FROM public.member_perk_catalog AS c
LEFT JOIN public.member_perk_holds AS h ON h.perk_id = c.id
GROUP BY c.id, c.category, c.cost
ORDER BY c.id;

ROLLBACK;
