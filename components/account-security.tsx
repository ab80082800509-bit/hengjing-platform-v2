'use client'

import { useEffect, useId, useState, type FormEvent } from 'react'
import { Check, CircleAlert, Eye, EyeOff, Loader2, LockKeyhole, MailCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { SheetModal } from './sheet-modal'

const inputCls =
  'w-full rounded-xl border bg-card py-2.5 pl-3 pr-11 text-base outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/30 sm:text-sm'
const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'

function passwordIssue(pw: string): string {
  if (pw.length < 8) return '密碼至少需要 8 碼'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '密碼需同時包含英文字母與數字'
  return ''
}

function PasswordField({
  label,
  value,
  onChange,
  error,
  autoComplete,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  autoComplete: string
  hint?: string
}) {
  const id = useId()
  const [shown, setShown] = useState(false)
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-bold text-muted-foreground">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} ${error ? 'border-destructive' : 'border-input'}`}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? `隱藏${label}` : `顯示${label}`}
          aria-pressed={shown}
          className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-err`} role="alert" className="flex items-center gap-1 text-xs font-bold text-destructive">
          <CircleAlert className="size-3.5" />{error}
        </p>
      )}
    </div>
  )
}

function ChangePasswordForm({ email, onDone, onError }: { email: string; onDone: () => void; onError: (message: string) => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const err: Record<string, string> = {}
    if (!current) err.current = '請輸入目前密碼'
    const issue = passwordIssue(next)
    if (issue) err.next = issue
    else if (next === current) err.next = '新密碼不能與目前密碼相同'
    if (confirm !== next) err.confirm = '兩次輸入的新密碼不一致'
    setErrors(err)
    if (Object.keys(err).length || busy) return
    setBusy(true)
    const verified = await supabase.auth.signInWithPassword({ email, password: current })
    if (verified.error) {
      setBusy(false)
      setErrors({ current: verified.error.message || '目前密碼不正確' })
      onError(verified.error.message || '目前密碼不正確')
      return
    }
    const updated = await supabase.auth.updateUser({ password: next })
    setBusy(false)
    if (updated.error) {
      setErrors({ next: updated.error.message || '密碼更新失敗' })
      onError(updated.error.message || '密碼更新失敗')
      return
    }
    setCurrent('')
    setNext('')
    setConfirm('')
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <PasswordField label="目前密碼" value={current} onChange={setCurrent} error={errors.current} autoComplete="current-password" />
      <PasswordField
        label="新密碼"
        value={next}
        onChange={setNext}
        error={errors.next}
        autoComplete="new-password"
        hint="至少 8 碼，需包含英文字母與數字"
      />
      <PasswordField label="確認新密碼" value={confirm} onChange={setConfirm} error={errors.confirm} autoComplete="new-password" />
      <button type="submit" disabled={busy} className={`${btnPrimary} w-full sm:w-auto`}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}更新密碼
      </button>
    </form>
  )
}

type ResetStep = 'identify' | 'done'

export function ForgotPasswordModal({ onClose, onNotify }: { onClose: () => void; onNotify: (m: string) => void }) {
  const [step, setStep] = useState<ResetStep>('identify')
  const [account, setAccount] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const sendCode = async (e: FormEvent) => {
    e.preventDefault()
    const v = account.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setError('請輸入註冊時使用的 Email。手機號碼重設尚未開放。')
      return
    }
    setBusy(true)
    setError('')
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(v, {
      redirectTo: typeof window === 'undefined' ? undefined : `${window.location.origin}/`,
    })
    setBusy(false)
    if (resetError) {
      setError(resetError.message || '寄送重設信失敗')
      return
    }
    setStep('done')
    onNotify('重設密碼信已寄出，請到 Email 設定新密碼')
  }

  return (
    <SheetModal title="忘記密碼" onClose={onClose} size="sm" z={100}>
      <div className="space-y-5 p-5">
        {step === 'identify' && (
          <form onSubmit={sendCode} className="space-y-4" noValidate>
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              請輸入註冊 Email。系統會寄出 Supabase 的重設密碼信，信件連結才是正式重設流程。
            </p>
            <div className="space-y-1.5">
              <label htmlFor="reset-account" className="text-xs font-bold text-muted-foreground">Email</label>
              <input
                id="reset-account"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                autoComplete="email"
                className={`${inputCls} pr-3 ${error ? 'border-destructive' : 'border-input'}`}
                placeholder="name@example.com"
              />
              {error && <p role="alert" className="text-xs font-bold text-destructive">{error}</p>}
            </div>
            <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}寄送重設信
            </button>
          </form>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <Check className="size-7" />
            </span>
            <h3 className="text-lg font-black">重設信已寄出</h3>
            <p className="text-pretty text-sm text-muted-foreground">請到 Email 開啟連結設定新密碼。這封信寄出後才算完成，頁面不會自行把密碼改掉。</p>
            <button type="button" onClick={onClose} className={`${btnPrimary} w-full`}>
              完成
            </button>
          </div>
        )}
      </div>
    </SheetModal>
  )
}

export function SetNewPasswordModal({ onClose, onNotify }: { onClose: () => void; onNotify: (m: string) => void }) {
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const issue = passwordIssue(next)
    if (issue) {
      setError(issue)
      return
    }
    if (next !== confirm) {
      setError('兩次輸入的新密碼不相同')
      return
    }
    setBusy(true)
    setError('')
    const { error: updateError } = await supabase.auth.updateUser({ password: next })
    setBusy(false)
    if (updateError) {
      setError(updateError.message || '密碼更新失敗')
      return
    }
    onNotify('新密碼已設定，請用新密碼登入')
    onClose()
  }

  return (
    <SheetModal title="設定新密碼" onClose={onClose} size="sm" z={110}>
      <form onSubmit={submit} className="space-y-4 p-5" noValidate>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          這是重設信連結帶回的正式流程。設定完成後，舊密碼就會失效。
        </p>
        <PasswordField label="新密碼" value={next} onChange={setNext} autoComplete="new-password" hint="至少 8 碼，需包含英文字母與數字" />
        <PasswordField label="確認新密碼" value={confirm} onChange={setConfirm} autoComplete="new-password" error={error} />
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}設定新密碼
        </button>
      </form>
    </SheetModal>
  )
}

export function SecurityPanel({ onNotify }: { onNotify: (m: string) => void }) {
  const [forgotOpen, setForgotOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [hasPassword, setHasPassword] = useState(true)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      const user = data.user
      setEmail(user?.email ?? '')
      const providers = user?.identities?.map((item) => item.provider) ?? []
      setHasPassword(providers.length === 0 || providers.includes('email'))
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section aria-label="帳戶安全" className="space-y-5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-blue-700 text-card">
          <LockKeyhole className="size-5" />
        </span>
        <div>
          <h3 className="text-base font-black">帳戶安全與密碼</h3>
          <p className="text-xs text-muted-foreground">透過 Supabase Auth 更新，不會另存一套密碼</p>
        </div>
      </div>

      <div className="max-w-md space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <h4 className="text-sm font-black">變更密碼</h4>
        {!ready ? (
          <p className="text-sm text-muted-foreground">正在確認登入方式</p>
        ) : !email ? (
          <p className="text-sm text-muted-foreground">請先登入後再管理密碼。</p>
        ) : !hasPassword ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>這個帳號使用第三方登入，沒有平台密碼，所以不會要求輸入目前密碼。</p>
            <button type="button" onClick={() => setForgotOpen(true)} className="text-xs font-bold text-brand-ink underline-offset-2 hover:underline">
              寄送 Email 設定密碼
            </button>
          </div>
        ) : (
          <>
            <ChangePasswordForm email={email} onDone={() => onNotify('密碼已更新')} onError={onNotify} />
            <button type="button" onClick={() => setForgotOpen(true)} className="text-xs font-bold text-brand-ink underline-offset-2 hover:underline">
              忘記目前密碼？
            </button>
          </>
        )}
      </div>

      <p className="max-w-md text-pretty text-xs leading-relaxed text-muted-foreground">
        密碼只交給 Supabase Auth 驗證與更新，不會寫進資料表或瀏覽器儲存。平台客服不會主動索取您的密碼。
      </p>

      {forgotOpen && <ForgotPasswordModal onClose={() => setForgotOpen(false)} onNotify={onNotify} />}
    </section>
  )
}
