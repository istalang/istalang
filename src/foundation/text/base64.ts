/**
 * Bytes as base64 text and back, on the `btoa` and `atob` every JavaScript engine has, so it runs
 * in Node and in a browser alike. Both convert through a binary string, one character per byte,
 * built in chunks: one argument per byte would overflow the call stack on large inputs.
 */

const chunkBytes = 0x80_00;

/** `bytes` as base64 text, padded. */
export function base64Of(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += chunkBytes) {
    chunks.push(String.fromCharCode(...bytes.subarray(start, start + chunkBytes)));
  }
  return btoa(chunks.join(''));
}

/** The bytes base64 `text` encodes; throws where it isn't base64. */
export function bytesOfBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) {
    bytes[at] = binary.charCodeAt(at);
  }
  return bytes;
}
