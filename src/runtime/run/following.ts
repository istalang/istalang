/**
 * A future following another (§3.14): a widened call's own future, which settles as the call's
 * does, together with it, with its value converted, and leaves the call's as it is for whatever
 * else reaches it.
 *
 * - The follower holds what it follows, and its converter, until that settles: the call's future
 *   is then held by the widened call's as by an unwidened caller.
 * - Disposed first, the follower lets go of what it follows apart from its round, at once, so a
 *   call nothing else holds stops as its own future's disposal would stop it (§7).
 * - A snapshot keeps the follower's side (`follows`); reading it back links the two again.
 */

import type { Value } from '../../definition/values/values.ts';
import type { Lifetimes } from './lifetimes.ts';
import type { Following, Future } from './objects/future.ts';

/** Has `follower` follow `followed`, converting its value by `converter`. */
export function follow(follower: Future, following: Following): void {
  follower.follows = following;
  following.future.followers.push(follower);
}

/** What `follower` followed, no longer linked; none for a future following nothing. */
export function unfollowed(follower: Future): Following | undefined {
  const { follows } = follower;
  if (follows !== undefined) {
    follower.follows = undefined;
    const { followers } = follows.future;
    followers.splice(followers.indexOf(follower), 1);
  }
  return follows;
}

/**
 * What a follower settles with as what it follows settles with `value`, which that future keeps:
 * `value` converted by `converter`, which it lets go of. What it followed it lets go of only once
 * what waited on that heard its value (settling.ts).
 */
export function convertedFollowing(
  call: (converter: Value, value: Value) => unknown,
  lifetimes: Lifetimes,
  converter: Value,
  value: Value,
): Value {
  const result = call(converter, value) as Value;
  lifetimes.letGo(converter);
  return result;
}
