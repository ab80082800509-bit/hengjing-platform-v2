'use client'

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Fingerprint,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Timer,
  X,
} from 'lucide-react'

export const ADMIN_MAX_ATTEMPTS = 3
const SESSION_SECONDS = 14 * 60 + 59

const DEMO = { account: 'admin', password: 'Admin#2026', code: '123456' }

const inputCls =
  'w-full rounded-xl border border-input bg-card px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50'
const btnPrimary =
  'inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-bold text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * 最高權限身分驗證彈窗（帳密 + 2FA / Passkey，錯誤 3 次封鎖 IP）
 * -------------------------------------------------------------------------- */
export function AdminAuthModal({
  failed,
  onFail,
  onResetLock,
  onSuccess,
  onClose,
}: {
  failed: number
  onFail: () => void
  onResetLock: () => void
  onSuccess: () => void
  onClose: () => void
}) {
  const locked = failed >= ADMIN_MAX_ATTEMPTS
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [method, setMethod] = useState<'totp' | 'passkey'>('totp')
  const [code, setCode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [passkeyOk, setPasskeyOk] = useState(false)
  const [hint, setHint] = useState('')
  const firstRef = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    firstRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [])

  const startPasskey = () => {
    if (locked || scanning) return
    setScanning(true)
    setHint('')
    window.setTimeout(() => {
      setScanning(false)
      setPasskeyOk(true)
    }, 1000)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (locked) return
    const credentialsOk = account.trim() === DEMO.account && password === DEMO.password
    const secondFactorOk = method === 'totp' ? code === DEMO.code : passkeyOk
    if (credentialsOk && secondFactorOk) {
      onSuccess()
      return
    }
    const next = failed + 1
    onFail()
    setPassword('')
    setCode('')
    setPasskeyOk(false)
    setHint(
      next >= ADMIN_MAX_ATTEMPTS
        ? ''
        : `驗證失敗：帳號、密碼或驗證資訊不正確，還可再嘗試 ${ADMIN_MAX_ATTEMPTS - next} 次`,
    )
  }

  const canSubmit =
    !locked && account.trim() !== '' && password !== '' && (method === 'totp' ? /^\d{6}$/.test(code) : passkeyOk)

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-foreground/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-auth-title"
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-card shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-3.5">
          <h2 id="admin-auth-title" className="flex items-center gap-2 text-base font-black">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="size-4" />
            </span>
            最高權限身分驗證
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉視窗"
            className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-5" noValidate>
          {locked && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive bg-destructive/10 p-3.5 text-sm font-bold text-destructive">
              <ShieldAlert className="mt-0.5 size-5 shrink-0" />
              <p className="leading-relaxed">登入失敗已達上限！該 IP 已被暫時封鎖，並已發送安全警報至管理員手機。</p>
            </div>
          )}
          {!locked && hint && (
            <div role="alert" className="rounded-xl border border-destructive/60 bg-destructive/10 px-3.5 py-2.5 text-xs font-bold text-destructive">
              {hint}
            </div>
          )}

          <Field label="管理員專屬帳號" htmlFor="admin-account">
            <input
              ref={firstRef}
              id="admin-account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              disabled={locked}
              autoComplete="off"
              spellCheck={false}
              className={inputCls}
              placeholder="請輸入管理員帳號"
            />
          </Field>
          <Field label="密碼" htmlFor="admin-password">
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={locked}
              autoComplete="off"
              className={inputCls}
              placeholder="請輸入密碼"
            />
          </Field>

          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground">第二道驗證</p>
            <div className="grid grid-cols-2 gap-1 rounded-full border border-border/70 bg-muted/60 p-1" role="group" aria-label="選擇第二道驗證方式">
              {(
                [
                  ['totp', 'Google Authenticator', <Smartphone key="t" className="size-3.5" />],
                  ['passkey', 'Passkey 生物辨識', <Fingerprint key="p" className="size-3.5" />],
                ] as const
              ).map(([id, label, icon]) => (
                <button
                  key={id}
                  type="button"
                  disabled={locked}
                  aria-pressed={method === id}
                  onClick={() => setMethod(id)}
                  className={`flex items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-bold transition disabled:opacity-50 ${method === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>

            {method === 'totp' ? (
              <Field label="2FA 動態 6 位數驗證碼" htmlFor="admin-code">
                <input
                  id="admin-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={locked}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className={`${inputCls} text-center font-mono text-lg tracking-[0.5em]`}
                  placeholder="000000"
                />
              </Field>
            ) : (
              <button
                type="button"
                onClick={startPasskey}
                disabled={locked || scanning}
                className={`${btnGhost} w-full py-3 ${passkeyOk ? 'border-emerald-600 text-emerald-400' : ''}`}
              >
                {scanning ? (
                  <><Loader2 className="size-4 animate-spin" />生物辨識中...</>
                ) : passkeyOk ? (
                  <><ShieldCheck className="size-4" />Passkey 驗證已通過</>
                ) : (
                  <><Fingerprint className="size-4" />使用 Passkey 進行生物辨識</>
                )}
              </button>
            )}
          </div>

          <button type="submit" disabled={!canSubmit} className={btnPrimary}>
            <Lock className="size-4" />驗證並登入
          </button>

          {locked && (
            <button type="button" onClick={onResetLock} className={`${btnGhost} w-full`}>
              <KeyRound className="size-4" />解除 IP 封鎖（測試用）
            </button>
          )}

          <p className="rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
            測試用：帳號 <code className="font-mono font-bold text-foreground">{DEMO.account}</code>、密碼{' '}
            <code className="font-mono font-bold text-foreground">{DEMO.password}</code>、驗證碼{' '}
            <code className="font-mono font-bold text-foreground">{DEMO.code}</code>（或 Passkey 模擬）。連續錯誤 {ADMIN_MAX_ATTEMPTS} 次會封鎖此 IP。
          </p>
        </form>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * 後台頂部資安即時監控 Banner
 * -------------------------------------------------------------------------- */
function formatClock(total: number) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function AdminSecurityBanner({ onTimeout, onLogout }: { onTimeout: () => void; onLogout: () => void }) {
  const [left, setLeft] = useState(SESSION_SECONDS)
  const onTimeoutRef = useRef(onTimeout)
  onTimeoutRef.current = onTimeout

  useEffect(() => {
    const tick = window.setInterval(() => setLeft((v) => Math.max(v - 1, 0)), 1000)
    const reset = () => setLeft(SESSION_SECONDS)
    window.addEventListener('pointerdown', reset)
    window.addEventListener('keydown', reset)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener('pointerdown', reset)
      window.removeEventListener('keydown', reset)
    }
  }, [])

  useEffect(() => {
    if (left === 0) onTimeoutRef.current()
  }, [left])

  const urgent = left <= 60

  return (
    <section
      aria-label="資安即時監控"
      className="rounded-2xl border border-border/70 bg-card p-3 shadow-sm sm:p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
          <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <ShieldCheck className="size-5" />
            <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-muted-foreground">系統狀態</p>
            <p className="text-sm font-black text-emerald-400">系統安全</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-brand-ink">
            <Globe className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-muted-foreground">管理員 IP 白名單</p>
            <p className="text-sm font-black">
              <span className="font-mono">123.X.X.X</span>
              <span className="ml-1 text-xs font-bold text-emerald-400">校驗通過</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${urgent ? 'bg-destructive/10 text-destructive' : 'bg-accent text-brand-ink'}`}>
            <Timer className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-muted-foreground">自動登出倒數</p>
            <p role="timer" className={`font-mono text-sm font-black tabular-nums ${urgent ? 'text-destructive' : ''}`}>
              {formatClock(left)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-brand-ink">
            <Lock className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-muted-foreground">異地登入防護</p>
            <p className="text-sm font-black">已開啟單一 Session 鎖定</p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>閒置超過時限將自動登出；操作畫面會重新計時。</p>
        <button type="button" onClick={onLogout} className={`${btnGhost} px-3 py-1.5 text-xs`}>
          <LogOut className="size-3.5" />登出後台
        </button>
      </div>
    </section>
  )
}
