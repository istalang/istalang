/**
 * The `crypto` module's natives (crypto.ista), over `node:crypto` and `Buffer`, which hash and
 * encode without I/O (architecture: Layers). Each `Hash` and `Encoding` variant maps to Node's name
 * for its algorithm or encoding through a table, so a variant Node names otherwise (SHA-3's
 * `sha3-256`) is one entry.
 *
 * Node's decoders skip what they can't read, so `decode` reads strictly by writing the bytes back:
 * text is canonical exactly when its bytes encode to it again, with hex compared in lowercase,
 * since either case is common. The bytes are then read as UTF-8 that must be well formed.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NativeContext, Natives } from '../../runtime/natives.ts';
import { resultError, resultOk, text, variantEntry } from '../native-values.ts';
import type { NativeKeys } from '../std-module.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the enums' variant names.
/** Each `Hash` variant's algorithm, as Node names it, by the variant's declared name. */
const algorithms = {
  Sha1: 'sha1',
  Sha256: 'sha256',
  Sha384: 'sha384',
  Sha512: 'sha512',
} as const;

/** Each `Encoding` variant's encoding, as `Buffer` names it (`base64url` writes no padding). */
const encodings = {
  Hex: 'hex',
  Base64: 'base64',
  Base64Url: 'base64url',
} as const satisfies Record<string, BufferEncoding>;
// biome-ignore-end lint/style/useNamingConvention: the keys are the enums' variant names.

/** The code of every `Error` `decode` returns. */
const decodeErrorCode = 'decode';

// biome-ignore lint/style/useNamingConvention: the option's name is TextDecoder's.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export const cryptoNatives = (keys: NativeKeys): Natives<NativeContext> => {
  const hashType = keys.type('Hash');
  const encodingType = keys.type('Encoding');
  return {
    [keys.of('hash', hashType, 'string', encodingType)]: ([algorithm, data, encoding], context) =>
      createHash(variantEntry(context, algorithm, algorithms))
        .update(text(data))
        .digest()
        .toString(variantEntry(context, encoding, encodings)),
    [keys.of('hmac', hashType, 'string', 'string', encodingType)]: (
      [algorithm, key, data, encoding],
      context,
    ) =>
      createHmac(variantEntry(context, algorithm, algorithms), text(key))
        .update(text(data))
        .digest()
        .toString(variantEntry(context, encoding, encodings)),
    [keys.of('timingSafeEqual', 'string', 'string')]: ([a, b]) => {
      const left = Buffer.from(text(a));
      const right = Buffer.from(text(b));
      return left.length === right.length && timingSafeEqual(left, right);
    },
    [keys.of('encode', 'string', encodingType)]: ([source, encoding], context) =>
      Buffer.from(text(source)).toString(variantEntry(context, encoding, encodings)),
    [keys.of('decode', 'string', encodingType)]: ([source, encoding], context) => {
      const name = variantEntry(context, encoding, encodings);
      const encoded = text(source);
      const bytes = Buffer.from(encoded, name);
      const canonical = name === 'hex' ? encoded.toLowerCase() : encoded;
      if (bytes.toString(name) !== canonical) {
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
