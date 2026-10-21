-- =============================================================================
-- 商品圖片 Storage：product-images
-- 請人工審查後在 Supabase SQL Editor 整段執行一次。本檔不執行。
-- 專案內沒有其他商品圖片 bucket。匿名讀取 product-images / seller-kyc /
-- products / product_images 都回 Bucket not found；seller-kyc 是私人證件桶，
-- 匿名查詢也會顯示不存在，所以這裡用 ON CONFLICT，避免重複建立同名 bucket。
-- 不刪除 storage.objects，不 UPDATE / DELETE public.products。
-- 不關閉 RLS，不授權 service_role 給前端。
-- 公開讀取商品圖。新增、修改、刪除只給已登入且 seller_applications.status = approved
-- 的賣家，而且路徑第一層必須是 auth.uid()。依賴已存在的 public.is_approved_seller()。
-- =============================================================================

BEGIN;

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
