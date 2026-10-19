import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Noto_Sans_TC } from 'next/font/google'
import { PwaRegister } from '@/components/pwa-register'
import './globals.css'

const notoSansTC = Noto_Sans_TC({
  weight: ['400', '500', '700', '900'],
  preload: false,
  display: 'swap',
  variable: '--font-noto',
})

export const metadata: Metadata = {
  title: '買個 Pay 服｜開放式電商平台',
  description:
    '買個 Pay 服是開放式電商平台：買家註冊逛市集、賣家實名認證開店，內建購物車拆單、金物流、月費訂閱與雙後台管理。',
  generator: 'v0.app',
  applicationName: '買個 Pay 服',
  icons: {
    icon: [
      { url: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: '買個 Pay 服',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  colorScheme: 'dark',
  themeColor: '#18181b',
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-Hant" className={`bg-background ${notoSansTC.variable}`}>
      <body className="font-sans antialiased">
        {children}
        <PwaRegister />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
