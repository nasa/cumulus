import type { ZodError } from 'zod';

const appendNumber = (val: string, num: number) => `${val}[${num}]`;

const appendString = (val: string, str: string) => (val ? `${val}.${str}` : str);

const joinPath = (pathSegments: Array<string | number>) => {
  let result = '';

  pathSegments.forEach((pathSegment) => {
    result = typeof pathSegment === 'number'
      ? appendNumber(result, pathSegment)
      : appendString(result, pathSegment);
  });
  return result;
};

interface BetterZodErrorParams {
  type: string
  input: unknown
  error: ZodError
}

export class BetterZodError extends Error {
  public readonly input: unknown;
  public readonly errors: string[];

  constructor(params: BetterZodErrorParams) {
    super(`Failed to parse ${params.type}`);

    this.name = 'BetterZodError';

    this.input = params.input;

    this.errors = params.error.errors.map(({ message, path }) =>
      (path.length === 0 ? message : `${message} at ${joinPath(path)}`));
  }
}

export const betterZodError = (params: BetterZodErrorParams) => new BetterZodError(params);

export const isBetterZodError = (e: unknown): e is BetterZodError => e instanceof BetterZodError;
