-- =============================================================================
-- 創始人測試額度正式入帳。人工審查後才執行。
-- 先整份執行預演，再提交 supabase/migrations/20261024210000_founder_test_point_grant.sql。
-- 這份不改資料庫結構。它只呼叫已經裝好的補點函式。
--
-- 使用方式：
-- 1. 把下面所有 member@example.com 與全零 UUID 換成只讀查詢確認的同一人。
-- 2. 維持最後一行 ROLLBACK，整份執行一次。
-- 3. 確認回傳的 userId 是該會員、replayed 是 false、balanceAfter 是 5000。
-- 4. 只有這時才把最後一行改成 COMMIT，再整份執行一次。
--
-- 這是把可用餘額補足至 5,000，不是再加 5,000。
-- 成功寫入後，同一個領獎鍵再執行只會回放，不會第二次入帳。
-- 若執行當下餘額已達 5,000，函式不寫流水；那種情況還沒有領獎鍵，
-- 之後餘額掉下來再執行，仍會補到 5,000。請不要在那種情況下改成 COMMIT。
-- =============================================================================

BEGIN;

DO $founder_grant_apply_guard$
BEGIN
  IF current_user IN ('authenticated', 'anon', 'service_role') THEN
    RAISE EXCEPTION '正式補點必須由資料庫擁有者執行。交易會回復。';
  END IF;
  IF to_regprocedure('public.post_founder_coupon_test_grant(uuid, text)') IS NULL THEN
    RAISE EXCEPTION '請先提交 20261024210000_founder_test_point_grant.sql。這份不會改結構。';
  END IF;
END
$founder_grant_apply_guard$;

SELECT
  users.id,
  users.email,
  users.email_confirmed_at,
  profile.public_nickname,
  profile.role,
  coalesce(account.balance, 0) AS balance,
  CASE
    WHEN coalesce(account.balance, 0) >= 5000 THEN 0
    ELSE 5000 - coalesce(account.balance, 0)
  END AS delta_if_granted
FROM auth.users AS users
LEFT JOIN public.profiles AS profile ON profile.id = users.id
LEFT JOIN public.member_point_accounts AS account ON account.user_id = users.id
WHERE users.id = '00000000-0000-0000-0000-000000000000'::uuid
  AND lower(users.email) = lower('member@example.com');

SELECT public.post_founder_coupon_test_grant(
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
WHERE entry.claim_key = 'platform_grant:founder-coupon-test-20261024';

ROLLBACK;
