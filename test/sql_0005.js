import * as Comlink from 'comlink';

export function sql_0005(context) {
  describe('sql_0005', function() {
    beforeAll(async function() {
      // Clear persistent storage.
      const proxy = await context.create();
      await context.destroy(proxy);
    });
  
    const cleanup = [];
    beforeEach(async function() {
      cleanup.splice(0);
    });
  
    afterEach(async function() {
      for (const fn of cleanup) {
        await fn();
      }
    });
  
    it('should transact atomically', async function() {
      const instances = [];
      for (let i = 0; i < 8; ++i) {
        const proxy = await context.create({ reset: false });
        const sqlite3 = proxy.sqlite3;
        let db;
        cleanup.push(async () => {
          if (db !== undefined) await sqlite3.close(db);
          await context.destroy(proxy);
        });
        db = await sqlite3.open_v2('demo');
        instances.push({ sqlite3, db });

        if (i === 0) {
          await sqlite3.exec(db, `
            BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS t(key PRIMARY KEY, value);
            INSERT OR IGNORE INTO t VALUES ('foo', 0);
            COMMIT;
          `);
        }
      }

      const iterations = 32;
      const values = new Set();
      await Promise.all(instances.map(async instance => {
        for (let i = 0; i < iterations; ++i) {
          const rows = await transact(instance, `
            BEGIN IMMEDIATE;
            UPDATE t SET value = value + 1 WHERE key = 'foo';
            SELECT value FROM t WHERE key = 'foo';
            COMMIT;
          `);
          values.add(rows[0][0]);
        }
      }));

      report('done');
      expect(values.size).toBe(instances.length * iterations);
      expect(Array.from(values).sort((a, b) => b - a).at(0)).toBe(values.size);
    });
  });
}

// Throwaway probe: globalThis.__SQL0005_MODE picks how a locked
// transaction is retried; attempts are reported live.
const MODE = globalThis.__SQL0005_MODE ?? 'current';
let attempts = 0;
let proxies = 0;
const report = (what) => fetch('/__probe-log', {
  method: 'POST', keepalive: true,
  body: `SQL0005 mode=${MODE} ${what} attempts=${attempts} proxies=${proxies}`,
}).catch(() => {});

async function transact(instance, sql) {
  const { sqlite3, db } = instance;
  while (true) {
    ++attempts;
    if (attempts % 500 === 0) report('progress');
    try {
      const rows = [];
      let callback;
      if (MODE === 'reuse') {
        instance.onRow ??= (++proxies, Comlink.proxy(row => instance.rows.push(row)));
        instance.rows = rows;
        callback = instance.onRow;
      } else {
        ++proxies;
        callback = Comlink.proxy(row => rows.push(row));
      }
      await sqlite3.exec(db, sql, callback);
      return rows;
    } catch (e) {
      if (e.message !== 'database is locked') {
        throw e;
      }
      if (MODE === 'backoff') {
        await new Promise(resolve => setTimeout(resolve, 1 + Math.random() * 4));
      } else if (MODE === 'slow') {
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
      }
    }
  }
}
