/** Stage 1 only. No I/O, clock, timers, prose parsing or runtime imports. */
export type Actor = 'program' | 'agent' | 'human';
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
export const accept = <T>(value: T): Result<T> => ({ ok: true, value });
export const reject = (reason: string): Result<never> => ({ ok: false, reason });
export function unreachable(value: never): never { throw new Error('Unknown event: ' + String(value)); }
export type Command<K extends string, A extends Actor, P = object> = Readonly<{ type: K; actor: A } & P>;
