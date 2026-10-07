import * as Comlink from 'comlink';

const TEST_WORKER_URL = './test-worker.js';
const TEST_WORKER_TERMINATE = true;

const mapProxyToReleaser = new WeakMap();
const workerFinalization = new FinalizationRegistry(release => release());

/**
 * @typedef TestContextParams
 * @property {string} [build]
 * @property {string} [config]
 * @property {boolean} [reset]
 */

/** @type {TestContextParams} */
const DEFAULT_PARAMS = Object.freeze({
  build: 'default',
  config: 'default',
  reset: true
});

export class TestContext {
  #params = structuredClone(DEFAULT_PARAMS);

  /**
   * @param {TestContextParams} params 
   */
  constructor(params = {}) {
    Object.assign(this.#params, params);
  }

  async create(extras = {}) {
    const url = new URL(TEST_WORKER_URL, import.meta.url);
    for (const [key, value] of Object.entries(this.#params)) {
      url.searchParams.set(key, value.toString());
    }
    for (const [key, value] of Object.entries(extras)) {
      url.searchParams.set(key, value.toString());
    }

    const worker = new Worker(url, { type: 'module' });
    const port = await new Promise((resolve, reject) => {
      worker.addEventListener('message', (event) => {
        if (event.ports[0]) {
          return resolve(event.ports[0]);
        }
        worker.terminate();
        const e = new Error(event.data.message);
        reject(Object.assign(e, event.data));
      }, { once: true });
      worker.addEventListener('error', (event) => {
        worker.terminate();
        reject(new Error(`test worker failed: ${event.message}`));
      }, { once: true });
    });

    const proxy = Comlink.wrap(port);
    if (TEST_WORKER_TERMINATE) {
      function releaser() {
        worker.terminate();
      }
      mapProxyToReleaser.set(proxy, releaser);
      workerFinalization.register(proxy, releaser);
    }

    return proxy;
  }

  async destroy(proxy) {
    // Close the VFS before the worker is terminated, so storage handles
    // and IndexedDB connections are released rather than abandoned.
    try {
      await Promise.race([
        proxy.vfs.close?.(),
        new Promise(resolve => setTimeout(resolve, 2000))
      ]);
    } catch (e) {
    }
    proxy[Comlink.releaseProxy]();
    const releaser = mapProxyToReleaser.get(proxy);
    if (releaser) {
      workerFinalization.unregister(releaser);
      releaser();
    }
  }

  /**
   * Whether FileSystemSyncAccessHandle accepts a mode (readwrite-unsafe),
   * which multiple connections to an OPFS database require.
   */
  static async supportsSyncHandleMode() {
    const src = `postMessage(typeof FileSystemSyncAccessHandle === 'function' &&
      'mode' in FileSystemSyncAccessHandle.prototype)`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    try {
      return await new Promise(resolve => {
        worker.addEventListener('message', ({ data }) => resolve(data), { once: true });
      });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }

  static async supportsJSPI() {
    return typeof WebAssembly === 'object' && 
      ( 'Suspending' in WebAssembly || 'Suspender' in WebAssembly );
  }
}
