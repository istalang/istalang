/**
 * An import's path (§13.1), as every loader and tool reads it: names separated by `/`, the `.ista`
 * extension implied, from the project root, or, when it starts with `./` or `../`, from the
 * importing module's folder. After those, a name is never empty, `.` or `..`, and holds no `\` or
 * `:`, which some platforms read as separators or drive letters, so a path can't escape its base:
 * an absolute path, a URL, `a//b` or `a/../b` is no import path.
 */

export interface ImportPath {
  /** The `.` and `..` the path starts with, which make it relative; none for one from the root. */
  readonly climbs: readonly ('.' | '..')[];
  /** The names after them; none for the folder a relative path starts in. */
  readonly names: readonly string[];
}

/** `path` read as an import's path, or as a folder of one; undefined when it is neither. */
export function importPathOf(path: string): ImportPath | undefined {
  const parts = path.split('/');
  const leading = parts.findIndex((part) => !isClimb(part));
  const climbs = (leading === -1 ? parts : parts.slice(0, leading)).filter(isClimb);
  const names = leading === -1 ? [] : parts.slice(leading);
  return names.every(isName) ? { climbs, names } : undefined;
}

function isClimb(part: string): part is '.' | '..' {
  return part === '.' || part === '..';
}

const platformSeparator = /[\\:]/u;

function isName(part: string): boolean {
  return part !== '' && !isClimb(part) && !platformSeparator.test(part);
}
