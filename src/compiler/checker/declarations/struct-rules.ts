/**
 * Rules a struct declaration must keep (§3.1): every value of it must be finite, so no field may
 * hold another value of the same struct by value (types/finiteness.ts, the one rule, which holds
 * a recursive type `match` use's values too).
 */

import type { StructDeclaration } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { fieldReaderOf, selfHoldingField } from '../types/finiteness.ts';

/** Reports each field of `declaration` that makes its values hold themselves. */
export function checkFiniteFields(checker: CheckerContext, declaration: StructDeclaration): void {
  const module = checker.moduleOf(declaration);
  const written = declaration.fields.filter((field) => field.kind === 'DeclaredField');
  checker.declaredFieldsOf(declaration).forEach((field, index) => {
    const node = written[index];
    if (
      node !== undefined &&
      selfHoldingField(fieldReaderOf(checker), [field], declaration) !== undefined
    ) {
      const name = declaration.name.text;
      checker.report(module, checkerDiagnostics.recursiveField(node.name.span, name, field.name));
    }
  });
}
