// M28: serial approval queue. Worker boleh paralel, prompt approval tetap FIFO.
export function createApprovalQueue(handler) {
  const queue = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    while (queue.length) {
      const item = queue.shift();
      try { item.resolve(await handler(...item.args)); }
      catch (err) { item.reject(err); }
    }
    running = false;
  }

  const ask = (...args) => new Promise((resolve, reject) => {
    queue.push({ args, resolve, reject });
    drain();
  });
  ask.isIdle = () => !running && queue.length === 0;
  ask.pending = () => queue.length;
  return ask;
}
