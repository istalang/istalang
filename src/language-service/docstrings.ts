/**
 * The docstring of what a name denotes (§2), as hover and completion show it: a function's, a
 * declared type's, a namespace's module's, a local function's. Other declarations carry none.
 */

import { localFunctionOf } from '../compiler/binder/entities.ts';
import type { Checker } from '../compiler/checker/check.ts';
import type { Denotation } from '../compiler/checker/denotation.ts';
import { importedModule } from './namespaces.ts';

/** The docstring of what `declared` names, for the declarations that may have one (§2). */
export function docstringOf(
  checker: Checker,
  declared: Denotation['declared'],
): string | undefined {
  switch (declared.kind) {
    case 'function':
      return declared.declaration.doc?.value;
    case 'type': {
      const { entity } = declared;
      return entity.kind === 'type' && 'doc' in entity.declaration
        ? entity.declaration.doc?.value
        : undefined;
    }
    case 'namespace':
      return importedModule(checker, declared.entity)?.tree.root.doc?.value;
    case 'variable': {
      const local = localFunctionOf(declared.entity);
      return local?.kind === 'FunctionDeclaration' ? local.doc?.value : undefined;
    }
    default:
      return undefined;
  }
}
