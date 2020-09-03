import AWS from 'aws-sdk';
import Knex from 'knex';
import { envUtils } from '@cumulus/common';

export const localStackConnectionEnv = {
  PG_HOST: 'localhost',
  PG_USER: 'postgres',
  PG_PASSWORD: 'password',
  PG_DATABASE: 'postgres',
};

export const getSecretConnectionConfig = async (
  SecretId: string,
  secretsManager: AWS.SecretsManager
): Promise<Knex.PgConnectionConfig> => {
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

export const getConnectionConfigEnv = (
  env: NodeJS.ProcessEnv
): Knex.PgConnectionConfig => ({
  host: envUtils.getRequiredEnvVar('PG_HOST', env),
  user: envUtils.getRequiredEnvVar('PG_USER', env),
  password: envUtils.getRequiredEnvVar('PG_PASSWORD', env),
  database: envUtils.getRequiredEnvVar('PG_DATABASE', env),
});

/**
 * Return configuration to make a database connection.
 *
 * @param {Object} params
 * @param {NodeJS.ProcessEnv} params.env - Environment values for the operation
 * @param {AWS.SecretsManager} params.secretsManager - An instance of an AWS
 *   Secrets Manager client
 * @returns {Knex.PgConnectionConfig} Configuration to make a Postgres database
 *   connection
 */
export const getConnectionConfig = async ({
  env,
  secretsManager = new AWS.SecretsManager(),
}: {
  env: NodeJS.ProcessEnv,
  secretsManager?: AWS.SecretsManager
}): Promise<Knex.PgConnectionConfig> => {
  // Storing credentials in Secrets Manager
  if (env.databaseCredentialSecretArn) {
    return getSecretConnectionConfig(
      env.databaseCredentialSecretArn,
      secretsManager
    );
  }

  // Getting credentials from environment variables
  return getConnectionConfigEnv(env);
};
