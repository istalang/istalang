/** The host of callback-holdings.ista: each lease is a name, and disposing one is a host call. */
let made = 0;

export default {
  'callback-holdings.makeLease()': () => {
    made += 1;
    return `lease-${made}`;
  },
  'callback-holdings.dispose(callback-holdings.Lease)': () => null,
};
