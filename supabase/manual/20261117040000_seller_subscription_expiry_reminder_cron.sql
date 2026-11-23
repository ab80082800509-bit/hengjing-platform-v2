-- =============================================================================
-- 第八階段第 2 批：賣家到期提醒的自動排程。
-- 專案裡沒有既有排程可沿用，這一支用 Supabase Cron（pg_cron）。
-- 每 5 分鐘呼叫既有的 dispatch_seller_subscription_reminders()。
-- 到期後由下一次排程送出；同一賣家、同一期限的去重仍由該函式負責。
-- 不新增授權。執行角色是函式擁有者 postgres，它原本就有 EXECUTE。
-- 重跑會先卸下同名任務，再留下一個。
-- 不設定啟用時間，不修改全站結帳開關，不收款。
--
-- 套用需要能建立 extension 的管理者（隔離庫為 supabase_admin）。
-- 隔離庫的 shared_preload_libraries 已包含 pg_cron。
--
-- 查詢狀態：
--   SELECT jobid, jobname, schedule, command, database, username, active
--   FROM cron.job
--   WHERE jobname = 'seller_subscription_expiry_reminders';
--
--   SELECT j.jobname, d.status, d.return_message, d.start_time, d.end_time
--   FROM cron.job_run_details d
--   JOIN cron.job j ON j.jobid = d.jobid
--   WHERE j.jobname = 'seller_subscription_expiry_reminders'
--   ORDER BY d.start_time DESC;
--
-- 停用這個任務（保留定義，不再執行）：
--   SELECT cron.alter_job(
--     job_id := (SELECT jobid FROM cron.job WHERE jobname = 'seller_subscription_expiry_reminders' AND username = 'postgres'),
--     active := false
--   );
--
-- 卸下這個任務：
--   SELECT cron.unschedule(jobid)
--   FROM cron.job
--   WHERE jobname = 'seller_subscription_expiry_reminders';
-- =============================================================================

DO $seller_subscription_reminder_cron$
DECLARE
  existing_id bigint;
  new_id bigint;
BEGIN
  IF to_regprocedure('public.dispatch_seller_subscription_reminders()') IS NULL THEN
    RAISE EXCEPTION '請先套用賣家到期提醒';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;

  FOR existing_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'seller_subscription_expiry_reminders'
  LOOP
    PERFORM cron.unschedule(existing_id);
  END LOOP;

  SELECT cron.schedule(
    'seller_subscription_expiry_reminders',
    '*/5 * * * *',
    $cmd$SELECT public.dispatch_seller_subscription_reminders();$cmd$
  ) INTO new_id;

  PERFORM cron.alter_job(job_id := new_id, username := 'postgres');
END
$seller_subscription_reminder_cron$;
