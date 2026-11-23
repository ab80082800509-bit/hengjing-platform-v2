-- =============================================================================
-- 第五階段正式套用前的唯讀檢查。
-- 只給人工在正式 Supabase SQL Editor 整份執行。不要執行第五階段 migration。
--
-- 本檔只有查詢。交易是 READ ONLY，並以 ROLLBACK 結束。
-- 不讀 auth.users、不讀點數餘額、不讀優惠券、不讀評價內容，也不輸出信箱、電話或會員編號。
-- 結果只有結構是否存在、約束與函式原文裡有沒有指定字樣，以及角色執行權。
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

SELECT
  to_jsonb(checks) AS checks,
  CASE
    WHEN checks.has_auth_users
      AND checks.has_auth_uid
      AND checks.has_point_accounts
      AND checks.has_point_entries
      AND checks.point_entry_columns_ready
      AND checks.has_reward_claims
      AND checks.reward_claim_columns_ready
      AND checks.has_post_member_reward
      AND checks.reward_rejects_unopened_kind
      AND NOT checks.reward_mentions_platform_grant
      AND checks.entries_kind_allows_perk_unlock
      AND checks.claims_kind_allows_perk_unlock
      AND checks.has_taipei_today
      AND checks.has_coupon_exchange_debit
      AND checks.has_products
      AND checks.products_have_seller_id
      AND checks.has_product_reviews
      AND checks.review_columns_ready
      AND checks.has_review_photos
      AND checks.photo_columns_ready
      AND checks.has_profiles
      AND checks.profiles_have_public_nickname
      AND checks.has_product_is_public
      AND checks.has_list_public_reviews
      AND checks.reviews_single_jsonb_overload
      AND checks.reviews_body_has_product_is_public
      AND checks.reviews_body_has_seller_id
      AND checks.reviews_not_yet_joined_to_loadout
      AND checks.anon_can_execute_reviews
      AND checks.authenticated_can_execute_reviews
      AND checks.perk_names_absent
    THEN '依賴齊全，第五階段新物件尚未存在。founder 兩個欄位若為 true，表示測試補點先前已在正式庫，本次 migration 不會建立也不會移除它。'
    ELSE '先不要套用第五階段。請看同一列哪個必要條件是 false，或 perk_names_absent 是 false。'
  END AS apply_gate
FROM (
  SELECT
    to_regclass('auth.users') IS NOT NULL AS has_auth_users,
    to_regprocedure('auth.uid()') IS NOT NULL AS has_auth_uid,
    to_regclass('public.member_point_accounts') IS NOT NULL AS has_point_accounts,
    to_regclass('public.member_point_entries') IS NOT NULL AS has_point_entries,
    (
      SELECT count(*) = 7
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'member_point_entries'
        AND column_name IN ('user_id', 'delta', 'balance_after', 'kind', 'claim_key', 'taipei_day', 'metadata')
    ) AS point_entry_columns_ready,
    to_regclass('public.reward_claims') IS NOT NULL AS has_reward_claims,
    (
      SELECT count(*) = 8
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'reward_claims'
        AND column_name IN ('user_id', 'kind', 'claim_key', 'taipei_day', 'delta', 'balance_after', 'point_entry_id', 'metadata')
    ) AS reward_claim_columns_ready,
    to_regprocedure('public.post_member_reward(uuid,text,text,integer,jsonb)') IS NOT NULL AS has_post_member_reward,
    CASE
      WHEN to_regprocedure('public.post_member_reward(uuid,text,text,integer,jsonb)') IS NULL THEN false
      ELSE position(
        '這個獎勵來源尚未開放入帳'
        IN pg_get_functiondef('public.post_member_reward(uuid,text,text,integer,jsonb)'::regprocedure)
      ) > 0
    END AS reward_rejects_unopened_kind,
    CASE
      WHEN to_regprocedure('public.post_member_reward(uuid,text,text,integer,jsonb)') IS NULL THEN false
      ELSE position(
        'platform_grant'
        IN pg_get_functiondef('public.post_member_reward(uuid,text,text,integer,jsonb)'::regprocedure)
      ) > 0
    END AS reward_mentions_platform_grant,
    coalesce((
      SELECT position('perk_unlock' IN pg_get_constraintdef(constraint_info.oid)) > 0
      FROM pg_constraint AS constraint_info
      JOIN pg_class AS relation ON relation.oid = constraint_info.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'member_point_entries'
        AND constraint_info.conname = 'member_point_entries_kind_known'
    ), false) AS entries_kind_allows_perk_unlock,
    coalesce((
      SELECT position('perk_unlock' IN pg_get_constraintdef(constraint_info.oid)) > 0
      FROM pg_constraint AS constraint_info
      JOIN pg_class AS relation ON relation.oid = constraint_info.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'reward_claims'
        AND constraint_info.conname = 'reward_claims_kind_known'
    ), false) AS claims_kind_allows_perk_unlock,
    coalesce((
      SELECT position('platform_grant' IN pg_get_constraintdef(constraint_info.oid)) > 0
      FROM pg_constraint AS constraint_info
      JOIN pg_class AS relation ON relation.oid = constraint_info.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'member_point_entries'
        AND constraint_info.conname = 'member_point_entries_kind_known'
    ), false) AS entries_kind_has_platform_grant,
    to_regprocedure('public.taipei_today(timestamptz)') IS NOT NULL AS has_taipei_today,
    to_regprocedure('public.post_coupon_exchange_debit(uuid,text,jsonb)') IS NOT NULL AS has_coupon_exchange_debit,
    to_regclass('public.products') IS NOT NULL AS has_products,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name = 'seller_id'
    ) AS products_have_seller_id,
    to_regclass('public.product_reviews') IS NOT NULL AS has_product_reviews,
    (
      SELECT count(*) = 8
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'product_reviews'
        AND column_name IN ('id', 'user_id', 'product_id', 'rating', 'body', 'seller_reply', 'seller_replied_at', 'created_at')
    ) AS review_columns_ready,
    to_regclass('public.product_review_photos') IS NOT NULL AS has_review_photos,
    (
      SELECT count(*) = 3
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'product_review_photos'
        AND column_name IN ('review_id', 'path', 'created_at')
    ) AS photo_columns_ready,
    to_regclass('public.profiles') IS NOT NULL AS has_profiles,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'profiles'
        AND column_name = 'public_nickname'
    ) AS profiles_have_public_nickname,
    to_regprocedure('public.product_is_public(jsonb)') IS NOT NULL AS has_product_is_public,
    to_regprocedure('public.list_public_reviews(uuid[])') IS NOT NULL AS has_list_public_reviews,
    (
      SELECT count(*) = 1
      FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = 'list_public_reviews'
        AND pg_get_function_identity_arguments(procedure.oid) IN ('p_ids uuid[]', 'uuid[]')
        AND pg_catalog.format_type(procedure.prorettype, NULL) = 'jsonb'
    ) AS reviews_single_jsonb_overload,
    CASE
      WHEN to_regprocedure('public.list_public_reviews(uuid[])') IS NULL THEN false
      ELSE position(
        'product_is_public'
        IN pg_get_functiondef('public.list_public_reviews(uuid[])'::regprocedure)
      ) > 0
    END AS reviews_body_has_product_is_public,
    CASE
      WHEN to_regprocedure('public.list_public_reviews(uuid[])') IS NULL THEN false
      ELSE position(
        'seller_id'
        IN pg_get_functiondef('public.list_public_reviews(uuid[])'::regprocedure)
      ) > 0
    END AS reviews_body_has_seller_id,
    CASE
      WHEN to_regprocedure('public.list_public_reviews(uuid[])') IS NULL THEN false
      ELSE position(
        'member_perk_loadout'
        IN pg_get_functiondef('public.list_public_reviews(uuid[])'::regprocedure)
      ) = 0
    END AS reviews_not_yet_joined_to_loadout,
    CASE
      WHEN to_regprocedure('public.list_public_reviews(uuid[])') IS NULL THEN false
      ELSE has_function_privilege('anon', 'public.list_public_reviews(uuid[])', 'EXECUTE')
    END AS anon_can_execute_reviews,
    CASE
      WHEN to_regprocedure('public.list_public_reviews(uuid[])') IS NULL THEN false
      ELSE has_function_privilege('authenticated', 'public.list_public_reviews(uuid[])', 'EXECUTE')
    END AS authenticated_can_execute_reviews,
    CASE
      WHEN to_regprocedure('public.list_public_reviews(uuid[])') IS NULL THEN false
      ELSE has_function_privilege('public', 'public.list_public_reviews(uuid[])', 'EXECUTE')
    END AS reviews_public_role_can_execute,
    to_regclass('public.member_perk_catalog') IS NULL
      AND to_regclass('public.member_perk_holds') IS NULL
      AND to_regclass('public.member_perk_loadout') IS NULL
      AND to_regprocedure('public.post_perk_unlock_debit(uuid,text,jsonb)') IS NULL
      AND to_regprocedure('public.purchase_my_perk(text)') IS NULL
      AND to_regprocedure('public.set_my_perk_equipped(text,boolean)') IS NULL
      AND to_regprocedure('public.list_my_perks()') IS NULL
      AND to_regprocedure('public.public_equipped_perks(uuid[])') IS NULL
      AND to_regprocedure('public.perk_state_json(uuid)') IS NULL
      AND to_regprocedure('public.guard_member_perk_catalog()') IS NULL
      AND to_regprocedure('public.guard_member_perk_hold()') IS NULL
      AND to_regprocedure('public.guard_member_perk_loadout()') IS NULL
      AND to_regprocedure('public.assert_owned_perk_slot(uuid,text,text)') IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname IN ('member_point_entries_perk_debit', 'reward_claims_perk_debit')
      ) AS perk_names_absent,
    to_regprocedure('public.post_founder_coupon_test_grant(uuid,text)') IS NOT NULL AS founder_grant_present,
    to_regprocedure('public.post_founder_coupon_test_reclaim(uuid,text)') IS NOT NULL AS founder_reclaim_present
) AS checks;

ROLLBACK;
