-- 第七階段第 2 批提案：方塊大挑戰每週排行榜。
-- 狀態：提案，尚未執行。須經站長核准後，只在本機隔離 Supabase 套用驗證，不得直接套用正式專案。
-- 依賴：auth.users、public.profiles(id, public_nickname)。不依賴第六階段遊戲獎勵預覽。
--
-- 設計：
--   1. 排行賽種子由伺服器發（start_block_ranked_run），瀏覽器只能送「每一步」[欄位, 行, 列]。
--   2. submit_block_ranked_run 以 block_replay 在資料庫內從頭重算整局；分數、消除、連擊全部以重算結果為準，不收前端分數。
--   3. 每場只能送一次。重送、竄改步驟、未結束、過快或超過 24 小時的送出都會被拒絕並留下紀錄。
--   4. 每週以 Asia/Taipei 週一 00:00 起算，與 game_reward_period('weekly') 相同；成績歸入開局那一週。
--   5. 公開榜單只回傳名次、公開暱稱、分數、消除與連擊；不回傳會員編號、Email 或其他私人資料。
--   6. 不寫 Pay 點數帳本、Inventory、成就、勳章或任何獎勵表。
-- 一致性：scripts/check-block-modes.ts 會比對本檔的形狀表與重算範例是否和 lib/arcade/block-rules.ts 相同。

BEGIN;

CREATE TABLE IF NOT EXISTS public.block_ranked_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  seed integer NOT NULL,
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  move_log jsonb,
  score integer,
  lines integer,
  best_combo integer,
  moves integer,
  reject_reason text,
  CONSTRAINT block_ranked_runs_status_check CHECK (status IN ('open', 'verified', 'rejected', 'abandoned')),
  CONSTRAINT block_ranked_runs_verified_check CHECK (
    status <> 'verified' OR (score IS NOT NULL AND score >= 0 AND move_log IS NOT NULL AND submitted_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS block_ranked_runs_one_open
  ON public.block_ranked_runs (user_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS block_ranked_runs_week_board
  ON public.block_ranked_runs (week_start, score DESC) WHERE status = 'verified';
CREATE INDEX IF NOT EXISTS block_ranked_runs_user_recent
  ON public.block_ranked_runs (user_id, started_at DESC);

-- 不開任何政策：會員不能直接讀寫，只能透過下面的函式。
ALTER TABLE public.block_ranked_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.block_ranked_runs FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 規則重算：與 lib/arcade/block-rules.ts 的 newBlockGame / placePiece 相同
-- ---------------------------------------------------------------------------

-- Math.imul 的無號 32 位元版本。
CREATE OR REPLACE FUNCTION public.block_imul(a bigint, b bigint)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT (((a & 65535) * b) + ((((a >> 16) * b) & 65535) << 16)) & 4294967295
$$;

-- mulberry32：回傳 [下一個狀態, 32 位元輸出]，皆為無號值。
CREATE OR REPLACE FUNCTION public.block_rng_next(p_state bigint)
RETURNS bigint[]
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
DECLARE
  s bigint := (p_state + 1831565813) & 4294967295;
  t bigint := s;
BEGIN
  t := public.block_imul(t # (t >> 15), t | 1);
  t := t # ((t + public.block_imul(t # (t >> 7), t | 61)) & 4294967295);
  RETURN ARRAY[s, t # (t >> 14)];
END;
$$;

CREATE OR REPLACE FUNCTION public.block_tray_fits(p_board integer[], p_tray integer[], p_starts integer[], p_lens integer[], p_cells integer[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  i integer;
  r integer;
  c integer;
  j integer;
  sh integer;
  rr integer;
  cc integer;
  ok boolean;
BEGIN
  FOR i IN 1 .. 3 LOOP
    sh := p_tray[i];
    CONTINUE WHEN sh = 0;
    FOR r IN 0 .. 7 LOOP
      FOR c IN 0 .. 7 LOOP
        ok := true;
        FOR j IN 0 .. p_lens[sh] - 1 LOOP
          rr := r + p_cells[p_starts[sh] + 2 * j];
          cc := c + p_cells[p_starts[sh] + 2 * j + 1];
          IF rr > 7 OR cc > 7 THEN
            ok := false;
            EXIT;
          END IF;
          IF p_board[rr * 8 + cc + 1] <> 0 THEN
            ok := false;
            EXIT;
          END IF;
        END LOOP;
        IF ok THEN
          RETURN true;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_replay(p_seed integer, p_moves jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  -- [權重, [r0, c0, r1, c1, ...]]，順序必須與 BLOCK_SHAPES 相同。
  -- BLOCK_SHAPES:BEGIN
  shapes jsonb := '[[3,[0,0]],[5,[0,0,0,1]],[5,[0,0,1,0]],[6,[0,0,0,1,0,2]],[6,[0,0,1,0,2,0]],[4,[0,0,0,1,0,2,0,3]],[4,[0,0,1,0,2,0,3,0]],[2,[0,0,0,1,0,2,0,3,0,4]],[2,[0,0,1,0,2,0,3,0,4,0]],[6,[0,0,0,1,1,0,1,1]],[2,[0,0,0,1,0,2,1,0,1,1,1,2,2,0,2,1,2,2]],[3,[0,0,0,1,0,2,1,0,1,1,1,2]],[3,[0,0,0,1,1,0,1,1,2,0,2,1]],[4,[0,0,0,1,1,0]],[4,[0,0,0,1,1,1]],[4,[0,0,1,0,1,1]],[4,[0,1,1,0,1,1]],[2,[0,0,0,1,0,2,1,0,2,0]],[2,[0,0,0,1,0,2,1,2,2,2]],[2,[0,0,1,0,2,0,2,1,2,2]],[2,[0,2,1,2,2,0,2,1,2,2]],[3,[0,0,1,0,2,0,2,1]],[3,[0,0,0,1,0,2,1,0]],[3,[0,0,0,1,1,1,2,1]],[3,[0,2,1,0,1,1,1,2]],[3,[0,1,1,1,2,0,2,1]],[3,[0,0,1,0,1,1,1,2]],[3,[0,0,0,1,1,0,2,0]],[3,[0,0,0,1,0,2,1,2]],[3,[0,0,0,1,0,2,1,1]],[3,[0,1,1,0,1,1,1,2]],[3,[0,0,1,0,1,1,2,0]],[3,[0,1,1,0,1,1,2,1]],[2,[0,1,0,2,1,0,1,1]],[2,[0,0,1,0,1,1,2,1]],[2,[0,0,0,1,1,1,1,2]],[2,[0,1,1,0,1,1,2,0]]]';
  -- BLOCK_SHAPES:END
  n_shapes integer;
  weights integer[] := ARRAY[]::integer[];
  starts integer[] := ARRAY[]::integer[];
  lens integer[] := ARRAY[]::integer[];
  cells integer[] := ARRAY[]::integer[];
  total integer := 0;
  board integer[] := array_fill(0, ARRAY[64]);
  tray integer[] := ARRAY[0, 0, 0];
  rng bigint := p_seed::bigint & 4294967295;
  roll bigint[];
  cum integer;
  pick integer;
  n_moves integer;
  mv jsonb;
  slot integer;
  prow integer;
  pcol integer;
  r integer;
  c integer;
  i integer;
  j integer;
  k integer;
  attempt integer;
  sh integer;
  full_rows boolean[];
  full_cols boolean[];
  line_n integer;
  combo integer := 0;
  combo_left integer := 0;
  best_combo integer := 0;
  score integer := 0;
  total_lines integer := 0;
  moves integer := 0;
BEGIN
  n_shapes := jsonb_array_length(shapes);
  FOR i IN 0 .. n_shapes - 1 LOOP
    weights := weights || (shapes -> i ->> 0)::integer;
    starts := starts || (coalesce(array_length(cells, 1), 0) + 1);
    lens := lens || (jsonb_array_length(shapes -> i -> 1) / 2);
    FOR j IN 0 .. jsonb_array_length(shapes -> i -> 1) - 1 LOOP
      cells := cells || (shapes -> i -> 1 ->> j)::integer;
    END LOOP;
    total := total + (shapes -> i ->> 0)::integer;
  END LOOP;

  IF jsonb_typeof(p_moves) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'format');
  END IF;
  n_moves := jsonb_array_length(p_moves);

  FOR k IN 0 .. n_moves LOOP
    -- 開局或三塊都用完時補牌；盡量讓至少一塊放得下，最多重抽 12 次。
    IF tray[1] = 0 AND tray[2] = 0 AND tray[3] = 0 THEN
      FOR attempt IN 0 .. 11 LOOP
        FOR i IN 1 .. 3 LOOP
          roll := public.block_rng_next(rng);
          rng := roll[1];
          cum := 0;
          pick := 1;
          FOR sh IN 1 .. n_shapes LOOP
            cum := cum + weights[sh];
            IF roll[2] * total < cum::bigint * 4294967296 THEN
              pick := sh;
              EXIT;
            END IF;
          END LOOP;
          -- 顏色亂數只影響外觀，但必須照樣消耗。
          roll := public.block_rng_next(rng);
          rng := roll[1];
          tray[i] := pick;
        END LOOP;
        EXIT WHEN public.block_tray_fits(board, tray, starts, lens, cells);
      END LOOP;
    END IF;

    EXIT WHEN k = n_moves;

    mv := p_moves -> k;
    IF jsonb_typeof(mv) IS DISTINCT FROM 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'format', 'at', k);
    END IF;
    IF jsonb_array_length(mv) <> 3 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'format', 'at', k);
    END IF;
    IF jsonb_typeof(mv -> 0) <> 'number' OR jsonb_typeof(mv -> 1) <> 'number' OR jsonb_typeof(mv -> 2) <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'format', 'at', k);
    END IF;
    IF (mv ->> 0) !~ '^[0-9]{1,2}$' OR (mv ->> 1) !~ '^[0-9]{1,2}$' OR (mv ->> 2) !~ '^[0-9]{1,2}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'blocked', 'at', k);
    END IF;
    slot := (mv ->> 0)::integer;
    prow := (mv ->> 1)::integer;
    pcol := (mv ->> 2)::integer;
    IF slot > 2 OR prow > 7 OR pcol > 7 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'blocked', 'at', k);
    END IF;
    sh := tray[slot + 1];
    IF sh = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing', 'at', k);
    END IF;

    FOR j IN 0 .. lens[sh] - 1 LOOP
      r := prow + cells[starts[sh] + 2 * j];
      c := pcol + cells[starts[sh] + 2 * j + 1];
      IF r > 7 OR c > 7 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'blocked', 'at', k);
      END IF;
      IF board[r * 8 + c + 1] <> 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'blocked', 'at', k);
      END IF;
    END LOOP;
    FOR j IN 0 .. lens[sh] - 1 LOOP
      board[(prow + cells[starts[sh] + 2 * j]) * 8 + pcol + cells[starts[sh] + 2 * j + 1] + 1] := 1;
    END LOOP;

    full_rows := array_fill(true, ARRAY[8]);
    full_cols := array_fill(true, ARRAY[8]);
    FOR r IN 0 .. 7 LOOP
      FOR c IN 0 .. 7 LOOP
        IF board[r * 8 + c + 1] = 0 THEN
          full_rows[r + 1] := false;
          full_cols[c + 1] := false;
        END IF;
      END LOOP;
    END LOOP;
    line_n := 0;
    FOR i IN 1 .. 8 LOOP
      IF full_rows[i] THEN line_n := line_n + 1; END IF;
      IF full_cols[i] THEN line_n := line_n + 1; END IF;
    END LOOP;
    FOR r IN 0 .. 7 LOOP
      FOR c IN 0 .. 7 LOOP
        IF full_rows[r + 1] OR full_cols[c + 1] THEN
          board[r * 8 + c + 1] := 0;
        END IF;
      END LOOP;
    END LOOP;

    IF line_n > 0 THEN
      combo := combo + 1;
      combo_left := 3;
    ELSIF combo_left > 0 THEN
      combo_left := combo_left - 1;
      IF combo_left = 0 THEN
        combo := 0;
      END IF;
    END IF;

    score := score + lens[sh] + 50 * line_n * (line_n + 1)
      + CASE WHEN line_n > 0 AND combo > 1 THEN 50 * (combo - 1) * line_n ELSE 0 END
      + CASE WHEN line_n > 0 AND NOT (1 = ANY (board)) THEN 300 ELSE 0 END;
    best_combo := greatest(best_combo, combo);
    total_lines := total_lines + line_n;
    moves := moves + 1;
    tray[slot + 1] := 0;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'over', NOT public.block_tray_fits(board, tray, starts, lens, cells),
    'score', score,
    'lines', total_lines,
    'bestCombo', best_combo,
    'moves', moves
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 排行賽開局與送出
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_block_ranked_run()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_week date;
  v_seed integer;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('block_ranked_runs:' || v_uid::text));
  IF (SELECT count(*) FROM public.block_ranked_runs WHERE user_id = v_uid AND started_at > now() - interval '1 hour') >= 40 THEN
    RAISE EXCEPTION '排行賽開局太頻繁，請稍後再試';
  END IF;
  UPDATE public.block_ranked_runs SET status = 'abandoned' WHERE user_id = v_uid AND status = 'open';
  v_week := v_day - (extract(isodow FROM v_day)::integer - 1);
  v_seed := ('x' || substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8))::bit(32)::integer;
  INSERT INTO public.block_ranked_runs (user_id, seed, week_start)
  VALUES (v_uid, v_seed, v_week)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('runId', v_id, 'seed', v_seed, 'weekStart', v_week);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_block_ranked_run(p_run_id uuid, p_moves jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_run public.block_ranked_runs%ROWTYPE;
  v_result jsonb;
  v_count integer;
  v_reason text;
  v_rank integer;
  v_best integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  SELECT * INTO v_run FROM public.block_ranked_runs WHERE id = p_run_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這場排行賽';
  END IF;
  IF v_run.status <> 'open' THEN
    RETURN jsonb_build_object('status', 'duplicate', 'reason', 'already_closed');
  END IF;

  IF jsonb_typeof(p_moves) IS DISTINCT FROM 'array' THEN
    v_reason := 'format';
  ELSE
    v_count := jsonb_array_length(p_moves);
    IF v_count = 0 OR v_count > 3000 THEN
      v_reason := 'format';
    ELSIF now() - v_run.started_at > interval '24 hours' THEN
      v_reason := 'expired';
    ELSIF now() - v_run.started_at < v_count * interval '250 milliseconds' THEN
      v_reason := 'too_fast';
    END IF;
  END IF;
  IF v_reason IS NULL THEN
    v_result := public.block_replay(v_run.seed, p_moves);
    IF NOT (v_result ->> 'ok')::boolean THEN
      v_reason := 'illegal_move';
    ELSIF NOT (v_result ->> 'over')::boolean THEN
      v_reason := 'not_finished';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    UPDATE public.block_ranked_runs
    SET status = 'rejected',
        submitted_at = now(),
        reject_reason = v_reason,
        move_log = CASE WHEN v_reason = 'format' THEN NULL ELSE p_moves END
    WHERE id = v_run.id;
    RETURN jsonb_build_object('status', 'rejected', 'reason', v_reason);
  END IF;

  UPDATE public.block_ranked_runs
  SET status = 'verified',
      submitted_at = now(),
      move_log = p_moves,
      score = (v_result ->> 'score')::integer,
      lines = (v_result ->> 'lines')::integer,
      best_combo = (v_result ->> 'bestCombo')::integer,
      moves = (v_result ->> 'moves')::integer
  WHERE id = v_run.id;

  SELECT ranked.place, ranked.best INTO v_rank, v_best
  FROM (
    SELECT best_runs.user_id, best_runs.best, rank() OVER (ORDER BY best_runs.best DESC) AS place
    FROM (
      SELECT runs.user_id, max(runs.score) AS best
      FROM public.block_ranked_runs AS runs
      WHERE runs.week_start = v_run.week_start AND runs.status = 'verified'
      GROUP BY runs.user_id
    ) AS best_runs
  ) AS ranked
  WHERE ranked.user_id = v_uid;

  RETURN jsonb_build_object(
    'status', 'verified',
    'score', (v_result ->> 'score')::integer,
    'lines', (v_result ->> 'lines')::integer,
    'bestCombo', (v_result ->> 'bestCombo')::integer,
    'weekStart', v_run.week_start,
    'rank', v_rank,
    'weekBest', v_best
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 公開榜單：本週或上週，前 50 名＋自己的名次
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_block_weekly_board(p_week_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_week date;
  v_rows jsonb;
  v_me jsonb;
  v_total integer;
BEGIN
  IF p_week_offset IS NULL OR p_week_offset NOT IN (0, -1) THEN
    RAISE EXCEPTION '只能查詢本週或上週';
  END IF;
  v_week := v_day - (extract(isodow FROM v_day)::integer - 1) + 7 * p_week_offset;

  WITH best_runs AS (
    SELECT DISTINCT ON (runs.user_id) runs.user_id, runs.score, runs.lines, runs.best_combo, runs.submitted_at
    FROM public.block_ranked_runs AS runs
    WHERE runs.week_start = v_week AND runs.status = 'verified'
    ORDER BY runs.user_id, runs.score DESC, runs.submitted_at ASC
  ), ranked AS (
    SELECT best_runs.*,
      rank() OVER (ORDER BY best_runs.score DESC) AS place,
      row_number() OVER (ORDER BY best_runs.score DESC, best_runs.submitted_at ASC) AS ord
    FROM best_runs
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'rank', ranked.place,
      'nickname', coalesce(nullif(btrim(profile.public_nickname), ''), '匿名玩家'),
      'score', ranked.score,
      'lines', ranked.lines,
      'bestCombo', ranked.best_combo,
      'me', v_uid IS NOT NULL AND ranked.user_id = v_uid
    ) ORDER BY ranked.ord) FILTER (WHERE ranked.ord <= 50), '[]'::jsonb),
    (jsonb_agg(jsonb_build_object('rank', ranked.place, 'score', ranked.score, 'lines', ranked.lines, 'bestCombo', ranked.best_combo))
      FILTER (WHERE v_uid IS NOT NULL AND ranked.user_id = v_uid)) -> 0,
    count(*)::integer
  INTO v_rows, v_me, v_total
  FROM ranked
  LEFT JOIN public.profiles AS profile ON profile.id = ranked.user_id;

  RETURN jsonb_build_object(
    'weekStart', v_week,
    'weekEnd', v_week + 6,
    'total', v_total,
    'rows', v_rows,
    'me', v_me,
    'signedIn', v_uid IS NOT NULL
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 權限
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.block_imul(bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_rng_next(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_tray_fits(integer[], integer[], integer[], integer[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_replay(integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_block_ranked_run() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_block_ranked_run(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_block_weekly_board(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_block_ranked_run() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_block_ranked_run(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_block_weekly_board(integer) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 自我檢查：資料庫重算必須與前端規則逐分相同，否則整批回滾。
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  -- BLOCK_VECTOR seed=-1234567 score=2194 lines=13 combo=4
  v jsonb := public.block_replay(-1234567, '[[0,0,0],[1,0,1],[2,0,3],[0,2,1],[1,0,6],[2,0,0],[0,2,5],[1,0,6],[2,0,2],[0,0,4],[1,3,0],[2,3,2],[0,0,7],[1,0,0],[2,0,2],[0,5,2],[1,2,0],[2,0,5],[0,4,5],[1,2,2],[2,2,2],[0,0,2],[1,2,3],[2,4,2],[0,4,4],[1,3,0],[2,5,0],[0,0,0],[1,0,3],[2,5,1],[0,1,1],[1,1,0],[2,1,2],[0,3,0],[1,0,0],[2,0,0],[1,5,6],[2,2,0]]'::jsonb);
BEGIN
  IF NOT (v ->> 'ok')::boolean OR NOT (v ->> 'over')::boolean
    OR (v ->> 'score')::integer <> 2194 OR (v ->> 'lines')::integer <> 13 OR (v ->> 'bestCombo')::integer <> 4 THEN
    RAISE EXCEPTION '方塊重算與前端規則不一致：%', v;
  END IF;
  IF (public.block_replay(-1234567, '[[0,0,0],[0,0,0]]'::jsonb) ->> 'ok')::boolean THEN
    RAISE EXCEPTION '重複使用同一塊方塊沒有被拒絕';
  END IF;
  IF (public.block_replay(-1234567, '[[0,9,0]]'::jsonb) ->> 'ok')::boolean THEN
    RAISE EXCEPTION '越界步驟沒有被拒絕';
  END IF;
  IF (public.block_replay(-1234567, '[[0,0,0],[1,0,1]]'::jsonb) ->> 'over')::boolean THEN
    RAISE EXCEPTION '未結束的對局被判成結束';
  END IF;
END;
$$;

COMMIT;
