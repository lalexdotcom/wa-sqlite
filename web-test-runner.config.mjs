import { globSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { webdriverLauncher } from '@web/test-runner-webdriver';
import { playwrightLauncher } from '@web/test-runner-playwright';
import { webkit } from 'playwright';
import { jasmineTestRunnerConfig } from 'web-test-runner-jasmine';

// Throwaway probe: stock Chrome and Firefox through WebDriver, WebKit through
// Playwright. WTR_BROWSERS=chrome,firefox,webkit picks a subset.
// WebdriverIO's own logs, for the launcher-level failures.
const WDIO = {
  logLevel: process.env.WDIO_LOG_LEVEL ?? 'warn',
  ...(process.env.WDIO_OUTPUT_DIR ? { outputDir: process.env.WDIO_OUTPUT_DIR } : {}),
};

const LAUNCHERS = {
  chrome: () => webdriverLauncher({
    ...WDIO,
    capabilities: {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: ['--headless=new'],
        ...(process.env.CHROME_PATH ? { binary: process.env.CHROME_PATH } : {}),
      },
    },
  }),
  firefox: () => webdriverLauncher({
    ...WDIO,
    capabilities: {
      browserName: 'firefox',
      'moz:firefoxOptions': {
        args: ['-headless'],
        ...(process.env.FIREFOX_PATH ? { binary: process.env.FIREFOX_PATH } : {}),
      },
      // WebdriverIO's geckodriver download fails under Yarn PnP on Windows.
      ...(process.env.GECKODRIVER_PATH
        ? { 'wdio:geckodriverOptions': { binary: process.env.GECKODRIVER_PATH } }
        : {}),
    },
  }),
  safari: () => webdriverLauncher({
    ...WDIO,
    capabilities: { browserName: 'safari' },
  }),
  // Safari in the iOS simulator booted by the workflow (IOS_UDID).
  'safari-ios': () => webdriverLauncher({
    ...WDIO,
    capabilities: {
      platformName: 'iOS',
      browserName: 'safari',
      'safari:useSimulator': true,
      'safari:diagnose': true,
      ...(process.env.IOS_UDID ? { 'safari:deviceUDID': process.env.IOS_UDID } : {}),
    },
  }),
  // Playwright's WebKit has OPFS only in a persistent context.
  webkit: () => playwrightLauncher({
    product: 'webkit',
    createBrowserContext: () =>
      webkit.launchPersistentContext(mkdtempSync(join(tmpdir(), 'wtr-webkit-'))),
  }),
};

const names = (process.env.WTR_BROWSERS ?? Object.keys(LAUNCHERS).join(','))
  .split(',').map(name => name.trim()).filter(Boolean);
for (const name of names) {
  if (!LAUNCHERS[name]) throw new Error(`WTR_BROWSERS: unknown browser "${name}"`);
}

// WTR_TRACE=1 wraps each file with probe/spec-reporter.js.
function testFiles() {
  const files = process.env.WTR_FILES ? process.env.WTR_FILES.split(',') : ['./test/*.test.js'];
  if (!process.env.WTR_TRACE) return files;
  mkdirSync('probe/wrapped', { recursive: true });
  return files.flatMap(pattern => globSync(pattern)).map(file => {
    const wrapper = `probe/wrapped/${basename(file)}`;
    // Imports run before a module's own code, so the mode is a module too.
    writeFileSync('probe/wrapped/mode.js',
      `globalThis.__SQL0005_MODE = ${JSON.stringify(process.env.SQL0005_MODE ?? 'current')};\n` +
      `globalThis.__PROBE_ARM = ${JSON.stringify(process.env.PROBE_ARM ?? 'base')};\n`);
    writeFileSync(wrapper, `import './mode.js';\nimport '../spec-reporter.js';\nimport '../../${file.replaceAll('\\', '/')}';\n`);
    return wrapper;
  });
}

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  ...jasmineTestRunnerConfig(),
  testFramework: {
    config: {
      defaultTimeoutInterval: 5 * 60 * 1000
    },
  },
  browserLogs: true,
  browserStartTimeout: Number(process.env.WTR_START_MS ?? 60_000),
  testsFinishTimeout: 20 * 60 * 1000,
  nodeResolve: true,
  files: testFiles(),
  middleware: [
    async (ctx, next) => {
      if (ctx.path !== '/__probe-log') return next();
      let body = '';
      for await (const chunk of ctx.req) body += chunk;
      process.stdout.write(`PROBE-SPEC ${new Date().toISOString()} ${body}\n`);
      ctx.status = 204;
    },
  ],
  concurrency: 1,
  concurrentBrowsers: 1,
  browsers: names.map(name => LAUNCHERS[name]()),
});
