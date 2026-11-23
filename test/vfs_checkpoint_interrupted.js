const REPLY_TIMEOUT_MS = 10_000;

/**
 * A checkpoint must never leave the database file with a page older than
 * the one a connection expects to read there: neither after a checkpoint
 * that stopped before it truncated the inactive write-ahead file, nor for a
 * connection whose view is behind the latest transaction.
 * @param {{ build: string }} params
 */
export function vfs_checkpoint_interrupted({ build }) {
  describe('vfs_checkpoint_interrupted', function() {
    const workers = [];
    afterEach(function() {
      for (const worker of workers.splice(0)) worker.terminate();
    });

    function connect(filename) {
      const url = new URL('./vfs_checkpoint_interrupted-worker.js', import.meta.url);
      url.searchParams.set('build', build);
      url.searchParams.set('filename', filename);
      const worker = new Worker(url, { type: 'module' });
      workers.push(worker);
      const context = (message) => new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no reply to ${message.type} ${message.sql ?? ''}`)),
          REPLY_TIMEOUT_MS);
        worker.addEventListener('message', ({ data }) => {
          clearTimeout(timer);
          resolve(data);
        }, { once: true });
        worker.addEventListener('error', event => reject(new Error(event.message)), { once: true });
        worker.postMessage(message);
      });
      context.worker = worker;
      return context;
    }
    const exec = async (context, sql) => {
      const result = await context({ type: 'exec', sql });
      expect(result.error).withContext(sql).toBeUndefined();
      return result;
    };
    const x = async (context) => (await exec(context, 'SELECT x FROM t')).rows[0]?.[0];

    // The inactive write-ahead file holds x = 1, the active one x = 2.
    // Automatic checkpoints are off so that neither is checkpointed yet.
    async function setUp(writer, others) {
      for (const context of [writer, ...others]) {
        await exec(context, 'PRAGMA wal_autocheckpoint = 0');
      }
      await exec(writer, 'CREATE TABLE t(x); CREATE TABLE u(y); INSERT INTO t VALUES (0); INSERT INTO u VALUES (0)');
      await exec(writer, 'PRAGMA journal_size_limit = 1');
      await exec(writer, 'UPDATE t SET x = 1');
      await exec(writer, 'PRAGMA journal_size_limit = 1000');
    }

    it('should not copy older pages back after a non-passive checkpoint stopped before truncating', async function() {
      const filename = `checkpoint-interrupted-${Math.random().toString(36).slice(2)}`;
      const a = connect(filename);
      const reader = connect(filename);
      await setUp(a, [reader]);
      await exec(a, 'UPDATE t SET x = 2');
      await exec(reader, 'PRAGMA wal_read_latest = 1');
      expect(await x(reader)).toBe(2);

      // The writer stops after its checkpoint has been broadcast, before it
      // truncates the inactive file, as if its context were terminated.
      await a({ type: 'stop-at-next-truncation' });
      expect((await a({ type: 'exec', sql: 'PRAGMA wal_checkpoint(FULL)' })).stopped).toBeTrue();
      a.worker.terminate();

      // The next writer checkpoints the inactive file it finds.
      const b = connect(filename);
      expect(await x(b)).toBe(2);
      await exec(b, 'PRAGMA wal_checkpoint');

      // The reader applied the first checkpoint, so it reads what is in the
      // database file, and a transaction it makes is built on that.
      expect(await x(reader)).toBe(2);
      await exec(reader, 'UPDATE t SET x = x + 10');
      const c = connect(filename);
      expect(await x(c)).toBe(12);
      expect((await exec(c, 'PRAGMA integrity_check')).rows).toEqual([['ok']]);
    });

    it('should keep a page for a reader whose view stops at a passive checkpoint', async function() {
      const filename = `checkpoint-interrupted-${Math.random().toString(36).slice(2)}`;
      const a = connect(filename);
      const reader = connect(filename);
      await setUp(a, [reader]);

      // The reader's view stops at x = 1. It reads u only, so that t's page
      // is not in SQLite's cache when the checkpoint runs.
      await exec(reader, 'PRAGMA wal_read_latest = 1');
      await exec(reader, 'BEGIN; SELECT y FROM u');
      await exec(a, 'UPDATE t SET x = 2');
      await exec(a, 'PRAGMA wal_checkpoint');

      expect(await x(reader)).toBe(1);
      await exec(reader, 'COMMIT');
      expect(await x(reader)).toBe(2);
    });
  });
}
