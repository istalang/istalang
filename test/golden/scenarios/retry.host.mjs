/** The host of retry.ista: not ready on its first call, ready on every later one. */
let calls = 0;

export default {
  'retry.ready()': () => {
    calls += 1;
    return calls > 1;
  },
};
