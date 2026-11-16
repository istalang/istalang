/**
 * The host values an instance holds (§7, §9): one object per payload while it is held, so a host
 * value it got from a call compares equal to itself as it comes back. A disposed one is forgotten,
 * its host releasing it through its type's `dispose` (disposal.ts).
 */

import { Resource } from './objects/resource.ts';

export class Resources {
  readonly #byPayload = new Map<unknown, Resource>();

  /** The host value of the extern type entry `type` holding `payload`, made with `id()` if new. */
  of(type: number, payload: unknown, id: () => number): Resource {
    const known = this.#byPayload.get(payload);
    if (known !== undefined) {
      return known;
    }
    const made = new Resource(id(), type, payload);
    this.#byPayload.set(payload, made);
    return made;
  }

  /** Knows `resource`, read back from a snapshot, as the one host value for its payload. */
  restored(resource: Resource): void {
    if (!resource.disposed) {
      this.#byPayload.set(resource.payload, resource);
    }
  }

  /** Forgets `resource`, disposed. */
  released(resource: Resource): void {
    this.#byPayload.delete(resource.payload);
  }
}
