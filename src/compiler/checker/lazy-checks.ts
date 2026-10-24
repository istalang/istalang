/**
 * Checks computed lazily, once per subject, where a subject reached again while its own check runs
 * is a cycle (§2, §3). Function bodies and top-level constants are both checked this way: a body
 * whose result is inferred may reach itself through calls, and a constant through the constants
 * it names.
 *
 * Each member of a cycle is reported once, at itself, so what is reported doesn't depend on which
 * member was asked for first; a caller asks `inCycle` before computing and answers the cycle with
 * its own stand-in value.
 */

import { memo } from '../../structures/memo.ts';
import { withPushed } from '../../structures/stack.ts';

export class LazyChecks<Subject, Result> {
  readonly #results = new Map<Subject, Result>();
  /** The subjects being checked right now, innermost last. */
  readonly #running: Subject[] = [];
  readonly #reported = new Set<Subject>();
  readonly #reportMember: (member: Subject) => void;

  /** `reportMember` reports one member of a cycle. */
  constructor(reportMember: (member: Subject) => void) {
    this.#reportMember = reportMember;
  }

  /** `subject`'s result: computed by `check` the first time, then remembered. */
  resultOf(subject: Subject, check: () => Result): Result {
    return memo(this.#results, subject, () => withPushed(this.#running, subject, check));
  }

  /**
   * Whether `subject`'s own check is running, so reaching it now closes a cycle; if so, every member
   * of the cycle not reported yet is reported.
   */
  inCycle(subject: Subject): boolean {
    const start = this.#running.indexOf(subject);
    if (start < 0) {
      return false;
    }
    for (const member of this.#running.slice(start).filter((each) => !this.#reported.has(each))) {
      this.#reported.add(member);
      this.#reportMember(member);
    }
    return true;
  }
}
