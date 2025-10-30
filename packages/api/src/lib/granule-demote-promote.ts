/**
 * @module granule-demote-promote
 *
 * Implements `demoteGranule` and `promoteGranule` functions that:
 *  - Move granule files between visible/hidden locations.
 *  - Update file records and granule group states in the database.
 *  - Publish to SNS.
 *  - Interact with CMR
 */

import { Knex } from 'knex';
import Logger from '@cumulus/logger';
import { RecordDoesNotExist } from '@cumulus/errors';
import { moveObject } from '@cumulus/aws-client/S3';
import {
  CollectionPgModel,
  FilePgModel,
  GranuleGroupsPgModel,
  PdrPgModel,
  ProviderPgModel,
  getUniqueGranuleByGranuleId,
  GranulePgModel,
  translatePostgresCollectionToApiCollection,
  translatePostgresGranuleToApiGranule,
} from '@cumulus/db';
const unpublishGranule = require('../../lib/granule-remove-from-cmr');
const { publishGranuleDeleteSnsMessage } = require('../../lib/publishSnsMessageUtils');

const log = new Logger({ sender: 'granule-demote-promote' });

/**
 * Demote granule:
 * - Remove from CMR
 * - Move granule files to hidden location
 * - Update DB file records
 * - Update granule_group state to 'H'
 * - Publish SNS event
 */
export const demoteGranule = async (params: {
  knex: Knex,
  granuleId: string,
  granulePgModel?: GranulePgModel,
  collectionPgModel?: CollectionPgModel,
  filePgModel?: FilePgModel,
  granuleGroupsModel?: GranuleGroupsPgModel,
  pdrPgModel?: PdrPgModel,
  providerPgModel?: ProviderPgModel,
}) => {
  const {
    knex,
    granuleId,
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    filePgModel = new FilePgModel(),
    granuleGroupsModel = new GranuleGroupsPgModel(),
    pdrPgModel = new PdrPgModel(),
    providerPgModel = new ProviderPgModel(),
  } = params;

  log.info(`Demoting granule ${granuleId}`);

  let pgGranule;
  let pgCollection;

  try {
    pgGranule = await getUniqueGranuleByGranuleId(knex, granuleId, granulePgModel);
    pgCollection = await collectionPgModel.get(
      knex, { cumulus_id: pgGranule.collection_cumulus_id }
    );
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return;
    }
    throw error;
  }

  const apiCollection = translatePostgresCollectionToApiCollection(pgCollection);
  const pgGranuleCumulusId = pgGranule.cumulus_id;

  // 1. Remove from CMR
  await unpublishGranule({ pgGranuleRecord: pgGranule, pgCollection, knex });

  const existingGroup = await granuleGroupsModel.search(
    knex,
    { granule_cumulus_id: pgGranuleCumulusId }
  );

  const pgFiles = await filePgModel.search(
    knex,
    { granule_cumulus_id: pgGranuleCumulusId }
  );

  const pgFilesWithNewLocation = pgFiles.map((pgFile) => {
    const updatedPgFile: any = structuredClone(pgFile);
    updatedPgFile.newBucket = apiCollection.hiddenFileBucket || pgFile.bucket;
    updatedPgFile.newKey = `${granuleId}/${pgFile.key}`;
    return updatedPgFile;
  });

  // TODO move files partial recovery
  let trx;
  try {
    // 2. Move files to hidden bucket and location
    // If there is a hidden bucket, move all the files to this bucket with prefix granuleId/
    // If not configured, move each file to its own bucket with prefix granuleId/
    //TODO limit parallel move files
    await Promise.all(pgFilesWithNewLocation.map(async (file) => {
      const moved = await moveObject({
        sourceBucket: file.bucket,
        sourceKey: file.key,
        destinationBucket: file.newBucket,
        destinationKey: file.newKey,
        copyTags: true,
      });
      log.info(`Moved ${file.bucket}/${file.key} -> ${file.newBucket}/${file.newKey}`);
      return moved;
    }));

    // update granule files in db
    const pgFileRecordsForUpdate = pgFilesWithNewLocation.map((file) => ({
      cumulus_id: file.cumulus_id,
      granule_cumulus_id: file.granule_cumulus_id,
      bucket: file.newBucket,
      key: file.newKey,
    }));

    trx = await knex.transaction();
    await filePgModel.upsert(trx, pgFileRecordsForUpdate);

    // 3. Update granule_group state to 'H'
    // TODO existing or not already exist, both should work
    const granuleGroup = {
      group_id: existingGroup?.[0]?.group_id,
      granule_cumulus_id: pgGranuleCumulusId,
      state: 'H',
    };
    await granuleGroupsModel.upsert(trx, granuleGroup);

    await trx.commit();
  } catch (error) {
    if (trx) await trx.rollback();
    await Promise.all(pgFilesWithNewLocation.map((file) => {
      log.info(`Recover ${file.newBucket}/${file.newKey} -> ${file.bucket}/${file.key}`);
      return moveObject({
        sourceBucket: file.newBucket,
        sourceKey: file.newKey,
        destinationBucket: file.bucket,
        destinationKey: file.key,
        copyTags: true,
      });
    }));
    log.error(`Failed to demote granule ${granuleId}: ${(error as Error).message}`);
    throw error;
  }

  // 4. Publish SNS topic
  const granuleToPublishToSns = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
    collectionPgModel,
    filePgModel,
    pdrPgModel,
    providerPgModel,
  });
  await publishGranuleDeleteSnsMessage(granuleToPublishToSns);

  log.info(`Granule ${granuleId} demoted successfully`);
};
