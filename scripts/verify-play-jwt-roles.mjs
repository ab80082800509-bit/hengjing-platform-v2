const page = process.argv[2]
const html = await (await fetch(page)).text()
const base = new URL(page).origin
const paths = [...new Set([...html.matchAll(/\/_next\/[^"'\\\s]+/g)].map((match) => match[0]))]
const roles = new Map()
for (const path of paths) {
  const text = await (await fetch(base + path)).text()
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString('utf8'))
      const key = `${payload.role ?? 'none'}|${payload.iss ?? 'none'}`
      roles.set(key, (roles.get(key) ?? 0) + 1)
    } catch {
      roles.set('undecodable', (roles.get('undecodable') ?? 0) + 1)
    }
  }
}
console.log(base)
for (const [key, count] of roles) console.log(count, key)
