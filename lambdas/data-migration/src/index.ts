import * as AWS from 'aws-sdk';
import Knex from 'knex';
import { dynamodbDocClient } from '@cumulus/aws-client/services';

export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
}

const getRequiredEnvVar = (name: string, env: NodeJS.ProcessEnv): string => {
  const value = env?.[name];

  if (value) return value;

  throw new Error(`The ${name} environment variable must be set`);
};

const getScanResults = async (tableName: string, prevResponse?: AWS.DynamoDB.ScanOutput) => {
  if (prevResponse && !prevResponse.LastEvaluatedKey) {
    return {
      Items: undefined,
    };
  }
  const response = await dynamodbDocClient().scan({
    TableName: tableName,
    ExclusiveStartKey: prevResponse?.LastEvaluatedKey,
  }).promise();
  return response;
};

export const migrateCollections = async (env: NodeJS.ProcessEnv, knex: Knex) => {
  const collectionsTable = getRequiredEnvVar('CollectionsTable', env);
  let response = await getScanResults(collectionsTable);
  /* eslint-disable no-await-in-loop */
  while (response.Items) {
    await Promise.all(response.Items.map(async (record) => {
      const updatedRecord: any = {
        ...record,
        granuleIdValidationRegex: record.granuleId,
        files: JSON.stringify(record.files),
        meta: JSON.stringify(record.meta),
      };
      delete updatedRecord.granuleId;
      await knex('collections').insert(updatedRecord);
    }));
    response = await getScanResults(collectionsTable, response);
  }
  /* eslint-enable no-await-in-loop */
};

const getConnectionConfig = (env: NodeJS.ProcessEnv): Knex.PgConnectionConfig => ({
  host: getRequiredEnvVar('PG_HOST', env),
  user: getRequiredEnvVar('PG_USER', env),
  // TODO Get this value from secrets manager
  password: getRequiredEnvVar('PG_PASSWORD', env),
  database: getRequiredEnvVar('PG_DATABASE', env),
});

export const handler = async (event: HandlerEvent): Promise<void> => {
  const env = event?.env ?? process.env;

  const knex = Knex({
    client: 'pg',
    connection: getConnectionConfig(env),
    debug: env?.KNEX_DEBUG === 'true',
    asyncStackTraces: env?.KNEX_ASYNC_STACK_TRACES === 'true',
  });

  try {
    await migrateCollections(env, knex);
  } finally {
    await knex.destroy();
  }
};
