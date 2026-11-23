-- =============================================================================
-- 預演：BEGIN → 替換 seller_orders_for_metric → 檢查定義與權限 → ROLLBACK
-- 請在 Supabase SQL Editor 一次執行整份，不要逐句執行。本檔不會被這次作業自動執行。
--
-- 交易結束時 ROLLBACK，正式資料庫的函式不會留下這次替換。
-- 不寫入訂單或明細，不修改 seller_operations_report、RLS、庫存、結帳或退款。
-- 檢查通過只代表函式文字與權限可在交易內建立，隨即回復。
-- 不可把這個結果當成已完成金額已經在正式環境核對過訂單。
--
-- 預演完成後若要確認沒有留下新函式，請單獨執行下面這句，不要和本檔一起執行：
-- SELECT position('completed_remaining_v1' IN pg_get_functiondef('public.seller_orders_for_metric(text, timestamptz, timestamptz)'::regprocedure)) AS marker_still_present;
-- 結果應為 0。0 只代表預演已回復，不是金額測試通過。
-- 檢查失敗時交易會中止並回復，不必再補一次 ROLLBACK。
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.seller_orders_for_metric(text, timestamptz, timestamptz)') IS NULL THEN
    RAISE EXCEPTION '找不到既有 public.seller_orders_for_metric(text, timestamptz, timestamptz)，已停止';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.seller_orders_for_metric(
  p_metric text,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid uuid := auth.uid();
  metric text := btrim(coalesce(p_metric, ''));
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '請先登入';
  END IF;
  IF metric <> 'pending' AND (p_from IS NULL OR p_to IS NULL OR p_to <= p_from) THEN
    RAISE EXCEPTION '請提供有效的日期區間';
  END IF;
  IF metric NOT IN ('placed', 'confirmed_collected', 'completed', 'pending', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION '找不到這個報表分類';
  END IF;

  -- refund_line_v1：退款分類改為逐筆可信退款。其他分類不走這段。
  IF metric = 'refunded' THEN
    RETURN (
      SELECT coalesce(jsonb_agg(item.payload ORDER BY item.sort_at DESC, item.sort_id DESC), '[]'::jsonb)
      FROM (
        SELECT
          r.created_at AS sort_at,
          r.id AS sort_id,
          jsonb_build_object(
            'orderId', o.id,
            'displayNo', o.display_no,
            'createdAt', o.created_at,
            'orderTotal', o.order_total,
            'buyerStage', public.order_buyer_stage(o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at),
            'buyerStageLabel', public.order_stage_label(public.order_buyer_stage(
              o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at
            )),
            'refundId', r.id,
            'refundAmount', r.amount,
            'refundCreatedAt', r.created_at
          ) AS payload
        FROM public.order_refunds r
        JOIN public.orders o ON o.id = r.order_id
        WHERE o.seller_id = uid
          AND r.trusted IS TRUE
          AND r.status = 'refunded'
          AND r.source IN ('gateway_verified', 'admin_verified')
          AND r.created_at >= p_from
          AND r.created_at < p_to
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 100
      ) item
    );
  END IF;

  -- completed_remaining_v1：已完成分類額外回傳剩餘明細金額。其他分類不走這段。
  -- 金額與 seller_operations_report 的 completed_amount 同一算式，不修改那支函式：
  --   (oi.quantity - oi.refunded_qty) * oi.unit_price
  -- 納入條件相同：賣家本人、已完成、完成時間落在區間、至少一項數量大於已退數量。
  -- 全部退貨的明細加總為 0，與報表一樣不計入筆數，因此不出現在這份明細。
  -- orderTotal 仍是 o.order_total，不覆蓋。
  -- 明細沿用 LIMIT 100。超過 100 筆時，明細筆數與金額合計會少於上方統計。這次不放寬上限。
  IF metric = 'completed' THEN
    RETURN (
      SELECT coalesce(jsonb_agg(item.payload ORDER BY item.sort_at DESC, item.sort_id DESC), '[]'::jsonb)
      FROM (
        SELECT
          o.created_at AS sort_at,
          o.id AS sort_id,
          jsonb_build_object(
            'orderId', o.id,
            'displayNo', o.display_no,
            'createdAt', o.created_at,
            'orderTotal', o.order_total,
            'buyerStage', public.order_buyer_stage(o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at),
            'buyerStageLabel', public.order_stage_label(public.order_buyer_stage(
              o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at
            )),
            'completedRemainingAmount', coalesce(sum((oi.quantity - oi.refunded_qty) * oi.unit_price), 0)
          ) AS payload
        FROM public.orders o
        JOIN public.order_items oi ON oi.order_id = o.id
        WHERE o.seller_id = uid
          AND o.completed_at IS NOT NULL
          AND o.fulfillment_status = 'completed'
          AND o.completed_at >= p_from
          AND o.completed_at < p_to
        GROUP BY o.id
        HAVING bool_or(oi.quantity > oi.refunded_qty)
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT 100
      ) item
    );
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(item.payload ORDER BY item.sort_at DESC), '[]'::jsonb)
    FROM (
      SELECT DISTINCT o.created_at AS sort_at, jsonb_build_object(
        'orderId', o.id,
        'displayNo', o.display_no,
        'createdAt', o.created_at,
        'orderTotal', o.order_total,
        'buyerStage', public.order_buyer_stage(o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at),
        'buyerStageLabel', public.order_stage_label(public.order_buyer_stage(
          o.lifecycle_status, o.payment_status, o.fulfillment_status, o.refund_status, o.completed_at
        ))
      ) AS payload
      FROM public.orders o
      LEFT JOIN public.order_items oi ON oi.order_id = o.id
      LEFT JOIN public.order_refunds r ON r.order_id = o.id
      WHERE o.seller_id = uid
        AND (
          (metric = 'placed' AND o.created_at >= p_from AND o.created_at < p_to)
          OR (
            metric = 'confirmed_collected'
            AND o.payment_status = 'confirmed'
            AND o.payment_confirmation_source = 'gateway_verified'
            AND o.payment_integration = 'gateway_verified'
            AND o.payment_confirmed_at >= p_from AND o.payment_confirmed_at < p_to
          )
          OR (
            metric = 'pending'
            AND o.lifecycle_status = 'open'
            AND o.completed_at IS NULL
            AND o.cancel_status = 'none'
            AND o.refund_status = 'none'
          )
          OR (
            metric = 'cancelled'
            AND o.cancel_status = 'cancelled'
            AND o.cancelled_at >= p_from AND o.cancelled_at < p_to
          )
        )
      ORDER BY o.created_at DESC
      LIMIT 100
    ) item
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seller_orders_for_metric(text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_orders_for_metric(text, timestamptz, timestamptz) TO authenticated;

DO $$
DECLARE
  def text := pg_get_functiondef('public.seller_orders_for_metric(text, timestamptz, timestamptz)'::regprocedure);
  missing text := '';
BEGIN
  IF position($chk$refund_line_v1$chk$ IN def) = 0 THEN missing := missing || ' refund_line_v1'; END IF;
  IF position($chk$refundId$chk$ IN def) = 0 THEN missing := missing || ' refundId'; END IF;
  IF position($chk$refundAmount$chk$ IN def) = 0 THEN missing := missing || ' refundAmount'; END IF;
  IF position($chk$refundCreatedAt$chk$ IN def) = 0 THEN missing := missing || ' refundCreatedAt'; END IF;
  IF position($chk$o.seller_id = uid$chk$ IN def) = 0 THEN missing := missing || ' seller_id'; END IF;
  IF position($chk$r.trusted IS TRUE$chk$ IN def) = 0 THEN missing := missing || ' trusted'; END IF;
  IF position($chk$r.status = 'refunded'$chk$ IN def) = 0 THEN missing := missing || ' status'; END IF;
  IF position($chk$gateway_verified$chk$ IN def) = 0 THEN missing := missing || ' gateway_verified'; END IF;
  IF position($chk$admin_verified$chk$ IN def) = 0 THEN missing := missing || ' admin_verified'; END IF;
  IF position($chk$metric = 'placed'$chk$ IN def) = 0 THEN missing := missing || ' placed'; END IF;
  IF position($chk$metric = 'confirmed_collected'$chk$ IN def) = 0 THEN missing := missing || ' confirmed_collected'; END IF;
  IF position($chk$metric = 'completed'$chk$ IN def) = 0 THEN missing := missing || ' completed'; END IF;
  IF position($chk$metric = 'pending'$chk$ IN def) = 0 THEN missing := missing || ' pending'; END IF;
  IF position($chk$metric = 'cancelled'$chk$ IN def) = 0 THEN missing := missing || ' cancelled'; END IF;
  IF position($chk$completed_remaining_v1$chk$ IN def) = 0 THEN missing := missing || ' completed_remaining_v1'; END IF;
  IF position($chk$completedRemainingAmount$chk$ IN def) = 0 THEN missing := missing || ' completedRemainingAmount'; END IF;
  IF position($chk$(oi.quantity - oi.refunded_qty) * oi.unit_price$chk$ IN def) = 0 THEN missing := missing || ' remaining_formula'; END IF;
  IF position($chk$'orderTotal', o.order_total$chk$ IN def) = 0 THEN missing := missing || ' orderTotal'; END IF;
  IF position($chk$bool_or(oi.quantity > oi.refunded_qty)$chk$ IN def) = 0 THEN missing := missing || ' remaining_qty'; END IF;
  IF position('SECURITY DEFINER' IN def) = 0 THEN missing := missing || ' security_definer'; END IF;
  IF position($chk$completed_remaining_v1$chk$ IN def) > position($chk$metric = 'placed'$chk$ IN def) THEN
    RAISE EXCEPTION '已完成分類必須在共用查詢之前返回。這不是訂單金額測試。';
  END IF;
  IF missing <> '' THEN
    RAISE EXCEPTION '函式定義檢查未過，缺少:%。交易會回復。這不是退款測試。', missing;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.seller_orders_for_metric(text, timestamptz, timestamptz)'::regprocedure
      AND prosecdef
      AND provolatile = 's'
      AND EXISTS (
        SELECT 1
        FROM unnest(coalesce(proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
          AND cfg LIKE '%public%'
          AND cfg LIKE '%pg_catalog%'
      )
  ) THEN
    RAISE EXCEPTION '函式屬性檢查未過：必須維持 STABLE、SECURITY DEFINER、search_path = public, pg_catalog。這不是退款測試。';
  END IF;
  IF has_function_privilege('anon', 'public.seller_orders_for_metric(text, timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '權限檢查未過：anon 不應能執行。這不是退款測試。';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
    WHERE p.oid = 'public.seller_orders_for_metric(text, timestamptz, timestamptz)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.seller_orders_for_metric(text, timestamptz, timestamptz)'::regprocedure
      AND proacl IS NULL
  ) THEN
    RAISE EXCEPTION '權限檢查未過：PUBLIC 不應能執行。這不是退款測試。';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.seller_orders_for_metric(text, timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '權限檢查未過：authenticated 應能執行。這不是退款測試。';
  END IF;
END $$;

-- 這一列出現，只代表交易內看得到新定義。下一句 ROLLBACK 會把它撤掉。
SELECT
  'preview_visible_inside_transaction_then_rollback' AS preview,
  p.prosecdef AS security_definer,
  p.provolatile = 's' AS stable,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  position('completed_remaining_v1' IN pg_get_functiondef(p.oid)) > 0 AS completed_remaining_visible_inside_transaction,
  position('refund_line_v1' IN pg_get_functiondef(p.oid)) > 0 AS refund_line_still_visible_inside_transaction
FROM pg_proc p
WHERE p.oid = 'public.seller_orders_for_metric(text, timestamptz, timestamptz)'::regprocedure;

ROLLBACK;
