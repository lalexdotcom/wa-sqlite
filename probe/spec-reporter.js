// Throwaway: log each spec as it starts and ends, live, through the test
// server, so a hang names its spec even when browser logs never arrive.
const t0 = performance.now();
const t = () => ((performance.now() - t0) / 1000).toFixed(1).padStart(7);
const send = (line) => fetch('/__probe-log', { method: 'POST', body: line, keepalive: true }).catch(() => {});
jasmine.getEnv().addReporter({
  specStarted: (r) => send(`${t()} START ${r.fullName}`),
  specDone: (r) => send(`${t()} ${r.status.toUpperCase()} ${r.fullName}`),
});
