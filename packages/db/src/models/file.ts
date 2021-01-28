import Knex from 'knex';

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

  // TODO also delete from S3
  delete(
    knexOrTransaction: Knex | Knex.Transaction,
    file: PostgresFileRecord
  ) {
    return super.delete(knexOrTransaction, { cumulus_id: file.cumulus_id });
  }

  // TODO get all files for a granule and delete from pg + s3
  deleteGranuleFiles(
    knexOrTransaction: Knex | Knex.Transaction,
    granule: PostgresGranuleRecord
  ) {

    // TODO in a transaction delete all files. If successful, delete from s3
    return knexOrTransaction<PostgresFileRecord>(this.tableName)
      .where({ granule_cumulus_id: granule.cumulus_id })
      .del(['cumulus_id']);
  }
}

export { FilePgModel };
