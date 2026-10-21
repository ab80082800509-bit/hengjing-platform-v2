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

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: storagePattern ? [storagePattern] : [],
  },
}

module.exports = nextConfig