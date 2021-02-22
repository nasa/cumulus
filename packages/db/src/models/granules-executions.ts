import Knex from 'knex';

import { isRecordDefined } from '../database';
import { tableNames } from '../tables';

import { PostgresGranuleExecution } from '../types/granule-execution';

export default class GranulesExecutionsPgModel {
  readonly tableName: tableNames;

  // can't extend base class because type for this data doesn't contain
  // a cumulus_id property
  constructor() {
    this.tableName = tableNames.granulesExecutions;
  }

  async create(
    knexTransaction: Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return knexTransaction(this.tableName).insert(item);
  }

  async exists(
    knexTransaction: Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return isRecordDefined(await knexTransaction(this.tableName).where(item).first());
  }

  async upsert(
    knexTransaction: Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return knexTransaction(this.tableName)
      .insert(item)
      .onConflict(['granule_cumulus_id', 'execution_cumulus_id'])
      .merge();
  }

  search(
    knexTransaction: Knex | Knex.Transaction,
    query: Partial<PostgresGranuleExecution>
  ) {
    return knexTransaction<PostgresGranuleExecution>(this.tableName)
      .where(query);
  }
}

export { GranulesExecutionsPgModel };
