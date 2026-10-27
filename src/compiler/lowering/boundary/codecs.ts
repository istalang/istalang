/**
 * The derived codecs (§9; docs/arch/boundary.md): the body of each `json._toJson<T>` and
 * `json._fromJson<T>` instance, written from `T`'s derived form (checker rules/json-forms/).
 *
 * Writing (encoder.ts) and reading (decoder.ts) take a form apart the same way: a struct, an enum
 * and a tuple part by part, each through its own type's codec, and a host type through the json
 * module's helper. A recursive type's derived codecs call themselves.
 */

import type { CodeFunction } from '../../../definition/functions.ts';
import { derivedCodecs } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import { substitute } from '../../checker/types/type.ts';
import { type FunctionInstance, substitutionOf } from '../instances.ts';
import { SynthesizedCode } from '../synthesized-code.ts';
import type { DefinitionTables } from '../tables.ts';
import { Decoder } from './decoder.ts';
import { Encoder } from './encoder.ts';

/** What writing a codec reads: the checker, the tables, and the instance whose body it is. */
export interface CodecLowering {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly instance: FunctionInstance;
}

/** Whether `instance` is a derived codec, whose body the compiler writes. */
export function isDerivedCodec(checker: Checker, instance: FunctionInstance): boolean {
  const { declaration } = instance;
  const { json } = checker.program.roles;
  return (
    json !== undefined &&
    checker.moduleOf(declaration) === json &&
    Object.values(derivedCodecs).some((name) => name === declaration.name.text)
  );
}

/** The entry of a derived codec instance: `_toJson<T>` or `_fromJson<T>`. */
export function derivedCodecEntry(lowering: CodecLowering): CodeFunction {
  const { checker, tables, instance } = lowering;
  const [type] = instance.typeArguments;
  if (type === undefined) {
    unreachable('A derived codec instance has no type argument.');
  }
  const { declaration } = instance;
  const isEncoder = declaration.name.text === derivedCodecs.write;
  const code = new SynthesizedCode(lowering, declaration.name.span, isEncoder ? 1 : 2);
  const result = substitute(checker.resultOf(declaration), substitutionOf(instance));
  if (result.kind !== 'nominal') {
    unreachable('A codec returns a Json or a Result.');
  }
  const form = checker.json.formOf(type);
  if (isEncoder) {
    new Encoder(code, result).write(form, type);
  } else {
    new Decoder(code, result).read(form, type);
  }
  return code.entry(tables.entryHeader(instance), false);
}
