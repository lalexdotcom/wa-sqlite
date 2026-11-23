/**
 * A commit whose commit frame cannot be written must fail, and leave
 * nothing behind: neither on the connection that made it nor in the
 * write-ahead log another connection reads.
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
      return (message) => new Promise((resolve, reject) => {
        worker.addEventListener('message', ({ data }) => resolve(data), { once: true });
        worker.addEventListener('error', event => reject(new Error(event.message)), { once: true });
        worker.postMessage(message);
      });
    }
    const exec = (context, sql) => context({ type: 'exec', sql });
    const values = async (context) => {
      const { rows, error } = await exec(context, 'SELECT x FROM t ORDER BY x');
      expect(error).toBeUndefined();
      return rows.map(row => row[0]);
    };

    for (const mode of ['short', 'throw']) {
      it(`should not commit a failed transaction with the next one (${mode} write)`, async function() {
        const filename = `commit-failure-${Math.random().toString(36).slice(2)}`;
        const a = connect(filename);
        expect((await exec(a, 'CREATE TABLE t(x); INSERT INTO t VALUES (1)')).error).toBeUndefined();

        await a({ type: 'fail-next-commit', mode });
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
      const filename = `commit-failure-${Math.random().toString(36).slice(2)}`;
      const a = connect(filename);
      const b = connect(filename);
      expect((await exec(a, 'CREATE TABLE t(x); INSERT INTO t VALUES (1)')).error).toBeUndefined();

      await a({ type: 'fail-next-commit', mode: 'short' });
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
  });
}
