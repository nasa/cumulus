import { z } from 'zod';

export const zodTypeGuard = <S extends z.ZodTypeAny>(schema: S) =>
  (input: unknown): input is z.infer<typeof schema> =>
    schema.safeParse(input).success;
