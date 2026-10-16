'use client'

import { useId, useState, type FormEvent } from 'react'
import { Check, CircleAlert, Eye, EyeOff, KeyRound, LockKeyhole, MailCheck } from 'lucide-react'
import { SheetModal } from './sheet-modal'

const inputCls =
  'w-full rounded-xl border bg-card py-2.5 pl-3 pr-11 text-base outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/30 sm:text-sm'
const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'
const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'

export const DEMO_RESET_CODE = '246810'

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

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const err: Record<string, string> = {}
    if (!current) err.current = '請輸入目前密碼'
    const issue = passwordIssue(next)
    if (issue) err.next = issue
    else if (next === current) err.next = '新密碼不能與目前密碼相同'
    if (confirm !== next) err.confirm = '兩次輸入的新密碼不一致'
    setErrors(err)
    if (Object.keys(err).length) return
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
      <button type="submit" className={`${btnPrimary} w-full sm:w-auto`}>
        <LockKeyhole className="size-4" />更新密碼
      </button>
    </form>
  )
}

type ResetStep = 'identify' | 'code' | 'reset' | 'done'

export function ForgotPasswordModal({ onClose, onNotify }: { onClose: () => void; onNotify: (m: string) => void }) {
  const [step, setStep] = useState<ResetStep>('identify')
  const [account, setAccount] = useState('')
  const [code, setCode] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const steps: { id: ResetStep; label: string }[] = [
    { id: 'identify', label: '確認身分' },
    { id: 'code', label: '輸入驗證碼' },
    { id: 'reset', label: '設定新密碼' },
  ]
  const at = steps.findIndex((s) => s.id === step)

  const sendCode = (e: FormEvent) => {
    e.preventDefault()
    const v = account.trim()
    if (!/^09\d{8}$/.test(v) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setError('請輸入註冊的 Email 或 10 碼手機號碼')
      return
    }
    setError('')
    setStep('code')
    onNotify('驗證碼已發送（示範環境）')
  }

  const verify = (e: FormEvent) => {
    e.preventDefault()
    if (code !== DEMO_RESET_CODE) {
      setError('驗證碼不正確，請重新輸入')
      return
    }
    setError('')
    setStep('reset')
  }

  const reset = (e: FormEvent) => {
    e.preventDefault()
    const err: Record<string, string> = {}
    const issue = passwordIssue(next)
    if (issue) err.next = issue
    if (confirm !== next) err.confirm = '兩次輸入的新密碼不一致'
    setFieldErrors(err)
    if (Object.keys(err).length) return
    setStep('done')
  }

  return (
    <SheetModal title="忘記密碼" onClose={onClose} size="sm" z={100}>
      <div className="space-y-5 p-5">
        {step !== 'done' && (
          <ol className="flex items-center gap-2" aria-label="重設進度">
            {steps.map((s, i) => (
              <li key={s.id} className="flex flex-1 items-center gap-2" aria-current={i === at ? 'step' : undefined}>
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                    i <= at ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {i < at ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className={`hidden text-xs font-bold sm:block ${i === at ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
                {i < steps.length - 1 && <span className="h-px flex-1 bg-border" />}
              </li>
            ))}
          </ol>
        )}

        {step === 'identify' && (
          <form onSubmit={sendCode} className="space-y-4" noValidate>
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              請輸入註冊時使用的 Email 或手機號碼，我們會寄送 6 碼驗證碼。
            </p>
            <div className="space-y-1.5">
              <label htmlFor="reset-account" className="text-xs font-bold text-muted-foreground">Email 或手機號碼</label>
              <input
                id="reset-account"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                autoComplete="username"
                className={`${inputCls} pr-3 ${error ? 'border-destructive' : 'border-input'}`}
                placeholder="name@example.com 或 0912345678"
              />
              {error && <p role="alert" className="text-xs font-bold text-destructive">{error}</p>}
            </div>
            <button type="submit" className={`${btnPrimary} w-full`}>
              <MailCheck className="size-4" />發送驗證碼
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verify} className="space-y-4" noValidate>
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              驗證碼已發送至 <b className="text-foreground">{account.trim()}</b>，10 分鐘內有效。
            </p>
            <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              示範環境不會真的寄信，驗證碼為 <b className="font-mono text-foreground">{DEMO_RESET_CODE}</b>
            </p>
            <div className="space-y-1.5">
              <label htmlFor="reset-code" className="text-xs font-bold text-muted-foreground">6 碼驗證碼</label>
              <input
                id="reset-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={`${inputCls} pr-3 text-center font-mono tracking-[0.4em] ${error ? 'border-destructive' : 'border-input'}`}
                placeholder="000000"
              />
              {error && <p role="alert" className="text-xs font-bold text-destructive">{error}</p>}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setStep('identify'); setError(''); setCode('') }} className={btnGhost}>上一步</button>
              <button type="submit" disabled={code.length !== 6} className={`${btnPrimary} flex-1`}>驗證</button>
            </div>
          </form>
        )}

        {step === 'reset' && (
          <form onSubmit={reset} className="space-y-4" noValidate>
            <PasswordField label="新密碼" value={next} onChange={setNext} error={fieldErrors.next} autoComplete="new-password" hint="至少 8 碼，需包含英文字母與數字" />
            <PasswordField label="確認新密碼" value={confirm} onChange={setConfirm} error={fieldErrors.confirm} autoComplete="new-password" />
            <button type="submit" className={`${btnPrimary} w-full`}>
              <KeyRound className="size-4" />重設密碼
            </button>
          </form>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <Check className="size-7" />
            </span>
            <h3 className="text-lg font-black">密碼已重設</h3>
            <p className="text-pretty text-sm text-muted-foreground">請使用新密碼重新登入。基於安全考量，其他裝置會一併登出。</p>
            <button
              type="button"
              onClick={() => {
                onNotify('密碼已重設，請使用新密碼登入')
                onClose()
              }}
              className={`${btnPrimary} w-full`}
            >
              完成
            </button>
          </div>
        )}
      </div>
    </SheetModal>
  )
}

export function SecurityPanel({ onNotify }: { onNotify: (m: string) => void }) {
  const [forgotOpen, setForgotOpen] = useState(false)
  return (
    <section aria-label="帳戶安全" className="space-y-5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-blue-700 text-card">
          <LockKeyhole className="size-5" />
        </span>
        <div>
          <h3 className="text-base font-black">帳戶安全與密碼</h3>
          <p className="text-xs text-muted-foreground">買家與賣家帳號皆適用</p>
        </div>
      </div>

      <div className="max-w-md space-y-4 rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <h4 className="text-sm font-black">變更密碼</h4>
        <ChangePasswordForm onDone={() => onNotify('密碼已更新')} />
        <button
          type="button"
          onClick={() => setForgotOpen(true)}
          className="text-xs font-bold text-brand-ink underline-offset-2 hover:underline"
        >
          忘記目前密碼？
        </button>
      </div>

      <p className="max-w-md text-pretty text-xs leading-relaxed text-muted-foreground">
        示範環境不會儲存真實密碼。請勿向任何人透露驗證碼，平台客服不會主動索取您的密碼。
      </p>

      {forgotOpen && <ForgotPasswordModal onClose={() => setForgotOpen(false)} onNotify={onNotify} />}
    </section>
  )
}
