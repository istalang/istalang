/**
 * Top-level constants (§3) and duration literals as Definition constants: the checker computed
 * their values (`ConstantForm`, checker/declarations/constants.ts), and lowering only turns each
 * form into a persisted value, a struct's type into its table index, and a lambda into a closure
 * of no captures of its own entry, which the constant owns. Reading one is a `constant`
 * instruction like any literal's, interned by its value (tables.ts).
 */

import type { Value } from '../../definition/values.ts';
import type { ConstantForm } from '../checker/constant-form.ts';
import type { DefinitionTables } from './tables.ts';

/** The persisted value of a form the checker computed. */
export function constantValue(tables: DefinitionTables, form: ConstantForm): Value {
  switch (form.kind) {
    case 'primitive':
      return form.value;
    case 'struct':
      return {
        kind: 'struct',
        type: tables.typeIndex(form.type),
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
