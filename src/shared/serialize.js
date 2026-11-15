// Wrap an async function so calls run one at a time, in call order.
// A rejected call does not block later ones.
export function serialize(fn) {
  let tail = Promise.resolve();
  return (...args) => {
    const run = tail.then(() => fn(...args));
    tail = run.catch(() => {});
    return run;
  };
}
