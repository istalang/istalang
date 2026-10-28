/**
 * Rules a struct declaration must keep (§3.1): every value of it must be finite, so no field may
 * hold another value of the same struct by value, directly or through other structs, tuples and
 * anonymous structs. Inside an optional or a collection, a value may be absent, so the chain ends
 * there: enums and extern types aren't followed, and neither are shared structs, whose values are
 * handles (§3.18).
 */

import type { StructDeclaration } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { Type } from '../types/type.ts';

/** Reports each field of `declaration` that makes its values hold themselves. */
export function checkFiniteFields(checker: CheckerContext, declaration: StructDeclaration): void {
  const module = checker.moduleOf(declaration);
  const written = declaration.fields.filter((field) => field.kind === 'DeclaredField');
  checker.declaredFieldsOf(declaration).forEach((field, index) => {
    const node = written[index];
    if (node !== undefined && holds(checker, field.type, declaration, new Set())) {
      const name = declaration.name.text;
      checker.report(module, checkerDiagnostics.recursiveField(node.name.span, name, field.name));
    }
  });
}

/** Whether a value of `type` holds a value of `target` by value, at any depth. */
function holds(
  checker: CheckerContext,
  type: Type,
  target: StructDeclaration,
  seen: Set<StructDeclaration>,
): boolean {
  switch (type.kind) {
    case 'tuple':
      return type.elements.some((element) => holds(checker, element, target, seen));
    case 'anonymous':
      return type.fields.some((field) => holds(checker, field.type, target, seen));
    case 'nominal': {
      const { declaration } = type.entity;
      if (declaration === target) {
        return true;
      }
      if (declaration.kind !== 'StructDeclaration' || seen.has(declaration)) {
        return false;
      }
      seen.add(declaration);
      const fields = checker.fieldsOf(type) ?? [];
      return fields.some((field) => holds(checker, field.type, target, seen));
    }
    case 'primitive':
    case 'function':
    case 'parameter':
    case 'any':
    case 'error':
      return false;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
