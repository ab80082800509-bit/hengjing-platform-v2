'use client'

import { useEffect, useState } from 'react'

const DAY_MS = 86_400_000
const TAIPEI_OFFSET_MS = 8 * 3_600_000

export const dayIndexOf = (ms: number) => Math.floor((ms + TAIPEI_OFFSET_MS) / DAY_MS)
export const msUntilReset = (ms: number) => DAY_MS - ((ms + TAIPEI_OFFSET_MS) % DAY_MS)

/**
 * 以台灣時間（UTC+8）計算的「今天」序號。
 * 只在跨過 00:00 時才更新，避免父層元件每秒重新渲染；skew 供「模擬隔天」使用。
 */
export function useDayIndex(skew: number): number | null {
  const [day, setDay] = useState<number | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const sync = () => {
      if (timer) clearTimeout(timer)
      const now = Date.now() + skew
      setDay(dayIndexOf(now))
      timer = setTimeout(sync, msUntilReset(now) + 50)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [skew])
  return day
}

const pad = (n: number) => String(n).padStart(2, '0')

export function ResetCountdown({ skew, className = '' }: { skew: number; className?: string }) {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setLeft(msUntilReset(Date.now() + skew))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [skew])

  if (left === null) return <span className={`font-mono tabular-nums ${className}`}>--:--:--</span>
  const total = Math.min(86_399, Math.floor(left / 1000))
  const text = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  return (
    <time role="timer" aria-live="off" className={`font-mono tabular-nums ${className}`}>
      {text}
    </time>
  )
}
