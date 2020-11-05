import { MissingRequiredEnvVar } from '@cumulus/errors';

export const getRequiredEnvVar = (
  name: string,
  env: NodeJS.ProcessEnv = process.env
): string => {
  const value = env[name];

  if (typeof value === 'string') return value;

  throw new MissingRequiredEnvVar(`The ${name} environment variable must be set`);
};
