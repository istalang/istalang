/** The CLI's one clock: what segments start at, and how long to sleep until a timer is due. */

/** Milliseconds since the Unix epoch. */
export function clock(): bigint {
  return BigInt(Date.now());
}
