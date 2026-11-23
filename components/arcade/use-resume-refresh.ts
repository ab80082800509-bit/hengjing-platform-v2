'use client'

import { useEffect } from 'react'

/** 分頁切回、從上一頁快取回來、離線後重新連線時重讀。不改系統時間。 */
export function useResumeRefresh(onResume: () => void) {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') onResume()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onResume()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onResume)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onResume)
    }
  }, [onResume])
}
