// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
// This file should be included in the build with --post-js.

(function() {
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  // One callback key per connection, so tracing one connection leaves
  // the callbacks of the others in place.
  const mapDbToAsyncFlags = new Map();

  Module['trace_v2'] = function(db, uMask, xCallback) {
    const pOldAsyncFlags = mapDbToAsyncFlags.get(db);
    if (pOldAsyncFlags) {
      Module['deleteCallback'](pOldAsyncFlags);
      Module['_sqlite3_free'](pOldAsyncFlags);
      mapDbToAsyncFlags.delete(db);
    }

    const pAsyncFlags = Module['_sqlite3_malloc'](4);
    setValue(pAsyncFlags, xCallback instanceof AsyncFunction ? 1 : 0, 'i32');
    mapDbToAsyncFlags.set(db, pAsyncFlags);

    ccall(
      'libtrace_trace_v2',
      'void',
      ['number', 'number', 'number', 'number'],
      [db, uMask, xCallback ? 1 : 0, pAsyncFlags]);
    if (xCallback) {
      Module['setCallback'](pAsyncFlags, (_, uEvent, pP, pX) => {
        return xCallback(uEvent, pP, pX);
      });
    }
  };
})();
