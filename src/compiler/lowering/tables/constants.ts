/**
 * Top-level constants (§5.1) and duration literals as Definition constants: the checker computed
 * their values (`ConstantForm`, checker/constructs/declarations/constants.ts), and lowering only
 * turns each form into a persisted value, a struct's type into its table index, and a lambda into a
 * closure of no captures of its own entry, which the constant owns. Reading one is a `constant`
 * instruction like any literal's, interned by its value (tables.ts).
 */

import type { Register } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values/values.ts';
import type { CheckedAnnotation } from '../../checker/surface/checked-annotation.ts';
import type { ConstantForm } from '../../checker/surface/constant-form.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { hasOneValue } from '../../checker/types/unions/unions.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeWriter } from '../functions/code-writer.ts';
import type { DefinitionTables } from './tables.ts';

/** A fresh register of `type` owning the constant `value`. */
export function emitConstant(
  context: { readonly code: CodeWriter; readonly tables: DefinitionTables },
  value: Value,
  type: Type,
  span: AnchoredSpan,
): Register {
  const { code, tables } = context;
  return code.constant(tables.constant(value), tables.types.reference(type), span);
}

/** The persisted value of a form the checker computed. */
export function constantValue(tables: DefinitionTables, form: ConstantForm): Value {
  switch (form.kind) {
    case 'primitive':
      return form.value;
    case 'struct':
      return {
        kind: 'struct',
        type: tables.types.index(form.type),
        fields: form.fields.map((field) => constantValue(tables, field)),
      };
    case 'tuple':
    case 'array':
      return {
        kind: form.kind,
        elements: form.elements.map((element) => constantValue(tables, element)),
      };
    case 'map':
      return {
        kind: 'map',
        entries: form.entries.map(([key, value]) => [
          constantValue(tables, key),
          constantValue(tables, value),
        ]),
      };
    case 'member':
      // A union is an enum with a variant per member, a member of one value its tag
      // (type-table.ts).
      return {
        kind: 'variant',
        type: tables.types.index(form.union),
        variant: tables.types.unionVariant(form.union, form.member),
        fields: hasOneValue(form.member) ? [] : [constantValue(tables, form.value)],
      };
    case 'function':
      return {
        kind: 'closure',
        function: tables.index({
          kind: 'nested',
          nested: {
            owner: { kind: 'constant', declaration: form.constant },
            node: form.lambda,
          },
        }),
        captures: [],
      };
    default: {
      const unhandled: never = form;
      return unhandled;
    }
  }
}

/** The values of `annotations`, as an entry carries them for tools to read (§5.5). */
export function annotationValues(
  tables: DefinitionTables,
  annotations: readonly CheckedAnnotation[],
): Value[] {
  return annotations.map(({ form }) => constantValue(tables, form));
}
