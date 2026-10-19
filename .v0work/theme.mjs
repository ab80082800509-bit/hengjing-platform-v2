import fs from 'node:fs'
const f = 'app/globals.css'
let s = fs.readFileSync(f, 'utf8')
const a = s.indexOf(':root {')
const b = s.indexOf('@layer base')
if (a < 0 || b < 0) throw new Error('markers not found')
const root = `:root {
  color-scheme: dark;
  --background: #18181b;
  --foreground: #f4f4f5;
  --card: #27272a;
  --card-foreground: #f4f4f5;
  --popover: #27272a;
  --popover-foreground: #f4f4f5;
  --primary: #f97316;
  --primary-foreground: #1c0a02;
  --secondary: #2d2a27;
  --secondary-foreground: #fdba74;
  --muted: #303034;
  --muted-foreground: #a1a1aa;
  --accent: #3a2c20;
  --accent-foreground: #fdba74;
  --destructive: #ef4444;
  --border: rgb(63 63 70 / 0.5);
  --input: #3f3f46;
  --ring: #f97316;
  --brand-ink: #fb923c;
  --verified: #38a9f5;
  --chart-1: #f97316;
  --chart-2: #fb923c;
  --chart-3: #fdba74;
  --chart-4: #a1a1aa;
  --chart-5: #f4f4f5;
  --radius: 0.75rem;
  --sidebar: #27272a;
  --sidebar-foreground: #f4f4f5;
  --sidebar-primary: #f97316;
  --sidebar-primary-foreground: #1c0a02;
  --sidebar-accent: #303034;
  --sidebar-accent-foreground: #f4f4f5;
  --sidebar-border: rgb(63 63 70 / 0.5);
  --sidebar-ring: #f97316;
}

`
s = s.slice(0, a) + root + s.slice(b)
fs.writeFileSync(f, s)
console.log('ok')
