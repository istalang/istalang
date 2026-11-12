/**
 * Top-level constants (§3) and duration literals as Definition constants: the checker computed
 * their values (`ConstantForm`, checker/constructs/declarations/constants.ts), and lowering only
 * turns each form into a persisted value, a struct's type into its table index, and a lambda into a
 * closure of no captures of its own entry, which the constant owns. Reading one is a `constant`
 * instruction like any literal's, interned by its value (tables.ts).
 */

import type { Register } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { CheckedAnnotation } from '../../checker/surface/checked-annotation.ts';
import type { ConstantForm } from '../../checker/surface/constant-form.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { hasOneValue } from '../../checker/types/unions/unions.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeWriter } from '../functions/code-writer.ts';
import type { DefinitionTables } from './tables.ts';

/** Allocates a register and emits a `constant` instruction loading `value` into it. */
export function emitConstant(
  context: { readonly code: CodeWriter; readonly tables: DefinitionTables },
  value: Value,
  span: AnchoredSpan,
): Register {
  const dst = context.code.allocate();
  context.code.emit({ kind: 'constant', span, dst, constant: context.tables.constant(value) });
  return dst;
}

/**
 * The persisted value of a form the checker computed, its types read through `typed`: a generic
 * function's annotation at the type arguments of one of its instances (§3.16).
 */
export function constantValue(
  tables: DefinitionTables,
  form: ConstantForm,
  typed: (type: Type) => Type = (type) => type,
): Value {
  const partValue = (part: ConstantForm) => constantValue(tables, part, typed);
  switch (form.kind) {
    case 'primitive':
      return form.value;
    case 'struct': {
      const type = typed(form.type);
      return {
        kind: 'struct',
        type: tables.types.index(
          type.kind === 'nominal' || type.kind === 'anonymous'
            ? type
            : unreachable('A struct type substituted is a struct type.'),
        ),
        fields: form.fields.map(partValue),
      };
    }
    case 'tuple':
    case 'array':
      return { kind: form.kind, elements: form.elements.map(partValue) };
    case 'map':
      return {
        kind: 'map',
        entries: form.entries.map(([key, value]) => [partValue(key), partValue(value)]),
      };
    case 'member': {
      // A union is an enum with a variant per member, a member of one value its tag
      // (type-table.ts); one whose members an instance merges into one is that member alone.
      const union = typed(form.union);
      const member = typed(form.member);
      if (union.kind !== 'union') {
        return partValue(form.value);
      }
      return {
        kind: 'variant',
        type: tables.types.index(union),
        variant: tables.types.unionVariant(union, member),
        fields: hasOneValue(member) ? [] : [partValue(form.value)],
      };
    }
    case 'function':
      return {
        kind: 'closure',
        function: tables.nestedIndex({
          owner: { kind: 'constant', declaration: form.constant },
          node: form.lambda,
        }),
        captures: [],
      };
    default: {
      const unhandled: never = form;
      return unhandled;
    }
  }
}

/**
 * The values of `annotations`, as an entry carries them for tools to read (§3.16), their types
 * read through `typed`, its instance's.
 */
export function annotationValues(
  tables: DefinitionTables,
  annotations: readonly CheckedAnnotation[],
  typed: (type: Type) => Type,
): Value[] {
  return annotations.map(({ form }) => constantValue(tables, form, typed));
}
