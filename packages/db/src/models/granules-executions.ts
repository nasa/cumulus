import Knex from 'knex';

import { isRecordDefined } from '../database';
import { tableNames } from '../tables';

import { PostgresGranuleExecution } from '../types/granule-execution';

// TODO: need model tests
export default class GranulesExecutionsPgModel {
  readonly tableName: tableNames;

  // can't extend base class because type for this data doesn't contain
  // a cumulus_id property
  constructor() {
    this.tableName = tableNames.granulesExecutions;
  }

  async create(
    knexOrTrx: Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return knexOrTrx(this.tableName).insert(item);
  }

  async exists(
    knexOrTrx: Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return isRecordDefined(await knexOrTrx(this.tableName).where(item).first());
  }

  async upsert(
    knexOrTrx: Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return knexOrTrx(this.tableName)
      .insert(item)
      .onConflict(['granule_cumulus_id', 'execution_cumulus_id'])
      .merge();
  }

  search(
    knexOrTrx: Knex | Knex.Transaction,
    query: Partial<PostgresGranuleExecution>
  ) {
    return knexOrTrx<PostgresGranuleExecution>(this.tableName)
      .where(query);
  }
}

export { GranulesExecutionsPgModel };
