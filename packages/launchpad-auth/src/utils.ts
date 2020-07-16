/* @private */
export const getEnvVar = (name:string) => {
  const envVar = process.env[name];
  if (!envVar) {
    throw new Error(`must set environment variable process.env.${name}`);
  }
  return envVar;
};
