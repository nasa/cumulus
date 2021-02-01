import Knex from 'knex';
import * as s3Utils from '@cumulus/aws-client/S3';
import pMap from 'p-map';

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

  async _deleteFilesFromS3(
    knexOrTransaction: Knex | Knex.Transaction,
    granule: PostgresGranuleRecord
  ): Promise<any> {
    // get granule's files
    const files = await knexOrTransaction<PostgresFileRecord>(this.tableName)
      .where({ granule_cumulus_id: granule.cumulus_id });

    // delete each from S3
    return pMap(
      files,
      (file) => {
        if (file.bucket && file.key) {
          return s3Utils.deleteS3Object(file.bucket, file.key);
        }
        // TODO throw error?
        return undefined;
      }
    );
  }

  // get all files for a granule and delete from pg + s3
  async deleteGranuleFiles(
    knexOrTransaction: Knex | Knex.Transaction,
    granule: PostgresGranuleRecord
  ) {
    let trx;
    if (knexOrTransaction instanceof Knex) {
      trx = await knexOrTransaction.transaction();
    } else {
      trx = knexOrTransaction;
    }

    return trx(this.tableName)
      .where({ granule_cumulus_id: granule.cumulus_id })
      .del(['cumulus_id'])
      .then(await this._deleteFilesFromS3(trx, granule));
  }
}

export { FilePgModel };
