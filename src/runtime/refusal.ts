/**
 * The runtime refusing what a host asked of it, as opposed to failing: a Definition naming externs
 * no native implements, a value with no JSON form yet (§9), an instance the store doesn't hold or
 * already holds, a snapshot whose Definition the store lacks, or a snapshot that doesn't fit its
 * Definition. A host catches these, together with the FormatError an invalid or unknown-version
 * text raises (definition/format.ts), and reports them as the request failing. Anything else the
 * runtime throws is a bug, and propagates with its stack.
 */

export type RefusalReason =
  | 'missingNatives'
  | 'noJsonForm'
  | 'unknownInstance'
  | 'instanceExists'
  | 'unknownDefinition'
  | 'snapshotMismatch';

export class Refusal extends Error {
  override readonly name = 'Refusal';
  readonly reason: RefusalReason;

  constructor(reason: RefusalReason, message: string) {
    super(message);
    this.reason = reason;
  }
}
