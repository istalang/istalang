/**
 * The entries of functions with no body of their own, built from their parameters once their
 * prologue has computed those a call left out from their defaults (§3.1, §3.3; frames.ts
 * `builtFrame`), so a default runs in the function as any function's does, never in its caller.
 *
 * - A struct's fields read as a function's parameters (syntax/declarations/field-defaults.ts). Its
 *   entry builds the struct, a shared struct's in a new cell (§3.18), for a literal leaving a field
 *   out (constructs/expressions/structs/structs.ts); a literal giving every field builds in place.
 * - A variant's constructor's entry builds the variant (§3.11), for a call leaving a field out and
 *   for what is handed an entry to call later, as a function value is (§3.14); a call giving every
 *   field builds it in place (values/variant-values.ts).
 * - A host extern's one code entry is its wrapper (synthesized/boundary/host-externs.ts), which
 *   computes its defaults before calling the host's native.
 * - An extern bound to a native computes nothing, so a call leaving its defaults out, or a function
 *   value of a shorter type naming it, calls its defaults entry, which then calls the extern with
 *   every parameter, a reference passed on as it came (tables/tables.ts `leavingOutIndex`); a call
 *   giving every argument calls the extern itself.
 */

import type { CodeFunction } from '../../../definition/tables/functions.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { FunctionInstance } from '../../checker/surface/witness-closing.ts';
import type { NominalType, Type } from '../../checker/types/type/index.ts';
import { emitCall, referenceTo } from '../calls/emit-call.ts';
import { hostCallOf, writeHostCall } from '../synthesized/boundary/host-externs.ts';
import { structValue } from '../values/struct-values.ts';
import { buildConstructed } from '../values/variant-values.ts';
import type { Lowering } from './frames.ts';
import { builtLowering } from './index.ts';

/** The entry of `instance`, a variant's constructor: its fields built into the variant. */
export function constructorEntry(lowering: Lowering, instance: FunctionInstance): CodeFunction {
  const { span } = instance.declaration.name;
  return builtLowering(lowering, instance).lowerBuilt((context, fields) =>
    buildConstructed(context, { instance, fields: fields.map(({ register }) => register) }, span),
  );
}

/** The entry of `instance`, a struct's fields: the struct they make, by their names. */
export function structEntry(lowering: Lowering, instance: FunctionInstance): CodeFunction {
  const { span } = instance.declaration.name;
  const fields = lowering.checker.parametersOf(instance.declaration);
  const built = builtLowering(lowering, instance);
  return built.lowerBuilt((context, parameters) => {
    const named = new Map(
      fields.map(({ node }, index) => {
        const register = parameters[index]?.register;
        if (node.name === undefined || register === undefined) {
          return unreachable("A struct's field has no name, or no parameter.");
        }
        return [node.name.text, register] as const;
      }),
    );
    return structValue(context, structTypeOf(built.result), named, span);
  });
}

/** The entry of `instance`, a host extern: its wrapper, calling the host's native. */
export function hostExternEntry(lowering: Lowering, instance: FunctionInstance): CodeFunction {
  const { span } = instance.declaration.name;
  const call = hostCallOf(lowering, instance);
  return builtLowering(lowering, instance, call.awaited?.value).lowerBuilt((context, parameters) =>
    writeHostCall(
      context,
      call,
      parameters.map(({ register }) => register),
      span,
    ),
  );
}

/**
 * The entry of `instance`, an extern bound to a native, computing the defaults a call leaves out,
 * then calling the extern with every parameter.
 */
export function externDefaultsEntry(lowering: Lowering, instance: FunctionInstance): CodeFunction {
  const { tables } = lowering;
  const { span } = instance.declaration.name;
  return builtLowering(lowering, instance).lowerBuilt((context, parameters) =>
    emitCall(context, {
      span,
      callee: tables.functionIndex(instance),
      arguments: parameters.map(({ register, reference }) =>
        reference ? referenceTo(register) : register,
      ),
    }),
  );
}

/** The struct a struct's fields function gives. */
function structTypeOf(type: Type): NominalType {
  if (type.kind !== 'nominal') {
    unreachable("A struct's fields give no struct.");
  }
  return type;
}
