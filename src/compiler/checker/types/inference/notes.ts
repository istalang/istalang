/**
 * What matching notes of a system's variables beside their bounds (system.ts): those whose bounds
 * disagreed, those the error type or `Never` met, and the member variables given a value of several
 * members of their union. A system joining others takes on their notes with their bounds.
 */

import type { ParameterKey, Type } from '../type/index.ts';
import { errorType, neverType } from '../type/primitives.ts';

const noVariables: ReadonlySet<ParameterKey> = new Set();
const noMembers: ReadonlyMap<ParameterKey, Type> = new Map();

export class MatchNotes {
  #conflicts: Set<ParameterKey> | undefined;
  #metNever: Set<ParameterKey> | undefined;
  #metError: Set<ParameterKey> | undefined;
  #severalMembers: Map<ParameterKey, Type> | undefined;

  /** The variables whose bounds disagreed. */
  get conflicts(): ReadonlySet<ParameterKey> {
    return this.#conflicts ?? noVariables;
  }

  /** The member variables given a value of several members of their union, by what was given. */
  get severalMembers(): ReadonlyMap<ParameterKey, Type> {
    return this.#severalMembers ?? noMembers;
  }

  /** Notes that `variable`'s bounds disagreed. */
  conflict(variable: ParameterKey): void {
    this.#conflicts ??= new Set();
    this.#conflicts.add(variable);
  }

  /** Notes that `Never` was given where `variable` stands. */
  metNever(variable: ParameterKey): void {
    this.#metNever ??= new Set();
    this.#metNever.add(variable);
  }

  /** Notes that the error type was given where `variable` stands. */
  metError(variable: ParameterKey): void {
    this.#metError ??= new Set();
    this.#metError.add(variable);
  }

  /** Notes that `variable`, a member variable, was given `given`, of several members. */
  severalMembersGiven(variable: ParameterKey, given: Type): void {
    this.#severalMembers ??= new Map();
    this.#severalMembers.set(variable, given);
  }

  /** What `variable` falls back to where no bound settles it: the error type or `Never` it met. */
  fallbackOf(variable: ParameterKey): Type | undefined {
    if (this.#metError?.has(variable) === true) {
      return errorType;
    }
    return this.#metNever?.has(variable) === true ? neverType : undefined;
  }

  /** Takes on `other`'s notes. */
  adopt(other: MatchNotes): void {
    for (const variable of other.conflicts) {
      this.conflict(variable);
    }
    for (const variable of other.#metNever ?? []) {
      this.metNever(variable);
    }
    for (const variable of other.#metError ?? []) {
      this.metError(variable);
    }
    for (const [variable, given] of other.severalMembers) {
      this.severalMembersGiven(variable, given);
    }
  }
}
