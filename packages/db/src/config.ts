import AWS from 'aws-sdk';
import Knex from 'knex';

import { envConectionConfigObject } from './types';

export const getRequiredEnvVar = (name: string, env: NodeJS.ProcessEnv): string => {
  const value = env[name];
  if (value) return value;
  throw new Error(`The ${name} environment variable must be set`);
};

export const getSecretConnectionConfig = async (
  SecretId: string
): Promise<Knex.PgConnectionConfig> => {
  const secretsManager = new AWS.SecretsManager();
  const response = await secretsManager.getSecretValue(
    { SecretId } as AWS.SecretsManager.GetSecretValueRequest
  ).promise();
  if (response.SecretString === undefined) {
    throw new Error(`AWS Secret did not contain a stored value: ${SecretId}`);
  }
  const dbAccessMeta = JSON.parse(response.SecretString);

  ['host', 'username', 'password', 'database'].forEach((key) => {
    if (!(key in dbAccessMeta)) {
      throw new Error(`AWS Secret ${SecretId} is missing required key '${key}'`);
    }
  });
  return {
    host: dbAccessMeta.host,
    user: dbAccessMeta.username,
    password: dbAccessMeta.password,
    database: dbAccessMeta.database,
  };
};

export const getEnvConnectionConfig = async (
  env: envConectionConfigObject
): Promise<Knex.PgConnectionConfig> => ({
  host: getRequiredEnvVar('PG_HOST', env),
  user: getRequiredEnvVar('PG_USER', env),
  password: getRequiredEnvVar('PG_PASSWORD', env),
  database: getRequiredEnvVar('PG_DATABASE', env),
});
