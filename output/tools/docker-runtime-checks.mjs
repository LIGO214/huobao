import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'

const app = 'huobao-acceptance-20261019-app-1'
const database = 'huobao-acceptance-20261019-postgres-1'
const base = 'http://127.0.0.1:15681'
const secret = 'huobao-local-acceptance-proxy-20261019-only'
function docker(...arguments_) {
  return execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 60000 }).trim()
}
function inApp(code) {
  return docker('exec', '-w', '/app/backend', app, 'node', '--input-type', 'module', '-e', code)
}
async function signed(path) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const requestId = randomUUID()
  const signature = createHmac('sha256', secret)
    .update(['1', '910001', 'GET', path, '', timestamp, requestId].join('\n')).digest('hex')
  const response = await fetch(base + path, {
    headers: {
      'X-Qunl-Auth-Version': '1', 'X-Qunl-User-Id': '910001', 'X-Qunl-Timestamp': timestamp,
      'X-Qunl-Request-Id': requestId, 'X-Qunl-Signature': signature,
    },
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(response.status, 200)
  return response.json()
}
const snapshotCode = `
  import pg from 'pg';
  import fs from 'node:fs/promises';
  import path from 'node:path';
  import {createHash} from 'node:crypto';
  const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
  const rows = (await pool.query('SELECT (SELECT count(*)::int FROM dramas) AS dramas, (SELECT count(*)::int FROM ai_service_configs) AS configs, (SELECT count(*)::int FROM episodes) AS episodes')).rows[0];
  await pool.end();
  const files = [];
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, {withFileTypes:true})) {
      const name=path.join(dir,entry.name);
      if(entry.isDirectory()) await visit(name);
      else files.push({name, hash:createHash('sha256').update(await fs.readFile(name)).digest('hex')});
    }
  }
  await visit('/app/data/users');
  files.sort((a,b)=>a.name.localeCompare(b.name));
  console.log(JSON.stringify({rows,files}));
`
let passed = 0
const identity = JSON.parse(inApp(`
  import fs from 'node:fs/promises';
  if(process.getuid()===0) throw new Error('Application is root');
  let rejected=false;
  try { const handle=await fs.open('/app/backend/workspace/prompts/script_rewriter.md','a');await handle.close(); }
  catch(error) { if(error.code!=='EACCES')throw error;rejected=true; }
  console.log(JSON.stringify({uid:process.getuid(),readOnly:rejected}));
`))
assert.equal(identity.readOnly, true)
passed++
assert.match(docker('exec', app, 'ffmpeg', '-version'), /ffmpeg version/)
passed++
assert.match(docker('exec', app, 'ffprobe', '-version'), /ffprobe version/)
passed++

const before = JSON.parse(inApp(snapshotCode))
assert.ok(before.rows.dramas > 0)
assert.ok(before.files.length > 0)
const beforeResponse = await signed('/api/v1/dramas')
// Planned restart of both services verifies persistence without testing recovery of live upstream work.
docker('stop', app)
docker('restart', database)
for (let attempt = 0; ; attempt++) {
  try { docker('exec', database, 'pg_isready', '-U', 'huobao_acceptance', '-d', 'huobao_acceptance'); break }
  catch (error) { if (attempt >= 30) throw error; await setTimeout(500) }
}
docker('start', app)
for (let attempt = 0; ; attempt++) {
  try {
    const health = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(1000) })
    if (health.ok) break
  } catch {}
  assert.ok(attempt < 60, 'Application did not become ready after restart')
  await setTimeout(500)
}
assert.deepEqual(JSON.parse(inApp(snapshotCode)), before)
assert.deepEqual(await signed('/api/v1/dramas'), beforeResponse)
passed++
console.log(`Docker runtime and persistence: ${passed} passed, 0 failed`)
