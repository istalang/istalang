/**
 * The compiled codecs (§9; docs/arch/boundary.md): the body of each `json.encode<T>` and
 * `json._decodeAt<T>` instance, written from `T`'s JSON form (checker rules/json-forms/).
 *
 * Writing (encoder.ts) and reading (decoder.ts) take a type's form apart the same way: a struct,
 * an enum and a tuple field by field, anything else by calling a json-module helper. A nested type
 * is a call to its own codec, so a recursive type's codecs call themselves.
 */

import type { CodeFunction } from '../../../definition/functions.ts';
import { codecFunctions } from '../../../language/well-known.ts';
import type { Checker } from '../../checker/check.ts';
import { substitute } from '../../checker/types/type.ts';
import { type FunctionInstance, substitutionOf } from '../instances.ts';
import type { DefinitionTables } from '../tables.ts';
import { Decoder } from './decoder.ts';
import { Encoder } from './encoder.ts';
import { SynthesizedCode } from './synthesized-code.ts';

/** What writing a codec reads: the checker, the tables, and the instance whose body it is. */
export interface CodecLowering {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly instance: FunctionInstance;
}

/** Whether `instance` is a codec, whose body the compiler writes. */
export function isCodec(checker: Checker, instance: FunctionInstance): boolean {
  const { declaration } = instance;
  const { json } = checker.program.roles;
  return (
    json !== undefined &&
    checker.moduleOf(declaration) === json &&
    Object.values(codecFunctions).some((name) => name === declaration.name.text)
  );
}

/** The entry of a codec instance: `encode<T>` or `_decodeAt<T>`. */
export function codecEntry(lowering: CodecLowering): CodeFunction {
  const { checker, tables, instance } = lowering;
  const [type] = instance.typeArguments;
  if (type === undefined) {
    throw new Error('A codec instance has no type argument.');
  }
  const { declaration } = instance;
  const isEncoder = declaration.name.text === codecFunctions.encode;
  const code = new SynthesizedCode(lowering, declaration.name.span, isEncoder ? 1 : 2);
  const result = substitute(checker.resultOf(declaration), substitutionOf(instance));
  if (result.kind !== 'nominal') {
    throw new Error('A codec returns a Json or a Result.');
  }
  const form = checker.json.formOf(type);
  if (isEncoder) {
    new Encoder(code, result).write(form, type);
  } else {
    new Decoder(code, result).read(form, type);
  }
  return code.entry(tables.entryHeader(instance), false);
}
