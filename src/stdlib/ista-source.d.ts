/**
 * An `.ista` import is the file's text, compiled into the package by the build and by the test
 * runner alike (scripts/ista-text-plugin.ts).
 */

declare module '*.ista' {
  const source: string;
  export default source;
}
