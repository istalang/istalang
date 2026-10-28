/**
 * What a body's exits and holds name, as the flow model and lowering read it (CheckedBody.labels).
 * The checker resolves each label once, while the scopes around it are open (flow/labels.ts).
 */

import type { Break, Continue, Hold, LabelledScope } from '../syntax/statements.ts';

/** What one body's exits and holds name, as lowering and the flow model read it. */
export interface LabelResolution {
  /** The scope `exit` leaves or goes on with; undefined where the checker found none. */
  readonly exitOf: (exit: Break | Continue) => LabelledScope | undefined;
  /** The labelled loop or block what `hold` holds lasts until; undefined for the function. */
  readonly heldUntil: (hold: Hold) => LabelledScope | undefined;
  /** Whether some `hold` names `scope`, which then keeps a list of what it holds. */
  readonly isHoldScope: (scope: LabelledScope) => boolean;
}
