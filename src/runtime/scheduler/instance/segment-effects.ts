/**
 * What an instance's segment did that only its commit makes real (§5): the calls it spawned (§9),
 * the answers it gave other instances' calls to its mocks (§10), the log records it wrote (§3.8
 * `log`), its random draws and the extern constants it read (§3.6). A discarded segment did none
 * of it; a commit writes it, and the next segment starts from what was committed.
 *
 * - Random values are draws from the source the committed snapshot keeps (random.ts), counted from
 *   the draws committed before the segment, so a segment that runs again draws the same ones. Each
 *   instance it spawns is seeded with the first bytes of a draw.
 * - An extern constant gives what it gave the first time any segment read it, ever after.
 */

import type { FunctionId } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values/values.ts';
import type { LogRecord, SpawnOptions } from '../../instance-state.ts';
import { drawOf, seedFrom } from '../../snapshot/random.ts';
import type { InstanceCall, Snapshot } from '../../snapshot/snapshot.ts';
import type { Answered } from './futures.ts';
import { spawnedName } from './instance-names.ts';

/**
 * A call this segment spawned (§9): the new instance's name, what it calls, its own options, the
 * seed of its random source, drawn from this instance's, and its outcome's encoder.
 */
interface Spawn extends Required<SpawnOptions> {
  readonly name: string;
  readonly call: InstanceCall;
  readonly seed: string;
  readonly encoder: FunctionId | undefined;
}

export class SegmentEffects {
  /** The snapshot the instance last committed, or was made from. */
  readonly #committed: () => Snapshot;
  #spawns: Spawn[] = [];
  #answered: Answered[] = [];
  #logs: LogRecord[] = [];
  /** How many random draws this segment made. */
  #draws = 0;
  /** The extern constants read before this segment, and those it read itself. */
  readonly #pinned: Map<string, Value>;

  constructor(committed: () => Snapshot) {
    this.#committed = committed;
    this.#pinned = new Map(committed().pinned.map(({ key, value }) => [key, value]));
  }

  /** What the extern constant `key` gives: what `read` gives the first time, ever after. */
  pinned(key: string, read: () => Value): Value {
    const known = this.#pinned.get(key);
    if (known !== undefined) {
      return known;
    }
    const value = read();
    this.#pinned.set(key, value);
    return value;
  }

  /** The calls this segment spawned, each a new instance once the segment commits (§9). */
  spawns(): readonly Spawn[] {
    return this.#spawns;
  }

  /**
   * Records `call` as spawned by this segment, with `options`, and with `crashEveryAwait` too when
   * this instance runs with it (§9, §10), its outcome encoded by `encoder`; the name the new
   * instance will have.
   */
  spawn(call: InstanceCall, options: SpawnOptions, encoder: FunctionId | undefined): string {
    const { instance, spawned, crashEveryAwait } = this.#committed();
    const name = spawnedName(instance, spawned + this.#spawns.length + 1);
    this.#spawns.push({
      name,
      call,
      crashEveryAwait: crashEveryAwait || options.crashEveryAwait === true,
      terminatesOnPanic: options.terminatesOnPanic === true,
      encoder,
      seed: seedFrom(this.draw()),
    });
    return name;
  }

  /** The next draw from this instance's random source (§3.8 `random`). */
  draw(): Uint8Array {
    const { seed, draws } = this.#committed().random;
    const index = draws + this.#draws;
    this.#draws += 1;
    return drawOf(seed, index);
  }

  /** Records `record`, which reaches the host once this segment commits (§3.8 `log`). */
  log(record: LogRecord): void {
    this.#logs.push(record);
  }

  /** The log records this segment wrote, in order. */
  logs(): readonly LogRecord[] {
    return this.#logs;
  }

  /** Records `answered`, an answer to another instance's call, filled once this segment commits. */
  answer(answered: Answered): void {
    this.#answered.push(answered);
  }

  /** The answers this segment gave other instances' calls, each filled once it commits (§10). */
  answered(): readonly Answered[] {
    return this.#answered;
  }

  /** What a commit of this segment writes of them, over the snapshot it changes. */
  committing(): Pick<Snapshot, 'spawned' | 'random' | 'pinned'> {
    const { spawned, random } = this.#committed();
    return {
      spawned: spawned + this.#spawns.length,
      random: { ...random, draws: random.draws + this.#draws },
      pinned: [...this.#pinned].map(([key, value]) => ({ key, value })),
    };
  }

  /** Forgets this segment's effects, once committed. */
  clear(): void {
    this.#spawns = [];
    this.#answered = [];
    this.#logs = [];
    this.#draws = 0;
  }
}
