import Knex from 'knex';

import { tableNames } from '../tables';

import { isRecordDefined } from '../database';

export default class BaseModel {
  private readonly tableName: tableNames;

  constructor({
    tableName,
  }: {
    tableName: tableNames,
  }) {
    this.tableName = tableName;
  }

  get<T>(knex: Knex, params: Partial<T>) {
    return knex<T>(this.tableName).where(params).first();
  }

  async exists<T>(
    knex: Knex,
    params: Partial<T>
  ): Promise<boolean> {
    return isRecordDefined(await this.get<T>(knex, params));
  }
}
