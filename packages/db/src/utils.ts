import { MissingRequiredEnvVarError } from '@cumulus/errors';

export const getRequiredEnvVar = (
  name: string,
  env: NodeJS.ProcessEnv = process.env
): string => {
  const value = env[name];

  if (typeof value === 'string') return value;

  throw new MissingRequiredEnvVarError(`The ${name} environment variable must be set`);
};
