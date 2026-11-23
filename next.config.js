/** @type {import('next').NextConfig} */

function supabaseStoragePattern() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || !url.hostname) return null
    return {
      protocol: 'https',
      hostname: url.hostname,
      pathname: '/storage/v1/object/public/**',
    }
  } catch {
    return null
  }
}

const storagePattern = supabaseStoragePattern()

// 3000 維持 .next。只有試玩程序明示 PLAY_DIST_DIR 時才改用獨立輸出，避免和第二個 next dev 搶同一份編譯結果。
const playDist = process.env.PLAY_DIST_DIR
const distDir = playDist === '.next-play' || playDist === '.next-play-build' ? playDist : '.next'

const nextConfig = {
  distDir,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: storagePattern ? [storagePattern] : [],
  },
}

module.exports = nextConfig