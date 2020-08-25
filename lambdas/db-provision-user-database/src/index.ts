import AWS from 'aws-sdk';
import Knex from 'knex';

export interface HandlerEvent {
  rootLoginSecret: string,
  userLoginSecret: string,
  prefix: string,
  dbPassword: string,
  engine: string,
  dbClusterIdentifier: string,
  env?: NodeJS.ProcessEnv,
}

const validateDatabaseInput = (
  inputString: string, regexp: RegExp
): boolean => regexp.test(inputString);

const getConnectionConfig = async (SecretId: string): Promise<Knex.PgConnectionConfig> => {
  const secretsManager = new AWS.SecretsManager();
  const response = await secretsManager.getSecretValue(
    { SecretId } as AWS.SecretsManager.GetSecretValueRequest
  ).promise();
  if (response.SecretString === undefined) {
    throw new Error('Database credentials are undefined!');
  }
  const dbAccessMeta = JSON.parse(response.SecretString);
  return {
    host: dbAccessMeta.host,
    user: dbAccessMeta.username,
    password: dbAccessMeta.password,
  };
};

export const handler = async (event: HandlerEvent): Promise<void> => {
  let knex;

  try {
    const secretsManager = new AWS.SecretsManager();
    const config = await getConnectionConfig(event.rootLoginSecret);
    knex = Knex({
      client: 'pg',
      connection: config,
      acquireConnectionTimeout: 120000,
    });
    const dbUser = event?.prefix.replace('-', '_');

    [dbUser, event?.dbPassword].forEach((input) => {
      if (!(validateDatabaseInput(input, new RegExp(/^\w+$/)))) {
        throw new Error(`Attempted to create database user ${dbUser} - username/password must be [a-zA-Z0-9_] only`);
      }
    });

    const tableExists = await knex.select(1).as('result')
      .from('pg_database').where('datname', `${dbUser}_db`);

    if (tableExists.length === 0) {
      await knex.raw(`create user ${dbUser} with encrypted password '${event.dbPassword}'`);
      await knex.raw(`create database ${dbUser}_db;`);
      await knex.raw(`grant all privileges on database ${dbUser}_db to ${dbUser}`);
    } else {
      await knex.raw(`alter user ${dbUser} with encrypted password '${event.dbPassword}'`);
      await knex.raw(`grant all privileges on database ${dbUser}_db to ${dbUser}`);
    }

    await secretsManager.putSecretValue({
      SecretId: event.userLoginSecret,
      SecretString: JSON.stringify({
        username: dbUser,
        password: event.dbPassword,
        engine: 'postgres',
        database: `${dbUser}_db`,
        host: config.host,
        port: config.port,
      }),
    }).promise();
  } finally {
    if (knex) {
      await knex.destroy();
    }
  }
};