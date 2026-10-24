/**
 * The text of one module, as every phase sees it.
 *
 * Positions throughout the toolchain are UTF-16 offsets into `text`: that is JavaScript's native
 * string index and the LSP's default encoding, so no phase converts while working. Lines, columns
 * and other encodings are derived at the edges (see line-map.ts).
 *
 * `path` is an opaque name chosen by whoever supplied the text (a file path, a URI, a test label);
 * the compiler never interprets it, and uses it only to label diagnostics. Derived data such as the
 * line map is memoized per SourceText object, so a SourceText must never be mutated: an edit is a
 * new SourceText.
 *
 * A byte order mark at the start of a file marks its encoding, not its content (§2). It is removed
 * here, where text enters the toolchain, so no phase ever sees one at offset 0. The brand makes this
 * factory the only way to obtain a SourceText, which is what keeps that guarantee: a host that
 * built one by hand would not compile.
 */

declare const fromFactory: unique symbol;

export interface SourceText {
  readonly path: string;
  readonly text: string;
  readonly [fromFactory]: true;
}

const byteOrderMark = '\uFEFF';

/** The SourceText of a file's contents, without a leading byte order mark. */
export function createSourceText(path: string, contents: string): SourceText {
  const text = contents.startsWith(byteOrderMark) ? contents.slice(byteOrderMark.length) : contents;
  return { path, text } as SourceText;
}
