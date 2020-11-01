import Knex from 'knex';

export const createTestDatabase = async (knex: Knex, dbName: string, dbUser: string) => {
  await knex.raw(`create database "${dbName}";`);
  await knex.raw(`grant all privileges on database "${dbName}" to "${dbUser}"`);
};

export const deleteTestDatabase = async (knex: Knex, dbName: string) =>
  knex.raw(`drop database if exists "${dbName}"`);

export const doesRecordExist = async<T>(
  params: Partial<T>,
  knex: Knex,
  tableName: string
): Promise<boolean> => await knex<T>(tableName).where(params).first() !== undefined;
