import Knex from 'knex';
import { getKnexClient } from './connection';
import { localStackConnectionEnv } from './config';

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

