import { DuckDBValue } from '@duckdb/node-api';

export function prepareBindings(bindings: ReadonlyArray<any>): DuckDBValue[] {
  return bindings.map((value) => {
    if (value instanceof Date) return value.toISOString();
    if (value !== null && typeof value === 'object') return JSON.stringify(value);
    return value as DuckDBValue;
  });
}
