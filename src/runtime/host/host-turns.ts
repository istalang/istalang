/**
 * Host calls on turns of their own (§9). The world's work runs synchronously to its end once begun
 * (durable-world.ts), and a host's extern runs inside it, halfway through the segment calling it.
 * So every host call that runs code starts on a turn of its own: never inside the world's work, a
 * call an extern makes starts once the call it was made in ended, and calls on one instance run one
 * after another, each seeing what the one before committed.
 */

/** What `call`, a host's call into the world, gives, run on a turn of its own. */
export async function hostTurn<Result>(call: () => Result | Promise<Result>): Promise<Result> {
  await Promise.resolve();
  return await call();
}
