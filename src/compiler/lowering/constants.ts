/**
 * Top-level constants (§3) and duration literals as Definition constants: the checker computed
 * their values (`ConstantForm`, checker/declarations/constants.ts), and lowering only turns each
 * form into a persisted value, a struct's type into its table index, and a lambda into a closure
 * of no captures of its own entry, which the constant owns. Reading one is a `constant`
 * instruction like any literal's, interned by its value (tables.ts).
 */

import type { Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values.ts';
import type { Span } from '../../text/span.ts';
import type { CheckedAnnotation } from '../checker/checked-annotation.ts';
import type { ConstantForm } from '../checker/constant-form.ts';
import type { CodeWriter } from './code-writer.ts';
import type { DefinitionTables } from './tables.ts';

/** Allocates a register and emits a `constant` instruction loading `value` into it. */
export function emitConstant(
  context: { readonly code: CodeWriter; readonly tables: DefinitionTables },
  value: Value,
  span: Span,
): Register {
  const dst = context.code.allocate();
  context.code.emit({ kind: 'constant', span, dst, constant: context.tables.constant(value) });
  return dst;
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

/** The values of `annotations`, as an entry carries them for tools to read (§3.16). */
export function annotationValues(
  tables: DefinitionTables,
  annotations: readonly CheckedAnnotation[],
): Value[] {
  return annotations.map(({ form }) => constantValue(tables, form));
}
