import cloneDeep from 'lodash/cloneDeep';
import set from 'lodash/set';
import { SecretsManager } from '@aws-sdk/client-secrets-manager';
import { knex, Knex } from 'knex';

import { getKnexConfig, getKnexClient } from '@cumulus/db';

export interface HandlerEvent {
  rootLoginSecret: string,
  userLoginSecret: string,
  prefix: string,
  dbPassword: string,
  secretsManager?: SecretsManager,
  dbRecreation?: boolean
}

export const dbExists = async (tableName: string, knexClient: Knex) =>
  await knexClient('pg_database').select('datname').where(knexClient.raw(`datname = CAST('${tableName}' as name)`));

export const userExists = async (userName: string, knexClient: Knex) =>
  await knexClient('pg_catalog.pg_user').where(knexClient.raw(`usename = CAST('${userName}' as name)`));

const validateEvent = (event: HandlerEvent): void => {
  if (event.dbPassword === undefined || event.prefix === undefined) {
    throw new Error(`This lambda requires 'dbPassword' and 'prefix' to be defined on the event: ${event}`);
  }
};

export const handler = async (event: HandlerEvent): Promise<void> => {
  validateEvent(event);

  const secretsManager = event.secretsManager ?? new SecretsManager();

  const rootKnexConfig = await getKnexConfig({
    env: {
      databaseCredentialSecretArn: event.rootLoginSecret,
    },
    secretsManager,
  });

  let knexClient;

  try {
    knexClient = await getKnexClient({
      env: {
        databaseCredentialSecretArn: event.rootLoginSecret,
        KNEX_DEBUG: process.env.KNEX_DEBUG,
      },
      secretsManager,
    });

    const dbUser = event.prefix.replace(/-/g, '_');
    [dbUser, event.dbPassword].forEach((input) => {
      if (!(/^\w+$/.test(input))) {
        throw new Error(`Attempted to create database user ${dbUser} - username/password must be [a-zA-Z0-9_] only`);
      }
    });
    const dbName = `${dbUser}_db`;

    const userExistsResults = await userExists(dbUser, knexClient);
    const dbExistsResults = await dbExists(dbName, knexClient);

    if (userExistsResults.length === 0) {
      await knexClient.raw(`create user "${dbUser}" with encrypted password '${event.dbPassword}'`);
    } else {
      await knexClient.raw(`alter user "${dbUser}" with encrypted password '${event.dbPassword}'`);
    }

    if (event.dbRecreation) {
      if (dbExistsResults.length !== 0) {
        await knexClient.raw(`alter database "${dbName}" connection limit 0;`);
        await knexClient.raw(`select pg_terminate_backend(pg_stat_activity.pid) from pg_stat_activity where pg_stat_activity.datname = '${dbName}'`);
        await knexClient.raw(`drop database "${dbName}";`);
      }
      await knexClient.raw(`create database "${dbName}";`);
    } else if (dbExistsResults.length === 0) {
      await knexClient.raw(`create database "${dbName}";`);
    }

    await knexClient.raw(`grant all privileges on database "${dbName}" to "${dbUser}"`);

    await knexClient.destroy();

    // connect to user database
    const userDbKnexConfig = cloneDeep(rootKnexConfig);
    set(userDbKnexConfig, 'connection.database', dbName);
    knexClient = knex(userDbKnexConfig);
    await knexClient.raw(`grant create, usage on schema public to "${dbUser}"`);

    await secretsManager.putSecretValue({
      SecretId: event.userLoginSecret,
      SecretString: JSON.stringify({
        username: dbUser,
        password: event.dbPassword,
        database: dbName,
        host: (rootKnexConfig.connection as Knex.PgConnectionConfig).host,
        port: (rootKnexConfig.connection as Knex.PgConnectionConfig).port,
        rejectUnauthorized: 'false',
      }),
    });
  } finally {
    if (knexClient) {
      await knexClient.destroy();
    }
  }
};
