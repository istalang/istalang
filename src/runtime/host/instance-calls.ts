/**
 * A host's calls on one instance, run one after another (§9). Each starts once the call before it
 * on the same instance has settled, and sees what that one committed. None runs inside another,
 * as one a host extern makes into the runtime for its own instance would otherwise do, halfway
 * through the segment calling it.
 *
 * A call with none before it starts at once, inside the host's own call, as every host call did
 * before calls had to wait for one another; only a call made while another runs waits for it.
 */

export class InstanceCalls {
  /** For each instance with a call running, when the last call made on it settles. */
  readonly #last = new Map<string, Promise<void>>();

  /** Runs `call` on `instance` once the calls made on it before have settled; what it gives. */
  run<T>(instance: string, call: () => T | Promise<T>): Promise<T> {
    const before = this.#last.get(instance);
    let release = (): void => undefined;
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#last.set(instance, settled);
    const result = before === undefined ? (async () => await call())() : before.then(call);
    const done = () => {
      if (this.#last.get(instance) === settled) {
        this.#last.delete(instance);
      }
      release();
    };
    result.then(done, done);
    return result;
  }
}
