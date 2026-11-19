/**
 * The language's fixed time-unit ratios, in milliseconds (§3.1, §19.2, §17.1), which duration literals
 * count in; the `time` module's code writes them as its own constants.
 */

export const millisecondsPerSecond = 1000n;
export const secondsPerMinute = 60n;
export const minutesPerHour = 60n;
export const hoursPerDay = 24n;
export const millisecondsPerMinute = secondsPerMinute * millisecondsPerSecond;
export const millisecondsPerHour = minutesPerHour * millisecondsPerMinute;
export const millisecondsPerDay = hoursPerDay * millisecondsPerHour;
