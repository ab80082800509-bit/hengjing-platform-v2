-- =============================================================================
-- 第八階段第 1 批：賣家訂閱正式套用前的唯讀預檢。
-- 只讀，結尾 ROLLBACK。不建立、不修復、不啟用任何物件，也不寫入啟用時間。
-- 結果只有一列：judgment、reason、snapshot。
-- judgment 只會是：尚未安裝、僅第一支已安裝、兩支已完整安裝、不相容。
-- 函式指紋是 md5(replace(本文, CRLF, LF))，來自這兩份套用檔的函式本文，不從待檢資料庫抄。
-- seller_plan_quote 例外：金額定案後改為 20261117060000 的未稅 400、稅額 20、含稅實付 420。
--   第一支：20261117010000_seller_subscription_apply.sql
--   第二支：20261117020000_seller_subscription_start_rules.sql
-- =============================================================================

BEGIN READ ONLY;

WITH fn(name, sig, v1, v2, slot) AS (
  VALUES
    ('seller_subscription_eval', 'public.seller_subscription_eval(uuid, timestamptz)', '37820150568ae4daedbcb70e9c0472d5', '03229c094d9e9ef928ffa57796d18d3b', 'both'),
    ('apply_my_seller_extension', 'public.apply_my_seller_extension()', '0d85722e4bf292525fc30287008a9c3e', 'd1915108eed25ec918b81099580f7127', 'both'),
    ('admin_review_seller_extension', 'public.admin_review_seller_extension(uuid, boolean, text)', 'bba0f414a85ee1b337dc5ee4502516e3', 'b6dec4a83a048080c517e5001075072b', 'both'),
    ('get_my_seller_subscription', 'public.get_my_seller_subscription()', '6848026b62398cc0b6e4bef80c3affc5', '7733b9733423ffaa5522b0dc283b8ba4', 'both'),
    ('seller_plan_quote', 'public.seller_plan_quote()', '4af5839f441956349039740c94c64c9c', NULL, 'v1'),
    ('seller_subscription_taipei', 'public.seller_subscription_taipei(timestamptz)', '2419f645bc4e8e4d3369d335bdba221f', NULL, 'v1'),
    ('seller_subscription_remaining', 'public.seller_subscription_remaining(timestamptz, timestamptz)', '22875c2ad197c12ce8ef4dc7c9972099', NULL, 'v1'),
    ('seller_subscription_new_trade_allowed', 'public.seller_subscription_new_trade_allowed(uuid, timestamptz)', '1d9daedee38f402f18eca63b52d1b0f0', NULL, 'v1'),
    ('seller_subscription_refuse_new_trades', 'public.seller_subscription_refuse_new_trades(jsonb)', 'fe9852d631f651000ef4804e2496d52f', NULL, 'v1'),
    ('orders_block_expired_seller_subscription', 'public.orders_block_expired_seller_subscription()', 'f09eaee148148e40d46a782077756cfa', NULL, 'v1'),
    ('reject_seller_subscription_payment', 'public.reject_seller_subscription_payment()', '6b54caecb01aec277d6e1982761fc708', NULL, 'v1'),
    ('admin_list_seller_extensions', 'public.admin_list_seller_extensions()', '48bf36335b4d97331a1c98c16ab6e711', NULL, 'v1'),
    ('seller_subscription_policy', 'public.seller_subscription_policy()', NULL, '0e9923755d0d957b88ecff1433996b37', 'v2'),
    ('seller_subscription_ensure_trial', 'public.seller_subscription_ensure_trial(uuid, timestamptz)', NULL, 'a63af72049b363b3caadb64189569d1b', 'v2'),
    ('seller_subscription_on_seller_approved', 'public.seller_subscription_on_seller_approved()', NULL, '1d65f58104d44a564450baaa36a07947', 'v2'),
    ('admin_enable_seller_subscriptions', 'public.admin_enable_seller_subscriptions()', NULL, 'd27953c46aa0801534cc143f27a41f89', 'v2')
),
fn_state AS (
  SELECT f.name, f.slot,
         CASE
           WHEN p.oid IS NULL THEN '缺少'
           WHEN f.v1 IS NOT NULL AND md5(replace(p.prosrc, E'\r\n', E'\n')) = f.v1 THEN '第一支'
           WHEN f.v2 IS NOT NULL AND md5(replace(p.prosrc, E'\r\n', E'\n')) = f.v2 THEN '第二支'
           ELSE '未知版本'
         END AS state,
         CASE
           WHEN to_regprocedure(f.sig) IS NULL THEN false
           ELSE has_function_privilege('authenticated', to_regprocedure(f.sig), 'execute')
         END AS auth_exec,
         CASE
           WHEN to_regprocedure(f.sig) IS NULL THEN false
           ELSE has_function_privilege('anon', to_regprocedure(f.sig), 'execute')
                OR has_function_privilege('public', to_regprocedure(f.sig), 'execute')
         END AS wide_exec
  FROM fn AS f
  LEFT JOIN pg_proc AS p ON p.oid = to_regprocedure(f.sig)
),
member_rpc(name) AS (
  VALUES
    ('seller_plan_quote'),
    ('get_my_seller_subscription'),
    ('apply_my_seller_extension'),
    ('reject_seller_subscription_payment'),
    ('admin_list_seller_extensions'),
    ('admin_review_seller_extension'),
    ('seller_subscription_policy'),
    ('admin_enable_seller_subscriptions')
),
obj AS (
  SELECT
    to_regclass('public.seller_subscriptions') IS NOT NULL AS subscriptions,
    to_regclass('public.seller_extension_requests') IS NOT NULL AS requests,
    to_regclass('public.seller_subscription_settings') IS NOT NULL AS settings,
    EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'seller_extension_one_pending') AS one_pending,
    EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'seller_extension_one_approved') AS one_approved,
    EXISTS (
      SELECT 1 FROM pg_index AS i
      JOIN pg_class AS c ON c.oid = i.indexrelid
      WHERE c.relname = 'seller_extension_one_request' AND i.indisunique AND i.indpred IS NULL
    ) AS one_request,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_subscriptions_payment') AS pay_check,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_subscriptions_trial_pair') AS trial_pair,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_subscriptions_extension_pair') AS extension_pair,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_subscriptions_paid_pair') AS paid_pair,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_extension_requests_status') AS request_status,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_extension_requests_review_pair') AS review_pair,
    EXISTS (
      SELECT 1 FROM pg_class
      WHERE oid = to_regclass('public.seller_subscriptions') AND relrowsecurity
    ) AS subscriptions_rls,
    EXISTS (
      SELECT 1 FROM pg_class
      WHERE oid = to_regclass('public.seller_extension_requests') AND relrowsecurity
    ) AS requests_rls,
    EXISTS (
      SELECT 1 FROM pg_class
      WHERE oid = to_regclass('public.seller_subscription_settings') AND relrowsecurity
    ) AS settings_rls,
    (
      SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('seller_subscriptions', 'seller_extension_requests', 'seller_subscription_settings')
    ) AS policy_count,
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'orders_seller_subscription_guard' AND NOT tgisinternal
    ) AS order_guard,
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'seller_applications_subscription_trial' AND NOT tgisinternal
    ) AS approval_trigger,
    CASE
      WHEN to_regprocedure('public.place_checkout(uuid, jsonb, jsonb, jsonb, text, text, text, jsonb)') IS NULL THEN false
      ELSE position(
        'seller_subscription_refuse_new_trades' IN pg_get_functiondef(
          'public.place_checkout(uuid, jsonb, jsonb, jsonb, text, text, text, jsonb)'::regprocedure
        )
      ) > 0
    END AS checkout_patched
),
table_grant AS (
  SELECT coalesce(bool_or(
    CASE
      WHEN to_regclass(t.rel) IS NULL THEN false
      ELSE has_table_privilege('authenticated', t.rel, 'SELECT')
        OR has_table_privilege('authenticated', t.rel, 'INSERT')
        OR has_table_privilege('authenticated', t.rel, 'UPDATE')
        OR has_table_privilege('authenticated', t.rel, 'DELETE')
        OR has_table_privilege('anon', t.rel, 'SELECT')
        OR has_table_privilege('anon', t.rel, 'INSERT')
        OR has_table_privilege('public', t.rel, 'SELECT')
        OR has_table_privilege('public', t.rel, 'INSERT')
    END
  ), false) AS opened
  FROM (VALUES
    ('public.seller_subscriptions'),
    ('public.seller_extension_requests'),
    ('public.seller_subscription_settings')
  ) AS t(rel)
),
shape AS (
  SELECT
    coalesce(bool_and(state = '缺少'), false) AS functions_absent,
    coalesce(bool_and(state = '第一支') FILTER (WHERE slot IN ('both', 'v1')), false) AS file1_functions,
    coalesce(bool_and(state = '缺少') FILTER (WHERE slot = 'v2'), false) AS file2_absent,
    coalesce(bool_and(state = '第二支') FILTER (WHERE slot IN ('both', 'v2')), false) AS file2_functions,
    coalesce(bool_and(state = '第一支') FILTER (WHERE slot = 'v1'), false) AS file1_kept,
    coalesce(bool_and(auth_exec) FILTER (WHERE name IN (
      'seller_plan_quote', 'get_my_seller_subscription', 'apply_my_seller_extension',
      'reject_seller_subscription_payment', 'admin_list_seller_extensions', 'admin_review_seller_extension'
    )), false) AS file1_member_exec,
    coalesce(bool_and(auth_exec) FILTER (WHERE name IN ('seller_subscription_policy', 'admin_enable_seller_subscriptions')), false) AS file2_member_exec,
    coalesce(bool_or(auth_exec) FILTER (WHERE name NOT IN (SELECT name FROM member_rpc)), false) AS internal_exec,
    coalesce(bool_or(wide_exec), false) AS wide_exec
  FROM fn_state
),
flags AS (
  SELECT
    s.functions_absent AND NOT o.subscriptions AND NOT o.requests AND NOT o.settings
      AND NOT o.one_request AND NOT o.approval_trigger AND NOT o.checkout_patched AS blank,
    s.file1_functions AND s.file2_absent AND NOT s.internal_exec AND NOT s.wide_exec AND s.file1_member_exec
      AND NOT s.file2_member_exec
      AND o.subscriptions AND o.requests AND NOT o.settings
      AND o.one_pending AND o.one_approved AND NOT o.one_request
      AND o.pay_check AND o.trial_pair AND o.extension_pair AND o.paid_pair
      AND o.request_status AND o.review_pair
      AND o.subscriptions_rls AND o.requests_rls AND o.policy_count = 0 AND NOT g.opened
      AND o.order_guard AND NOT o.approval_trigger AND o.checkout_patched AS file1_only,
    s.file2_functions AND s.file1_kept AND NOT s.internal_exec AND NOT s.wide_exec
      AND s.file1_member_exec AND s.file2_member_exec
      AND o.subscriptions AND o.requests AND o.settings
      AND o.one_pending AND o.one_approved AND o.one_request
      AND o.pay_check AND o.trial_pair AND o.extension_pair AND o.paid_pair
      AND o.request_status AND o.review_pair
      AND o.subscriptions_rls AND o.requests_rls AND o.settings_rls AND o.policy_count = 0 AND NOT g.opened
      AND o.order_guard AND o.approval_trigger AND o.checkout_patched AS both_installed
  FROM shape AS s
  CROSS JOIN obj AS o
  CROSS JOIN table_grant AS g
),
labeled AS (
  SELECT
    CASE
      WHEN both_installed THEN '兩支已完整安裝'
      WHEN file1_only THEN '僅第一支已安裝'
      WHEN blank THEN '尚未安裝'
      ELSE '不相容'
    END AS judgment,
    CASE
      WHEN both_installed THEN '第一支保留的函式與第二支覆寫的函式都對到套用檔，資料表、一次申請限制與權限符合'
      WHEN file1_only THEN '只有第一支的函式、資料表與部分唯一索引，還沒有啟用時間表與每位賣家一筆申請的限制'
      WHEN blank THEN '賣家訂閱資料表、函式與結帳插入都還沒有'
      ELSE (
        SELECT '版本、資料表、約束、一次申請限制或權限沒有對上任一種可套用狀態'
          || coalesce('：' || string_agg(name || '=' || state, '，' ORDER BY name), '')
        FROM fn_state
        WHERE state = '未知版本'
           OR (
             slot = 'both'
             AND state IS DISTINCT FROM (SELECT state FROM fn_state WHERE name = 'seller_subscription_eval')
           )
      )
    END AS reason
  FROM flags
),
snapshot AS (
  SELECT format(
    '函式=%s；資料表=%s；約束=%s；一次申請=%s；會員可執行=%s；內部函式可執行=%s；匿名或PUBLIC可執行=%s；資料表授權=%s；啟用時間=%s；結帳開關=%s；訂閱列=%s；申請列=%s',
    (SELECT string_agg(name || ':' || state, ', ' ORDER BY name) FROM fn_state),
    (SELECT format('subscriptions:%s, requests:%s, settings:%s', subscriptions, requests, settings) FROM obj),
    (SELECT format('payment:%s, pairs:%s, review:%s', pay_check, trial_pair AND extension_pair AND paid_pair, request_status AND review_pair) FROM obj),
    (SELECT format('pending:%s, approved:%s, one:%s', one_pending, one_approved, one_request) FROM obj),
    (SELECT coalesce(string_agg(name, ', ' ORDER BY name), '無') FROM fn_state WHERE auth_exec),
    (SELECT coalesce(bool_or(auth_exec) FILTER (WHERE name NOT IN (SELECT name FROM member_rpc)), false) FROM fn_state),
    (SELECT coalesce(bool_or(wide_exec), false) FROM fn_state),
    (SELECT opened FROM table_grant),
    CASE
      WHEN to_regclass('public.seller_subscription_settings') IS NULL THEN '沒有設定表'
      ELSE coalesce((xpath('/row/v/text()', query_to_xml(
        'SELECT CASE WHEN enabled_at IS NULL THEN ''尚未設定'' ELSE to_char(enabled_at AT TIME ZONE ''Asia/Taipei'', ''YYYY-MM-DD HH24:MI:SS'') END AS v FROM public.seller_subscription_settings WHERE singleton',
        false, true, ''
      )))[1]::text, '沒有設定列')
    END,
    CASE
      WHEN to_regclass('public.commerce_settings') IS NULL THEN '沒有結帳設定'
      ELSE coalesce((xpath('/row/v/text()', query_to_xml(
        'SELECT CASE WHEN checkout_enabled THEN ''開啟'' ELSE ''關閉'' END AS v FROM public.commerce_settings WHERE id = true',
        false, true, ''
      )))[1]::text, '沒有結帳列')
    END,
    CASE
      WHEN to_regclass('public.seller_subscriptions') IS NULL THEN '沒有資料表'
      ELSE coalesce((xpath('/row/v/text()', query_to_xml('SELECT count(*)::text AS v FROM public.seller_subscriptions', false, true, '')))[1]::text, '0')
    END,
    CASE
      WHEN to_regclass('public.seller_extension_requests') IS NULL THEN '沒有資料表'
      ELSE coalesce((xpath('/row/v/text()', query_to_xml('SELECT count(*)::text AS v FROM public.seller_extension_requests', false, true, '')))[1]::text, '0')
    END
  ) AS snapshot
)
SELECT labeled.judgment, labeled.reason, snapshot.snapshot
FROM labeled
CROSS JOIN snapshot;

ROLLBACK;
