/** Futures events a test ignores: what resolving readies or answers goes nowhere. */

import type { FutureEvents } from './futures.ts';

export const ignoredEvents: FutureEvents = { ready: () => undefined, answered: () => undefined };
