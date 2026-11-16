/** The host of host-future.ista: quotes resolve as promises, one as a bigint, one as a number. */
const prices = { apple: 3n, pear: 4 };

export default {
  'host-future.quote(String)': (item) => Promise.resolve(prices[item]),
  'host-future.record(String, Int)': () => null,
};
