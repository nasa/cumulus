import { SecretsManager } from '@aws-sdk/client-secrets-manager';
import { Knex } from 'knex';

import { getKnexConfig, getKnexClient } from '@cumulus/db';

export interface HandlerEvent {
  rootLoginSecret: string,
  userLoginSecret: string,
  prefix: string,
  dbPassword: string,
  secretsManager?: SecretsManager,
  dbRecreation?: boolean
}

export const dbExists = async (tableName: string, knex: Knex) =>
  await knex('pg_database').select('datname').where(knex.raw(`datname = CAST('${tableName}' as name)`));

export const userExists = async (userName: string, knex: Knex) =>
  await knex('pg_catalog.pg_user').where(knex.raw(`usename = CAST('${userName}' as name)`));

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

  let knex;

  try {
    knex = await getKnexClient({
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

    const userExistsResults = await userExists(dbUser, knex);
    const dbExistsResults = await dbExists(`${dbUser}_db`, knex);

    if (userExistsResults.length === 0) {
      await knex.raw(`create user "${dbUser}" with encrypted password '${event.dbPassword}'`);
    } else {
      await knex.raw(`alter user "${dbUser}" with encrypted password '${event.dbPassword}'`);
    }

    if (event.dbRecreation) {
      if (dbExistsResults.length !== 0) {
        await knex.raw(`alter database "${dbUser}_db" connection limit 0;`);
        await knex.raw(`select pg_terminate_backend(pg_stat_activity.pid) from pg_stat_activity where pg_stat_activity.datname = '${dbUser}_db'`);
        await knex.raw(`drop database "${dbUser}_db";`);
      }
      await knex.raw(`create database "${dbUser}_db";`);
    } else if (dbExistsResults.length === 0) {
      await knex.raw(`create database "${dbUser}_db";`);
    }
    await knex.raw(`grant all privileges on database "${dbUser}_db" to "${dbUser}"`);

    await secretsManager.putSecretValue({
      SecretId: event.userLoginSecret,
      SecretString: JSON.stringify({
        username: dbUser,
        password: event.dbPassword,
        database: `${dbUser}_db`,
        host: (rootKnexConfig.connection as Knex.PgConnectionConfig).host,
        port: (rootKnexConfig.connection as Knex.PgConnectionConfig).port,
        DISABLE_PG_SSL: true,
      }),
    });
  } finally {
    if (knex) {
      await knex.destroy();
    }
  }
};
