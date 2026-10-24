/**
 * The text of one module, as every phase sees it.
 *
 * Positions throughout the toolchain are UTF-16 offsets into `text`: that is JavaScript's native
 * string index and the LSP's default encoding, so no phase converts while working. Lines, columns
 * and other encodings are derived at the edges (see line-map.ts).
 *
 * `path` is an opaque name chosen by whoever supplied the text (a file path, a URI, a test label);
 * the compiler never interprets it. Derived data such as the line map is memoized per SourceText
 * object, so a SourceText must never be mutated: an edit is a new SourceText.
 */

export interface SourceText {
  readonly path: string;
  readonly text: string;
}
