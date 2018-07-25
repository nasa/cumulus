'use strict';

const clonedeep = require('lodash.clonedeep');
const get = require('lodash.get');
const path = require('path');
const uniqBy = require('lodash.uniqby');

const aws = require('@cumulus/common/aws');
const cmrjs = require('@cumulus/cmrjs');
const { CMR } = require('@cumulus/cmrjs');
const log = require('@cumulus/common/log');
const { DefaultProvider } = require('@cumulus/common/crypto');
const { moveGranuleFiles } = require('@cumulus/ingest/granule');

const Manager = require('./base');

const {
  parseException,
  constructCollectionId,
  deconstructCollectionId,
  getGranuleProductVolume,
  extractDate
} = require('../lib/utils');
const Rule = require('./rules');
const granuleSchema = require('./schemas').granule;

class Granule extends Manager {
  constructor() {
    super({
      tableName: process.env.GranulesTable,
      tableHash: { name: 'granuleId', type: 'S' },
      schema: granuleSchema
    });
  }

  /**
  * Adds fileSize values from S3 object metadata for granules missing that information
  *
  * @param {Array<Object>} files - Array of files from a payload granule object
  * @returns {Promise<Array>} - Updated array of files with missing fileSize appended
  */
  addMissingFileSizes(files) {
    const filePromises = files.map((file) => {
      if (!('fileSize' in file)) {
        return aws.headObject(file.bucket, file.filepath)
          .then((result) => {
            const updatedFile = file;
            updatedFile.fileSize = result.ContentLength;
            return updatedFile;
          })
          .catch((error) => {
            log.error(`Error: ${error}`);
            log.error(`Could not validate missing filesize for s3://${file.filename}`);

            return file;
          });
      }
      return Promise.resolve(file);
    });
    return Promise.all(filePromises);
  }

  /**
   * Removes a give granule from CMR
   *
   * @param {string} granuleId - the granule ID
   * @param {string} collectionId - the collection ID
   * @returns {Promise<undefined>} - undefined
   */
  async removeGranuleFromCmr(granuleId, collectionId) {
    log.info(`granules.removeGranuleFromCmr ${granuleId}`);
    const password = await DefaultProvider.decrypt(process.env.cmr_password);
    const cmr = new CMR(
      process.env.cmr_provider,
      process.env.cmr_client_id,
      process.env.cmr_username,
      password
    );

    await cmr.deleteGranule(granuleId, collectionId);
    await this.update({ granuleId }, { published: false, cmrLink: null });
  }

  /**
   * start the re-ingest of a given granule object
   *
   * @param {Object} g - the granule object
   * @returns {Promise<undefined>} - undefined
   */
  async reingest(g) {
    const { name, version } = deconstructCollectionId(g.collectionId);

    // get the payload of the original execution
    const status = await aws.getSfnExecutionStatusFromArn(path.basename(g.execution));
    const originalMessage = JSON.parse(status.execution.input);

    const lambdaPayload = await Rule.buildPayload({
      workflow: 'IngestGranule',
      meta: originalMessage.meta,
      payload: originalMessage.payload,
      provider: g.provider,
      collection: {
        name,
        version
      }
    });

    await this.updateStatus({ granuleId: g.granuleId }, 'running');

    await aws.invokeLambda(process.env.invoke, lambdaPayload);
  }

  /**
   * apply a workflow to a given granule object
   *
   * @param {Object} g - the granule object
   * @param {string} workflow - the workflow name
   * @returns {Promise<undefined>} undefined
   */
  async applyWorkflow(g, workflow) {
    const { name, version } = deconstructCollectionId(g.collectionId);

    const lambdaPayload = await Rule.buildPayload({
      workflow,
      payload: {
        granules: [g]
      },
      provider: g.provider,
      collection: {
        name,
        version
      }
    });

    await this.updateStatus({ granuleId: g.granuleId }, 'running');

    await aws.invokeLambda(process.env.invoke, lambdaPayload);
  }

  /**
   * Move a granule's files to destination locations specified
   *
   * @param {Object} g - the granule object
   * @param {Array<{regex: string, bucket: string, filepath: string}>} destinations
   * - list of destinations specified
   *    regex - regex for matching filepath of file to new destination
   *    bucket - aws bucket of the destination
   *    filepath - file path/directory on the bucket for the destination
   * @param {string} distEndpoint - distribution endpoint
   * @returns {Promise<undefined>} undefined
   */
  async move(g, destinations, distEndpoint) {
    log.info(`granules.move ${g.granuleId}`);
    const files = clonedeep(g.files);
    await moveGranuleFiles(g.granuleId, files, destinations, distEndpoint, g.published);
    await this.update({ granuleId: g.granuleId }, { files: files });
  }

  /**
   * Create new granule records from incoming sns messages
   *
   * @param {Object} payload - sns message containing the output of a Cumulus Step Function
   * @returns {Promise<Array>} granule records
   */
  async createGranulesFromSns(payload) {
    const executionName = get(payload, 'cumulus_meta.execution_name');
    const stateMachineArn = get(payload, 'cumulus_meta.state_machine');
    const granules = get(payload, 'payload.granules', get(payload, 'meta.input_granules'));

    if (!granules) return Promise.resolve();

    const arn = aws.getExecutionArn(
      stateMachineArn,
      executionName
    );

    if (!arn) return Promise.resolve();

    const execution = aws.getExecutionUrl(arn);

    const collection = get(payload, 'meta.collection');
    const exception = parseException(payload.exception);

    const collectionId = constructCollectionId(collection.name, collection.version);

    const done = granules.map(async (g) => {
      if (g.granuleId) {
        let granuleFiles = g.files;
        granuleFiles = await this.addMissingFileSizes(uniqBy(g.files, 'filename'));

        const doc = {
          granuleId: g.granuleId,
          pdrName: get(payload, 'meta.pdr.name'),
          collectionId,
          status: get(payload, 'meta.status'),
          provider: get(payload, 'meta.provider.id'),
          execution,
          cmrLink: get(g, 'cmrLink'),
          files: granuleFiles,
          error: exception,
          createdAt: get(payload, 'cumulus_meta.workflow_start_time'),
          timestamp: Date.now(),
          productVolume: getGranuleProductVolume(g.files),
          timeToPreprocess: get(payload, 'meta.sync_granule_duration', 0) / 1000,
          timeToArchive: get(payload, 'meta.post_to_cmr_duration', 0) / 1000,
          processingStartDateTime: extractDate(payload, 'meta.sync_granule_end_time'),
          processingEndDateTime: extractDate(payload, 'meta.post_to_cmr_start_time')
        };

        doc.published = get(g, 'published', false);
        // Duration is also used as timeToXfer for the EMS report
        doc.duration = (doc.timestamp - doc.createdAt) / 1000;

        if (g.cmrLink) {
          const metadata = await cmrjs.getMetadata(g.cmrLink);
          doc.beginningDateTime = metadata.time_start;
          doc.endingDateTime = metadata.time_end;
          doc.lastUpdateDateTime = metadata.updated;

          const fullMetadata = await cmrjs.getFullMetadata(g.cmrLink);
          if (fullMetadata && fullMetadata.DataGranule) {
            doc.productionDateTime = fullMetadata.DataGranule.ProductionDateTime;
          }
        }

        return this.create(doc);
      }
      return Promise.resolve();
    });

    return Promise.all(done);
  }
}

module.exports = Granule;
