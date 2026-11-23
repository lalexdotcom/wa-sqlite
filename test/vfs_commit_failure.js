const REPLY_TIMEOUT_MS = 10_000;

/**
 * A write that fails while a transaction commits must leave the database
 * as if the transaction had either failed or committed: on the connection
 * that made it, in the write-ahead log other connections read, and for the
 * transactions that follow.
 * @param {{ build: string }} params
 */
export function vfs_commit_failure({ build }) {
  describe('vfs_commit_failure', function() {
    const workers = [];
    afterEach(function() {
      for (const worker of workers.splice(0)) worker.terminate();
    });

    function connect(filename) {
      const url = new URL('./vfs_commit_failure-worker.js', import.meta.url);
      url.searchParams.set('build', build);
      url.searchParams.set('filename', filename);
      const worker = new Worker(url, { type: 'module' });
      workers.push(worker);
      const context = (message) => new Promise((resolve, reject) => {
        // A connection that waits forever fails the test instead of
        // stopping the suite.
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
    const exec = (context, sql) => context({ type: 'exec', sql });
    const values = async (context, table = 't') => {
      const { rows, error } = await exec(context, `SELECT x FROM ${table} ORDER BY x`);
      expect(error).toBeUndefined();
      return rows.map(row => row[0]);
    };
    const newFilename = () => `commit-failure-${Math.random().toString(36).slice(2)}`;

    for (const mode of ['short', 'throw']) {
      it(`should not commit a failed transaction with the next one (${mode} write)`, async function() {
        const filename = newFilename();
        const a = connect(filename);
        expect((await exec(a, 'CREATE TABLE t(x); INSERT INTO t VALUES (1)')).error).toBeUndefined();

        await a({ type: 'fail-next-write', write: 'commit', mode });
        expect((await exec(a, 'INSERT INTO t VALUES (2)')).error).toBeDefined();

        expect((await exec(a, 'INSERT INTO t VALUES (3)')).error).toBeUndefined();
        expect(await values(a)).toEqual([1, 3]);

        // A new connection reads the write-ahead log.
        const b = connect(filename);
        expect(await values(b)).toEqual([1, 3]);
        expect((await exec(b, 'PRAGMA integrity_check')).rows).toEqual([['ok']]);
      });
    }

    it('should not overwrite a transaction committed after the failure', async function() {
      const filename = newFilename();
      const a = connect(filename);
      const b = connect(filename);
      expect((await exec(a, 'CREATE TABLE t(x); INSERT INTO t VALUES (1)')).error).toBeUndefined();

      await a({ type: 'fail-next-write', write: 'commit', mode: 'short' });
      expect((await exec(a, 'INSERT INTO t VALUES (2)')).error).toBeDefined();
      expect(await values(a)).toEqual([1]);

      // Another connection commits after the failure, then the failed
      // connection commits again.
      expect((await exec(b, 'INSERT INTO t VALUES (10)')).error).toBeUndefined();
      expect((await exec(a, 'INSERT INTO t VALUES (3)')).error).toBeUndefined();

      const c = connect(filename);
      expect(await values(c)).toEqual([1, 3, 10]);
      expect((await exec(c, 'PRAGMA integrity_check')).rows).toEqual([['ok']]);
    });

    // Without a read after the failure, the failed connection's next commit
    // is written over the other connection's frames, and the other
    // connection's next commit over those.
    for (const [size, value] of [['the same size', '10'], ['larger', 'randomblob(9000)']]) {
      it(`should keep the database intact when another connection commits ${size} after the failure`, async function() {
        const filename = newFilename();
        const a = connect(filename);
        const b = connect(filename);
        expect((await exec(a, 'CREATE TABLE t(x); INSERT INTO t VALUES (1)')).error).toBeUndefined();

        await a({ type: 'fail-next-write', write: 'commit', mode: 'short' });
        expect((await exec(a, 'INSERT INTO t VALUES (2)')).error).toBeDefined();

        expect((await exec(b, `INSERT INTO t VALUES (${value})`)).error).toBeUndefined();
        expect((await exec(a, 'INSERT INTO t VALUES (3)')).error).toBeUndefined();
        expect((await exec(b, 'INSERT INTO t VALUES (4)')).error).toBeUndefined();

        const c = connect(filename);
        expect((await exec(c, 'PRAGMA integrity_check')).rows).toEqual([['ok']]);
        // A blob reads as its length.
        const { rows } = await exec(c,
          `SELECT CASE WHEN typeof(x) = 'blob' THEN length(x) ELSE x END FROM t ORDER BY rowid`);
        expect(rows.map(row => row[0])).toEqual([1, value === '10' ? 10 : 9000, 3, 4]);
      });
    }

    // A commit that changes write-ahead file also writes the other file's
    // header and an end frame. journal_size_limit = 1 makes the next commit
    // change file.
    for (const write of ['header', 'end']) {
      for (const mode of ['short', 'throw']) {
        it(`should keep the next commit after a failed ${write} write when changing file (${mode} write)`, async function() {
          const filename = newFilename();
          const a = connect(filename);
          expect((await exec(a, 'CREATE TABLE t(x); CREATE TABLE u(x); INSERT INTO t VALUES (1)')).error).toBeUndefined();
          await exec(a, 'PRAGMA journal_size_limit = 1');

          // Without its header the commit fails; without its end frame,
          // which only older readers need, it does not.
          await a({ type: 'fail-next-write', write, mode });
          const result = await exec(a, 'INSERT INTO u VALUES (2)');
          const committed = write === 'end';
          expect(result.error === undefined).toBe(committed);
          const u = committed ? [2] : [];
          expect(await values(a, 'u')).toEqual(u);

          expect((await exec(a, 'INSERT INTO t VALUES (3)')).error).toBeUndefined();

          // A connection opened now reads both, and can checkpoint.
          const b = connect(filename);
          expect(await values(b)).toEqual([1, 3]);
          expect(await values(b, 'u')).toEqual(u);
          expect((await exec(b, 'PRAGMA wal_checkpoint')).error).toBeUndefined();
          expect((await exec(b, 'PRAGMA integrity_check')).rows).toEqual([['ok']]);

          const c = connect(filename);
          expect(await values(c)).toEqual([1, 3]);
          expect(await values(c, 'u')).toEqual(u);
        });
      }
    }

    // A writer terminated at the commit frame of a commit that changes file
    // leaves the other file's header behind.
    for (const write of ['commit', 'end']) {
      it(`should go on changing file after a writer is terminated at its ${write} frame`, async function() {
        const filename = newFilename();
        const a = connect(filename);
        const b = connect(filename);
        expect((await exec(a, 'CREATE TABLE t(x); CREATE TABLE u(x); INSERT INTO t VALUES (1)')).error).toBeUndefined();
        await exec(a, 'PRAGMA journal_size_limit = 1');

        await a({ type: 'fail-next-write', write, mode: 'hang' });
        expect((await exec(a, 'INSERT INTO u VALUES (2)')).stuck).toBeTrue();
        a.worker.terminate();

        // The next writer commits, changes file, and commits in the other
        // file. Without a checkpoint, which would truncate the file it
        // leaves, both files then hold frames.
        await exec(b, 'PRAGMA journal_size_limit = 1; PRAGMA wal_autocheckpoint = 0');
        expect((await exec(b, 'INSERT INTO t VALUES (3)')).error).toBeUndefined();
        expect((await exec(b, 'INSERT INTO t VALUES (4)')).error).toBeUndefined();

        const root = await navigator.storage.getDirectory();
        for (const suffix of ['-wa0', '-wa1']) {
          const file = await (await root.getFileHandle(filename + suffix)).getFile();
          expect(file.size).withContext(suffix).toBeGreaterThan(32);
        }

        const c = connect(filename);
        expect(await values(c)).toEqual([1, 3, 4]);
        expect((await exec(c, 'PRAGMA integrity_check')).rows).toEqual([['ok']]);
      });
    }
  });
}
