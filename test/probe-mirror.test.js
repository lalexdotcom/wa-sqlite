import { TestContext } from './TestContext.js';
import { sql_0005 } from './sql_0005.js';

// Throwaway probe: sql_0005 on IDBMirrorVFS asyncify alone; PROBE_ARM picks
// the variant, passed to each worker in its URL.
const arm = globalThis.__PROBE_ARM ?? 'base';
describe(`probe IDBMirrorVFS ${arm}`, function() {
  sql_0005(new TestContext({ build: 'asyncify', config: 'IDBMirrorVFS', probeArm: arm }));
});
