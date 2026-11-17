/**
 * avsc reads and writes Node Buffers alone (its bytes type and its reader check `Buffer.isBuffer`),
 * so bytes cross into it here, as a view sharing their memory. The Buffer is the `buffer` module
 * avsc itself requires, never the global, so a browser needs avsc's shim of it and nothing more.
 */

// biome-ignore lint/style/useNodejsImportProtocol: the bare name avsc requires, which a browser bundle maps to its shim.
import { Buffer } from 'buffer';

/** `bytes` as the Buffer avsc takes, sharing their memory. */
export function avscBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
}
