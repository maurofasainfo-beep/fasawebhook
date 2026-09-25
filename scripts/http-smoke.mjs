import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

// Uses the production build and an intentionally unconfigured environment.
// No Supabase project is contacted or modified by this smoke test.
const project = fileURLToPath(new URL('..', import.meta.url));
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: project, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', WEBHOOK_TOKEN_ENCRYPTION_KEY: '', APP_PUBLIC_URL: origin },
});
let output = '';
server.stdout.on('data', data => { output += data; });
server.stderr.on('data', data => { output += data; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Production server exited before becoming ready.');
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, 'Production server did not start.');
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Suas integrações/);
  assert.match(html, /Configuração/);
  assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY|auth_token_encrypted/);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  console.log('PASS: production homepage 200; direct panel; security headers; no privileged configuration in HTML.');
  const method = await fetch(`${origin}/api/webhooks/receive/00000000-0000-4000-8000-000000000000`);
  assert.equal(method.status, 405); assert.equal(method.headers.get('allow'), 'POST');
  console.log('PASS: public endpoint returns 405 and Allow: POST for GET.');
  const admin = await fetch(`${origin}/api/admin/webhooks`, { headers: { 'X-Dashboard-Request': '1' } });
  assert.equal(admin.status, 500); assert.equal(admin.headers.get('cache-control'), 'no-store');
  const body = await admin.json(); assert.equal(body.success, false); assert.match(body.error, /configuração do servidor/);
  assert.doesNotMatch(JSON.stringify(body), /stack|SUPABASE_SERVICE_ROLE_KEY/);
  console.log('PASS: missing configuration returns controlled JSON 500, no stack or secrets.');
  assert.equal((await fetch(origin)).status, 200);
  console.log('PASS: server remains available after API configuration failure.');
} catch (error) {
  // Environment is intentionally empty; this output cannot contain project keys.
  console.error(output);
  throw error;
} finally {
  const stopped = once(server, 'exit');
  if (server.exitCode === null) { server.kill(); await stopped; }
}
