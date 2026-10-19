import fs from 'node:fs'

const target = '/vercel/share/v0-project/components/open-marketplace.tsx'
const specPath = '/vercel/share/v0-project/.v0work/variants-spec.txt'
fs.copyFileSync(target, '/vercel/share/v0-project/.v0work/open-marketplace.before-variants.tsx')

let src = fs.readFileSync(target, 'utf8')
const spec = fs.readFileSync(specPath, 'utf8').replace(/\r\n/g, '\n')

const count = (hay, needle) => hay.split(needle).length - 1
const trimNl = (s) => s.replace(/\n$/, '')

const edits = spec.split('#### EDIT ').slice(1)
let applied = 0
for (const chunk of edits) {
  const nl = chunk.indexOf('\n')
  const [label, mode] = chunk.slice(0, nl).trim().split(/\s+/)
  const body = chunk.slice(nl + 1)
  const parts = body.split(/^---- (OLD|END|NEW)\n/m)
  const sections = {}
  for (let i = 1; i < parts.length; i += 2) sections[parts[i]] = trimNl(parts[i + 1])

  if (mode === 'replace') {
    const n = count(src, sections.OLD)
    if (n !== 1) {
      console.error(`[${label}] expected 1 match, found ${n}`)
      process.exit(1)
    }
    src = src.replace(sections.OLD, () => sections.NEW)
  } else if (mode === 'between') {
    const start = src.indexOf(sections.OLD)
    if (start < 0 || count(src, sections.OLD) !== 1) {
      console.error(`[${label}] start marker matches: ${count(src, sections.OLD)}`)
      process.exit(1)
    }
    const end = src.indexOf(sections.END, start)
    if (end < 0) {
      console.error(`[${label}] end marker not found`)
      process.exit(1)
    }
    src = src.slice(0, start) + sections.NEW + '\n' + src.slice(end)
  } else {
    console.error(`[${label}] unknown mode ${mode}`)
    process.exit(1)
  }
  applied++
  console.log(`ok  ${label}`)
}

fs.writeFileSync(target, src)
console.log(`applied ${applied}/${edits.length}`)
