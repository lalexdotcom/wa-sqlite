// A worker for vfs_commit_failure.js, holding one connection on
// OPFSWriteAheadVFS. It can make the write of the next commit frame fail,
// either short or with an exception, as a full quota would.
import * as SQLite from '../src/sqlite-api.js';
import { OPFSWriteAheadVFS } from '../src/examples/OPFSWriteAheadVFS.js';

const BUILDS = new Map([
  ['default', '../dist/wa-sqlite.mjs'],
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

// A commit frame is a 32-byte frame header of type 1, written on its own.
const FRAME_HEADER_SIZE = 32;
const FRAME_TYPE_COMMIT = 1;

const searchParams = new URLSearchParams(location.search);

/** @type {'short'|'throw'|null} */ let failNextCommit = null;
const write = FileSystemSyncAccessHandle.prototype.write;
FileSystemSyncAccessHandle.prototype.write = function(buffer, options) {
  const bytes = ArrayBuffer.isView(buffer) ?
    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) :
    new Uint8Array(buffer);
  if (failNextCommit &&
      bytes.byteLength === FRAME_HEADER_SIZE &&
      bytes[0] === FRAME_TYPE_COMMIT) {
    const mode = failNextCommit;
    failNextCommit = null;
    if (mode === 'throw') {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
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
      case 'fail-next-commit':
        failNextCommit = data.mode;
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
