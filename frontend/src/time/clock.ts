/**
 * The one place PocketWalk reads the time. Everything that needs "now" takes a Clock, so tests can
 * inject a fake and the walk timer never depends on how many interval callbacks have fired.
 *
 * Date.now() (wall clock) is used on purpose: unlike performance.now() it keeps advancing while a
 * phone is asleep or the tab is frozen, which is exactly the "phone down" case.
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
