/**
 * The reach state keeps what a value was read out of through every update that hands it on: a
 * value reaching only what another reaches (`link` inside, `share`) holds some of what that one
 * was read out of, whatever paths in between have ended.
 */

import { describe, expect, it } from 'vitest';
import { ReachState } from './reach-state.ts';

const [whole, part, held, copy, read] = [0, 1, 2, 3, 4] as const;

/** `held` keeps a part read out of `whole`, and the part's own node then ends. */
function heldPartEnded(): ReachState {
  const reach = new ReachState();
  for (const node of [whole, part, held, copy, read]) {
    reach.fresh(node);
  }
  reach.readThrough(part, whole);
  reach.hold(held, part);
  reach.kill(part);
  return reach;
}

describe('what a value was read out of', () => {
  it('stays known through a link copying only what the value reaches', () => {
    const reach = heldPartEnded();
    reach.link(copy, held, { exact: true, inside: true });
    reach.readThrough(read, copy);
    reach.link(whole, read, { exact: true, inside: false });
    expect(reach.carriedBy(read, whole)).toBe(true);
  });

  it('stays known through a value sharing with what holds it', () => {
    const reach = heldPartEnded();
    reach.share(copy, held);
    reach.link(whole, copy, { exact: true, inside: false });
    expect(reach.carriedBy(copy, whole)).toBe(true);
  });
});
