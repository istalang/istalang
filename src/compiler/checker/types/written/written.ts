/**
 * Where a type is written (§4.2): the checker resolving it, and its module. Inside the passes of a
 * loop over a type's keys (§11.2) it is also the pass: the loop's key is bound there (contexts/
 * passes.ts), so a written type depending on it resolves as that pass reads it, from its leaves up,
 * never resolved first with the key unbound; what it gets wrong is reported in the pass, which
 * reports a mistake several passes make once, and each node it resolves is recorded there for tools.
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { TypeNode } from '../../../syntax/types/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { Substitution } from '../parts/substitution.ts';
import type { Type } from '../type/index.ts';

/** Where a type is written: the checker resolving it, its module, and the pass, if any. */
export interface Written {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  readonly pass?: PassResolution | undefined;
}

/** A pass resolving written types (the banner): what it binds, reports and records. */
export interface PassResolution {
  readonly binds: Substitution;
  readonly report: (diagnostic: Diagnostic<AnchoredSpan>) => void;
  readonly record: (node: TypeNode, type: Type) => void;
}

/** Reports `diagnostic` where `written` is resolved: in its pass, or else in its module. */
export function reportWritten(written: Written, diagnostic: Diagnostic<AnchoredSpan>): void {
  if (written.pass === undefined) {
    written.checker.report(written.module, diagnostic);
  } else {
    written.pass.report(diagnostic);
  }
}
