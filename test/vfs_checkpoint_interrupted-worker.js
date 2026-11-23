// A worker for vfs_checkpoint_interrupted.js, holding one connection on
// OPFSWriteAheadVFS. It can stop at the next truncation of a file to zero,
// as a context terminated there would: at the end of a checkpoint, that is
// the inactive write-ahead file.
import * as SQLite from '../src/sqlite-api.js';
import { OPFSWriteAheadVFS } from '../src/examples/OPFSWriteAheadVFS.js';

const BUILDS = new Map([
  ['default', '../dist/wa-sqlite.mjs'],
  ['asyncify', '../dist/wa-sqlite-async.mjs'],
  ['jspi', '../dist/wa-sqlite-jspi.mjs'],
]);

const searchParams = new URLSearchParams(location.search);

let stopAtNextTruncation = false;
const truncate = FileSystemSyncAccessHandle.prototype.truncate;
FileSystemSyncAccessHandle.prototype.truncate = function(size) {
  if (stopAtNextTruncation && size === 0) {
    // Tell the page, which terminates this worker, and never return.
    stopAtNextTruncation = false;
    postMessage({ stopped: true });
    while (true);
  }
  return truncate.call(this, size);
};

const ready = (async () => {
  const { default: moduleFactory } = await import(BUILDS.get(searchParams.get('build')));
  const module = await moduleFactory();
  const sqlite3 = SQLite.Factory(module);
  const vfs = await OPFSWriteAheadVFS.create('checkpoint-interrupted', module);
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
      case 'stop-at-next-truncation':
        stopAtNextTruncation = true;
        postMessage({});
        break;
    }
  } catch (e) {
    postMessage({ error: e.message });
  }
});
