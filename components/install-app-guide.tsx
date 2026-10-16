'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Copy,
  Download,
  EllipsisVertical,
  Lock,
  Monitor,
  MonitorDown,
  Share,
  Smartphone,
  Store,
  X,
} from 'lucide-react'

type Device = 'mobile' | 'desktop'
type MobileOS = 'ios' | 'android'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const APP_NAME = '買個 Pay 服'

const STEPS: Record<MobileOS | 'desktop', { title: string; hint: string; steps: { text: string; strong: string }[] }> = {
  ios: {
    title: 'iPhone / iPad・Safari',
    hint: '請務必使用 Safari 開啟本頁，其他瀏覽器在 iOS 上無法加入主畫面。',
    steps: [
      { text: '點擊瀏覽器下方工具列的', strong: '「分享」按鈕' },
      { text: '在選單中向下滑動，選擇', strong: '「加入主畫面」' },
      { text: '確認名稱後點右上角', strong: '「新增」，桌面即出現 App 圖示' },
    ],
  },
  android: {
    title: 'Android・Chrome',
    hint: '部分機型的選項名稱為「安裝應用程式」，兩者功能相同。',
    steps: [
      { text: '點擊瀏覽器右上角的', strong: '選單（三點）' },
      { text: '選擇', strong: '「加到主畫面」或「安裝應用程式」' },
      { text: '在跳出的視窗點', strong: '「安裝」，主畫面即出現 App 圖示' },
    ],
  },
  desktop: {
    title: 'Windows / Mac・Chrome、Edge',
    hint: '網址列沒有安裝圖示時，請從右上角選單操作。',
    steps: [
      { text: '點擊網址列右側的', strong: '安裝圖示' },
      { text: '或點右上角選單，選擇', strong: `「安裝 ${APP_NAME}」` },
      { text: '確認後網頁將', strong: '獨立成桌面 App 視窗執行' },
    ],
  },
}

function detectDevice(): { device: Device; os: MobileOS } {
  const ua = navigator.userAgent
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  const isAndroid = /Android/.test(ua)
  if (isIOS) return { device: 'mobile', os: 'ios' }
  if (isAndroid) return { device: 'mobile', os: 'android' }
  return { device: 'desktop', os: 'android' }
}

function Highlight({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className="relative z-20 inline-flex">
      <span className="absolute -inset-1.5 rounded-lg bg-primary/25 motion-safe:animate-pulse" aria-hidden="true" />
      <span className="relative flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        {children}
      </span>
      <span className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-1.5 py-0.5 text-[11px] font-bold text-card">
        {label}
      </span>
    </span>
  )
}

function IosMock() {
  return (
    <div className="mx-auto w-full max-w-60 overflow-hidden rounded-3xl border-4 border-foreground/80 bg-card shadow-md" role="img" aria-label="iOS Safari 畫面示意：下方工具列的分享按鈕">
      <div className="space-y-2 bg-muted/60 p-4">
        <div className="h-3 w-2/3 rounded-full bg-border" />
        <div className="h-20 rounded-xl bg-border/70" />
        <div className="h-3 w-1/2 rounded-full bg-border" />
      </div>
      <div className="flex items-center justify-between border-t border-border bg-card px-4 pb-8 pt-3 text-muted-foreground">
        <ChevronLeft className="size-5" />
        <ChevronRight className="size-5" />
        <Highlight label="分享"><Share className="size-4" /></Highlight>
        <BookOpen className="size-5" />
        <Copy className="size-5" />
      </div>
    </div>
  )
}

function AndroidMock() {
  return (
    <div className="mx-auto w-full max-w-60 overflow-hidden rounded-3xl border-4 border-foreground/80 bg-card shadow-md" role="img" aria-label="Android Chrome 畫面示意：右上角選單與加到主畫面選項">
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2.5">
        <div className="flex flex-1 items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[11px] text-muted-foreground">
          <Lock className="size-3" />buy-pay.tw
        </div>
        <Highlight label="選單"><EllipsisVertical className="size-4" /></Highlight>
      </div>
      <div className="relative h-44 bg-muted/60 p-4">
        <div className="space-y-2">
          <div className="h-3 w-2/3 rounded-full bg-border" />
          <div className="h-16 rounded-xl bg-border/70" />
        </div>
        <ul className="absolute right-3 top-2 w-40 space-y-0.5 rounded-xl border border-border bg-card p-1.5 text-[11px] shadow-lg">
          <li className="rounded-md px-2 py-1.5 text-muted-foreground">新增分頁</li>
          <li className="rounded-md px-2 py-1.5 text-muted-foreground">書籤</li>
          <li className="flex items-center gap-1 rounded-md bg-primary px-2 py-1.5 font-bold text-primary-foreground">
            <Download className="size-3" />加到主畫面
          </li>
          <li className="rounded-md px-2 py-1.5 text-muted-foreground">設定</li>
        </ul>
      </div>
    </div>
  )
}

function DesktopMock() {
  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-border bg-card shadow-md" role="img" aria-label="桌機瀏覽器畫面示意：網址列右側的安裝圖示">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-2">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
      </div>
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <ChevronLeft className="size-4 text-muted-foreground" />
        <ChevronRight className="size-4 text-muted-foreground" />
        <div className="flex flex-1 items-center justify-between rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><Lock className="size-3" />buy-pay.tw</span>
          <Highlight label="安裝圖示"><MonitorDown className="size-4" /></Highlight>
        </div>
        <EllipsisVertical className="size-4 text-muted-foreground" />
      </div>
      <div className="relative h-36 bg-muted/60 p-4">
        <div className="space-y-2">
          <div className="h-3 w-1/2 rounded-full bg-border" />
          <div className="h-14 w-2/3 rounded-xl bg-border/70" />
        </div>
        <div className="absolute right-6 top-3 w-44 rounded-xl border border-border bg-card p-3 text-[11px] shadow-lg">
          <p className="flex items-center gap-1.5 font-black text-foreground">
            <span className="flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground"><Store className="size-3" /></span>
            安裝 {APP_NAME}
          </p>
          <div className="mt-2.5 flex justify-end gap-1.5">
            <span className="rounded-full px-2.5 py-1 text-muted-foreground">取消</span>
            <span className="rounded-full bg-primary px-2.5 py-1 font-bold text-primary-foreground">安裝</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function InstallAppButton() {
  const [open, setOpen] = useState(false)
  const [device, setDevice] = useState<Device>('desktop')
  const [os, setOs] = useState<MobileOS>('ios')
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    setInstalled(standalone)

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setInstallEvent(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setInstallEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, close])

  const openGuide = () => {
    const detected = detectDevice()
    setDevice(detected.device)
    if (detected.device === 'mobile') setOs(detected.os)
    setOpen(true)
  }

  const runInstall = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    await installEvent.userChoice
    setInstallEvent(null)
  }

  const key: MobileOS | 'desktop' = device === 'desktop' ? 'desktop' : os
  const guide = STEPS[key]

  return (
    <>
      <button
        type="button"
        onClick={openGuide}
        aria-haspopup="dialog"
        aria-label="安裝 App 至桌面"
        className="relative inline-flex size-9 items-center justify-center rounded-full border border-primary/50 bg-primary/10 text-sm font-bold text-foreground transition hover:bg-primary/20 active:scale-[0.98] sm:size-auto sm:gap-1.5 sm:px-4 sm:py-2"
      >
        <Smartphone className="size-4 text-primary" />
        <span className="hidden sm:inline">安裝 App 至桌面</span>
        {!installed && (
          <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
            <span className="absolute inline-flex size-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
            <button type="button" aria-label="關閉視窗" onClick={close} className="absolute inset-0 bg-foreground/50 backdrop-blur-sm" />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="install-guide-title"
              className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border/70 bg-card shadow-2xl sm:rounded-3xl"
            >
              <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                    <Store className="size-6" />
                  </span>
                  <div>
                    <h2 id="install-guide-title" className="text-balance text-lg font-black leading-tight">
                      安裝 {APP_NAME} 到桌面
                    </h2>
                    <p className="mt-0.5 text-pretty text-sm text-muted-foreground">不用下載，一鍵開啟、全螢幕使用，像原生 App 一樣順手。</p>
                  </div>
                </div>
                <button type="button" onClick={close} aria-label="關閉視窗" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
                  <X className="size-5" />
                </button>
              </div>

              <div className="overflow-y-auto px-5 pb-5">
                {installed && (
                  <p className="mb-4 flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm font-bold">
                    <CircleCheck className="size-4 text-primary" />你正在以 App 模式使用，已完成安裝。
                  </p>
                )}

                <div role="tablist" aria-label="選擇裝置類型" className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
                  {(
                    [
                      ['mobile', '手機版', Smartphone],
                      ['desktop', '桌機版', Monitor],
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={device === id}
                      onClick={() => setDevice(id)}
                      className={`flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold transition ${device === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      <Icon className="size-4" />{label}
                    </button>
                  ))}
                </div>

                {device === 'mobile' && (
                  <div role="group" aria-label="選擇手機系統" className="mt-3 flex gap-2">
                    {(
                      [
                        ['ios', 'iOS・Safari'],
                        ['android', 'Android・Chrome'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={os === id}
                        onClick={() => setOs(id)}
                        className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${os === id ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-5 rounded-2xl bg-muted/50 px-4 pb-10 pt-5">
                  {key === 'ios' && <IosMock />}
                  {key === 'android' && <AndroidMock />}
                  {key === 'desktop' && <DesktopMock />}
                </div>

                <h3 className="mt-5 text-sm font-black">{guide.title}</h3>
                <ol className="mt-3 space-y-3">
                  {guide.steps.map((step, i) => (
                    <li key={step.strong} className="flex items-start gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground">{i + 1}</span>
                      <p className="text-pretty pt-0.5 text-sm leading-relaxed text-muted-foreground">
                        {step.text}<strong className="font-black text-foreground">{step.strong}</strong>
                      </p>
                    </li>
                  ))}
                </ol>

                <p className="mt-4 rounded-xl border border-border/70 px-3 py-2.5 text-pretty text-xs leading-relaxed text-muted-foreground">{guide.hint}</p>

                {installEvent && !installed && (
                  <button
                    type="button"
                    onClick={runInstall}
                    className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98]"
                  >
                    <Download className="size-4" />立即安裝
                  </button>
                )}

                <button
                  type="button"
                  onClick={close}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium transition hover:bg-muted active:scale-[0.98]"
                >
                  <Check className="size-4" />我知道了
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
