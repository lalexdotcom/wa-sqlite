// Copyright 2024 Roy T. Hashimoto. All Rights Reserved.
#include <stdio.h>
#include <emscripten.h>
#include <sqlite3.h>

#include "libadapters.h"

#define CALL_JS(SIGNATURE, KEY, ...) \
  (asyncFlags ? \
    SIGNATURE##_async(KEY, __VA_ARGS__) : \
    SIGNATURE(KEY, __VA_ARGS__))

static int libtrace_xTrace(unsigned uEvent, void* pApp, void* pP, void* pX) {
  const int asyncFlags = pApp ? *(int *)pApp : 0;
  return CALL_JS(ippipp, pApp, pApp, uEvent, pP, pX);
}

void EMSCRIPTEN_KEEPALIVE libtrace_trace_v2(sqlite3* db, unsigned uMask, int xCallback, void* pApp) {
  sqlite3_trace_v2(db, uMask, xCallback ? &libtrace_xTrace : NULL, pApp);
}
