/**
 * Code points in UTF-16 text: how wide each is, and positions counted in code points beside the
 * UTF-16 offsets JavaScript counts. The scanner steps over source text by code point; std natives
 * count a string as the language does (spec §3.8), searching its UTF-16 text, which never splits a
 * code point the language holds (a string can't hold a lone surrogate, §2), and converting
 * positions only at their edge, here.
 */

/** The code points of `s`, as its length, indexing, slicing and iteration count them. */
export const codePoints = (s: string): string[] => [...s];

const lastBasicPlaneCodePoint = 0xff_ff;

/** UTF-16 length of the code point at `offset`: 2 for a surrogate pair, else 1. */
export function codePointWidth(text: string, offset: number): number {
  return (text.codePointAt(offset) ?? 0) > lastBasicPlaneCodePoint ? 2 : 1;
}

/** Where code point `position` of `s` starts, in UTF-16 units: 0 before the start, the length past the end. */
export function utf16Offset(s: string, position: number): number {
  let offset = 0;
  for (let counted = 0; counted < position && offset < s.length; counted += 1) {
    offset += codePointWidth(s, offset);
  }
  return offset;
}

/** How many code points `s` holds, counted without allocating an array of them. */
export function codePointCount(s: string): number {
  return codePointPositions(s)(s.length);
}

/** The code point at `position` of `s`, in code points; undefined outside `s`. */
export function codePointAtPosition(s: string, position: number): string | undefined {
  if (position < 0 || position >= s.length) {
    return undefined;
  }
  const offset = utf16Offset(s, position);
  return offset < s.length ? s.slice(offset, offset + codePointWidth(s, offset)) : undefined;
}

/** The substring of `s` from code point `start` to `end`, both non-negative. */
export function codePointSlice(s: string, start: number, end: number): string {
  if (end <= start) {
    return '';
  }
  const from = utf16Offset(s, start);
  let to = from;
  for (let counted = start; counted < end && to < s.length; counted += 1) {
    to += codePointWidth(s, to);
  }
  return s.slice(from, to);
}

/**
 * The code point position of each UTF-16 offset of `s` it is asked for, each an offset where a code
 * point starts. Asked in increasing order, as a scan finds matches, it counts each code point once.
 */
export function codePointPositions(s: string): (offset: number) => number {
  let counted = { offset: 0, position: 0 };
  return (offset) => {
    if (offset < counted.offset) {
      counted = { offset: 0, position: 0 };
    }
    let { offset: reached, position } = counted;
    while (reached < offset) {
      reached += codePointWidth(s, reached);
      position += 1;
    }
    counted = { offset: reached, position };
    return position;
  };
}
