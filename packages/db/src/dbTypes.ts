/* eslint-disable unicorn/no-null */

export const timestampOrNull = (x: unknown): string | null => (
  typeof x === 'number'
    ? (new Date(x)).toISOString()
    : null
);

export const booleanOrNull = (x: unknown): boolean | null =>
  (typeof x === 'boolean' ? x : null);

export const numberOrNull = (x: unknown): number | null =>
  (typeof x === 'number' ? x : null);

export const stringOrNull = (x: unknown): string | null =>
  (typeof x === 'string' ? x : null);
