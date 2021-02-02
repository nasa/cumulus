import Knex from 'knex';
import * as s3Utils from '@cumulus/aws-client/S3';
import { UnparsableFileLocationError } from '@cumulus/errors';
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
    files: Array<PostgresFileRecord>
  ): Promise<any> {
    // delete each from S3
    return pMap(
      files,
      (file) => {
        if (file.bucket && file.key) {
          return s3Utils.deleteS3Object(file.bucket, file.key);
        }
        // TODO this isn't tested. Need to update existing S3 file and delete bucket/key?
        throw new UnparsableFileLocationError(`File bucket "${file.bucket}" or file key "${file.key}" could not be parsed`);
      }
    );
  }

  // get all files for a granule and delete from pg + s3
  async deleteGranuleFiles(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranuleRecord
  ) {
    // get granule's files first so we can remove them from S3
    const files = await knexOrTrx<PostgresFileRecord>(this.tableName)
      .where({ granule_cumulus_id: granule.cumulus_id });

    await knexOrTrx(this.tableName)
      .where({ granule_cumulus_id: granule.cumulus_id })
      .del();

    await this._deleteFilesFromS3(files);
  }
}

export { FilePgModel };
