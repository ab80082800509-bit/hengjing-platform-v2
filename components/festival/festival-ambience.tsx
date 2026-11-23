'use client'

/**
 * 全站節慶氛圍，只在根版型掛一次。四層：背景氛圍（內容後方）、畫面邊緣大型裝飾、前景粒子、特殊動態。
 * 全部 pointer-events: none，層級低於頁首、底部分頁列與所有視窗，不會擋住按鈕、商品或表單。
 */
import './festival-ambience.css'
import { useEffect, useState } from 'react'
import { festivalYear, useFestivalSnapshot } from './festival-store'
import { EdgeArt } from './festival-edges'
import { Backdrop, FestivalSprite, Particles, Special, Topper } from './festival-effects'

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return reduced
}

export function FestivalAmbience() {
  const snap = useFestivalSnapshot()
  const reduced = useReducedMotion()
  const theme = snap.theme
  const scene = snap.now ? theme.scene : undefined
  // 莊重節慶維持簡約，不加角落插畫。
  const corner = !!scene && scene.mood !== 'solemn'
  const band = scene ? (scene.topper ? (corner ? 'full' : 'topper') : corner ? 'corner' : null) : null

  useEffect(() => {
    const root = document.documentElement
    root.dataset.festival = theme.id
    if (snap.issues.length) root.dataset.festivalIssue = String(snap.issues.length)
    else delete root.dataset.festivalIssue
    if (!scene) {
      delete root.dataset.faActive
      delete root.dataset.faMood
      return
    }
    root.dataset.faActive = ''
    root.dataset.faMood = scene.mood
    root.style.setProperty('--fa-accent', theme.palette.accent)
    root.style.setProperty('--fa-soft', theme.palette.soft)
    root.style.setProperty('--fa-glow', theme.palette.glow)
    return () => {
      delete root.dataset.faActive
      delete root.dataset.faMood
    }
  }, [theme, scene, snap.issues.length])

  // 頂部掛飾帶從頁首下緣開始。只有主版面（.fa-page-root > main）會替掛飾帶預留空間，
  // 其他頁面沒有預留位置就不顯示掛飾帶，避免壓到內容。
  useEffect(() => {
    if (!scene) return
    const root = document.documentElement
    let observed: Element | null = null
    const observer = new ResizeObserver(() => sync())
    function sync() {
      const header = document.querySelector('body header')
      if (header !== observed) {
        if (observed) observer.unobserve(observed)
        if (header) observer.observe(header)
        observed = header
      }
      const bottom = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 0
      root.style.setProperty('--fa-top', `${bottom}px`)
      if (band && document.querySelector('.fa-page-root > main')) root.dataset.faBand = band
      else delete root.dataset.faBand
    }
    sync()
    const poll = window.setInterval(sync, 1500)
    return () => {
      window.clearInterval(poll)
      observer.disconnect()
      delete root.dataset.faBand
    }
  }, [scene, band])

  // 往下捲動後淡化邊緣插畫。
  useEffect(() => {
    if (!scene) return
    const root = document.documentElement
    let frame = 0
    const update = () => {
      frame = 0
      if (window.scrollY > 240) root.dataset.faScrolled = ''
      else delete root.dataset.faScrolled
    }
    const request = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', request, { passive: true })
    return () => {
      window.removeEventListener('scroll', request)
      if (frame) window.cancelAnimationFrame(frame)
      delete root.dataset.faScrolled
    }
  }, [scene])

  if (!scene) return null
  const year = festivalYear(snap.now)

  return (
    <div className="fa-root" data-scene={theme.id} data-mood={scene.mood} data-reduced={reduced ? '' : undefined} aria-hidden="true">
      <FestivalSprite />
      <div className="fa-backdrop"><Backdrop id={theme.id} special={scene.special} /></div>
      {scene.topper ? <div className="fa-topper"><Topper kind={scene.topper} /></div> : null}
      {corner ? (
        <>
          <div className="fa-corner fa-corner-left"><EdgeArt id={theme.id} side="left" year={year} /></div>
          <div className="fa-corner fa-corner-right"><EdgeArt id={theme.id} side="right" year={year} /></div>
        </>
      ) : null}
      <div className="fa-edge fa-edge-left"><EdgeArt id={theme.id} side="left" year={year} /></div>
      <div className="fa-edge fa-edge-right"><EdgeArt id={theme.id} side="right" year={year} /></div>
      {reduced ? null : <div className="fa-fore"><Particles kind={scene.particle} /></div>}
      {reduced || !scene.special ? null : <div className="fa-special" data-special={scene.special}><Special kind={scene.special} /></div>}
    </div>
  )
}
