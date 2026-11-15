/**
 * The `crypto` module's natives (crypto.ista), which hash and encode without I/O (architecture:
 * Layers), on @noble/hashes and the encoders every JavaScript engine has, so they run in Node and in
 * a browser alike. Each `Hash` and `Encoding` variant maps to its algorithm or encoding through a
 * table, so a new variant is one entry.
 *
 * `decode` reads strictly by writing the bytes back: text is canonical exactly when its bytes encode
 * to it again, with hex compared in lowercase, since either case is common. The bytes are then read
 * as UTF-8 that must be well formed.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { NativeContext, Natives } from '../../runtime/natives.ts';
import type { NativeKeys } from '../std-module.ts';
import { text, variantEntry } from '../values/arguments.ts';
import { resultError, resultOk } from '../values/results.ts';

/** An encoding of bytes as text: its name, and both ways; `decode` gives none for what it can't read. */
interface Encoding {
  readonly name: string;
  readonly encode: (bytes: Uint8Array) => string;
  readonly decode: (encoded: string) => Uint8Array | undefined;
}

/** Bytes as the binary string `btoa` takes and `atob` gives, one character per byte. */
function binaryOf(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return binary;
}

/** What `read` gives, or none when it throws: a decoder's refusal of what isn't its text. */
function readOrNone(read: () => Uint8Array): Uint8Array | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

const base64: Encoding = {
  name: 'base64',
  encode: (bytes) => btoa(binaryOf(bytes)),
  decode: (encoded) =>
    readOrNone(() => Uint8Array.from(atob(encoded), (each) => each.charCodeAt(0))),
};

// biome-ignore-start lint/style/useNamingConvention: the keys are the enums' variant names.
/** Each `Hash` variant's algorithm, by the variant's declared name. */
const algorithms = { Sha1: sha1, Sha256: sha256, Sha384: sha384, Sha512: sha512 } as const;

/** Each `Encoding` variant's encoding (`base64url` writes no padding). */
const encodings: Readonly<Record<'Hex' | 'Base64' | 'Base64Url', Encoding>> = {
  Hex: {
    name: 'hex',
    encode: bytesToHex,
    decode: (encoded) => readOrNone(() => hexToBytes(encoded)),
  },
  Base64: base64,
  Base64Url: {
    name: 'base64url',
    encode: (bytes) =>
      base64.encode(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''),
    decode: (encoded) => base64.decode(encoded.replaceAll('-', '+').replaceAll('_', '/')),
  },
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the enums' variant names.

/** The code of every `Error` `decode` returns. */
const decodeErrorCode = 'decode';

// biome-ignore lint/style/useNamingConvention: the option's name is TextDecoder's.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// biome-ignore-start lint/suspicious/noBitwiseOperators: comparing in constant time folds every byte's difference in with XOR and OR, never branching on one.
/** Whether two byte strings are equal, taking as long whichever byte differs first. */
function equalInConstantTime(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  for (const [index, byte] of left.entries()) {
    difference |= byte ^ (right[index] ?? 0);
  }
  return difference === 0;
}
// biome-ignore-end lint/suspicious/noBitwiseOperators: comparing in constant time folds every byte's difference in with XOR and OR, never branching on one.

export const cryptoNatives = (keys: NativeKeys): Natives<NativeContext> => {
  const hashType = keys.type('Hash');
  const encodingType = keys.type('Encoding');
  return {
    [keys.of('hash', hashType, 'String', encodingType)]: ([algorithm, data, encoding], context) =>
      variantEntry(context, encoding, encodings).encode(
        variantEntry(context, algorithm, algorithms)(utf8ToBytes(text(data))),
      ),
    [keys.of('hmac', hashType, 'String', 'String', encodingType)]: (
      [algorithm, key, data, encoding],
      context,
    ) =>
      variantEntry(context, encoding, encodings).encode(
        hmac(
          variantEntry(context, algorithm, algorithms),
          utf8ToBytes(text(key)),
          utf8ToBytes(text(data)),
        ),
      ),
    [keys.of('timingSafeEqual', 'String', 'String')]: ([a, b]) =>
      equalInConstantTime(utf8ToBytes(text(a)), utf8ToBytes(text(b))),
    [keys.of('encode', 'String', encodingType)]: ([source, encoding], context) =>
      variantEntry(context, encoding, encodings).encode(utf8ToBytes(text(source))),
    [keys.of('decode', 'String', encodingType)]: ([source, encoding], context) => {
      const { name, encode, decode } = variantEntry(context, encoding, encodings);
      const encoded = text(source);
      const bytes = decode(encoded);
      const canonical = name === 'hex' ? encoded.toLowerCase() : encoded;
      if (bytes === undefined || encode(bytes) !== canonical) {
        return resultError(context, `'${encoded}' is not ${name} text.`, decodeErrorCode);
      }
      try {
        return resultOk(context, strictUtf8.decode(bytes));
      } catch {
        return resultError(
          context,
          `'${encoded}' decodes to bytes that aren't UTF-8.`,
          decodeErrorCode,
        );
      }
    },
  };
};
