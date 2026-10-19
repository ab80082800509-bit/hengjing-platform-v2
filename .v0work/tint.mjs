import fs from 'node:fs'
const hues = 'amber|emerald|blue|red|rose|yellow'
const files = fs.readdirSync('components').filter((f) => f.endsWith('.tsx')).map((f) => 'components/' + f)
let total = 0
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  const out = lines.map((line) => {
    // solid gold badges / bounce chip keep their dark-on-gold text
    const solidLight = /bg-amber-400|from-amber-300|bg-yellow-200|bg-yellow-300/.test(line)
    let l = line
    l = l.replace(new RegExp(`\\bbg-(${hues})-50/60\\b`, 'g'), 'bg-$1-500/10')
    l = l.replace(new RegExp(`\\bbg-(${hues})-50\\b`, 'g'), 'bg-$1-500/10')
    l = l.replace(new RegExp(`\\bbg-(${hues})-100\\b`, 'g'), 'bg-$1-500/15')
    l = l.replace(new RegExp(`\\b(border|ring)-(${hues})-(200|300)\\b`, 'g'), '$1-$2-500/35')
    if (!solidLight) {
      l = l.replace(new RegExp(`\\btext-(${hues})-(800|900|950)\\b`, 'g'), 'text-$1-300')
      l = l.replace(new RegExp(`\\btext-(${hues})-700\\b`, 'g'), 'text-$1-400')
    }
    l = l.replace(/\btext-(emerald|amber)-600\b/g, 'text-$1-400')
    return l
  })
  const next = out.join('\n')
  if (next !== lines.join('\n')) { fs.writeFileSync(f, next); total++; console.log('updated', f) }
}
console.log('files changed', total)
