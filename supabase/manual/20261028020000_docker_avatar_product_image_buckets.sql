-- =============================================================================
-- 3001 隔離試玩（hengjing-stage45-local Docker）Storage 補齊：
--   member-avatars、product-images
-- 只限本機 Docker 執行：
--   Get-Content <本檔> -Raw | docker exec -i supabase_db_hengjing-stage45-local psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- 定義與正式 migration 完全一致，不另外放寬：
--   member-avatars  ← migrations/20261020120000_buyer_store_features.sql
--   product-images  ← migrations/20261020035100_product_images_bucket.sql
-- 不刪除 storage.objects，不更動 seller-kyc，不更動任何 public 資料表。
-- 可重複執行。
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_approved_seller()') IS NULL THEN
    RAISE EXCEPTION '缺少 public.is_approved_seller()，product-images 政策無法建立';
  END IF;
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION '缺少 public.profiles';
  END IF;
END;
$$;

-- member-avatars -------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'member-avatars',
  'member-avatars',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS member_avatars_public_read ON storage.objects;
DROP POLICY IF EXISTS member_avatars_owner_insert ON storage.objects;
DROP POLICY IF EXISTS member_avatars_owner_update ON storage.objects;
DROP POLICY IF EXISTS member_avatars_owner_delete ON storage.objects;

CREATE POLICY member_avatars_public_read
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'member-avatars');

CREATE POLICY member_avatars_owner_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'member-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY member_avatars_owner_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'member-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'member-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY member_avatars_owner_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'member-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- product-images -------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS product_images_public_read ON storage.objects;
DROP POLICY IF EXISTS product_images_seller_insert ON storage.objects;
DROP POLICY IF EXISTS product_images_seller_update ON storage.objects;
DROP POLICY IF EXISTS product_images_seller_delete ON storage.objects;

CREATE POLICY product_images_public_read
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'product-images');

CREATE POLICY product_images_seller_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND public.is_approved_seller()
    AND cardinality(storage.foldername(name)) = 1
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY product_images_seller_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'product-images'
    AND public.is_approved_seller()
    AND cardinality(storage.foldername(name)) = 1
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'product-images'
    AND public.is_approved_seller()
    AND cardinality(storage.foldername(name)) = 1
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY product_images_seller_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'product-images'
    AND public.is_approved_seller()
    AND cardinality(storage.foldername(name)) = 1
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

COMMIT;
