/**
 * What building a type needs of the program it belongs to (§2, §3.5): the rules types/ can't
 * judge alone, since they look at declarations, conformance among them, which resolution/ owns
 * above this layer. The checker implements them once (program-checker.ts) and hands them to every
 * constructor that needs them, so a type is normalized alike however it was reached: written,
 * substituted, joined by inference, made optional or widened.
 *
 * - The rules are passed where a type is built, never stored in what describes one: a type or a
 *   substitution is data a later checker may take over (structures/entries/), while the rules
 *   answer for the program of the checker building it.
 * - A rule may need types built by the same rules (conformance substitutes signatures, which may
 *   hold the very union being normalized), so the checker answers each question once per key and a
 *   question reached again while it is answered takes a stand-in (structures/entries/).
 */

import type { AnyType, Type } from './type.ts';

/** The rules of the program building a type that types/ sits below. */
export interface TypeRules {
  /**
   * Whether the `any` type `target`, a member of a union, takes `member` whole (§2 "Collapse"):
   * a value of `member` meets every constraint of `target`.
   */
  readonly absorbs: (target: AnyType, member: Type) => boolean;
}
