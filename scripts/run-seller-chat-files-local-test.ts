/**
 * 買賣家聊聊照片與檔案。只連隔離庫 127.0.0.1:54322。
 * 會重複套用本輪這一個增量檔，不重跑歷史檔。測試資料最後還原。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import {
  CHAT_FILE_BUCKET,
  CHAT_FILE_LIMIT_TEXT,
  CHAT_FILE_MAX_BYTES,
  CHAT_FILE_MAX_COUNT,
  chatFileRefusal,
  resolveChatFileMime,
} from '../lib/chat-files'

const HOST = '127.0.0.1'
const PORT = 54322
const DB_CONTAINER = 'supabase_db_hengjing-stage45-local'
const KONG_CONTAINER = 'supabase_kong_hengjing-stage45-local'
const A = 'f11a0000-0000-4000-8000-0000000000a1'
const B = 'f22b0000-0000-4000-8000-0000000000b2'
const C = 'f33c0000-0000-4000-8000-0000000000c3'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const passed: string[] = []
const pass = (name: string) => {
  passed.push(name)
  console.log(`  ✓ ${name}`)
}

function checkClient() {
  const ui = readFileSync('components/seller-chat.tsx', 'utf8')
  const features = readFileSync('lib/marketplace-features.ts', 'utf8')
  const rules = readFileSync('lib/chat-files.ts', 'utf8')
  const sql = readFileSync('supabase/manual/20261030031100_seller_chat_files.sql', 'utf8')
  assert(ui.includes('CHAT_FILE_LIMIT_TEXT') && rules.includes(CHAT_FILE_LIMIT_TEXT), '畫面沒有寫出附件上限')
  assert(ui.includes('capture="environment"'), '手機沒有拍照入口')
  assert(ui.includes('從相簿選取照片') && ui.includes('選取檔案'), '相簿或檔案入口不在')
  assert(ui.includes('取消選取') && ui.includes('重試傳送') && ui.includes('放大照片') && ui.includes('下載檔案'), '預覽、取消、重試、放大或下載不在')
  assert(ui.includes('載入較早的訊息'), '沒有載入較早訊息')
  assert(!features.includes(`getPublicUrl`) || !features.slice(features.indexOf('uploadSellerChatFile')).includes('getPublicUrl'), '聊天附件使用了永久公開連結')
  assert(features.includes('createSignedUrl'), '沒有授權讀取')
  assert(sql.includes('public = false') || sql.includes('public,\n  false'), 'SQL 沒有把附件桶設成私人')
  assert(sql.includes(String(CHAT_FILE_MAX_BYTES)) && sql.includes('application/pdf') && sql.includes('image/webp'), 'SQL 上限或格式與畫面不一致')
  assert(sql.includes('seller_chat_file_deletable'), '已送出的附件沒有刪除保護')
  assert(chatFileRefusal({ name: 'a.gif', type: 'image/gif', size: 10 }) === '只支援 JPG、PNG、WEBP 照片或 PDF 檔案', '不支援的格式沒有原因')
  assert(chatFileRefusal({ name: 'big.png', type: 'image/png', size: CHAT_FILE_MAX_BYTES + 1 }) === '單檔上限 8MB', '超過 8MB 沒有原因')
  assert(chatFileRefusal({ name: 'empty.png', type: 'image/png', size: 0 }) === '檔案是空的', '空檔沒有原因')
  assert(chatFileRefusal({ name: 'ok.png', type: 'image/png', size: 32 }) === '', '合格照片被拒絕')
  assert(resolveChatFileMime({ name: 'note.pdf', type: '' }) === 'application/pdf', '沒有型別的 PDF 沒有辨識')
  assert(CHAT_FILE_MAX_COUNT === 3 && CHAT_FILE_BUCKET === 'seller-chat-files', '選取數量或桶名不對')
  assert(sql.includes('REVOKE ALL ON FUNCTION public.list_seller_chat_messages(uuid) FROM PUBLIC, anon;'), '讀取函式沒有同時撤銷 PUBLIC 與 anon')
  assert(sql.includes('notification_outbox 缺少 event_key 防重約束，停止'), '沒有檢查通知防重約束')
  assert(sql.includes('是未知版本，停止'), '未知函式版本沒有停止')
  assert(sql.includes('附件表欄位與這份增量不一致，停止'), '既有附件表沒有核對欄位')
  assert(sql.includes('pg_advisory_xact_lock(hashtext(\'seller-chat-file\'), hashtext('), '送出與刪除沒有鎖住同一個路徑')
  assert(sql.includes('AS RESTRICTIVE'), '沒有只限制 seller-chat-files 的政策')
  pass('畫面與儲存上限一致，不支援與過大的檔案有清楚原因')
}

const SQL_FILE = 'supabase/manual/20261030031100_seller_chat_files.sql'
const PREVIOUS_SEND = 'ffcbc5d5d0ba2bb057097a57e5f357de'
const PREVIOUS_DELETABLE = '57662d0356dc0061512a6b085f78883d'

function functionHashes(file: string) {
  const sql = readFileSync(file, 'utf8')
  const found: Record<string, string[]> = {}
  const re = /CREATE (?:OR REPLACE )?FUNCTION public\.([a-z0-9_]+)\(/g
  const marker = 'AS ' + '$'.repeat(2)
  const closer = '$'.repeat(2) + ';'
  let match: RegExpExecArray | null
  while ((match = re.exec(sql))) {
    const asAt = sql.indexOf(marker, match.index)
    const open = asAt + marker.length
    const close = sql.indexOf(closer, open)
    const body = sql.slice(open, close).replace(/\r\n/g, '\n')
    const hash = createHash('md5').update(body).digest('hex')
    found[match[1]] = found[match[1]] || []
    found[match[1]].push(hash)
  }
  return found
}

function sqlBody(sql: string) {
  const start = sql.indexOf('\nBEGIN;')
  const end = sql.lastIndexOf('\nCOMMIT;')
  assert(start >= 0 && end > start, 'SQL 交易邊界不在')
  return sql.slice(start + '\nBEGIN;'.length, end)
}

async function playerSnapshot() {
  const row = await db.query(`
    select
      (select count(*)::int from public.seller_chat_messages) as messages,
      (select md5(coalesce(string_agg(id::text || body, '' order by id::text), '')) from public.seller_chat_messages) as message_hash,
      (select count(*)::int from public.seller_chat_attachments) as attachments,
      (select md5(coalesce(string_agg(path || file_name || mime || byte_size::text, '' order by path), '')) from public.seller_chat_attachments) as attachment_hash,
      (select count(*)::int from storage.objects where bucket_id = 'seller-chat-files') as files,
      (select coalesce(sum(balance), 0)::text from public.member_point_accounts) as points,
      (select count(*)::int from public.member_point_accounts) as point_accounts,
      (select active::text from public.member_perk_catalog where id = 'sticker-party') as sticker_active,
      (select count(*)::int from public.member_perk_holds) as holds
  `)
  return row.rows[0] as Record<string, unknown>
}

const password = execSync(`docker exec ${DB_CONTAINER} printenv POSTGRES_PASSWORD`, { encoding: 'utf8' }).trim()
const db = new pg.Client({ host: HOST, port: PORT, user: 'postgres', password, database: 'postgres' })

async function asUser(userId: string) {
  await db.query('RESET ROLE')
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  await db.query('SET LOCAL ROLE authenticated')
  const uid = await db.query('select auth.uid() as uid')
  assert(uid.rows[0].uid === userId, '隔離庫沒有綁到指定會員')
}

async function expectRejected(setupSql: string, pattern: RegExp, name: string, body: string) {
  await db.query('BEGIN')
  try {
    await db.query(setupSql)
    await db.query(body)
    throw new Error(`${name}：應該停止卻套用成功`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.query('ROLLBACK')
    assert(!message.includes('應該停止') && pattern.test(message), `${name}：得到「${message}」`)
    pass(name)
  }
}

async function expectFail(sql: string, pattern: RegExp, name: string, params: unknown[] = []) {
  await db.query('SAVEPOINT expect_fail')
  try {
    await db.query(sql, params)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.query('ROLLBACK TO SAVEPOINT expect_fail')
    assert(pattern.test(message), `${name}：得到「${message}」`)
    pass(name)
    return
  }
  await db.query('ROLLBACK TO SAVEPOINT expect_fail')
  throw new Error(`${name}：應該失敗卻成功`)
}

async function putObject(name: string, owner: string, size: number, mime: string) {
  await db.query('RESET ROLE')
  await db.query(
    `insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('seller-chat-files', $1, $2, jsonb_build_object('size', $3::int, 'contentLength', $3::int, 'mimetype', $4::text))`,
    [name, owner, size, mime],
  )
}

function objectName(chatId: string, userId: string) {
  return `${chatId}/${userId}/${randomUUID()}`
}

const RACE_A = 'a11ace00-0000-4000-8000-0000000000a1'
const RACE_B = 'b22ace00-0000-4000-8000-0000000000b2'
const RACE_CHAT = 'c33ace00-0000-4000-8000-0000000000c3'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function openClient() {
  return new pg.Client({ host: HOST, port: PORT, user: 'postgres', password, database: 'postgres' })
}

async function asClient(client: pg.Client, userId: string) {
  await client.query('RESET ROLE')
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  await client.query('SET LOCAL ROLE authenticated')
}

async function backendWait(pid: number) {
  const row = await db.query(
    `select state, wait_event_type, wait_event from pg_stat_activity where pid = $1`,
    [pid],
  )
  return row.rows[0] as { state: string; wait_event_type: string | null; wait_event: string | null } | undefined
}

async function proveConcurrentDelete() {
  const send = openClient()
  const del = openClient()
  await send.connect()
  await del.connect()
  const sendPath = `${RACE_CHAT}/${RACE_A}/${randomUUID()}`
  const deletePath = `${RACE_CHAT}/${RACE_A}/${randomUUID()}`
  const deleteTag = deletePath.split('/').pop()
  try {
    await db.query(`
      drop trigger if exists _chat_file_race_pause_message on public.seller_chat_messages;
      drop trigger if exists _chat_file_race_pause_delete on storage.objects;
      drop function if exists public._chat_file_race_pause_message();
      drop function if exists public._chat_file_race_pause_delete();
      drop table if exists public._chat_file_race_gate;
      create table public._chat_file_race_gate (id int primary key, open boolean not null);
      insert into public._chat_file_race_gate values (1, false), (2, false);
    `)
    await db.query(`
      create function public._chat_file_race_pause_message() returns trigger
      language plpgsql security definer set search_path = public as $fn$
      begin
        if new.body = '［照片］race-send.png' then
          loop
            exit when coalesce((select open from public._chat_file_race_gate where id = 1), true);
            perform pg_sleep(0.05);
          end loop;
        end if;
        return new;
      end
      $fn$
    `)
    await db.query(`
      create trigger _chat_file_race_pause_message
      before insert on public.seller_chat_messages
      for each row execute function public._chat_file_race_pause_message()
    `)
    await db.query(`
      create function public._chat_file_race_pause_delete() returns trigger
      language plpgsql security definer set search_path = public as $fn$
      begin
        if old.bucket_id = 'seller-chat-files' and split_part(old.name, '/', 3) = '${deleteTag}' then
          loop
            exit when coalesce((select open from public._chat_file_race_gate where id = 2), true);
            perform pg_sleep(0.05);
          end loop;
        end if;
        return old;
      end
      $fn$
    `)
    await db.query(`
      create trigger _chat_file_race_pause_delete
      before delete on storage.objects
      for each row execute function public._chat_file_race_pause_delete()
    `)
    await db.query('BEGIN')
    await db.query(
      `insert into auth.users (id, email, aud, role, instance_id) values
        ($1, 'chat-file-race-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($2, 'chat-file-race-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
      [RACE_A, RACE_B],
    )
    await db.query(`insert into public.seller_applications (user_id, store_name, status) values ($1, '併發測試店', 'approved')`, [RACE_B])
    await db.query(`insert into public.seller_chats (id, buyer_id, seller_user_id) values ($1, $2, $3)`, [RACE_CHAT, RACE_A, RACE_B])
    await db.query(
      `insert into storage.objects (bucket_id, name, owner_id, metadata) values
        ('seller-chat-files', $1, $3, '{"size":32,"contentLength":32,"mimetype":"image/png"}'::jsonb),
        ('seller-chat-files', $2, $3, '{"size":32,"contentLength":32,"mimetype":"image/png"}'::jsonb)`,
      [sendPath, deletePath, RACE_A],
    )
    await db.query('COMMIT')

    await send.query(`set statement_timeout = '20s'`)
    await del.query(`set statement_timeout = '20s'`)
    const sendPid = (await send.query('select pg_backend_pid() as pid')).rows[0].pid as number
    const delPid = (await del.query('select pg_backend_pid() as pid')).rows[0].pid as number

    await send.query('BEGIN')
    await asClient(send, RACE_A)
    const sendFirst = send.query(
      `select public.send_seller_chat_file($1::uuid, $2, 'race-send.png', $3::uuid) as r`,
      [RACE_CHAT, sendPath, randomUUID()],
    ).then((result) => ({ ok: true as const, id: result.rows[0].r.id as string })).catch((err: Error) => ({ ok: false as const, error: err.message }))
    const sendPaused = await waitUntil(async () => {
      const state = await backendWait(sendPid)
      return state?.wait_event === 'PgSleep' ? state : null
    }, '送出沒有停在寫入附件之前')
    assert(sendPaused.wait_event === 'PgSleep', '送出沒有停在寫入附件之前')

    await del.query('BEGIN')
    await del.query(`select set_config('storage.allow_delete_query', 'true', true)`)
    await asClient(del, RACE_A)
    const deleteDuringSend = del.query(
      `delete from storage.objects where bucket_id = 'seller-chat-files' and name = $1`,
      [sendPath],
    ).then((result) => ({ ok: true as const, rowCount: result.rowCount })).catch((err: Error) => ({ ok: false as const, error: err.message }))
    const deleteWaits = await waitUntil(async () => {
      const state = await backendWait(delPid)
      return state?.wait_event === 'advisory' ? state : null
    }, '送出先進行時，刪除沒有停在路徑鎖')
    assert(deleteWaits.wait_event === 'advisory', '送出先進行時，刪除沒有停在路徑鎖')
    await db.query(`update public._chat_file_race_gate set open = true where id = 1`)
    const sent = await sendFirst
    assert(sent.ok, `送出先進行時送出失敗：${sent.ok ? '' : sent.error}`)
    await send.query('COMMIT')
    const deletedDuringSend = await deleteDuringSend
    assert(deletedDuringSend.ok && deletedDuringSend.rowCount === 0, '送出先進行時，已送出的檔案仍被刪除')
    await del.query('COMMIT')
    const sendFirstLeft = await db.query(
      `select
         (select count(*)::int from public.seller_chat_attachments where path = $1) as attachments,
         (select count(*)::int from storage.objects where name = $1) as objects`,
      [sendPath],
    )
    assert(sendFirstLeft.rows[0].attachments === 1 && sendFirstLeft.rows[0].objects === 1, '送出先進行後，訊息在但檔案不在')
    pass('送出先進行、刪除同時到達時，檔案仍在')

    await db.query(`update public._chat_file_race_gate set open = false where id = 2`)
    await del.query('BEGIN')
    await del.query(`select set_config('storage.allow_delete_query', 'true', true)`)
    await asClient(del, RACE_A)
    const deleteFirst = del.query(
      `delete from storage.objects where bucket_id = 'seller-chat-files' and name = $1`,
      [deletePath],
    ).then((result) => ({ ok: true as const, rowCount: result.rowCount })).catch((err: Error) => ({ ok: false as const, error: err.message }))
    await waitUntil(async () => {
      const state = await backendWait(delPid)
      return state?.wait_event === 'PgSleep' ? state : null
    }, '刪除沒有先停住')
    await send.query('BEGIN')
    await asClient(send, RACE_A)
    const sendSecond = send.query(
      `select public.send_seller_chat_file($1::uuid, $2, 'race-delete.png', $3::uuid) as r`,
      [RACE_CHAT, deletePath, randomUUID()],
    ).then((result) => ({ ok: true as const, id: result.rows[0].r.id as string })).catch((err: Error) => ({ ok: false as const, error: err.message }))
    const sendWaits = await waitUntil(async () => {
      const state = await backendWait(sendPid)
      return state?.wait_event === 'advisory' ? state : null
    }, '刪除先進行時，送出沒有停在路徑鎖')
    assert(sendWaits.wait_event === 'advisory', '刪除先進行時，送出沒有停在路徑鎖')
    await db.query(`update public._chat_file_race_gate set open = true where id = 2`)
    const removedFirst = await deleteFirst
    assert(removedFirst.ok && removedFirst.rowCount === 1, '刪除先進行時，未送出的檔案沒有刪掉')
    await del.query('COMMIT')
    const sentSecond = await sendSecond
    assert(!sentSecond.ok && sentSecond.error.includes('找不到這個附件'), `刪除先進行時送出沒有拒絕：${sentSecond.ok ? sentSecond.id : sentSecond.error}`)
    await send.query('ROLLBACK')
    const deleteFirstLeft = await db.query(
      `select
         (select count(*)::int from public.seller_chat_messages where body = '［照片］race-delete.png') as messages,
         (select count(*)::int from storage.objects where name = $1) as objects`,
      [deletePath],
    )
    assert(deleteFirstLeft.rows[0].messages === 0 && deleteFirstLeft.rows[0].objects === 0, '刪除先進行後仍留下已送出的訊息或檔案')
    pass('刪除先進行、送出同時到達時，不會留下已刪檔案的訊息')
  } finally {
    try { await db.query(`update public._chat_file_race_gate set open = true`) } catch { /* 閘門可能已刪 */ }
    await sleep(200)
    try { await send.query('ROLLBACK') } catch { /* 交易可能已結束 */ }
    try { await del.query('ROLLBACK') } catch { /* 交易可能已結束 */ }
    await db.query(`select set_config('storage.allow_delete_query', 'true', false)`)
    await db.query(`
      drop trigger if exists _chat_file_race_pause_message on public.seller_chat_messages;
      drop trigger if exists _chat_file_race_pause_delete on storage.objects;
      drop function if exists public._chat_file_race_pause_message();
      drop function if exists public._chat_file_race_pause_delete();
    `)
    await db.query(`delete from public.notification_outbox where user_id in ($1, $2) and event_key like 'seller_chat_message:%'`, [RACE_A, RACE_B])
    await db.query(`delete from public.seller_chat_messages where chat_id = $1`, [RACE_CHAT])
    await db.query(`delete from storage.objects where bucket_id = 'seller-chat-files' and name like $1 || '/%'`, [RACE_CHAT])
    await db.query(`delete from public.seller_chats where id = $1`, [RACE_CHAT])
    await db.query(`delete from public.seller_applications where user_id in ($1, $2)`, [RACE_A, RACE_B])
    await db.query(`delete from auth.users where id in ($1, $2)`, [RACE_A, RACE_B])
    await db.query(`drop table if exists public._chat_file_race_gate`)
    await send.end()
    await del.end()
  }
}

async function waitUntil<T>(probe: () => Promise<T | null>, label: string, ms = 8000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const found = await probe()
    if (found) return found
    await sleep(40)
  }
  throw new Error(label)
}

async function main() {
  assert(HOST === '127.0.0.1' && PORT === 54322, '拒絕連到隔離庫以外的資料庫')
  const dbPort = execSync(`docker port ${DB_CONTAINER} 5432`, { encoding: 'utf8' })
  const kongPort = execSync(`docker port ${KONG_CONTAINER} 8000`, { encoding: 'utf8' })
  assert(dbPort.includes('54322'), '54322 不是 hengjing-stage45-local')
  assert(kongPort.includes('54321'), '54321 不是這份隔離庫的 API')
  checkClient()
  const current = functionHashes(SQL_FILE)
  const historical = functionHashes('supabase/migrations/20261020143000_chat_and_security_fixes.sql')
  const dockerCopy = functionHashes('supabase/manual/20261028030000_docker_missing_feature_objects.sql')
  const sqlText = readFileSync(SQL_FILE, 'utf8')
  const listHashes = current.list_seller_chat_messages
  assert(historical.list_seller_chat_messages[0] === dockerCopy.list_seller_chat_messages[0], '兩份舊版讀取函式指紋不同')
  for (const hash of [
    historical.list_seller_chat_messages[0],
    ...listHashes,
    current.send_seller_chat_file[0],
    current.seller_chat_file_deletable[0],
    PREVIOUS_SEND,
    PREVIOUS_DELETABLE,
  ]) {
    assert(sqlText.includes(hash), `來源指紋沒有寫進 SQL：${hash}`)
  }
  assert(current.send_seller_chat_file[0] !== PREVIOUS_SEND, '送出函式指紋仍是未加鎖的版本')
  pass('版本指紋由專案來源檔計算')
  await db.connect()
  const ready = await db.query(`select to_regprocedure('public.send_seller_chat_file(uuid, text, text, uuid)') is not null as ok`)
  assert(ready.rows[0].ok === true, '請先套用 20261030031100_seller_chat_files.sql。這個測試不會自動重跑歷史檔')
  const baseline = await playerSnapshot()
  await db.query(sqlText)
  assert(JSON.stringify(await playerSnapshot()) === JSON.stringify(baseline), '第一次重複套用改變了既有資料')
  const body = sqlBody(sqlText)
  await expectRejected(
    `create or replace function public.list_seller_chat_messages(p_chat_id uuid)
     returns jsonb language plpgsql stable security definer set search_path = public
     as $fn$ begin return '[]'::jsonb; end $fn$`,
    /未知版本/,
    '未知函式版本會停止',
    body,
  )
  await expectRejected(
    'alter table public.notification_outbox rename to notification_outbox_hidden_probe',
    /缺少 public.notification_outbox/,
    '缺少通知依賴會停止',
    body,
  )
  await expectRejected(
    'alter table public.notification_outbox drop constraint notification_outbox_event_key_key',
    /防重約束/,
    '缺少 event_key 防重約束會停止',
    body,
  )
  await db.query('BEGIN')
  await db.query(`grant execute on function public.list_seller_chat_messages(uuid) to anon`)
  const granted = await db.query(`select has_function_privilege('anon', 'public.list_seller_chat_messages(uuid)', 'execute') as ok`)
  assert(granted.rows[0].ok === true, '測試沒有把舊讀取函式明確授權給 anon')
  await db.query(body)
  const revoked = await db.query(`select has_function_privilege('anon', 'public.list_seller_chat_messages(uuid)', 'execute') as ok`)
  assert(revoked.rows[0].ok === false, '套用後 anon 仍可執行 list_seller_chat_messages(uuid)')
  await db.query('ROLLBACK')
  pass('舊函式明確授權 anon 後會撤銷')
  const before = await db.query(`
    select
      (select count(*) from public.seller_chat_messages)::int as messages,
      (select count(*) from storage.objects where bucket_id = 'seller-chat-files')::int as files,
      (select active from public.member_perk_catalog where id = 'sticker-party') as sticker_active
  `)
  await db.query('BEGIN')
  try {
    const bucket = await db.query(`select public, file_size_limit from storage.buckets where id = 'seller-chat-files'`)
    assert(bucket.rows[0].public === false && Number(bucket.rows[0].file_size_limit) === CHAT_FILE_MAX_BYTES, '附件桶不是私人或上限不是 8MB')
    const anonSend = await db.query(`select has_function_privilege('anon', 'public.send_seller_chat_file(uuid,text,text,uuid)', 'execute') as ok`)
    const userSend = await db.query(`select has_function_privilege('authenticated', 'public.send_seller_chat_file(uuid,text,text,uuid)', 'execute') as ok`)
    assert(anonSend.rows[0].ok === false && userSend.rows[0].ok === true, '未登入角色可以呼叫附件送出')
    const anonList = await db.query(`select has_function_privilege('anon', 'public.list_seller_chat_messages(uuid)', 'execute') as anon, has_function_privilege('authenticated', 'public.list_seller_chat_messages(uuid)', 'execute') as member`)
    assert(anonList.rows[0].anon === false && anonList.rows[0].member === true, '匿名角色可以讀取聊天訊息')
    pass('附件桶不公開，未登入角色不能呼叫送出')

    await db.query(
      `insert into auth.users (id, email, aud, role, instance_id) values
        ($1, 'chat-file-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($2, 'chat-file-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($3, 'chat-file-c@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
      [A, B, C],
    )
    await db.query(`insert into public.seller_applications (user_id, store_name, status) values ($1, '附件測試店', 'approved')`, [B])
    await asUser(A)
    const opened = await db.query('select public.open_seller_chat($1::uuid) as id', [B])
    const chatId = opened.rows[0].id as string
    const photoPath = objectName(chatId, A)
    const pdfPath = objectName(chatId, B)
    await putObject(photoPath, A, 128, 'image/png')
    await putObject(pdfPath, B, 256, 'application/pdf')

    const photoClaim = randomUUID()
    await asUser(A)
    const photo = await db.query(
      `select public.send_seller_chat_file($1::uuid, $2, $3, $4::uuid) as r`,
      [chatId, photoPath, '櫃檯.png', photoClaim],
    )
    const photoRow = photo.rows[0].r as { id: string; body: string; file: { path: string; name: string; bytes: number; mime: string } }
    assert(photoRow.file.path === photoPath && photoRow.file.mime === 'image/png' && photoRow.file.bytes === 128, '照片沒有寫進訊息')
    assert(photoRow.body.startsWith('［照片］') && photoRow.file.name === '櫃檯.png', '照片訊息沒有檔名')
    const replay = await db.query(
      `select public.send_seller_chat_file($1::uuid, $2, $3, $4::uuid) as r`,
      [chatId, photoPath, '櫃檯.png', photoClaim],
    )
    assert(replay.rows[0].r.id === photoRow.id, '同一張照片重試產生了另一則訊息')
    const photoCount = await db.query('RESET ROLE').then(() => db.query(
      `select count(*)::int as n from public.seller_chat_attachments where claim_key = $1::uuid`,
      [photoClaim],
    ))
    assert(photoCount.rows[0].n === 1, '重試寫入了一筆以上的附件')
    pass('照片送出可重試，不會重複產生訊息')

    await asUser(B)
    const pdf = await db.query(
      `select public.send_seller_chat_file($1::uuid, $2, $3, $4::uuid) as r`,
      [chatId, pdfPath, '報價.pdf', randomUUID()],
    )
    assert(pdf.rows[0].r.file.mime === 'application/pdf' && pdf.rows[0].r.body.startsWith('［檔案］'), '檔案沒有寫進賣家回覆')
    await asUser(A)
    const listed = await db.query('select public.list_seller_chat_messages($1::uuid) as rows', [chatId])
    const rows = listed.rows[0].rows as Array<{ id: string; file: { mime: string; name: string } | null }>
    assert(rows.some((row) => row.file?.mime === 'image/png' && row.file.name === '櫃檯.png'), '買家重讀看不到照片')
    assert(rows.some((row) => row.file?.mime === 'application/pdf'), '買家重讀看不到賣家檔案')
    await asUser(B)
    const sellerView = await db.query('select public.list_seller_chat_messages($1::uuid) as rows', [chatId])
    assert((sellerView.rows[0].rows as unknown[]).length === rows.length, '賣家讀到的附件則數不同')
    pass('買賣雙方都能讀到對方的照片與檔案')

    await db.query('RESET ROLE')
    await db.query(`update public.seller_chat_messages set created_at = now() - interval '2 hours' where id = $1`, [photoRow.id])
    await asUser(A)
    const older = await db.query(
      `select public.list_seller_chat_messages($1::uuid, now() - interval '1 hour') as rows`,
      [chatId],
    )
    const olderRows = older.rows[0].rows as Array<{ id: string; file: { path: string } | null }>
    assert(olderRows.some((row) => row.id === photoRow.id && row.file?.path === photoPath), '較早的照片沒有跟著舊訊息讀出')
    assert(!olderRows.some((row) => row.id === pdf.rows[0].r.id), '較新的檔案混進較早的那一頁')
    pass('載入較早訊息仍帶得出附件')

    const foreignChat = randomUUID()
    await db.query('RESET ROLE')
    await db.query(
      `insert into public.seller_chats (id, buyer_id, seller_user_id) values ($1, $2, $3)`,
      [foreignChat, C, B],
    )
    await asUser(A)
    await expectFail(
      `select public.send_seller_chat_file($1::uuid, $2, 'x.png', $3::uuid)`,
      /不能使用這個附件/,
      '可以把別的對話路徑拿來當自己的訊息',
      [chatId, objectName(foreignChat, A), randomUUID()],
    )
    await expectFail(
      `select public.send_seller_chat_file($1::uuid, $2, 'x.png', $3::uuid)`,
      /不能使用這個附件/,
      '可以把對方上傳的路徑拿來發送',
      [chatId, objectName(chatId, B), randomUUID()],
    )
    await expectFail(
      `select public.send_seller_chat_file($1::uuid, $2, 'x.png', $3::uuid)`,
      /找不到這個附件/,
      '不存在的附件也能送出',
      [chatId, objectName(chatId, A), randomUUID()],
    )
    const badPath = objectName(chatId, A)
    const bigPath = objectName(chatId, A)
    const emptyPath = objectName(chatId, A)
    await putObject(badPath, A, 20, 'text/plain')
    await putObject(bigPath, A, CHAT_FILE_MAX_BYTES + 1, 'image/jpeg')
    await putObject(emptyPath, A, 0, 'image/png')
    await asUser(A)
    await expectFail(
      `select public.send_seller_chat_file($1::uuid, $2, 'a.txt', $3::uuid)`,
      /只支援 JPG、PNG、WEBP 照片或 PDF 檔案/,
      '不支援的格式仍可送出',
      [chatId, badPath, randomUUID()],
    )
    await expectFail(
      `select public.send_seller_chat_file($1::uuid, $2, 'big.jpg', $3::uuid)`,
      /單檔上限 8MB/,
      '超過 8MB 仍可送出',
      [chatId, bigPath, randomUUID()],
    )
    await expectFail(
      `select public.send_seller_chat_file($1::uuid, $2, 'empty.png', $3::uuid)`,
      /檔案是空的/,
      '空檔仍可送出',
      [chatId, emptyPath, randomUUID()],
    )
    await expectFail(
      `select public.send_seller_chat_file($1::uuid, $2, 'again.png', $3::uuid)`,
      /這個附件已經送出/,
      '已送出的路徑可以再掛到新訊息',
      [chatId, photoPath, randomUUID()],
    )

    await asUser(C)
    await expectFail(
      `select public.list_seller_chat_messages($1::uuid)`,
      /不能查看這則對話/,
      '非會話成員可以讀取附件訊息',
      [chatId],
    )
    await expectFail(
      `select public.send_seller_chat_file($1::uuid, $2, 'x.png', $3::uuid)`,
      /不能在這則對話發言|不能使用這個附件/,
      '非會話成員可以發送附件',
      [chatId, objectName(chatId, C), randomUUID()],
    )
    const outsiderRead = await db.query(
      `select count(*)::int as n from storage.objects where bucket_id = 'seller-chat-files' and name = $1`,
      [photoPath],
    )
    assert(outsiderRead.rows[0].n === 0, '非會話成員可以從儲存讀到附件')
    await expectFail(
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       values ('seller-chat-files', $1, $2, '{"size":8,"mimetype":"image/png"}'::jsonb)`,
      /row-level security|permission denied/,
      '非會話成員可以上傳附件',
      [objectName(chatId, C), C],
    )
    await db.query('RESET ROLE')
    await db.query(`select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)`)
    await db.query('SET LOCAL ROLE authenticated')
    await expectFail(
      `select public.send_seller_chat_file($1::uuid, $2, 'x.png', $3::uuid)`,
      /請先登入/,
      '未登入可以發送附件',
      [chatId, photoPath, randomUUID()],
    )
    await db.query('RESET ROLE')
    await db.query('SET LOCAL ROLE anon')
    await expectFail(
      `select public.send_seller_chat_file($1::uuid, $2, 'x.png', $3::uuid)`,
      /permission denied/,
      '匿名角色可以發送附件',
      [chatId, photoPath, randomUUID()],
    )
    pass('未登入與非會話成員不能上傳路徑、發送或讀取')

    await db.query('RESET ROLE')
    await db.query(`select set_config('storage.allow_delete_query', 'true', true)`)
    await asUser(A)
    const visible = await db.query(
      `select count(*)::int as n from storage.objects where bucket_id = 'seller-chat-files' and name = $1`,
      [photoPath],
    )
    assert(visible.rows[0].n === 1, '會話成員不能讀自己的附件')
    const blocked = await db.query(`delete from storage.objects where bucket_id = 'seller-chat-files' and name = $1`, [photoPath])
    assert(blocked.rowCount === 0, '已送出的照片被刪掉')
    const unsent = objectName(chatId, A)
    await putObject(unsent, A, 64, 'image/webp')
    await asUser(A)
    const removed = await db.query(`delete from storage.objects where bucket_id = 'seller-chat-files' and name = $1`, [unsent])
    assert(removed.rowCount === 1, '未送出的暫存檔不能取消')
    const ownUpload = objectName(chatId, A)
    await db.query(
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       values ('seller-chat-files', $1, $2, '{"size":16,"mimetype":"image/png","contentLength":16}'::jsonb)`,
      [ownUpload, A],
    )
    const removedOwn = await db.query(`delete from storage.objects where bucket_id = 'seller-chat-files' and name = $1`, [ownUpload])
    assert(removedOwn.rowCount === 1, '會話成員不能取消自己尚未送出的上傳')
    await db.query('RESET ROLE')
    const kept = await db.query(`select count(*)::int as n from storage.objects where name = $1`, [photoPath])
    assert(kept.rows[0].n === 1, '取消暫存時把已送出的照片刪了')
    pass('取消只刪未送出的暫存，已送出的附件還在')

    await db.query('RESET ROLE')
    const unapproved = randomUUID()
    await db.query(`insert into public.seller_chats (id, buyer_id, seller_user_id) values ($1, $2, $3)`, [unapproved, C, A])
    const replyPath = objectName(unapproved, A)
    await putObject(replyPath, A, 32, 'image/jpeg')
    await asUser(A)
    await expectFail(
      `select public.send_seller_chat_file($1::uuid, $2, 'x.jpg', $3::uuid)`,
      /通過賣家認證後才能回覆買家/,
      '未認證賣家可以回傳附件',
      [unapproved, replyPath, randomUUID()],
    )

    await asUser(A)
    const text = await db.query(`select public.send_seller_chat_message($1::uuid, '附件驗收文字') as r`, [chatId])
    const sticker = await db.query(`select public.send_seller_chat_message($1::uuid, '[[sticker:base-ok]]') as r`, [chatId])
    const mixed = await db.query('select public.list_seller_chat_messages($1::uuid) as rows', [chatId])
    const mixedRows = mixed.rows[0].rows as Array<{ id: string; body: string; file: unknown }>
    const textRow = mixedRows.find((row) => row.id === text.rows[0].r.id)
    const stickerRow = mixedRows.find((row) => row.id === sticker.rows[0].r.id)
    assert(textRow?.body === '附件驗收文字' && textRow.file == null, '文字訊息被改掉')
    assert(stickerRow?.body === '[[sticker:base-ok]]' && stickerRow.file == null, '貼圖訊息被改掉')
    pass('原有文字與免費貼圖仍可送出與讀取')

    await db.query('RESET ROLE')
    await db.query(`
      create policy chat_file_probe_loose
      on storage.objects
      for all
      to public
      using (true)
      with check (true)
    `)
    await asUser(C)
    const leaked = await db.query(
      `select count(*)::int as n from storage.objects where bucket_id = 'seller-chat-files' and name = $1`,
      [photoPath],
    )
    assert(leaked.rows[0].n === 0, '寬鬆政策讓非會話成員讀到附件')
    await expectFail(
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       values ('seller-chat-files', $1, $2, '{"size":8,"mimetype":"image/png"}'::jsonb)`,
      /row-level security|permission denied/,
      '寬鬆政策讓非會話成員寫入附件',
      [objectName(chatId, C), C],
    )
    await db.query('RESET ROLE')
    await db.query(`select set_config('storage.allow_delete_query', 'true', true)`)
    await asUser(C)
    const outsiderDelete = await db.query(`delete from storage.objects where bucket_id = 'seller-chat-files' and name = $1`, [photoPath])
    assert(outsiderDelete.rowCount === 0, '寬鬆政策讓非會話成員刪除附件')
    await asUser(A)
    const overwritten = await db.query(
      `update storage.objects set metadata = metadata || '{"probe":true}'::jsonb where bucket_id = 'seller-chat-files' and name = $1`,
      [photoPath],
    )
    assert(overwritten.rowCount === 0, '寬鬆政策讓會員覆寫已送出附件')
    const removedSent = await db.query(`delete from storage.objects where bucket_id = 'seller-chat-files' and name = $1`, [photoPath])
    assert(removedSent.rowCount === 0, '寬鬆政策讓會員刪除已送出附件')
    const stillVisible = await db.query(
      `select count(*)::int as n from storage.objects where bucket_id = 'seller-chat-files' and name = $1`,
      [photoPath],
    )
    assert(stillVisible.rows[0].n === 1, '會話成員在限制政策下讀不到自己的附件')
    await db.query('RESET ROLE')
    const avatarName = `${A}/loose-probe.png`
    await db.query(
      `insert into storage.objects (bucket_id, name, owner_id, metadata)
       values ('member-avatars', $1, $2, '{"size":4,"mimetype":"image/png"}'::jsonb)`,
      [avatarName, A],
    )
    await asUser(A)
    const avatarUpdate = await db.query(
      `update storage.objects set metadata = metadata || '{"probe":true}'::jsonb where bucket_id = 'member-avatars' and name = $1`,
      [avatarName],
    )
    assert(avatarUpdate.rowCount === 1, '限制政策改到其他儲存桶的更新')
    await db.query('RESET ROLE')
    await db.query(`select set_config('storage.allow_delete_query', 'true', true)`)
    await asUser(A)
    const avatarDelete = await db.query(`delete from storage.objects where bucket_id = 'member-avatars' and name = $1`, [avatarName])
    assert(avatarDelete.rowCount === 1, '限制政策改到其他儲存桶的刪除')
    pass('既有寬鬆儲存政策仍擋下非成員與已送出附件，其他桶維持原行為')

    await db.query('ROLLBACK')
    await db.query('RESET ROLE')
    const after = await db.query(`
      select
        (select count(*) from public.seller_chat_messages)::int as messages,
        (select count(*) from storage.objects where bucket_id = 'seller-chat-files')::int as files,
        (select active from public.member_perk_catalog where id = 'sticker-party') as sticker_active,
        (select count(*) from auth.users where email like 'chat-file-%@example.invalid')::int as users
    `)
    assert(after.rows[0].messages === before.rows[0].messages, '測試沒有還原聊天訊息')
    assert(after.rows[0].files === before.rows[0].files, '測試沒有還原儲存物件')
    assert(after.rows[0].sticker_active === before.rows[0].sticker_active, '貼圖停售狀態被改掉')
    assert(after.rows[0].users === 0, '測試會員留在隔離庫')
    pass('隔離庫已還原')
    await proveConcurrentDelete()
    await db.query(sqlText)
    assert(JSON.stringify(await playerSnapshot()) === JSON.stringify(baseline), '併發測試或第二次重複套用改變了既有資料')
    pass('重複套用不改變既有聊天、附件、點數或其他玩家資料')
    console.log(`通過 ${passed.length} 項`)
  } catch (err) {
    try { await db.query('ROLLBACK') } catch { /* 交易可能已結束 */ }
    throw err
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
