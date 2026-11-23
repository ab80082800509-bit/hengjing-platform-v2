import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// 登入與簽到必須共用同一個瀏覽器 client，session 才會寫進同一份 localStorage。
// 伺服器與瀏覽器的 globalThis 不同，不會把會員 session 留在伺服器。
const store = globalThis
if (!store.__hengjingSupabase) {
  store.__hengjingSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}

export const supabase = store.__hengjingSupabase

export default supabase
