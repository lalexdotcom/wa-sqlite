import { TestContext } from './TestContext.js';

// Throwaway probe: what the browser exposes, printed through browserLogs.
describe('probe capabilities', function() {
  it('reports', async function() {
    const report = {
      userAgent: navigator.userAgent,
      jspi: await TestContext.supportsJSPI(),
      syncHandleMode: await TestContext.supportsSyncHandleMode(),
    };
    try {
      const root = await navigator.storage.getDirectory();
      const file = await root.getFileHandle('probe-capabilities', { create: true });
      report.opfs = 'ok';
      report.createWritable = typeof file.createWritable === 'function';
      await root.removeEntry('probe-capabilities');
    } catch (e) {
      report.opfs = `${e.name}: ${e.message}`;
    }
    report.webLocks = typeof navigator.locks?.request === 'function';
    console.log(`PROBE-CAPABILITIES ${JSON.stringify(report)}`);
    expect(true).toBe(true);
  });
});
