/**
 * Patterns that may fail to match (§3.11): a `match` case's and an `is`'s. The walk is shared with
 * targets (walk/index.ts), and checks what only these patterns have where it meets it
 * (walk/kinds/); this module declares what they bind and keeps what lowering reads of them.
 */

import type { Pattern } from '../../../syntax/patterns.ts';
import type { BodyContext, PatternRecord } from '../../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../../contexts/passes.ts';
import { type CheckedPattern, namesBound } from '../../surface/checked-pattern.ts';
import { unfolded } from '../../types/type/computed-types.ts';
import type { Type } from '../../types/type/index.ts';
import { subjectPart } from './exhaustiveness/remaining.ts';
import { type WalkedPattern, walkPattern } from './walk/index.ts';

/** The patterns of one body as checked, for lowering. */
export class CheckedPatterns implements PatternRecord {
  readonly #patterns: PassTable<Pattern, CheckedPattern>;

  constructor(passes: Passes) {
    this.#patterns = passes.table();
  }

  record(pattern: Pattern, checked: CheckedPattern): void {
    this.#patterns.set(pattern, checked);
  }

  patternOf(pattern: Pattern, pass?: Pass): CheckedPattern | undefined {
    return this.#patterns.get(pattern, pass);
  }
}

/**
 * Checks `pattern` against a value of `subject`, declaring the names it binds, which a `match` case
 * binds of what earlier cases left of it (`remaining`, exhaustiveness/remaining.ts); its shape is
 * undefined when it acts as a guard for exhaustiveness.
 */
export function checkPattern(
  context: BodyContext,
  pattern: Pattern,
  subject: Type,
  remaining: Type = subject,
): WalkedPattern {
  const whole = subjectPart(unfolded(subject), unfolded(remaining));
  const walked = walkPattern(context, pattern, whole);
  for (const { name, type } of namesBound(walked)) {
    context.variables.declare(name, type);
  }
  context.patterns.record(pattern, walked);
  return walked;
}
