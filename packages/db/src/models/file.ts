import Knex from 'knex';
import { DeletePublishedGranule } from '@cumulus/errors';

import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresFile, PostgresFileRecord } from '../types/file';
import { PostgresGranuleRecord } from '../types/granule';

class FilePgModel extends BasePgModel<PostgresFile, PostgresFileRecord> {
  constructor() {
    super({
      tableName: tableNames.files,
    });
  }

  upsert(
    knexOrTrx: Knex | Knex.Transaction,
    file: PostgresFile
  ) {
    return knexOrTrx(this.tableName)
      .insert(file)
      .onConflict(['bucket', 'key'])
      .merge();
  }

  /**
   * Delete a granule's files from Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTrx - A DB client or transaction
   * @param {PostgresGranuleRecord} granule - A granule object returned from Postgres
   * @returns {Knex | Knex.Transaction} - The DB client or transaction
   */
  async deleteGranuleFiles(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranuleRecord
  ) {
    if (granule.published) {
      throw new DeletePublishedGranule('You cannot delete a granule or files from a granule that is published to CMR. Remove it from CMR first');
    }

    await knexOrTrx(this.tableName)
      .where({ granule_cumulus_id: granule.cumulus_id })
      .del();

    return knexOrTrx;
  }
}

export { FilePgModel };
