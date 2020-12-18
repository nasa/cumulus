import Knex from 'knex';
import cryptoRandomString from 'crypto-random-string';

import { getKnexClient } from './connection';
import { localStackConnectionEnv } from './config';

import { PostgresCollection } from './types/collection';
import { PostgresGranule } from './types/granule';
import { PostgresProvider } from './types/provider';

export const createTestDatabase = async (knex: Knex, dbName: string, dbUser: string) => {
  await knex.raw(`create database "${dbName}";`);
  await knex.raw(`grant all privileges on database "${dbName}" to "${dbUser}"`);
};

export const deleteTestDatabase = async (knex: Knex, dbName: string) =>
  knex.raw(`drop database if exists "${dbName}"`);

export const generateLocalTestDb = async (
  testDbName: string,
  migrationDir: string
) => {
  const knexAdmin = await getKnexClient({ env: localStackConnectionEnv });
  const knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      migrationDir,
    },
  });
  await createTestDatabase(knexAdmin, testDbName, localStackConnectionEnv.PG_USER);
  await knex.migrate.latest();
  return ({ knex, knexAdmin });
};

export const destroyLocalTestDb = async ({
  knex, knexAdmin, testDbName,
}: {
  knex: Knex,
  knexAdmin: Knex,
  testDbName: string
}) => {
  knex.destroy();
  await deleteTestDatabase(knexAdmin, testDbName);
  knexAdmin.destroy();
};

export const fakeCollectionRecordFactory = (
  params: Partial<PostgresCollection>
) => ({
  name: cryptoRandomString({ length: 5 }),
  version: '0.0.0',
  sample_file_name: 'file.txt',
  granule_id_extraction_regex: 'fake-regex',
  granule_id_validation_regex: 'fake-regex',
  files: JSON.stringify([{
    regex: 'fake-regex',
    sampleFileName: 'file.txt',
  }]),
  ...params,
});

export const fakeProviderRecordFactory = (
  params: Partial<PostgresProvider>
) => ({
  name: `provider${cryptoRandomString({ length: 5 })}`,
  host: 'test-bucket',
  protocol: 's3',
  ...params,
});

export const fakeGranuleRecordFactory = (
  params: Partial<PostgresGranule>
): Omit<PostgresGranule, 'collection_cumulus_id'> => ({
  granule_id: cryptoRandomString({ length: 3 }),
  status: 'running',
  ...params,
});
