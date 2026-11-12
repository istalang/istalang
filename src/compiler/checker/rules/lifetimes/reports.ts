/**
 * How a lifetime finding is reported (design.md §7): where the cycle closes, naming what holds it;
 * a call's or a witness's, with the function whose write would close it as a related location,
 * since the summaries the finding came from hold no positions.
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { typeText } from '../../types/type/type-text.ts';
import type { Violation } from './analysis/body.ts';

/** The diagnostic reporting `violation`. */
export function diagnosticOf(
  checker: Pick<CheckerContext, 'moduleOf'>,
  { kind, site, holderType, callee }: Violation,
): Diagnostic<AnchoredSpan, ModuleId> {
  const holder = typeText(holderType);
  const related =
    callee === undefined
      ? []
      : [
          {
            message: `'${callee.name.text}' is declared here.`,
            module: checker.moduleOf(callee),
            span: callee.name.span,
          },
        ];
  switch (kind) {
    case 'write':
      return checkerDiagnostics.cycleWrite(site.span, holder);
    case 'call':
      return { ...checkerDiagnostics.cycleCall(site.span, callee?.name.text, holder), related };
    case 'instance':
      return { ...checkerDiagnostics.cycleInstance(site.span, callee?.name.text, holder), related };
    case 'closure':
      return checkerDiagnostics.cycleEscaping(site.span, holder);
    case 'witness':
      return {
        ...checkerDiagnostics.cycleWitness(site.span, callee?.name.text, holder),
        related,
      };
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}
