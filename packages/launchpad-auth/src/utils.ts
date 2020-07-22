/* @private */
export const getEnvVar = (name: string): string => {
  const envVar = process.env[name];
  if (!envVar) {
    throw new Error(`Must set environment variable ${name}`);
  }
  return envVar;
};
