'use strict';

const path = require('path');
const get = require('lodash.get');
const clonedeep = require('lodash.clonedeep');
const merge = require('lodash.merge');
const uniqBy = require('lodash.uniqby');
const cmrjs = require('@cumulus/cmrjs');
const { CMR } = require('@cumulus/cmrjs');
const log = require('@cumulus/common/log');
const aws = require('@cumulus/ingest/aws');
const { DefaultProvider } = require('@cumulus/ingest/crypto');
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
    // initiate the manager class with the name of the
    // granules table
    super(process.env.GranulesTable, granuleSchema);
  }

  /**
   * Create the dynamoDB for this class
   *
   * @returns {Promise} aws dynamodb createTable response
   */
  async createTable() {
    const hash = { name: 'granuleId', type: 'S' };
    return Manager.createTable(this.tableName, hash);
  }

  /**
   * Removes a give granule from CMR
   *
   * @param {string} granuleId - the granule ID
   * @param {string} collectionId - the collection ID
   * @returns {Promise<undefined>} undefined
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
   * @returns {Promise<Object>} an object showing the start of the re-ingest
   */
  async reingest(g) {
    await this.applyWorkflow(g, 'IngestGranule', 'input');
    return {
      granuleId: g.granuleId,
      action: 'reingest',
      status: 'SUCCESS'
    };
  }

  /**
   * apply a workflow to a given granule object
   *
   * @param {Object} g - the granule object
   * @param {string} workflow - the workflow name
   * @param {string} messageSource - 'input' or 'output' from previous execution
   * @param {Object} metaOverride - overrides the meta of the new execution,
   *                                accepts partial override
   * @param {Object} payloadOverride - overrides the payload of the new execution,
   *                                   accepts partial override
   * @returns {Promise<Object>} an object showing the start of the workflow execution
   */
  async applyWorkflow(g, workflow, messageSource, metaOverride, payloadOverride) {
    const { name, version } = deconstructCollectionId(g.collectionId);

    try {
      // get the payload of the original execution
      const status = await aws.StepFunction.getExecutionStatus(path.basename(g.execution));
      const originalMessage = JSON.parse(status.execution[messageSource]);

      const meta = metaOverride
        ? merge(originalMessage.meta, metaOverride)
        : originalMessage.meta;

      const workflowPayload = payloadOverride
        ? merge(originalMessage.payload, payloadOverride)
        : originalMessage.payload;

      const lambdaPayload = await Rule.buildPayload({
        workflow,
        meta,
        workflowPayload,
        provider: g.provider,
        collection: {
          name,
          version
        }
      });

      await this.updateStatus({ granuleId: g.granuleId }, 'running');

      await aws.invoke(process.env.invoke, lambdaPayload);
      return {
        granuleId: g.granuleId,
        action: `applyWorkflow ${workflow}`,
        status: 'SUCCESS'
      };
    }
    catch (e) {
      log.error(g.granuleId, e);
      return {
        granuleId: g.granuleId,
        action: `applyWorkflow ${workflow}`,
        status: 'FAILED',
        error: e.message
      };
    }
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
  createGranulesFromSns(payload) {
    const name = get(payload, 'cumulus_meta.execution_name');
    const granules = get(payload, 'payload.granules', get(payload, 'meta.input_granules'));

    if (!granules) return Promise.resolve();

    const arn = aws.getExecutionArn(
      get(payload, 'cumulus_meta.state_machine'),
      name
    );

    if (!arn) return Promise.resolve();

    const execution = aws.getExecutionUrl(arn);

    const collection = get(payload, 'meta.collection');
    const exception = parseException(payload.exception);

    const collectionId = constructCollectionId(collection.name, collection.version);

    const done = granules.map(async (g) => {
      if (g.granuleId) {
        const doc = {
          granuleId: g.granuleId,
          pdrName: get(payload, 'meta.pdr.name'),
          collectionId,
          status: get(payload, 'meta.status'),
          provider: get(payload, 'meta.provider.id'),
          execution,
          cmrLink: get(g, 'cmrLink'),
          files: uniqBy(g.files, 'filename'),
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
