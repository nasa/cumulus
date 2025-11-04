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
const { publishGranuleUpdateSnsMessage } = require('../../lib/publishSnsMessageUtils');
const { unpublishGranule } = require('../../lib/granule-remove-from-cmr');

const log = new Logger({ sender: 'granule-demote-promote' });

/**
 * Generate new file locations for hidden bucket storage.
 */
const buildHiddenFileLocations = (pgFiles: any[], apiCollection: any, granuleId: string) =>
  pgFiles.map((pgFile) => ({
    ...pgFile,
    newBucket: apiCollection.hiddenFileBucket || pgFile.bucket,
    newKey: `${granuleId}/${pgFile.key}`,
  }));

// TODO move files partial recovery, not all files moved to destination
// TODO limit concurrent move
/**
 * Move a set of files to their new S3 locations.
 */
const moveGranuleFiles = async (files: any[]) => {
  await Promise.all(files.map(async (file) => {
    await moveObject({
      sourceBucket: file.bucket,
      sourceKey: file.key,
      destinationBucket: file.newBucket,
      destinationKey: file.newKey,
      copyTags: true,
    });
    log.info(`Moved ${file.bucket}/${file.key} → ${file.newBucket}/${file.newKey}`);
  }));
};

/**
 * Roll back file moves if something fails during the demotion process.
 */
const rollbackFileMoves = async (files: any[]) => {
  await Promise.all(files.map(async (file) => {
    log.info(`Rolling back ${file.newBucket}/${file.newKey} → ${file.bucket}/${file.key}`);
    await moveObject({
      sourceBucket: file.newBucket,
      sourceKey: file.newKey,
      destinationBucket: file.bucket,
      destinationKey: file.key,
      copyTags: true,
    });
  }));
};

/**
 * Update file records and granule group state in a transaction.
 */
export const updateDatabaseRecords = async ({
  knex,
  filePgModel,
  granuleGroupsModel,
  files,
  granuleCumulusId,
  existingGroup,
}: {
  knex: Knex;
  filePgModel: FilePgModel;
  granuleGroupsModel: GranuleGroupsPgModel;
  files: any[];
  granuleCumulusId: number;
  existingGroup?: any;
}): Promise<void> => {
  const trx = await knex.transaction();

  try {
    const updatedFileRecords = files.map((file) => ({
      cumulus_id: file.cumulus_id,
      granule_cumulus_id: file.granule_cumulus_id,
      bucket: file.newBucket,
      key: file.newKey,
    }));

    await filePgModel.updateFilesById(trx, updatedFileRecords);

    // TODO existing or not already exist, both should work
    await granuleGroupsModel.upsert(trx, {
      group_id: existingGroup?.[0]?.group_id,
      granule_cumulus_id: granuleCumulusId,
      state: 'H',
    });

    await trx.commit();
  } catch (error) {
    log.error(error);
    await trx.rollback();
    throw error;
  }
};

export const demoteGranule = async ({
  knex,
  granuleId,
  granulePgModel = new GranulePgModel(),
  collectionPgModel = new CollectionPgModel(),
  filePgModel = new FilePgModel(),
  granuleGroupsModel = new GranuleGroupsPgModel(),
  pdrPgModel = new PdrPgModel(),
  providerPgModel = new ProviderPgModel(),
}: {
  knex: Knex,
  granuleId: string,
  granulePgModel?: GranulePgModel,
  collectionPgModel?: CollectionPgModel,
  filePgModel?: FilePgModel,
  granuleGroupsModel?: GranuleGroupsPgModel,
  pdrPgModel?: PdrPgModel,
  providerPgModel?: ProviderPgModel,
}) => {
  log.info(`Demoting granule ${granuleId}`);

  let pgGranule;
  let pgCollection;

  try {
    pgGranule = await getUniqueGranuleByGranuleId(knex, granuleId, granulePgModel);
    pgCollection = await collectionPgModel.get(
      knex,
      { cumulus_id: pgGranule.collection_cumulus_id }
    );
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      log.warn(`Granule ${granuleId} does not exist — skipping demotion`);
      return;
    }
    throw error;
  }

  const apiCollection = translatePostgresCollectionToApiCollection(pgCollection);
  const granuleCumulusId = pgGranule.cumulus_id;

  // 1: Remove from CMR
  await unpublishGranule({ pgGranuleRecord: pgGranule, pgCollection, knex });

  // 2: Prepare new file locations
  const pgFiles = await filePgModel.search(knex, { granule_cumulus_id: granuleCumulusId });
  const filesWithUpdatedLocations = buildHiddenFileLocations(pgFiles, apiCollection, granuleId);

  const existingGroup = await granuleGroupsModel.search(knex, {
    granule_cumulus_id: granuleCumulusId,
  });

  // 3: Move files and update database
  try {
    await moveGranuleFiles(filesWithUpdatedLocations);
    await updateDatabaseRecords({
      knex,
      filePgModel,
      granuleGroupsModel,
      files: filesWithUpdatedLocations,
      granuleCumulusId,
      existingGroup,
    });
  } catch (error) {
    await rollbackFileMoves(filesWithUpdatedLocations);
    log.error(`Failed to demote granule ${granuleId}: ${(error as Error).message}`);
    throw error;
  }

  // 4: Publish SNS event
  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
    collectionPgModel,
    filePgModel,
    pdrPgModel,
    providerPgModel,
  });

  await publishGranuleUpdateSnsMessage(apiGranule);

  log.info(`Granule ${granuleId} demoted successfully`);
};
