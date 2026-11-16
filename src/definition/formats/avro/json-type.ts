/**
 * A value of no fixed shape (zod's `unknown`, an extern's payload) as Avro holds it: its canonical
 * JSON text (../codec.ts), so it reads back as JSON reading gives it.
 */

import avsc from 'avsc';
import { decodeJson, encodeJson } from '../codec.ts';

// biome-ignore-start lint/style/useThisInClassMethods: avsc calls a logical type's conversions as its methods.
export class JsonType extends avsc.types.LogicalType {
  protected override _toValue(value: unknown): string {
    return encodeJson(value);
  }

  protected override _fromValue(text: string): unknown {
    return decodeJson(text);
  }
}
// biome-ignore-end lint/style/useThisInClassMethods: avsc calls a logical type's conversions as its methods.
