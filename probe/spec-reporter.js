// Throwaway: log each spec as it starts and ends, live, through the test
// server, so a hang names its spec even when browser logs never arrive.
const t0 = performance.now();
const t = () => ((performance.now() - t0) / 1000).toFixed(1).padStart(7);
const send = (line) => fetch('/__probe-log', { method: 'POST', body: line, keepalive: true }).catch(() => {});
jasmine.getEnv().addReporter({
  specStarted: (r) => send(`${t()} START ${r.fullName}`),
  specDone: (r) => send(`${t()} ${r.status.toUpperCase()} ${r.fullName}`),
});

// Page side: messages sent to workers and over ports, reported live.
{
  const c = { portSent: 0, workerSent: 0 };
  const portPost = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function(...a) { c.portSent++; return portPost.apply(this, a); };
  const workerPost = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(...a) { c.workerSent++; return workerPost.apply(this, a); };
  setInterval(() => send(`${t()} TRAFFIC page portSent=${c.portSent} workerSent=${c.workerSent}`), 2000);
}
