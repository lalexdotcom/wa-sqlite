// A worker for vfs_commit_failure.js, holding one connection on
// OPFSWriteAheadVFS. It can make the write of the next commit frame fail,
// or of the frames that follow it, either short or with an exception, as
// a full quota would, or stop there, as a terminated context would.
import * as SQLite from '../src/sqlite-api.js';
import { OPFSWriteAheadVFS } from '../src/examples/OPFSWriteAheadVFS.js';

const BUILDS = new Map([
  ['default', '../dist/wa-sqlite.mjs'],
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

// The writes that can fail are told apart by their first bytes: a frame
// header of type 1 (commit) or 2 (end), or a file header (magic 0x377f0684).
const FRAME_HEADER_SIZE = 32;
const MATCHERS = {
  commit: bytes => bytes[0] === 1,
  end: bytes => bytes[0] === 2,
  header: bytes => bytes[0] === 0x37 && bytes[1] === 0x7f,
};

const searchParams = new URLSearchParams(location.search);

/** @type {{ write: string, mode: 'short'|'throw'|'hang' }?} */ let failNext = null;
const write = FileSystemSyncAccessHandle.prototype.write;
FileSystemSyncAccessHandle.prototype.write = function(buffer, options) {
  const bytes = ArrayBuffer.isView(buffer) ?
    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) :
    new Uint8Array(buffer);
  if (failNext &&
      bytes.byteLength === FRAME_HEADER_SIZE &&
      MATCHERS[failNext.write](bytes)) {
    const { mode } = failNext;
    failNext = null;
    if (mode === 'throw') {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    }
    if (mode === 'hang') {
      // Stand for a context terminated at this write: tell the page, which
      // terminates this worker, and never return.
      postMessage({ stuck: true });
      while (true);
    }
    return 0;
  }
  return write.call(this, buffer, options);
};

const ready = (async () => {
  const { default: moduleFactory } = await import(BUILDS.get(searchParams.get('build')));
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);
  const vfs = await OPFSWriteAheadVFS.create('commit-failure', module);
  sqlite3.vfs_register(vfs, true);
  const db = await sqlite3.open_v2(searchParams.get('filename'));
  return { sqlite3, db };
})();

addEventListener('message', async ({ data }) => {
  try {
    const { sqlite3, db } = await ready;
    switch (data.type) {
      case 'exec': {
        const rows = [];
        try {
          await sqlite3.exec(db, data.sql, row => rows.push(row));
          postMessage({ rows });
        } catch (e) {
          postMessage({ rows, error: e.message });
        }
        break;
      }
      case 'fail-next-write':
        failNext = { write: data.write, mode: data.mode };
        postMessage({});
        break;
      case 'close':
        await sqlite3.close(db);
        postMessage({});
        break;
    }
  } catch (e) {
    postMessage({ error: e.message });
  }
});
