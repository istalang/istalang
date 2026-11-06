/**
 * The language's fixed time-unit ratios, in milliseconds (§2, §3.8, §9): one home for duration
 * literals and ISO 8601 duration and time text (stdlib/time/iso.ts).
 */

export const millisecondsPerSecond = 1000n;
export const secondsPerMinute = 60n;
export const minutesPerHour = 60n;
export const hoursPerDay = 24n;
export const millisecondsPerMinute = secondsPerMinute * millisecondsPerSecond;
export const millisecondsPerHour = minutesPerHour * millisecondsPerMinute;
export const millisecondsPerDay = hoursPerDay * millisecondsPerHour;
