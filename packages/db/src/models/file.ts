import Knex from 'knex';
import * as s3Utils from '@cumulus/aws-client/S3';
import { UnparsableFileLocationError, DeletePublishedGranule } from '@cumulus/errors';
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

  /**
   * Delete files from S3
   *
   * @param {Array<PostgresFileRecord>} files - A list of files with a bucket and key
   * @returns {Promise}
   * @private
   */
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

  /**
   * Delete a granule's files from Postgres and S3
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

    // get granule's files first so we can remove them from S3
    const files = await knexOrTrx<PostgresFileRecord>(this.tableName)
      .where({ granule_cumulus_id: granule.cumulus_id });

    await knexOrTrx(this.tableName)
      .where({ granule_cumulus_id: granule.cumulus_id })
      .del();

    await this._deleteFilesFromS3(files);

    return knexOrTrx;
  }
}

export { FilePgModel };
