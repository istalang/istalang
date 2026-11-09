/**
 * A constraint scope (docs/work/variance-inference/i2-scope.md): the one system of variables the
 * generic calls and literals of an outermost expression infer in, the members that joined it, and
 * the records waiting for it to settle. The body's scopes hold the current one (body-scopes.ts);
 * what opened it settles it on every path, so no member is ever left unsettled.
 *
 * - A member's inference lives in the scope's system (`root`): a literal's from the start, a call's
 *   once its candidate is chosen and it joins (`Inference.commitTo`); the first member's system is
 *   the scope's, so a scope one call alone joins builds none. So what a member is given and gives bounds
 *   the very variables everything else in the scope sees, and no construct reads another's variables
 *   through its own parameters.
 * - An expression that needs what is expected of it to be checked (a lambda, a function or variant
 *   named as a value) is a placeholder member, a variable standing for its type (i2-scope.md §3).
 *   What it can't be a value of, it refuses as a bound, so a candidate a call probes that gives it
 *   one fails. The scope checks it once what is expected of it is known enough: its head; for a
 *   function its inputs, and for a computed type what decides its form (a mapped type's keys), none
 *   of which another placeholder still gives (a function its results, a struct literal held back
 *   what its fields reach, any other itself), settled then. Each ready one goes first; where none
 *   is, one waiting on no other, then the first to join. What it then is, its placeholder is taken
 *   as.
 * - Settling judges every placeholder, those joining while that runs included, then solves every
 *   variable together, writes each record that waited, solved, and completes each member in the
 *   order they joined, what it was given before it. One pass writes every record.
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import type { PostponedMember, ScopeMember } from '../../contexts/scopes.ts';
import { builtFrom, expectedFunction } from '../../types/fitting/expected.ts';
import { Inference } from '../../types/inference/infer.ts';
import type { SettlingOf } from '../../types/inference/settle.ts';
import { formDecidedBy, isComputed } from '../../types/type/computed-types.ts';
import type { Type } from '../../types/type/index.ts';
import { membersOf } from '../../types/unions/unions.ts';

/** What settling a scope does through the body context. */
export interface ScopeSettling {
  /** Runs `check` with no scope current, so whatever it checks settles on its own. */
  readonly suspended: (check: () => void) => void;
  /** Records `node` as having `type`. */
  readonly record: (node: Expression, type: Type) => void;
}

export class ConstraintScope {
  #root: Inference | undefined;
  readonly #members: ScopeMember[] = [];
  readonly #postponed: PostponedMember[] = [];
  /** What waits for the scope to be solved: records written open, reports of calls not made. */
  readonly #waiting: ((solved: (type: Type) => Type) => void)[] = [];

  /**
   * The inference holding the scope's system, which every member's lives in: the first member's,
   * so a scope only one call joins builds no system of its own; undefined before any joins.
   */
  get root(): Inference | undefined {
    return this.#root;
  }

  /**
   * Moves `inference` into the scope's system (`Inference.commitTo`), which is its own where the
   * scope has none yet.
   */
  commit(inference: Inference): void {
    if (this.#root === undefined) {
      this.#root = inference;
    } else {
      inference.commitTo(this.#root);
    }
  }

  /** Joins `member`, its inference committed to the scope. */
  join(member: ScopeMember): void {
    this.commit(member.inference);
    this.#members.push(member);
  }

  /** Joins `member`, a placeholder its inference infers, committed to the scope. */
  postpone(member: PostponedMember): void {
    this.commit(member.inference);
    this.#postponed.push(member);
  }

  /** `type` as what is settled and what the expected type chooses guide it (`Scopes.guided`). */
  guided(type: Type): Type {
    return this.#root === undefined ? type : this.#root.guidedIn(type, this.#settlingOf());
  }

  /** Fixes what only a default decides of `types` to it (`Scopes.fixDefaults`); whether any. */
  fixDefaults(types: readonly Type[]): boolean {
    return this.#root?.fixDefaults(types, this.#settlingOf()) === true;
  }

  /** Runs `work` once the scope is solved, with its types as solved, before its members complete. */
  whenSolved(work: (solved: (type: Type) => Type) => void): void {
    this.#waiting.push(work);
  }

  /** Whether `type` mentions a variable of this scope. */
  holds(type: Type): boolean {
    return this.#root?.mentionsVariables(type) === true;
  }

  /** `type` with the scope's variables as it solved them (`settle`). */
  solved(type: Type): Type {
    return this.#root === undefined ? type : this.#root.solved(type);
  }

  /**
   * Judges every member's postponed arguments while the scope is still current, so what a lambda's
   * body gives joins it; then solves, and completes each member with no scope current.
   */
  settle(through: ScopeSettling): void {
    this.#judgeAll();
    this.#root?.solveJointly(this.#members);
    const solve = (type: Type) => this.solved(type);
    through.suspended(() => {
      for (const write of this.#waiting) {
        write(solve);
      }
      for (const member of this.#members) {
        const type = member.complete();
        if (member.node !== undefined) {
          through.record(member.node, type);
        }
      }
    });
  }

  /**
   * Judges every placeholder, those joining while it runs included: each ready one first; where
   * none is, one waiting on no other, so what it gives reaches those that do; else the first to
   * join.
   */
  #judgeAll(): void {
    const judged = new Set<PostponedMember>();
    for (;;) {
      const waiting = this.#postponed.filter((member) => !judged.has(member));
      const next =
        this.#readyOf(waiting) ??
        waiting.find((member) => !this.#waitsOn(member, waiting)) ??
        waiting[0];
      if (next === undefined) {
        return;
      }
      judged.add(next);
      this.#judge(next);
    }
  }

  /**
   * The first of `waiting` ready to be judged; where none is, once what they wait on is fixed by
   * what else bounds it, so a sibling of a type of its own tells them what they are.
   */
  #readyOf(waiting: readonly PostponedMember[]): PostponedMember | undefined {
    const isReady = (member: PostponedMember) => this.#isReady(member, waiting);
    const ready = waiting.find(isReady);
    const fixed =
      ready === undefined &&
      this.#root?.fixToward(
        waiting.map(({ type }) => type),
        this.#settlingOf(),
      ) === true;
    return fixed ? waiting.find(isReady) : ready;
  }

  /** Checks `member` with what is known of what is expected of it, its placeholder taken as that. */
  #judge(member: PostponedMember): void {
    const root = this.#root;
    const expectation = this.#expectationOf(member);
    const waited = waitedOnBy(expectation);
    if (root !== undefined && waited !== undefined) {
      root.fixIn(waited, this.#settlingOf());
    }
    const expected =
      expectation === undefined || root === undefined ? undefined : root.fixedIn(expectation);
    const judgedType = member.judge(expected);
    // One judged in error gives the error type where it goes, so what it would have bounded
    // settles to it, reporting nothing more.
    if (judgedType.kind === 'error') {
      member.inference.abandon(member.type);
    }
    member.inference.settleAs(member.type, judgedType);
  }

  /**
   * Whether enough is known of what `member` is expected to be: its head; and what it waits on
   * (`waitedOnBy`), none of which is what another of `waiting` gives (`#waitsOn`).
   */
  #isReady(member: PostponedMember, waiting: readonly PostponedMember[]): boolean {
    const root = this.#root;
    const expectation = this.#expectationOf(member);
    const headKnown =
      root !== undefined &&
      expectation !== undefined &&
      !(expectation.kind === 'parameter' && root.mentionsVariables(expectation));
    return headKnown && !this.#waitsOn(member, waiting);
  }

  /** Whether what `member` waits on (`waitedOnBy`) is what judging another of `waiting` gives. */
  #waitsOn(member: PostponedMember, waiting: readonly PostponedMember[]): boolean {
    const waited = waitedOnBy(this.#expectationOf(member));
    if (this.#root === undefined || waited === undefined) {
      return false;
    }
    const given = waiting.flatMap((other) => (other === member ? [] : [this.#givenBy(other)]));
    return this.#root.waitsOn(waited, given);
  }

  /**
   * What judging `other` bounds: its shape, which building relates to what it builds; as a
   * function, its results, its inputs fixed before; else its placeholder, which it then is.
   */
  #givenBy(other: PostponedMember): Type {
    if (other.shape !== undefined) {
      return other.shape;
    }
    const shape = expectedFunction(this.#expectationOf(other));
    return shape === undefined ? other.type : shape.result;
  }

  /**
   * What the scope knows is expected of `member`: of a union, the one member it can be a value of,
   * as a lambda passed for an optional function is one.
   */
  #expectationOf(member: PostponedMember): Type | undefined {
    const expectation = this.#root?.expectationOf(member.type, member.standsAlone !== true);
    if (expectation === undefined || expectation.kind !== 'union') {
      return expectation;
    }
    const isOpen = (part: Type) => this.#root?.mentionsVariables(part) === true;
    const taking = membersOf(expectation).filter((each) => member.admits(each, isOpen));
    return taking.length === 1 ? taking[0] : expectation;
  }

  /** How each variable of the scope settles, as the member it stands for settles it. */
  #settlingOf(): SettlingOf {
    return Inference.settlingsOf(this.#members);
  }
}

/**
 * What must be fixed before a value can be checked against `expectation`: a function's inputs, and
 * what decides the type a computed one reduces to (`formDecidedBy`); undefined for any other.
 */
function waitedOnBy(expectation: Type | undefined): Type | undefined {
  const shape = expectedFunction(expectation);
  if (shape !== undefined) {
    return inputsOf(shape);
  }
  const target = builtFrom(expectation);
  return target !== undefined && isComputed(target) ? formDecidedBy(target) : undefined;
}

/** What a function of `shape` takes: its parameters' types and its pack, as one tuple. */
function inputsOf(shape: NonNullable<ReturnType<typeof expectedFunction>>): Type {
  return {
    kind: 'tuple',
    elements: [
      ...shape.parameters.map((parameter) => parameter.type),
      ...(shape.pack === undefined ? [] : [shape.pack]),
    ],
  };
}
