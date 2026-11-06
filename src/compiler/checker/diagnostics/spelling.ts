/**
 * How messages spell a parameter: by its name, quoted, or as the pattern it is instead when it has
 * none (§3.3). Messages of several parts of the catalog name parameters, so the spelling is one.
 */

/**
 * `'name'`, or "this pattern" for a parameter that is a pattern alone, capitalized to start a
 * sentence.
 */
export function spelledParameter(name: string | undefined, starts = false): string {
  if (name !== undefined) {
    return `'${name}'`;
  }
  return starts ? 'This pattern' : 'this pattern';
}
