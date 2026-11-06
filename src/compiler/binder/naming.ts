/**
 * The naming rules (language/naming.ts) as the binder reports them: a declared name breaking its
 * convention, or taking a built-in type's name; and a name declared nowhere, which, spelled as a
 * primitive was before type names were all PascalCase (`int`), is told the one it became.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { type Convention, followsConvention, isBuiltInTypeName } from '../../language/naming.ts';
import { primitiveOnceSpelled } from '../../language/primitives.ts';
import { type Identifier, isMissingName } from '../syntax/tree/node.ts';
import type { AnchoredSpan } from '../syntax/tree/positions.ts';
import { binderDiagnostics } from './diagnostics.ts';

/** The diagnostic for a declared name that breaks the naming rules, if it does. */
export function namingViolation(
  name: Identifier,
  convention: Convention,
): Diagnostic<AnchoredSpan> | undefined {
  if (convention === 'type' && isBuiltInTypeName(name.text)) {
    return binderDiagnostics.builtInTypeName(name.span, name.text);
  }
  if (isMissingName(name) || followsConvention(name.text, convention)) {
    return;
  }
  return convention === 'type'
    ? binderDiagnostics.typeNameConvention(name.span, name.text)
    : binderDiagnostics.valueNameConvention(name.span, name.text);
}

/** The diagnostic for `name`, which resolves to nothing with nothing else to explain it. */
export function undeclaredName(name: Identifier, isAssigned: boolean): Diagnostic<AnchoredSpan> {
  if (isAssigned) {
    return binderDiagnostics.assignmentToUndeclared(name.span, name.text);
  }
  const primitive = primitiveOnceSpelled(name.text);
  return primitive === undefined
    ? binderDiagnostics.undeclared(name.span, name.text)
    : binderDiagnostics.lowercasePrimitive(name.span, name.text, primitive);
}
