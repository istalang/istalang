/**
 * Functions numbered by their keys (docs/arch/definition.md, "Names"): lowering spells a key for
 * every function, the same in every program holding it, and a Definition persists each as a number
 * of 64 bits, its functions sorted by it, so a function's number is its key's position among the
 * program's keys.
 *
 * A key's number is the first 8 bytes of its spelling's SHA-256, read big-endian: small, and two
 * keys of one program sharing one is refused as the program is numbered.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** How many bytes of a key's digest its number keeps: 64 bits. */
const keyBytes = 8;

/** The number a Definition persists for the function key spelled `spelled`. */
export function functionKeyOf(spelled: string): bigint {
  return BigInt(`0x${bytesToHex(sha256(utf8ToBytes(spelled)).subarray(0, keyBytes))}`);
}
