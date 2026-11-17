/**
 * What a function instance's own entry is made of (../lower.ts lowers each), decided in one place
 * so whatever asks of an entry before it is lowered answers as lowering will:
 * - a struct's fields build the struct, and a variant's its variant (syntax/declarations/
 *   field-defaults.ts);
 * - a derived codec's body the compiler writes from its type (docs/arch/boundary.md);
 * - a host extern's wrapper encodes and decodes around its native (§9);
 * - a function with a body is that body's code;
 * - a prelude operator's extern standing for a primitive operation (primitive-ops.ts) is that
 *   operation, written inline where called, so it has no native;
 * - any other extern is bound to a native: the one entry that is no code, so it computes no default
 *   a call leaves out, which an entry beside it does instead (tables.ts `leavingOutIndex`).
 * Every one of them but a native's begins with the prologue computing its defaults (§3.3).
 */

import {
  type PrimitiveOp,
  primitiveOfExtern,
} from '../../../definition/instructions/primitive-ops.ts';
import { derivedCodecs } from '../../../foundation/language/well-known/codecs.ts';
import type { Checker } from '../../checker/check.ts';
import { isHostExtern } from '../../checker/surface/host-externs.ts';
import type { JsonDirection } from '../../checker/surface/json-form.ts';
import type { FunctionInstance } from '../../checker/surface/witness-closing.ts';
import { constructedVariant, isFieldsFunction } from '../../syntax/declarations/field-defaults.ts';
import { keyOf } from './extern-keys.ts';

/**
 * What an instance's own entry is made of; a derived codec's says which way it crosses, and a
 * primitive's which operation it is.
 */
export type OwnEntry =
  | { readonly kind: 'struct' }
  | { readonly kind: 'constructor' }
  | { readonly kind: 'hostExtern' }
  | { readonly kind: 'body' }
  | { readonly kind: 'native' }
  | { readonly kind: 'derivedCodec'; readonly direction: JsonDirection }
  | { readonly kind: 'primitive'; readonly op: PrimitiveOp };

/** What `instance`'s own entry is made of. */
export function ownEntryOf(checker: Checker, instance: FunctionInstance): OwnEntry {
  const { declaration } = instance;
  if (isFieldsFunction(declaration)) {
    return { kind: constructedVariant(declaration) === undefined ? 'struct' : 'constructor' };
  }
  const direction = derivedCodecDirection(checker, instance);
  if (direction !== undefined) {
    return { kind: 'derivedCodec', direction };
  }
  if (isHostExtern(checker, declaration)) {
    return { kind: 'hostExtern' };
  }
  if (!declaration.isExtern) {
    return { kind: 'body' };
  }
  const op = primitiveOf(checker, instance);
  return op === undefined ? { kind: 'native' } : { kind: 'primitive', op };
}

/** The primitive operation `instance`, an extern, stands for; undefined for any other extern. */
function primitiveOf(checker: Checker, { declaration }: FunctionInstance): PrimitiveOp | undefined {
  if (!checker.isStd(checker.moduleOf(declaration))) {
    return undefined;
  }
  return primitiveOfExtern[keyOf(checker, declaration, checker.parametersOf(declaration))];
}

/**
 * Which way `instance` crosses as JSON when it is a derived codec, whose body the compiler
 * writes: `write` for `_toJson<T>`, `read` for `_fromJson<T>`; undefined for any other function.
 */
function derivedCodecDirection(
  checker: Checker,
  instance: FunctionInstance,
): JsonDirection | undefined {
  const { declaration } = instance;
  const { json } = checker.program.roles;
  if (json === undefined || checker.moduleOf(declaration) !== json) {
    return undefined;
  }
  return (Object.keys(derivedCodecs) as JsonDirection[]).find(
    (direction) => derivedCodecs[direction] === declaration.name.text,
  );
}
