-- =============================================================================
-- 緊急關閉 Pay 點數商城虛擬商品兌換。只把 purchase_enabled 改回 false。
-- 已兌換的收藏、裝備與點數紀錄全部保留，會員仍可照常裝備。
-- =============================================================================

BEGIN;

UPDATE public.member_perk_settings SET purchase_enabled = false WHERE id = true;

DO $close_purchase_check$
BEGIN
  IF (SELECT purchase_enabled FROM public.member_perk_settings WHERE id = true) IS DISTINCT FROM false THEN
    RAISE EXCEPTION '兌換開關沒有關閉';
  END IF;
END
$close_purchase_check$;

COMMIT;
