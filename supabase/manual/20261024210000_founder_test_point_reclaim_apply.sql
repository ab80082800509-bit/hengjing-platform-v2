-- =============================================================================
-- 創始人測試額度正式回收。人工審查後，且優惠券測試做完，才執行。
-- 這份不改資料庫結構，也不作廢優惠券、訂單或虛擬道具。
--
-- 使用方式：
-- 1. 填入與當初補點相同、且已用只讀查詢確認的會員編號與信箱。
-- 2. 維持最後一行 ROLLBACK，整份執行一次。
-- 3. 確認 userId、delta 為負數或 0、balanceAfter 沒有變負，
--    並閱讀 unresolvedPointHolds 與 entitlementLimit。
-- 4. holdsReleased 必須是 false。券包裡的點數兌換券仍會留下。
-- 5. 只有接受這個限制時，才把最後一行改成 COMMIT，再整份執行一次。
--
-- 回收金額是當初補上的差額，減去補點之後餘額鏈上的負數流水。
-- 不看 created_at 或 UUID。同一交易時間、或較早開始但較晚入帳的扣點，都依餘額先後歸屬。
-- 補點前的餘額，以及補點之後的簽到與刮卡，會留下來。
-- 會員只要已有虛擬道具流水，這次會停止，不會清虛擬特權，也不作廢券。
-- 成功寫入後再執行只會回放，不會再扣一次。
-- =============================================================================

BEGIN;

DO $founder_reclaim_apply_guard$
BEGIN
  IF current_user IN ('authenticated', 'anon', 'service_role') THEN
    RAISE EXCEPTION '正式回收必須由資料庫擁有者執行。交易會回復。';
  END IF;
  IF to_regprocedure('public.post_founder_coupon_test_reclaim(uuid, text)') IS NULL THEN
    RAISE EXCEPTION '請先提交 20261024210000_founder_test_point_grant.sql。這份不會改結構。';
  END IF;
END
$founder_reclaim_apply_guard$;

SELECT
  users.id,
  users.email,
  users.email_confirmed_at,
  coalesce(account.balance, 0) AS balance
FROM auth.users AS users
LEFT JOIN public.member_point_accounts AS account ON account.user_id = users.id
WHERE users.id = '00000000-0000-0000-0000-000000000000'::uuid
  AND lower(users.email) = lower('member@example.com');

SELECT public.post_founder_coupon_test_reclaim(
  '00000000-0000-0000-0000-000000000000'::uuid,
  'member@example.com'
);

SELECT
  entry.user_id,
  entry.kind,
  entry.delta,
  entry.balance_after,
  entry.claim_key
FROM public.member_point_entries AS entry
WHERE entry.claim_key IN (
  'platform_grant:founder-coupon-test-20261024',
  'platform_reclaim:founder-coupon-test-20261024'
)
ORDER BY entry.created_at, entry.id;

ROLLBACK;
