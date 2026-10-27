/**
 * The `crypto` module's natives (crypto.ista), over `node:crypto` and `Buffer`, which hash and
 * encode without I/O (architecture: Layers). Each `Hash` and `Encoding` variant's name, lowercased,
 * is Node's name for its algorithm or encoding (`Sha256` → `sha256`, `Base64Url` → `base64url`,
 * which Node writes unpadded).
 *
 * Node's decoders skip what they can't read, so `decode` reads strictly by writing the bytes back:
 * text is canonical exactly when its bytes encode to it again, with hex compared in lowercase,
 * since either case is common. The bytes are then read as UTF-8 that must be well formed.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NativeContext, Natives } from '../../runtime/natives.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { resultError, resultOk, text, variantName } from '../native-values.ts';
import type { NativeKeys } from '../std-module.ts';

/** The code of every `Error` `decode` returns. */
const decodeErrorCode = 'decode';

// biome-ignore lint/style/useNamingConvention: the option's name is TextDecoder's.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export const cryptoNatives = (keys: NativeKeys): Natives<NativeContext> => {
  const hashType = keys.type('Hash');
  const encodingType = keys.type('Encoding');
  return {
    [keys.of('hash', hashType, 'string', encodingType)]: ([algorithm, data, encoding], context) =>
      createHash(nodeName(context, algorithm))
        .update(text(data))
        .digest()
        .toString(encodingOf(context, encoding)),
    [keys.of('hmac', hashType, 'string', 'string', encodingType)]: (
      [algorithm, key, data, encoding],
      context,
    ) =>
      createHmac(nodeName(context, algorithm), text(key))
        .update(text(data))
        .digest()
        .toString(encodingOf(context, encoding)),
    [keys.of('timingSafeEqual', 'string', 'string')]: ([a, b]) => {
      const left = Buffer.from(text(a));
      const right = Buffer.from(text(b));
      return left.length === right.length && timingSafeEqual(left, right);
    },
    [keys.of('encode', 'string', encodingType)]: ([source, encoding], context) =>
      Buffer.from(text(source)).toString(encodingOf(context, encoding)),
    [keys.of('decode', 'string', encodingType)]: ([source, encoding], context) => {
      const name = encodingOf(context, encoding);
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

type Variant = Parameters<typeof variantName>[1];

/** Node's name for the algorithm or encoding `variant` names: its name, lowercased. */
function nodeName(context: NativeContext, variant: Variant): string {
  return variantName(context, variant).toLowerCase();
}

/** The encoding an `Encoding` variant names, as `Buffer` takes it. */
function encodingOf(context: NativeContext, variant: Variant): BufferEncoding {
  const name = nodeName(context, variant);
  return Buffer.isEncoding(name) ? name : unreachable(`Buffer has no encoding '${name}'.`);
}
