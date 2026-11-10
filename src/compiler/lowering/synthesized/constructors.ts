/**
 * A variant's constructor's own entry (§3.11), for what is handed an entry to call later, as a
 * function value is (§3.14): code taking the variant's fields as its parameters and giving the variant
 * they make, built as a call of the constructor builds it in place (values/variant-values.ts).
 */

import type { CodeFunction } from '../../../definition/tables/functions.ts';
import type { CodeContext } from '../context.ts';
import type { FunctionInstance } from '../tables/instances.ts';
import { buildConstructed } from '../values/variant-values.ts';
import { SynthesizedCode } from './index.ts';

/** The entry of `instance`, a variant's constructor: its parameters built into the variant. */
export function constructorEntry(
  context: Pick<CodeContext, 'checker' | 'tables'>,
  instance: FunctionInstance,
): CodeFunction {
  const { declaration } = instance;
  const fields = context.checker.parametersOf(declaration).length;
  const code = new SynthesizedCode(context, declaration.name.span, fields);
  code.return(buildConstructed(code, { instance, fields: code.parameters }, code.span));
  return code.entry(context.tables.entryHeader(instance), false);
}
