/** The host of host-codecs.ista: greets a name, keeps what is sent, and describes its leases. */
export default {
  'host-codecs.greet(host-codecs.Name)': (name) => `hello ${String(name)}`,
  'codec-queue.send(T)': () => null,
  'host-codecs.openAll()': () => [{ id: 'a' }, { id: 'b' }],
  'host-codecs.find()': () => ({ id: 'c' }),
  'host-codecs.describeAll(prelude.Array<host-codecs.Lease>, prelude.Optional<host-codecs.Lease>)':
    (leases, found) => JSON.stringify([leases, found]),
  'host-codecs.release(host-codecs.Lease)': () => null,
};
