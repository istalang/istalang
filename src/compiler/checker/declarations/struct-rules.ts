/**
 * Rules a struct declaration, and a recursive alias, must keep (§3.1, §3.17): every value of it
 * must be finite, so no field may hold another value of the same type by value (types/
 * finiteness.ts, the one rule, which holds a recursive type `match` use's values too). A recursive
 * alias's shape is reported at the field, any other body at the alias.
 */

import type { StructDeclaration, TypeAliasDeclaration } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { fieldReaderOf, holdsItself, selfHoldingField } from '../types/finiteness.ts';
import { typeText } from '../types/type-text.ts';

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

/** Reports a recursive `alias` whose values would hold themselves by value. */
export function checkFiniteAlias(checker: CheckerContext, alias: TypeAliasDeclaration): void {
  const use = checker.aliasedType(alias);
  if (use.kind !== 'recursive' || use.declaration !== alias) {
    return;
  }
  const reader = fieldReaderOf(checker);
  const body = checker.typeRules.unfold(use);
  const name = alias.name.text;
  const module = checker.moduleOf(alias);
  if (body.kind === 'anonymous') {
    const field = selfHoldingField(reader, body.fields, use);
    if (field !== undefined) {
      const at = field.declared?.node.name.span ?? alias.name.span;
      checker.report(module, checkerDiagnostics.recursiveField(at, name, field.name));
    }
  } else if (holdsItself(reader, body, use)) {
    checker.report(
      module,
      checkerDiagnostics.recursiveField(alias.name.span, name, typeText(body)),
    );
  }
}
