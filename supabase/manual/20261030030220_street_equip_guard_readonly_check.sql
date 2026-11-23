-- =============================================================================
-- 第七階段第 9 批：夢想商店街套用欄位修補前的唯讀預檢（對應 20261030030210_street_equip_guard_apply.sql）。
-- 只讀，不建立物件，結尾 ROLLBACK。第一個結果第 0 列為「可修補」才執行修補檔。
--   可修補：street_cloud_build 仍是 v2 套用檔，其餘 5 個函式也都是 v2。
--   已修補：street_cloud_build 已是修補檔，其餘 5 個函式仍是 v2。
--   不可修補：缺函式、仍是 v1，或任一相關函式不是上述已知版本。未知版本一律拒絕。
-- 指紋是 md5(replace(本文, CRLF, LF))。常數來自套用檔與修補檔，不是從待檢資料庫抄下來的：
--   v2：20261030030200_street_content_v2_apply.sql
--   修正版：20261030030210_street_equip_guard_apply.sql 的 street_cloud_build
-- 修補前後各跑一次，最後一個結果的存檔、獎勵、點數與合成小舖數字必須完全相同。
-- =============================================================================

BEGIN READ ONLY;

WITH fn(name, sig, v2, fix) AS (
  VALUES
  ('street_cloud_spec', 'public.street_cloud_spec()', '5a170498b46603661a2439563cb67d33', NULL),
  ('street_cloud_build', 'public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint)', '838580cae35772373d7ea1315bdd9282', '13a1b2fe7cdded34dd0f61c786a3951e'),
  ('street_cloud_row_json', 'public.street_cloud_row_json(public.member_street_saves)', 'e16250d4644b44450c3af5b745ecc877', NULL),
  ('get_my_street_save', 'public.get_my_street_save()', '94102a0fe2b884254ae871a36925eee9', NULL),
  ('street_decor_min_level', 'public.street_decor_min_level(text)', '0843e958e392f3692ddb12f0d7b4ff7d', NULL),
  ('street_decor_slot', 'public.street_decor_slot(text)', '3aef135d08d199d67798ff9ac1f8ebec', NULL)
),
fn_state AS (
  SELECT fn.name,
         CASE
           WHEN p.oid IS NULL THEN '缺少'
           WHEN md5(replace(p.prosrc, E'\r\n', E'\n')) = fn.v2 THEN 'v2'
           WHEN fn.fix IS NOT NULL AND md5(replace(p.prosrc, E'\r\n', E'\n')) = fn.fix THEN 'v2修正'
           ELSE '未知版本'
         END AS state
  FROM fn
  LEFT JOIN pg_proc AS p ON p.oid = to_regprocedure(fn.sig)
),
ver AS (
  SELECT coalesce(bool_and(state = 'v2'), false) AS ready,
         coalesce((SELECT state = 'v2修正' FROM fn_state WHERE name = 'street_cloud_build'), false) AS fixed,
         coalesce((SELECT state = 'v2' FROM fn_state WHERE name = 'street_cloud_build'), false) AS old_v2
  FROM fn_state
  WHERE name <> 'street_cloud_build'
),
checks(sort, item, ok, detail) AS (
  SELECT 1, '六個相關函式都在',
         coalesce((SELECT bool_and(state <> '缺少') FROM fn_state), false),
         (SELECT string_agg(name, '、' ORDER BY name) FROM fn_state WHERE state = '缺少')
  UNION ALL
  SELECT 2, '修補不會改到的 5 個函式都是 v2 套用檔',
         (SELECT ready FROM ver),
         (SELECT string_agg(name || ' ' || state, '、' ORDER BY name) FROM fn_state WHERE name <> 'street_cloud_build' AND state <> 'v2')
  UNION ALL
  SELECT 3, 'street_cloud_build 是 v2 或修補檔的已知版本',
         coalesce((SELECT state IN ('v2', 'v2修正') FROM fn_state WHERE name = 'street_cloud_build'), false),
         (SELECT state FROM fn_state WHERE name = 'street_cloud_build')
  UNION ALL
  SELECT 4, 'street_cloud_build 不對 API 角色開放',
         CASE
           WHEN to_regprocedure('public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint)') IS NULL THEN false
           WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
             OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN false
           WHEN has_function_privilege('anon', 'public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint)', 'EXECUTE') THEN false
           WHEN has_function_privilege('authenticated', 'public.street_cloud_build(jsonb, jsonb, numeric, integer, bigint, bigint, bigint, bigint, bigint)', 'EXECUTE') THEN false
           ELSE true
         END,
         NULL
)
SELECT 0 AS sort,
       CASE
         WHEN NOT bool_and(coalesce(ok, false)) THEN '不可修補：' || string_agg(
           item || coalesce('（' || nullif(detail, '') || '）', ''), '、' ORDER BY sort) FILTER (WHERE ok IS NOT TRUE)
         WHEN (SELECT fixed FROM ver) THEN '已修補'
         WHEN (SELECT old_v2 FROM ver) THEN '可修補'
         ELSE '不可修補'
       END AS item,
       bool_and(coalesce(ok, false)) AS ok
FROM checks
UNION ALL
SELECT sort, item || coalesce('（' || nullif(detail, '') || '）', ''), coalesce(ok, false) FROM checks
UNION ALL
SELECT 20 + row_number() OVER (ORDER BY name), '函式 ' || name || '：' || state, state IN ('v2', 'v2修正') FROM fn_state
ORDER BY sort;

SELECT
  CASE
    WHEN to_regclass('public.member_street_saves') IS NULL THEN NULL
    ELSE (xpath('/row/v/text()', query_to_xml($q$
      SELECT concat_ws(' / ', count(*), coalesce(sum(coins), 0), coalesce(sum(xp), 0), coalesce(sum(revision), 0),
                       md5(coalesce(string_agg(md5(progress::text), '' ORDER BY user_id), ''))) AS v
      FROM public.member_street_saves$q$, false, true, '')))[1]::text
  END AS street_saves,
  CASE WHEN to_regclass('public.member_point_accounts') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT concat_ws(' / ', count(*), coalesce(sum(balance), 0)) AS v FROM public.member_point_accounts$q$, false, true, '')))[1]::text END,
  CASE WHEN to_regclass('public.member_point_entries') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT count(*) AS v FROM public.member_point_entries$q$, false, true, '')))[1]::text END,
  CASE WHEN to_regclass('public.member_perk_catalog') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT concat_ws(' / ', count(*), coalesce(sum(cost), 0)) AS v FROM public.member_perk_catalog$q$, false, true, '')))[1]::text END,
  CASE WHEN to_regclass('public.member_merge_shops') IS NULL THEN NULL
       ELSE (xpath('/row/v/text()', query_to_xml($q$SELECT count(*) AS v FROM public.member_merge_shops$q$, false, true, '')))[1]::text END;

ROLLBACK;
