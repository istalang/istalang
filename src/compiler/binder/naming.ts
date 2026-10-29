/** Where a declared name breaks the naming conventions (language/naming.ts), the binder reports it. */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { type Convention, followsConvention } from '../../language/naming.ts';
import { type Identifier, isMissingName } from '../syntax/node.ts';
import { binderDiagnostics } from './diagnostics.ts';

/** The diagnostic for a declared name that breaks its convention, if it does. */
export function conventionViolation(
  name: Identifier,
  convention: Convention,
): Diagnostic | undefined {
  if (isMissingName(name) || followsConvention(name.text, convention)) {
    return;
  }
  return convention === 'type'
    ? binderDiagnostics.typeNameConvention(name.span, name.text)
    : binderDiagnostics.valueNameConvention(name.span, name.text);
}
