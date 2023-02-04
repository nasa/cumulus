import { z } from 'zod';
import { BetterZodError, betterZodError } from './better-zod-error';

export const zodParser = <S extends z.ZodTypeAny>(type: string, schema: S) =>
  (input: unknown): z.infer<typeof schema> | BetterZodError => {
    const parseResult = schema.safeParse(input);
    return parseResult.success
      ? parseResult.data
      : betterZodError({ type, input, error: parseResult.error });
  };
