-- =============================================================================
-- 第七階段第 9 批：成就守門函式最小修復（移除 preview 留下的 game.reward_cleanup 刪除後門）。
-- 在正式 Supabase SQL Editor 整份執行。只重建 public.guard_game_achievement_write()，
-- 定義與 20261030030010_stage6_rewards_achievements_apply.sql 安全版完全相同。
-- 不重跑第六階段、不改觸發器、資料表、權限、點數、商城、成就紀錄或會員資料。
-- 前置檢查或自我檢查任一失敗都會整筆 ROLLBACK，資料庫維持原狀。
-- 執行後再跑 20261030030250_game_achievements_v2_readonly_check.sql 確認 guard_has_no_backdoor = true。
-- =============================================================================

BEGIN;

DO $guard_fix_precheck$
DECLARE
  fn regprocedure := to_regprocedure('public.guard_game_achievement_write()');
  preview_src constant text := $src$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('game.reward_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF current_setting('game.achievement', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '遊戲成就只能由同步交易更新';
  END IF;
  IF TG_TABLE_NAME = 'member_game_achievements' AND TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '已解鎖的成就不可修改或刪除';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '展示設定不可刪除';
  END IF;
  RETURN NEW;
END;
$src$;
  p pg_proc%ROWTYPE;
BEGIN
  IF fn IS NULL THEN
    RAISE EXCEPTION '找不到 public.guard_game_achievement_write()，停止';
  END IF;
  SELECT * INTO p FROM pg_proc WHERE oid = fn;
  IF position('reward_cleanup' IN p.prosrc) = 0 THEN
    RAISE EXCEPTION '守門函式已沒有刪除後門，不需要再執行本檔';
  END IF;
  IF btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')) <> btrim(regexp_replace(preview_src, '\s+', ' ', 'g')) THEN
    RAISE EXCEPTION '守門函式內容與 preview 原檔不同（可能被其他人改過），停止並回報';
  END IF;
  IF p.prosecdef OR p.prorettype <> 'trigger'::regtype
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
    RAISE EXCEPTION '守門函式屬性與預期不同，停止並回報';
  END IF;
  IF (
    SELECT count(*) FROM pg_trigger
    WHERE NOT tgisinternal AND tgfoid = fn AND tgenabled <> 'D'
      AND (tgname, tgrelid) IN (
        ('member_game_achievements_guard', 'public.member_game_achievements'::regclass),
        ('member_game_showcase_guard', 'public.member_game_showcase'::regclass)
      )
  ) <> 2 THEN
    RAISE EXCEPTION '成就守門觸發器狀態與預期不同，停止並回報';
  END IF;

  PERFORM set_config('guard_fix.owner', p.proowner::text, true);
  PERFORM set_config('guard_fix.acl', coalesce(p.proacl::text, ''), true);
  PERFORM set_config('guard_fix.triggers', (
    SELECT string_agg(tgname || ':' || tgrelid::regclass::text || ':' || tgtype::text || ':' || tgenabled::text, ',' ORDER BY tgname)
    FROM pg_trigger WHERE NOT tgisinternal AND tgfoid = fn
  ), true);
  PERFORM set_config('guard_fix.data', concat_ws(':',
    (SELECT count(*) FROM public.member_game_achievements),
    (SELECT count(*) FROM public.member_game_showcase),
    (SELECT count(*) FROM public.game_achievement_catalog),
    (SELECT count(*) FROM auth.users)
  ), true);
END
$guard_fix_precheck$;

CREATE OR REPLACE FUNCTION public.guard_game_achievement_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF current_setting('game.achievement', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '遊戲成就只能由同步交易更新';
  END IF;
  IF TG_TABLE_NAME = 'member_game_achievements' AND TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '已解鎖的成就不可修改或刪除';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '展示設定不可刪除';
  END IF;
  RETURN NEW;
END;
$$;

DO $guard_fix_self_check$
DECLARE
  fn regprocedure := 'public.guard_game_achievement_write()'::regprocedure;
  p pg_proc%ROWTYPE;
  blocked text;
BEGIN
  SELECT * INTO p FROM pg_proc WHERE oid = fn;
  IF position('reward_cleanup' IN p.prosrc) > 0 THEN
    RAISE EXCEPTION '刪除後門仍在';
  END IF;
  IF p.proowner::text IS DISTINCT FROM current_setting('guard_fix.owner', true)
     OR coalesce(p.proacl::text, '') IS DISTINCT FROM current_setting('guard_fix.acl', true)
     OR p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
    RAISE EXCEPTION '守門函式擁有者、權限或屬性被改動';
  END IF;
  IF (
    SELECT string_agg(tgname || ':' || tgrelid::regclass::text || ':' || tgtype::text || ':' || tgenabled::text, ',' ORDER BY tgname)
    FROM pg_trigger WHERE NOT tgisinternal AND tgfoid = fn
  ) IS DISTINCT FROM current_setting('guard_fix.triggers', true) THEN
    RAISE EXCEPTION '成就守門觸發器被改動';
  END IF;

  -- 用同名暫存表實測守門行為，不碰正式成就資料；暫存表在本區塊結束前刪除。
  CREATE TEMP TABLE member_game_achievements (x integer) ON COMMIT DROP;
  CREATE TEMP TABLE member_game_showcase (x integer) ON COMMIT DROP;
  CREATE TRIGGER guard_fix_probe_a BEFORE INSERT OR UPDATE OR DELETE ON pg_temp.member_game_achievements
    FOR EACH ROW EXECUTE FUNCTION public.guard_game_achievement_write();
  CREATE TRIGGER guard_fix_probe_s BEFORE INSERT OR UPDATE OR DELETE ON pg_temp.member_game_showcase
    FOR EACH ROW EXECUTE FUNCTION public.guard_game_achievement_write();

  PERFORM set_config('game.reward_cleanup', 'off', true);
  PERFORM set_config('game.achievement', 'off', true);
  BEGIN
    INSERT INTO pg_temp.member_game_achievements VALUES (1);
    blocked := 'none';
  EXCEPTION WHEN raise_exception THEN
    blocked := SQLERRM;
  END;
  IF blocked IS DISTINCT FROM '遊戲成就只能由同步交易更新' THEN
    RAISE EXCEPTION '同步交易以外寫入成就沒有被擋下（%）', blocked;
  END IF;

  PERFORM set_config('game.achievement', 'on', true);
  INSERT INTO pg_temp.member_game_achievements VALUES (1);
  INSERT INTO pg_temp.member_game_showcase VALUES (1);
  UPDATE pg_temp.member_game_showcase SET x = 2;

  PERFORM set_config('game.reward_cleanup', 'on', true);
  BEGIN
    DELETE FROM pg_temp.member_game_achievements;
    blocked := 'none';
  EXCEPTION WHEN raise_exception THEN
    blocked := SQLERRM;
  END;
  IF blocked IS DISTINCT FROM '已解鎖的成就不可修改或刪除' THEN
    RAISE EXCEPTION 'reward_cleanup 仍能刪除成就（%）', blocked;
  END IF;
  BEGIN
    DELETE FROM pg_temp.member_game_showcase;
    blocked := 'none';
  EXCEPTION WHEN raise_exception THEN
    blocked := SQLERRM;
  END;
  IF blocked IS DISTINCT FROM '展示設定不可刪除' THEN
    RAISE EXCEPTION 'reward_cleanup 仍能刪除展示勳章（%）', blocked;
  END IF;
  PERFORM set_config('game.achievement', 'off', true);
  BEGIN
    DELETE FROM pg_temp.member_game_achievements;
    blocked := 'none';
  EXCEPTION WHEN raise_exception THEN
    blocked := SQLERRM;
  END;
  IF blocked IS DISTINCT FROM '遊戲成就只能由同步交易更新' THEN
    RAISE EXCEPTION 'reward_cleanup 仍能繞過同步交易（%）', blocked;
  END IF;
  PERFORM set_config('game.reward_cleanup', 'off', true);

  DROP TABLE pg_temp.member_game_achievements;
  DROP TABLE pg_temp.member_game_showcase;

  IF concat_ws(':',
    (SELECT count(*) FROM public.member_game_achievements),
    (SELECT count(*) FROM public.member_game_showcase),
    (SELECT count(*) FROM public.game_achievement_catalog),
    (SELECT count(*) FROM auth.users)
  ) IS DISTINCT FROM current_setting('guard_fix.data', true) THEN
    RAISE EXCEPTION '成就、展示勳章或會員筆數在修復中發生變化，停止';
  END IF;
  RAISE NOTICE '成就守門函式已移除刪除後門；擁有者、權限、觸發器與資料不變';
END
$guard_fix_self_check$;

COMMIT;
