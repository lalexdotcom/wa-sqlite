// Throwaway probe: what OPFS does Playwright's WebKit expose, per context kind.
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webkit } from 'playwright';

const WORKER = `
const r = {};
const step = async (name, fn) => {
  try { r[name] = (await fn()) ?? 'ok'; } catch (e) { r[name] = (e && e.name) + ': ' + (e && e.message); }
};
const pending = (p, ms) => Promise.race([p, new Promise((res) => setTimeout(() => res('still pending after ' + ms + ' ms'), ms))]);
r.isSecureContext = self.isSecureContext;
r['typeof navigator.storage'] = typeof navigator.storage;
r['typeof getDirectory'] = typeof navigator.storage?.getDirectory;
r['typeof FileSystemSyncAccessHandle'] = typeof FileSystemSyncAccessHandle;
r["'mode' in FileSystemSyncAccessHandle.prototype"] = typeof FileSystemSyncAccessHandle !== 'undefined' && 'mode' in FileSystemSyncAccessHandle.prototype;
r['typeof WebAssembly.Suspending / promising'] = typeof WebAssembly.Suspending + ' / ' + typeof WebAssembly.promising;
let root, fh, h;
await step('getDirectory()', async () => { root = await navigator.storage.getDirectory(); });
await step('createSyncAccessHandle + write/read', async () => {
  fh = await root.getFileHandle('probe.bin', { create: true });
  h = await fh.createSyncAccessHandle();
  h.write(new Uint8Array([1, 2, 3]), { at: 0 });
  h.flush();
  const b = new Uint8Array(3);
  h.read(b, { at: 0 });
  return 'size ' + h.getSize() + ', read ' + Array.from(b);
});
await step('second default handle while the first is open', () =>
  pending(fh.createSyncAccessHandle().then((h2) => { h2.close(); return 'granted'; }), 2000));
await step('two readwrite-unsafe handles', async () => {
  const f = await root.getFileHandle('unsafe.bin', { create: true });
  const a = await f.createSyncAccessHandle({ mode: 'readwrite-unsafe' });
  try {
    const b = await pending(f.createSyncAccessHandle({ mode: 'readwrite-unsafe' }), 2000);
    if (typeof b === 'string') return b;
    const mode = a.mode;
    b.close();
    return 'both granted, a.mode = ' + mode;
  } finally { a.close(); }
});
h?.close();
await step('createWritable', async () => {
  const w = await (await root.getFileHandle('w.bin', { create: true })).createWritable();
  await w.write(new Uint8Array([4, 5]));
  await w.close();
  return 'size ' + (await (await root.getFileHandle('w.bin')).getFile()).size;
});
await step('Web Locks', async () => typeof navigator.locks?.request === 'function'
  ? navigator.locks.request('probe', () => 'granted') : 'navigator.locks missing');
postMessage(r);
`;

const PAGE = `<!doctype html><script type="module">
const w = new Worker('/worker.js', { type: 'module' });
window.result = new Promise((res) => {
  w.onmessage = (e) => res(e.data);
  w.onerror = (e) => res({ workerError: String(e.message) });
});
window.mainThread = {
  'typeof navigator.storage': typeof navigator.storage,
  'typeof getDirectory': typeof navigator.storage?.getDirectory,
};
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === '/worker.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(WORKER);
  } else {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://localhost:${server.address().port}/`;

async function probe(kind, context) {
  const page = await context.newPage();
  await page.goto(url);
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const mainThread = await page.evaluate(() => window.mainThread);
  const worker = await page.evaluate(() => window.result);
  await context.close();
  return { kind, userAgent, mainThread, worker };
}

const results = [];
const browser = await webkit.launch();
results.push({ browserVersion: browser.version() });
results.push(await probe('ephemeral (browser.newContext)', await browser.newContext()));
await browser.close();
results.push(await probe('persistent (launchPersistentContext)',
  await webkit.launchPersistentContext(mkdtempSync(join(tmpdir(), 'webkit-probe-')))));
server.close();
console.log(JSON.stringify(results, null, 2));
