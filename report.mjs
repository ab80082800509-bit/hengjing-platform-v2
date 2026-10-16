import fs from 'fs'

const file = 'components/open-marketplace.tsx'
let s = fs.readFileSync(file, 'utf8')

const rep = (a, b) => {
  const n = s.split(a).length - 1
  if (n !== 1) throw new Error(`expected 1 match, got ${n}: ${a.slice(0, 70)}`)
  s = s.replace(a, () => b)
}
const repAll = (a, b) => {
  const n = s.split(a).length - 1
  if (n < 1) throw new Error(`no match: ${a.slice(0, 70)}`)
  s = s.split(a).join(b)
}
const repRe = (re, b) => {
  const all = s.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))
  if (!all || all.length !== 1) throw new Error(`regex matches ${all ? all.length : 0}: ${re}`)
  s = s.replace(re, (...args) => (typeof b === 'function' ? b(...args) : b))
}
const slice = (startMarker, endMarker, replacement) => {
  const a = s.indexOf(startMarker)
  const b = s.indexOf(endMarker, a + 1)
  if (a < 0 || b < 0) throw new Error(`slice markers missing: ${startMarker.slice(0, 40)}`)
  s = s.slice(0, a) + replacement + s.slice(b)
}

/* ---------- imports ---------- */
rep(
  "import { BuyerProfileHeader, BuyerProfilePanel, FavoritesPanel, FollowingPanel, type FollowPrefs } from './buyer-profile'",
  "import { BuyerProfileHeader, BuyerProfilePanel, FavoritesPanel, FollowingPanel, UserAvatar, type FollowPrefs } from './buyer-profile'\nimport { EvidenceThumbs, EvidenceUploader } from './evidence-uploader'",
)

/* ---------- types ---------- */
rep(
  'interface Review {\n  user: string',
  "interface Viewer {\n  name: string\n  tone: number\n  avatar?: string\n}\n\ninterface Review {\n  owner?: string\n  user: string",
)
rep('logoClass: string\n', 'logoClass: string\n  logo?: string\n')
repAll("'product' | 'ban'", "'product' | 'ban' | 'seller'")
rep(
  "type ReportReason = 'prohibited' | 'fake' | 'price' | 'ip'",
  "type ReportReason = 'prohibited' | 'fake' | 'price' | 'ip' | 'mismatch' | 'other'",
)
repRe(
  /(reporterType\?: 'buyer' \| 'brand'\s*contact\?: string)(\s*\})/,
  (_m, a, b) => `${a}\n  targetType?: 'product' | 'seller'\n  evidence?: string[]\n  reporterAccount?: string\n  ts?: number${b}`,
)

/* ---------- reasons + limits ---------- */
slice(
  'const REPORT_REASONS: {',
  'const reportStatusMeta:',
  `const REPORT_REASONS: { id: ReportReason; label: string; hint: string; icon: typeof Flag }[] = [
  { id: 'fake', label: '疑似詐騙 / 假貨', hint: '仿冒品、盜版或疑似詐騙行為', icon: ShieldAlert },
  { id: 'mismatch', label: '商品描述不符', hint: '圖片、規格或說明與實際內容不一致', icon: ImageOff },
  { id: 'price', label: '價格異常 / 誘導私下交易', hint: '價格明顯不合理，或引導買家脫離平台交易', icon: Banknote },
  { id: 'prohibited', label: '違禁品', hint: '疑似販售法令禁止或管制的物品', icon: Ban },
  { id: 'ip', label: '侵權 / 圖片盜用', hint: '未經授權使用品牌商標、圖片或著作內容', icon: Flag },
  { id: 'other', label: '其他', hint: '以上皆不符，請在詳細說明中描述', icon: CircleAlert },
]
const REPORT_LIMIT = 3
const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000
const REPORT_NOTE_MIN = 15
const REPORT_WARNING = '⚠️ 請如實回報。若經查證屬惡意捏造或濫用檢舉功能，平台將永久取消檢舉權限並凍結帳號。'
`,
)

/* ---------- Avatar (seller logo) ---------- */
rep(
  'function Avatar({ seller, size = \'size-10\' }: { seller: Seller; size?: string }) {\n  return (',
  `function Avatar({ seller, size = 'size-10' }: { seller: Seller; size?: string }) {
  if (seller.logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={seller.logo} alt="" aria-hidden="true" className={\`\${size} shrink-0 rounded-2xl border border-border/60 object-cover shadow-sm\`} />
    )
  }
  return (`,
)

/* ---------- ProductModal ---------- */
rep(
  '  onReport,\n  checkin = false,\n  faved = false,',
  '  onReport,\n  viewer = null,\n  reportsLeft = REPORT_LIMIT,\n  onNeedLogin,\n  checkin = false,\n  faved = false,',
)
rep(
  '  onReport: (reason: ReportReason, note: string) => void\n  checkin?: boolean',
  '  onReport: (reason: ReportReason, note: string, evidence: string[]) => void\n  viewer?: Viewer | null\n  reportsLeft?: number\n  onNeedLogin?: () => void\n  checkin?: boolean',
)
rep(
  'onClick={() => setReportOpen(true)}\n            className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground transition hover:text-destructive"',
  'onClick={() => (viewer ? setReportOpen(true) : onNeedLogin?.())}\n            className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground transition hover:text-destructive"',
)
rep(
  '<span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-black text-accent-foreground">{r.user.slice(0, 1)}</span>',
  `{viewer && r.owner === viewer.name ? (
                        <UserAvatar name={viewer.name} tone={viewer.tone} src={viewer.avatar} size="size-8" textSize="text-xs" />
                      ) : (
                        <span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-black text-accent-foreground">{r.user.slice(0, 1)}</span>
                      )}`,
)
rep(
  `      <ReportModal
        product={product}
        onClose={() => setReportOpen(false)}
        onSubmit={(reason, note) => {
          setReportOpen(false)
          onReport(reason, note)
        }}
      />`,
  `      <ReportModal
        title="檢舉此商品"
        target={{ name: product.name, image: product.image }}
        left={reportsLeft}
        onClose={() => setReportOpen(false)}
        onSubmit={(reason, note, evidence) => {
          setReportOpen(false)
          onReport(reason, note, evidence)
        }}
      />`,
)

/* ---------- ReportModal ---------- */
slice(
  'function ReportModal({',
  '/* ----------------------------------------------------------------------------\n * 賣家專屬賣場 Modal',
  `function ReportModal({
  title,
  target,
  left,
  onClose,
  onSubmit,
}: {
  title: string
  target: { name: string; image?: string; seller?: Seller }
  left: number
  onClose: () => void
  onSubmit: (reason: ReportReason, note: string, evidence: string[]) => void
}) {
  const [reason, setReason] = useState<ReportReason | ''>('')
  const [note, setNote] = useState('')
  const [evidence, setEvidence] = useState<string[]>([])
  const [errors, setErrors] = useState<{ reason?: string; note?: string }>({})
  const blocked = left <= 0
  const noteLen = note.trim().length
  const hint = REPORT_REASONS.find((r) => r.id === reason)?.hint

  return (
    <Modal title={title} onClose={onClose} size="md" z={70}>
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (blocked) return
          const next: { reason?: string; note?: string } = {}
          if (!reason) next.reason = '請先選擇檢舉原因'
          if (noteLen < REPORT_NOTE_MIN) next.note = \`詳細說明至少需 \${REPORT_NOTE_MIN} 字，請提供具體事證（目前 \${noteLen} 字）\`
          setErrors(next)
          if (next.reason || next.note || !reason) return
          onSubmit(reason, note.trim(), evidence)
        }}
      >
        <div className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3">
          {target.image ? (
            <div className="size-14 shrink-0 overflow-hidden rounded-xl border border-border/70">
              <ProductImage src={target.image} alt={target.name} />
            </div>
          ) : target.seller ? (
            <Avatar seller={target.seller} size="size-14" />
          ) : null}
          <p className="min-w-0 text-sm font-bold leading-snug">{target.name}</p>
        </div>

        <p
          role="status"
          className={\`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold \${blocked ? 'bg-red-50 text-destructive' : 'bg-muted text-muted-foreground'}\`}
        >
          <CircleAlert className="size-3.5 shrink-0" />
          {blocked
            ? \`您已達 24 小時內 \${REPORT_LIMIT} 次檢舉上限，請稍後再試\`
            : \`24 小時內最多可檢舉 \${REPORT_LIMIT} 次，目前還可提交 \${left} 次\`}
        </p>

        <Field label="檢舉原因" error={errors.reason}>
          <select
            className={inputCls}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as ReportReason | '')
              setErrors((x) => ({ ...x, reason: undefined }))
            }}
          >
            <option value="">請選擇檢舉原因</option>
            {REPORT_REASONS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
        </Field>

        <Field label={\`詳細說明（必填，至少 \${REPORT_NOTE_MIN} 字）\`} error={errors.note}>
          <textarea
            className={\`\${inputCls} min-h-24\`}
            value={note}
            onChange={(e) => {
              setNote(e.target.value)
              setErrors((x) => ({ ...x, note: undefined }))
            }}
            maxLength={500}
            placeholder="請具體描述您發現的問題，例如時間、對話內容或商品與實物的差異"
          />
          <p className={\`mt-1 text-right text-xs \${noteLen >= REPORT_NOTE_MIN ? 'text-emerald-700' : 'text-muted-foreground'}\`}>
            {noteLen} / {REPORT_NOTE_MIN} 字以上
          </p>
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-bold">佐證截圖（選填）</p>
          <EvidenceUploader value={evidence} onChange={setEvidence} />
        </div>

        <p role="note" className="text-pretty rounded-xl border border-destructive/30 bg-red-50 p-3 text-xs font-bold leading-relaxed text-destructive">
          {REPORT_WARNING}
        </p>
        <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
          檢舉不會直接下架，案件會進入後台待審區由人工審核；賣家可提出申訴與回覆，檢舉人資料依法保密。
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>取消</button>
          <button type="submit" disabled={blocked} className={\`\${btnDanger} disabled:opacity-50\`}>
            <Flag className="size-4" />送出檢舉
          </button>
        </div>
      </form>
    </Modal>
  )
}

`,
)

/* ---------- AppealModal labels ---------- */
rep(
  "kind === 'ban' ? '申請解除封鎖' : '商品下架申訴'",
  "kind === 'ban' ? '申請解除封鎖' : kind === 'seller' ? '賣場檢舉申訴 / 回覆' : '商品申訴 / 回覆'",
)
rep(
  "kind === 'ban' ? '申訴對象：賣家帳號' : '申訴對象：被下架商品'",
  "kind === 'ban' ? '申訴對象：賣家帳號' : kind === 'seller' ? '申訴對象：被檢舉的賣場' : '申訴對象：被檢舉商品'",
)

/* ---------- state ---------- */
rep(
  'useState<{ tone: number; nameChangedAt?: string }>({ tone: 0 })',
  'useState<{ tone: number; avatar?: string; nameChangedAt?: string }>({ tone: 0 })',
)

/* ---------- handlers ---------- */
slice(
  'const reportProduct = (',
  'const dismissReport = (id: string) => {',
  `const reportsLeft = account
    ? Math.max(0, REPORT_LIMIT - reports.filter((r) => r.reporterAccount === account.name && Date.now() - (r.ts ?? 0) < REPORT_WINDOW_MS).length)
    : 0
  const viewer: Viewer | null = account ? { name: account.name, tone: buyerProfile.tone, avatar: buyerProfile.avatar } : null
  const needLoginForReport = () => {
    notify('請先登入會員後再檢舉（不需實名認證）')
    setAuthOpen(true)
  }
  const uploadAvatar = (dataUrl: string) => {
    setBuyerProfile((p) => ({ ...p, avatar: dataUrl }))
    if (mySeller) setSellers((l) => l.map((x) => (x.id === mySeller.id ? { ...x, logo: dataUrl } : x)))
    notify('大頭貼已更新')
  }
  const removeAvatar = () => {
    setBuyerProfile((p) => ({ ...p, avatar: undefined }))
    if (mySeller) setSellers((l) => l.map((x) => (x.id === mySeller.id ? { ...x, logo: undefined } : x)))
    notify('已移除大頭貼')
  }
  const canReport = (extra?: { reporterType?: 'buyer' | 'brand' }) => {
    if (extra?.reporterType === 'brand') return true
    if (!account) {
      needLoginForReport()
      return false
    }
    if (reportsLeft <= 0) {
      notify(\`24 小時內最多只能檢舉 \${REPORT_LIMIT} 次，請稍後再試\`)
      return false
    }
    return true
  }
  const reportProduct = (
    pid: string,
    reason: ReportReason,
    note: string,
    extra?: { reporterType?: 'buyer' | 'brand'; contact?: string; evidence?: string[] },
  ) => {
    const product = products.find((p) => p.id === pid)
    if (!product) return
    if (!canReport(extra)) return
    const reasonLabel = REPORT_REASONS.find((r) => r.id === reason)?.label ?? '其他'
    pushNotice(
      product.sellerId,
      'reported',
      product.name,
      \`您的商品「\${product.name}」被檢舉，已進入平台審核\`,
      \`檢舉原因：\${reasonLabel}。商品不會被直接下架，案件已進入後台待審區，平台將人工審核；您可在下方提出申訴或回覆說明，提供出貨證明、進貨單據等佐證。檢舉人資料依法保密。\`,
      \`您的商品「\${product.name}」遭檢舉（\${reasonLabel}），進入人工審核，商品仍正常上架。如有異議可登入賣家後台申訴回覆。\`,
      product.id,
    )
    const d = new Date()
    const report: Report = {
      id: \`R\${Date.now()}\`,
      productId: pid,
      sellerId: product.sellerId,
      productName: product.name,
      productImage: product.image,
      reason,
      note,
      reporter: extra?.reporterType === 'brand' ? '品牌權利人' : maskName(account?.name ?? '匿名買家'),
      at: \`\${todayStr()} \${pad(d.getHours())}:\${pad(d.getMinutes())}\`,
      status: 'open',
      reporterType: extra?.reporterType ?? 'buyer',
      contact: extra?.contact,
      targetType: 'product',
      evidence: extra?.evidence,
      reporterAccount: extra?.reporterType === 'brand' ? undefined : account?.name,
      ts: Date.now(),
    }
    setReports((l) => [report, ...l])
    notify('檢舉已送出，平台將進行人工審核')
  }
  const reportSeller = (sid: string, reason: ReportReason, note: string, evidence: string[]) => {
    const target = sellers.find((x) => x.id === sid)
    if (!target || !canReport()) return
    const reasonLabel = REPORT_REASONS.find((r) => r.id === reason)?.label ?? '其他'
    pushNotice(
      sid,
      'reported',
      target.name,
      '您的賣場被檢舉，已進入平台審核',
      \`檢舉原因：\${reasonLabel}。賣場不會被直接停權，案件已進入後台待審區，平台將人工審核；您可提出申訴或回覆說明。檢舉人資料依法保密。\`,
      \`您的賣場遭檢舉（\${reasonLabel}），進入人工審核，賣場仍正常營運。如有異議可登入賣家後台申訴回覆。\`,
    )
    const d = new Date()
    const report: Report = {
      id: \`R\${Date.now()}\`,
      productId: '',
      sellerId: sid,
      productName: target.name,
      productImage: target.logo ?? '',
      reason,
      note,
      reporter: maskName(account?.name ?? '匿名買家'),
      at: \`\${todayStr()} \${pad(d.getHours())}:\${pad(d.getMinutes())}\`,
      status: 'open',
      reporterType: 'buyer',
      targetType: 'seller',
      evidence,
      reporterAccount: account?.name,
      ts: Date.now(),
    }
    setReports((l) => [report, ...l])
    notify('檢舉已送出，平台將進行人工審核')
  }
  `,
)

repRe(
  /(const dismissReport = \(id: string\) => \{\s*const target = reports\.find\(\(r\) => r\.id === id\)\s*if \(!target\) return)/,
  (m) => `${m}
  if (target.targetType === 'seller') {
    setReports((l) => l.map((r) => (r.id === id ? { ...r, status: 'dismissed' } : r)))
    pushNotice(target.sellerId, 'dismissed', target.productName, '賣場檢舉已駁回', '平台審核後認定賣場無違規，您無需任何操作。', '平台審核後駁回對您賣場的檢舉。')
    notify('已駁回對賣家的檢舉')
    return
  }`,
)
repRe(
  /(const confirmReport = \(id: string\) => \{\s*const target = reports\.find\(\(r\) => r\.id === id\)\s*if \(!target\) return)/,
  (m) => `${m}
  if (target.targetType === 'seller') {
    setReports((l) => l.map((r) => (r.id === id ? { ...r, status: 'confirmed' } : r)))
    pushNotice(target.sellerId, 'confirmed', target.productName, '賣場經審核確認違規', '平台審核後確認您的賣場存在違規情事，請立即改善；累計違規可能導致賣場被永久封鎖。', '您的賣場經平台審核確認違規，請儘速改善。')
    notify('已確認賣家違規並通知賣家')
    return
  }`,
)

/* resolveAppeal: seller kind */
rep(
  "if (approve && a.kind === 'ban') {",
  "if (approve && a.kind === 'seller') {\n  setReports((l) => l.map((r) => (r.sellerId === a.sellerId && r.targetType === 'seller' && r.status === 'open' ? { ...r, status: 'dismissed' } : r)))\n  }\n  if (approve && a.kind === 'ban') {",
)
rep(
  "const subject = a.kind === 'ban' ? '賣家帳號' :",
  "const subject = a.kind === 'ban' ? '賣家帳號' : a.kind === 'seller' ? '被檢舉的賣場' :",
)
rep(
  "? a.kind === 'ban' ? '申訴成立，賣家帳號已解除封鎖' :",
  "? a.kind === 'seller' ? '申訴成立，對賣場的檢舉已撤銷' : a.kind === 'ban' ? '申訴成立，賣家帳號已解除封鎖' :",
)
rep(
  "${a.kind === 'ban' ? '帳號已解除封鎖。' : '商品已恢復上架。'}",
  "${a.kind === 'seller' ? '對賣場的檢舉已撤銷。' : a.kind === 'ban' ? '帳號已解除封鎖。' : '商品已恢復上架。'}",
)

/* ---------- main call sites ---------- */
rep(
  'onReport={(reason, note) => reportProduct(openProduct.id, reason, note)}',
  'onReport={(reason, note, evidence) => reportProduct(openProduct.id, reason, note, { evidence })}\n          viewer={viewer}\n          reportsLeft={reportsLeft}\n          onNeedLogin={needLoginForReport}',
)
repRe(
  /(onOpenProduct=\{\(id\) => setProductId\(id\)\}\s*onChat=\{\(\) => setChatId\(storeSeller\.id\)\})/,
  (m) => `${m}\n          viewer={viewer}\n          reportsLeft={reportsLeft}\n          onNeedLogin={needLoginForReport}\n          onReport={(reason, note, evidence) => reportSeller(storeSeller.id, reason, note, evidence)}`,
)
rep(
  'onAvatar={(i) => setBuyerProfile((p) => ({ ...p, tone: i }))}',
  'onAvatar={(i) => setBuyerProfile((p) => ({ ...p, tone: i }))}\n          avatar={buyerProfile.avatar}\n          onAvatarUpload={uploadAvatar}\n          onAvatarRemove={removeAvatar}',
)

/* ---------- BuyerCenterModal ---------- */
repRe(
  /(  tone,\s*nameChangedAt,\s*onRename,\s*onAvatar,)(\s*onSwitchSeller,)/,
  (_m, a, b) => `${a}\n  avatar,\n  onAvatarUpload,\n  onAvatarRemove,${b}`,
)
repRe(
  /(  tone: number\s*nameChangedAt\?: string\s*onRename: \(n: string\) => void\s*onAvatar: \(i: number\) => void)/,
  (m) => `${m}\n  avatar?: string\n  onAvatarUpload: (dataUrl: string) => void\n  onAvatarRemove: () => void`,
)
rep(
  '<BuyerProfileHeader name={buyerName} tone={tone} completed',
  '<BuyerProfileHeader name={buyerName} tone={tone} avatar={avatar} completed',
)
rep(
  '              tone={tone}\n              nameChangedAt={nameChangedAt}',
  '              tone={tone}\n              avatar={avatar}\n              onAvatarUpload={onAvatarUpload}\n              onAvatarRemove={onAvatarRemove}\n              nameChangedAt={nameChangedAt}',
)

fs.writeFileSync(file, s)
console.log('patched ok')
