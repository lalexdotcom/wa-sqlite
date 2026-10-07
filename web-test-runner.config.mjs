import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webdriverLauncher } from '@web/test-runner-webdriver';
import { playwrightLauncher } from '@web/test-runner-playwright';
import { webkit } from 'playwright';
import { jasmineTestRunnerConfig } from 'web-test-runner-jasmine';

// Throwaway probe: stock Chrome and Firefox through WebDriver, WebKit through
// Playwright. WTR_BROWSERS=chrome,firefox,webkit picks a subset.
const LAUNCHERS = {
  chrome: () => webdriverLauncher({
    capabilities: {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: ['--headless=new'],
        ...(process.env.CHROME_PATH ? { binary: process.env.CHROME_PATH } : {}),
      },
    },
  }),
  firefox: () => webdriverLauncher({
    capabilities: {
      browserName: 'firefox',
      'moz:firefoxOptions': {
        args: ['-headless'],
        ...(process.env.FIREFOX_PATH ? { binary: process.env.FIREFOX_PATH } : {}),
      },
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

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  ...jasmineTestRunnerConfig(),
  testFramework: {
    config: {
      defaultTimeoutInterval: 5 * 60 * 1000
    },
  },
  browserLogs: true,
  browserStartTimeout: 60_000,
  testsFinishTimeout: 20 * 60 * 1000,
  nodeResolve: true,
  files: process.env.WTR_FILES ? process.env.WTR_FILES.split(',') : ['./test/*.test.js'],
  concurrency: 1,
  concurrentBrowsers: 1,
  browsers: names.map(name => LAUNCHERS[name]()),
});
