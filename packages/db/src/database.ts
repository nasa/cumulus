import Knex from 'knex';

export const getDbClient = (knex: Knex, tableName: string) => // TODO dump
  knex(tableName);

export const getDbTransaction = (trx: Knex.Transaction, tableName: string) => // TODO dump
  trx(tableName);

export const createTestDatabase = async (knex: Knex, dbName: string, dbUser: string) => {
  await knex.raw(`create database "${dbName}";`);
  await knex.raw(`grant all privileges on database "${dbName}" to "${dbUser}"`);
};

export const deleteTestDatabase = async (knex: Knex, dbName: string) =>
  knex.raw(`drop database if exists "${dbName}"`);
