'use strict';

const cloneDeep = require('lodash.clonedeep');
const get = require('lodash.get');
const partial = require('lodash.partial');
const path = require('path');

const aws = require('@cumulus/ingest/aws');
const commonAws = require('@cumulus/common/aws');
const StepFunctions = require('@cumulus/common/StepFunctions');
const cmrjs = require('@cumulus/cmrjs');
const { CMR, reconcileCMRMetadata } = require('@cumulus/cmrjs');
const log = require('@cumulus/common/log');
const { DefaultProvider } = require('@cumulus/common/key-pair-provider');
const { buildURL } = require('@cumulus/common/URLUtils');
const {
  generateMoveFileParams,
  moveGranuleFiles
} = require('@cumulus/ingest/granule');
const { isNil, renameProperty } = require('@cumulus/common/util');

const Manager = require('./base');

const CumulusMessage = require('../lib/CumulusMessage');
const { buildDatabaseFiles } = require('../lib/FileUtils');

const {
  parseException,
  deconstructCollectionId,
  getGranuleProductVolume,
  extractDate
} = require('../lib/utils');
const Rule = require('./rules');
const granuleSchema = require('./schemas').granule;

const translateGranule = async (granule) => {
  if (isNil(granule.files)) return granule;

  return {
    ...granule,
    files: await buildDatabaseFiles({ files: granule.files })
  };
};

class Granule extends Manager {
  constructor() {
    const globalSecondaryIndexes = [{
      IndexName: 'collectionId-granuleId-index',
      KeySchema: [
        {
          AttributeName: 'collectionId',
          KeyType: 'HASH'
        },
        {
          AttributeName: 'granuleId',
          KeyType: 'RANGE'
        }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 10
      }
    }];

    super({
      tableName: process.env.GranulesTable,
      tableHash: { name: 'granuleId', type: 'S' },
      tableAttributes: [{ name: 'collectionId', type: 'S' }],
      tableIndexes: { GlobalSecondaryIndexes: globalSecondaryIndexes },
      schema: granuleSchema
    });
  }

  async get(...args) {
    return translateGranule(await super.get(...args));
  }

  async batchGet(...args) {
    const result = cloneDeep(await super.batchGet(...args));

    result.Responses[this.tableName] = await Promise.all(
      result.Responses[this.tableName].map(translateGranule)
    );

    return result;
  }

  async scan(...args) {
    const scanResponse = await super.scan(...args);

    if (scanResponse.Items) {
      return {
        ...scanResponse,
        Items: await Promise.all(scanResponse.Items.map(translateGranule))
      };
    }

    return scanResponse;
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
    await this.update({ granuleId }, { published: false }, ['cmrLink']);
  }

  /**
   * start the re-ingest of a given granule object
   *
   * @param {Object} granule - the granule object
   * @returns {Promise<undefined>} - undefined
   */
  async reingest(granule) {
    const executionArn = path.basename(granule.execution);

    const executionDescription = await StepFunctions.describeExecution({ executionArn });
    const originalMessage = JSON.parse(executionDescription.input);

    const { name, version } = deconstructCollectionId(granule.collectionId);

    const lambdaPayload = await Rule.buildPayload({
      workflow: originalMessage.meta.workflow_name,
      meta: originalMessage.meta,
      cumulus_meta: {
        cumulus_context: {
          reingestGranule: true,
          forceDuplicateOverwrite: true
        }
      },
      payload: originalMessage.payload,
      provider: granule.provider,
      collection: {
        name,
        version
      }
    });

    await this.updateStatus({ granuleId: granule.granuleId }, 'running');

    return aws.invoke(process.env.invoke, lambdaPayload);
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

    await aws.invoke(process.env.invoke, lambdaPayload);
  }

  /**
   * Move a granule's files to destinations specified
   *
   * @param {Object} g - the granule record object
   * @param {Array<{regex: string, bucket: string, filepath: string}>} destinations
   *    - list of destinations specified
   *    regex - regex for matching filepath of file to new destination
   *    bucket - aws bucket of the destination
   *    filepath - file path/directory on the bucket for the destination
   * @param {string} distEndpoint - distribution endpoint URL
   * @returns {Promise<undefined>} undefined
   */
  async move(g, destinations, distEndpoint) {
    log.info(`granules.move ${g.granuleId}`);

    const updatedFiles = await moveGranuleFiles(g.files, destinations);

    await reconcileCMRMetadata(g.granuleId, updatedFiles, distEndpoint, g.published);

    return this.update(
      { granuleId: g.granuleId },
      {
        files: updatedFiles.map(partial(renameProperty, 'name', 'fileName'))
      }
    );
  }

  /**
   * With the params for moving a granule, return the files that already exist at
   * the move location
   *
   * @param {Object} granule - the granule object
   * @param {Array<{regex: string, bucket: string, filepath: string}>} destinations
   * - list of destinations specified
   *    regex - regex for matching filepath of file to new destination
   *    bucket - aws bucket of the destination
   *    filepath - file path/directory on the bucket for the destination
   * @returns {Promise<Array<Object>>} - promise that resolves to a list of files
   * that already exist at the destination that they would be written to if they
   * were to be moved via the move granules call
   */
  async getFilesExistingAtLocation(granule, destinations) {
    const moveFileParams = generateMoveFileParams(granule.files, destinations);

    const fileExistsPromises = moveFileParams.map(async (moveFileParam) => {
      const { target, file } = moveFileParam;
      if (target) {
        const exists = await commonAws.fileExists(target.Bucket, target.Key);

        if (exists) {
          return Promise.resolve(file);
        }
      }

      return Promise.resolve();
    });

    const existingFiles = await Promise.all(fileExistsPromises);

    return existingFiles.filter((file) => file);
  }

  async buildGranuleRecordsFromCumulusMessage(cumulusMessage) {
    const granules = get(cumulusMessage, 'payload.granules')
      || get(cumulusMessage, 'meta.input_granules');

    if (isNil(granules)) return [];

    const collectionId = CumulusMessage.getCollectionId(cumulusMessage);

    const arn = CumulusMessage.getExecutionArn(cumulusMessage);
    if (!arn) return [];

    const execution = aws.getExecutionUrl(arn);

    const exception = parseException(cumulusMessage.exception);

    const now = Date.now();

    return Promise.all(
      granules.filter((g) => g.granuleId).map(async (granule) => {
        const granuleFiles = await buildDatabaseFiles({
          providerURL: buildURL({
            protocol: cumulusMessage.meta.provider.protocol,
            host: cumulusMessage.meta.provider.host,
            port: cumulusMessage.meta.provider.port
          }),
          files: granule.files
        });

        const doc = {
          granuleId: granule.granuleId,
          pdrName: get(cumulusMessage, 'meta.pdr.name'),
          collectionId,
          status: get(cumulusMessage, 'meta.status'),
          provider: get(cumulusMessage, 'meta.provider.id'),
          execution,
          cmrLink: get(granule, 'cmrLink'),
          files: granuleFiles,
          error: exception,
          createdAt: get(cumulusMessage, 'cumulus_meta.workflow_start_time'),
          timestamp: now,
          productVolume: getGranuleProductVolume(granuleFiles),
          timeToPreprocess: get(cumulusMessage, 'meta.sync_granule_duration', 0) / 1000,
          timeToArchive: get(cumulusMessage, 'meta.post_to_cmr_duration', 0) / 1000,
          processingStartDateTime: extractDate(cumulusMessage, 'meta.sync_granule_end_time'),
          processingEndDateTime: extractDate(cumulusMessage, 'meta.post_to_cmr_start_time')
        };

        doc.published = get(granule, 'published', false);
        // Duration is also used as timeToXfer for the EMS report
        doc.duration = (doc.timestamp - doc.createdAt) / 1000;

        if (granule.cmrLink) {
          const metadata = await cmrjs.getMetadata(granule.cmrLink);
          doc.beginningDateTime = metadata.time_start;
          doc.endingDateTime = metadata.time_end;
          doc.lastUpdateDateTime = metadata.updated;

          const fullMetadata = await cmrjs.getFullMetadata(granule.cmrLink);
          if (fullMetadata && fullMetadata.DataGranule) {
            doc.productionDateTime = fullMetadata.DataGranule.ProductionDateTime;
          }
        }

        return {
          createdAt: now,
          ...doc,
          updatedAt: now
        };
      })
    );
  }

  /**
   * Create new granule records from incoming sns messages
   *
   * @param {Object} payload - sns message containing the output of a Cumulus Step Function
   * @returns {Promise<Array>} granule records
   */
  async createGranulesFromSns(payload) {
    const granules = await this.buildGranuleRecordsFromCumulusMessage(payload);

    if (granules.length === 0) return undefined;

    return Promise.all(granules.map((granule) => this.create(granule)));
  }

  /**
   * return the queue of the granules for a given collection,
   * the items are ordered by granuleId
   *
   * @param {string} collectionId - collection id
   * @param {string} status - granule status, optional
   * @returns {Array<Object>} the granules' queue for a given collection
   */
  getGranulesForCollection(collectionId, status) {
    const params = {
      TableName: this.tableName,
      IndexName: 'collectionId-granuleId-index',
      ExpressionAttributeNames:
        { '#collectionId': 'collectionId', '#granuleId': 'granuleId', '#files': 'files' },
      ExpressionAttributeValues: { ':collectionId': collectionId },
      KeyConditionExpression: '#collectionId = :collectionId',
      ProjectionExpression: '#granuleId, #collectionId, #files'
    };

    // add status filter
    if (status) {
      params.ExpressionAttributeNames['#status'] = 'status';
      params.ExpressionAttributeValues[':status'] = status;
      params.FilterExpression = '#status = :status';
    }

    return new commonAws.DynamoDbSearchQueue(params, 'query');
  }
}

module.exports = Granule;
