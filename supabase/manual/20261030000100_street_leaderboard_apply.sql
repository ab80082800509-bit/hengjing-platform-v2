-- =============================================================================
-- 第七階段第 8 批正式套用版：夢想商店街社交排行榜（好友互助排行、趣味偷貨排行）。
-- 狀態：待站長確認，尚未執行。確認前不得在正式 Supabase 執行。
-- 先跑 20261030000000_street_leaderboard_readonly_check.sql，batch8_gate 顯示可以套用才執行本檔。
--
-- 依賴第 5 批：member_street_exhibits（是否公開）、street_taipei_day、street_public_identity。
-- 依賴第 6 批：member_street_friends（好友關係）、member_street_helps（有效互助紀錄）。
-- 依賴第 7 批：member_street_steals（偷貨成功／失敗紀錄）。
-- 第 5～7 批的表、函式、觸發器與權限一律不改。
--
-- 對正式資料的影響：
--   只新增一個唯讀函式 get_street_leaderboard(text, text, text)。
--   不新增資料表、索引或觸發器，不寫入、不修改、不刪除任何資料列。
--   函式宣告為 STABLE，資料庫本身就不允許它寫入。整份包在單一交易。
--
-- 規則：
--   1. 成績全部由資料庫從既有紀錄即時統計，函式不接受任何分數、名次或會員編號參數；
--      查詢者身分只取 auth.uid()。
--   2. 好友互助排行：每一列 member_street_helps 算一次「幫忙」。第 6 批已保證每位幫手每台北日
--      對同一位好友最多一列、同一把 request_key 只記一列、不能幫自己，所以重送、並發與自刷都不會多算。
--      附帶顯示「被幫忙次數」。
--   3. 趣味偷貨排行：只把 outcome = 'success' 算成成功次數；'miss' 另外計算為失敗次數，不計入名次。
--      第 7 批已保證同一把 request_key 只記一列、不能偷自己。
--   4. 每週以 Asia/Taipei 週一 00:00 起算，依紀錄上的 help_day／steal_day 歸週，與方塊大挑戰週榜相同。
--      原始紀錄有觸發器保護，不能修改或刪除（只有會員帳號刪除時外鍵連動清除），
--      所以任何一週的週榜都能由原始紀錄重算出同一份結果；不另存快照，不會因週期切換而錯亂或重複累計。
--      可查本週、上週與累計。
--   5. 同分規則固定：成績高者在前；同分時，先達到該成績的（最後一筆計分紀錄時間較早）在前；
--      再同分依會員編號排序。名次為 1、2、3… 不重複。
--   6. 全站榜只列出「商店街已公開、且成績大於 0」的會員，每位查詢者看到的名次一致。
--      未公開的會員不會出現在全站榜，排行榜也不會替任何人打開商店街。
--      查詢者自己若未公開，只回傳自己的成績，並標示未列入。
--   7. 好友榜只列出自己與 member_street_friends 中 status = 'accepted' 的好友，沿用第 6 批好友關係。
--   8. 回傳欄位只有名次、成績、公開暱稱與頭像（由 street_public_identity 過濾）。
--      會員編號只在對方商店街已公開時回傳，供前往其公開商店街。不回傳 Email、電話、地址、金幣或存檔。
--   9. 商店街經營排行不在本檔：伺服器上沒有可信的經營數據（等級、店面來自瀏覽器存檔），不製造排名。
--  10. 不呼叫 post_member_reward，不讀寫 member_point_*、reward_claims，不發放任何獎勵。
-- =============================================================================

BEGIN;

DO $require_street_batch7$
BEGIN
  IF pg_catalog.to_regclass('public.member_street_exhibits') IS NULL
     OR pg_catalog.to_regprocedure('public.street_taipei_day(timestamptz)') IS NULL
     OR pg_catalog.to_regprocedure('public.street_public_identity(uuid)') IS NULL THEN
    RAISE EXCEPTION '需要先完整套用第七階段第 5 批 20261029220100_street_social_apply.sql';
  END IF;
  IF pg_catalog.to_regclass('public.member_street_friends') IS NULL
     OR pg_catalog.to_regclass('public.member_street_helps') IS NULL THEN
    RAISE EXCEPTION '需要先完整套用第七階段第 6 批 20261029220200_street_friend_help_apply.sql';
  END IF;
  IF pg_catalog.to_regclass('public.member_street_steals') IS NULL THEN
    RAISE EXCEPTION '需要先完整套用第七階段第 7 批 20261029230100_street_steal_explore_apply.sql';
  END IF;
  IF (
    SELECT count(*) FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND (
        (c.table_name = 'member_street_helps' AND c.column_name IN ('helper_id', 'owner_id', 'help_day', 'created_at'))
        OR (c.table_name = 'member_street_steals' AND c.column_name IN ('thief_id', 'steal_day', 'outcome', 'created_at'))
        OR (c.table_name = 'member_street_friends' AND c.column_name IN ('user_low', 'user_high', 'status'))
        OR (c.table_name = 'member_street_exhibits' AND c.column_name IN ('user_id', 'published'))
      )
  ) <> 13 THEN
    RAISE EXCEPTION '第 5～7 批資料表欄位與排行榜不相容，本檔不修改既有資料表';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = proc.pronamespace
    WHERE nsp.nspname = 'public' AND proc.proname = 'get_street_leaderboard'
  ) THEN
    RAISE EXCEPTION '第 8 批同名函式已存在。為避免覆蓋正式函式，本檔停止';
  END IF;
END
$require_street_batch7$;

CREATE OR REPLACE FUNCTION public.get_street_leaderboard(p_board text, p_scope text, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := public.street_taipei_day(pg_catalog.now());
  v_week date;
  v_from date;
  v_to date;
  v_rows jsonb;
  v_me jsonb;
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF p_board IS NULL OR p_board NOT IN ('help', 'steal')
     OR p_scope IS NULL OR p_scope NOT IN ('global', 'friends')
     OR p_period IS NULL OR p_period NOT IN ('week', 'last_week', 'all') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  v_week := v_today - (EXTRACT(isodow FROM v_today)::integer - 1);
  IF p_period = 'week' THEN
    v_from := v_week;
    v_to := v_week + 6;
  ELSIF p_period = 'last_week' THEN
    v_from := v_week - 7;
    v_to := v_week - 1;
  END IF;

  WITH help_given AS (
    SELECT h.helper_id AS member, count(*)::integer AS score, max(h.created_at) AS reached_at
    FROM public.member_street_helps AS h
    WHERE p_board = 'help' AND (v_from IS NULL OR h.help_day BETWEEN v_from AND v_to)
    GROUP BY h.helper_id
  ), help_received AS (
    SELECT h.owner_id AS member, count(*)::integer AS n
    FROM public.member_street_helps AS h
    WHERE p_board = 'help' AND (v_from IS NULL OR h.help_day BETWEEN v_from AND v_to)
    GROUP BY h.owner_id
  ), steal_stats AS (
    SELECT s.thief_id AS member,
      (count(*) FILTER (WHERE s.outcome = 'success'))::integer AS score,
      (count(*) FILTER (WHERE s.outcome = 'miss'))::integer AS miss,
      max(s.created_at) FILTER (WHERE s.outcome = 'success') AS reached_at
    FROM public.member_street_steals AS s
    WHERE p_board = 'steal' AND (v_from IS NULL OR s.steal_day BETWEEN v_from AND v_to)
    GROUP BY s.thief_id
  ), circle AS (
    SELECT v_uid AS member
    UNION
    SELECT CASE WHEN f.user_low = v_uid THEN f.user_high ELSE f.user_low END
    FROM public.member_street_friends AS f
    WHERE p_scope = 'friends' AND f.status = 'accepted' AND (f.user_low = v_uid OR f.user_high = v_uid)
    UNION
    SELECT g.member FROM help_given AS g WHERE p_scope = 'global' AND g.score > 0
    UNION
    SELECT x.member FROM steal_stats AS x WHERE p_scope = 'global' AND x.score > 0
  ), scored AS (
    SELECT c.member,
      CASE WHEN p_board = 'help' THEN coalesce(g.score, 0) ELSE coalesce(x.score, 0) END AS score,
      CASE WHEN p_board = 'help' THEN coalesce(r.n, 0) ELSE coalesce(x.miss, 0) END AS extra,
      CASE WHEN p_board = 'help' THEN g.reached_at ELSE x.reached_at END AS reached_at,
      EXISTS (SELECT 1 FROM public.member_street_exhibits AS e WHERE e.user_id = c.member AND e.published) AS published
    FROM circle AS c
    LEFT JOIN help_given AS g ON g.member = c.member
    LEFT JOIN help_received AS r ON r.member = c.member
    LEFT JOIN steal_stats AS x ON x.member = c.member
  ), ranked AS (
    SELECT sc.member,
      (row_number() OVER (ORDER BY sc.score DESC, sc.reached_at ASC NULLS LAST, sc.member ASC))::integer AS place
    FROM scored AS sc
    WHERE p_scope = 'friends' OR (sc.published AND sc.score > 0)
  ), joined AS (
    SELECT sc.*, rk.place
    FROM scored AS sc
    LEFT JOIN ranked AS rk ON rk.member = sc.member
  )
  SELECT
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'rank', j.place,
        'score', j.score,
        'extra', j.extra,
        'me', j.member = v_uid,
        'published', j.published,
        'userId', CASE WHEN j.published THEN j.member ELSE NULL END
      ) || public.street_public_identity(j.member)
      ORDER BY j.place
    ) FILTER (WHERE j.place <= 50), '[]'::jsonb),
    (count(*) FILTER (WHERE j.place IS NOT NULL))::integer,
    (pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'rank', j.place,
      'score', j.score,
      'extra', j.extra,
      'listed', j.place IS NOT NULL,
      'published', j.published
    )) FILTER (WHERE j.member = v_uid)) -> 0
  INTO v_rows, v_total, v_me
  FROM joined AS j;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'board', p_board,
    'scope', p_scope,
    'period', p_period,
    'weekStart', v_from,
    'weekEnd', v_to,
    'nextWeekAt', ((v_week + 7)::timestamp AT TIME ZONE 'Asia/Taipei'),
    'total', v_total,
    'rows', v_rows,
    'me', v_me
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_street_leaderboard(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_street_leaderboard(text, text, text) TO authenticated;

COMMENT ON FUNCTION public.get_street_leaderboard(text, text, text) IS
  '夢想商店街社交排行榜。只讀第 6 批互助與第 7 批偷貨的原始紀錄即時統計，不寫入、不發獎。全站榜只列已公開商店街的會員。';

-- ---------------------------------------------------------------------------
-- 自我檢查
-- ---------------------------------------------------------------------------

DO $street_board_self_check$
DECLARE
  fn constant text := 'public.get_street_leaderboard(text, text, text)';
  def text;
BEGIN
  def := pg_catalog.pg_get_functiondef(fn::regprocedure);
  IF position('post_member_reward' IN def) > 0 OR position('member_point' IN def) > 0
     OR position('reward_claims' IN def) > 0 OR position('member_perk' IN def) > 0
     OR position('INSERT ' IN pg_catalog.upper(def)) > 0 OR position('UPDATE ' IN pg_catalog.upper(def)) > 0
     OR position('DELETE ' IN pg_catalog.upper(def)) > 0 THEN
    RAISE EXCEPTION '排行榜不能寫入資料或碰 Pay 點數、獎勵';
  END IF;
  IF has_function_privilege('anon', fn, 'EXECUTE') THEN
    RAISE EXCEPTION '訪客不能執行排行榜';
  END IF;
  IF NOT has_function_privilege('authenticated', fn, 'EXECUTE') THEN
    RAISE EXCEPTION '已登入會員應可執行排行榜';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = fn::regprocedure
      AND (
        proc.prosecdef IS NOT TRUE
        OR proc.provolatile <> 's'
        OR NOT ('search_path=pg_catalog' = ANY (COALESCE(proc.proconfig, ARRAY[]::text[])))
      )
  ) THEN
    RAISE EXCEPTION '排行榜函式必須是 SECURITY DEFINER、STABLE，並固定 search_path = pg_catalog';
  END IF;
END
$street_board_self_check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
