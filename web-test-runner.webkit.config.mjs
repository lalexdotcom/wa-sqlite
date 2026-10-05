// Throwaway: the suite on Playwright's WebKit, with a persistent context per session.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { playwrightLauncher } from '@web/test-runner-playwright';
import { webkit } from 'playwright';
import base from './web-test-runner.config.mjs';

export default {
  ...base,
  testsFinishTimeout: 20 * 60 * 1000,
  files: process.env.WTR_FILES ? [process.env.WTR_FILES] : base.files,
  browsers: [
    playwrightLauncher({
      product: 'webkit',
      createBrowserContext: () =>
        webkit.launchPersistentContext(mkdtempSync(join(tmpdir(), 'wtr-webkit-'))),
    }),
  ],
};
