-- 補上購物車重新整理後需要的公開店名查詢。
-- 本機 seller_applications 尚未有 certified_at，既有賣家不回填認證時間。
-- 只讀已通過審核且店名非空的列，只回傳會員編號、店名，以及認證時間（沒有該欄時為 NULL）。
-- 不讀 KYC、統編、姓名、信箱或手機，也不改任何資料表的 RLS。

BEGIN;

DO $public_store_names_require$
BEGIN
  IF to_regclass('public.seller_applications') IS NULL THEN
    RAISE EXCEPTION '需要 seller_applications 才能提供公開店名';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'seller_applications'
      AND column_name IN ('user_id', 'store_name', 'status', 'created_at')
    GROUP BY table_schema, table_name
    HAVING count(*) = 4
  ) THEN
    RAISE EXCEPTION 'seller_applications 缺少公開店名所需欄位';
  END IF;
END
$public_store_names_require$;

DROP FUNCTION IF EXISTS public.public_store_names(uuid[]);

CREATE FUNCTION public.public_store_names(p_ids uuid[])
RETURNS TABLE (seller_user_id uuid, store_name text, certified_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'seller_applications'
      AND column_name = 'certified_at'
  ) THEN
    RETURN QUERY EXECUTE $names$
      SELECT DISTINCT ON (sa.user_id)
        sa.user_id,
        sa.store_name,
        sa.certified_at
      FROM public.seller_applications AS sa
      WHERE sa.user_id = ANY (coalesce($1, ARRAY[]::uuid[]))
        AND sa.status = 'approved'
        AND nullif(btrim(sa.store_name), '') IS NOT NULL
      ORDER BY sa.user_id, sa.created_at DESC
    $names$ USING p_ids;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (sa.user_id)
    sa.user_id,
    sa.store_name,
    NULL::timestamptz
  FROM public.seller_applications AS sa
  WHERE sa.user_id = ANY (coalesce(p_ids, ARRAY[]::uuid[]))
    AND sa.status = 'approved'
    AND nullif(btrim(sa.store_name), '') IS NOT NULL
  ORDER BY sa.user_id, sa.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.public_store_names(uuid[]) IS
  '依會員編號回傳已通過審核的公開店名。沒有 certified_at 欄時認證時間為 NULL，不回填、不暴露私人資料。';

REVOKE ALL ON FUNCTION public.public_store_names(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_store_names(uuid[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
