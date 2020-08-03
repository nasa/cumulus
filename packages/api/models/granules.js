'use strict';

const cloneDeep = require('lodash/cloneDeep');
const get = require('lodash/get');
const partial = require('lodash/partial');
const path = require('path');
const pMap = require('p-map');

const awsClients = require('@cumulus/aws-client/services');
const Lambda = require('@cumulus/aws-client/Lambda');
const s3Utils = require('@cumulus/aws-client/S3');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { CMR } = require('@cumulus/cmr-client');
const cmrUtils = require('@cumulus/cmrjs/cmr-utils');
const log = require('@cumulus/common/log');
const { getCollectionIdFromMessage } = require('@cumulus/message/Collections');
const { getMessageExecutionArn } = require('@cumulus/message/Executions');
const { getMessageGranules } = require('@cumulus/message/Granules');
const { buildURL } = require('@cumulus/common/URLUtils');
const {
  isNil,
  removeNilProperties
} = require('@cumulus/common/util');
const {
  getBucketsConfigKey,
  getDistributionBucketMapKey
} = require('@cumulus/common/stack');
const {
  DeletePublishedGranule
} = require('@cumulus/errors');
const {
  generateMoveFileParams,
  moveGranuleFiles
} = require('@cumulus/ingest/granule');

const StepFunctionUtils = require('../lib/StepFunctionUtils');
const Manager = require('./base');

const { CumulusModelError } = require('./errors');
const FileUtils = require('../lib/FileUtils');
const { translateGranule } = require('../lib/granules');
const GranuleSearchQueue = require('../lib/GranuleSearchQueue');

const {
  parseException,
  deconstructCollectionId,
  getGranuleProductVolume
} = require('../lib/utils');
const Rule = require('./rules');
const granuleSchema = require('./schemas').granule;

const renameProperty = (from, to, obj) => {
  const newObj = { ...obj, [to]: obj[from] };
  delete newObj[from];
  return newObj;
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

  getRecord({ granuleId }) {
    return super.get({ granuleId });
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
   * Remove granule record from CMR
   *
   * @param {Object} granule - A granule record
   * @throws {CumulusModelError|Error}
   * @returns {Promise}
   * @private
   */
  async _removeGranuleFromCmr(granule) {
    log.info(`granules.removeGranuleFromCmrByGranule ${granule.granuleId}`);

    if (!granule.published || !granule.cmrLink) {
      throw new CumulusModelError(`Granule ${granule.granuleId} is not published to CMR, so cannot be removed from CMR`);
    }

    const cmrSettings = await cmrUtils.getCmrSettings();
    const cmr = new CMR(cmrSettings);
    const metadata = await cmr.getGranuleMetadata(granule.cmrLink);

    // Use granule UR to delete from CMR
    await cmr.deleteGranule(metadata.title, granule.collectionId);
  }

  async removeGranuleFromCmrByGranule(granule) {
    await this._removeGranuleFromCmr(granule);
    return this.update({ granuleId: granule.granuleId }, { published: false }, ['cmrLink']);
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
      },
      queueUrl: granule.queueUrl
    });

    await this.updateStatus({ granuleId: granule.granuleId }, 'running');

    return Lambda.invoke(process.env.invoke, lambdaPayload);
  }

  /**
   * apply a workflow to a given granule object
   *
   * @param {Object} g - the granule object
   * @param {string} workflow - the workflow name
   * @param {string} [queueName] - specify queue to append message to
   * @param {string} [asyncOperationId] - specify asyncOperationId origin
   * @returns {Promise<undefined>} undefined
   */
  async applyWorkflow(
    g,
    workflow,
    queueName = undefined,
    asyncOperationId = undefined
  ) {
    if (!workflow) {
      throw new TypeError('granule.applyWorkflow requires a `workflow` parameter');
    }

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
      },
      queueName,
      asyncOperationId
    });

    await this.updateStatus({ granuleId: g.granuleId }, 'running');

    await Lambda.invoke(process.env.invoke, lambdaPayload);
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

    const bucketsConfig = await s3Utils.getJsonS3Object(
      process.env.system_bucket,
      getBucketsConfigKey(process.env.stackName)
    );

    const bucketTypes = Object.values(bucketsConfig)
      .reduce(
        (acc, { name, type }) => ({ ...acc, [name]: type }),
        {}
      );

    const distributionBucketMap = await s3Utils.getJsonS3Object(
      process.env.system_bucket,
      getDistributionBucketMapKey(process.env.stackName)
    );
    const updatedFiles = await moveGranuleFiles(g.files, destinations);

    await cmrUtils.reconcileCMRMetadata({
      granuleId: g.granuleId,
      updatedFiles,
      distEndpoint,
      published: g.published,
      distributionBucketMap,
      bucketTypes
    });

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
        const exists = await s3Utils.fileExists(target.Bucket, target.Key);

        if (exists) {
          return Promise.resolve(file);
        }
      }

      return Promise.resolve();
    });

    const existingFiles = await Promise.all(fileExistsPromises);

    return existingFiles.filter((file) => file);
  }

  /**
   * Build a granule record.
   *
   * @param {Object} params
   * @param {AWS.S3} params.s3 - an AWS.S3 instance
   * @param {Object} params.granule - A granule object
   * @param {Object} params.message - A workflow execution message
   * @param {string} params.executionUrl - A Step Function execution URL
   * @param {Object} [params.executionDescription={}] - Defaults to empty object
   * @param {Date} params.executionDescription.startDate - Start date of the workflow execution
   * @param {Date} params.executionDescription.stopDate - Stop date of the workflow execution
   * @returns {Promise<Object>} A granule record
   */
  static async generateGranuleRecord({
    s3,
    granule,
    message,
    executionUrl,
    executionDescription = {}
  }) {
    if (!granule.granuleId) throw new CumulusModelError(`Could not create granule record, invalid granuleId: ${granule.granuleId}`);
    const collectionId = getCollectionIdFromMessage(message);
    if (!collectionId) {
      throw new CumulusModelError('meta.collection required to generate a granule record');
    }
    const granuleFiles = await FileUtils.buildDatabaseFiles({
      s3,
      providerURL: buildURL({
        protocol: message.meta.provider.protocol,
        host: message.meta.provider.host,
        port: message.meta.provider.port
      }),
      files: granule.files
    });

    const temporalInfo = await cmrUtils.getGranuleTemporalInfo(granule);

    const { startDate, stopDate } = executionDescription;
    const processingTimeInfo = {};
    if (startDate) {
      processingTimeInfo.processingStartDateTime = startDate.toISOString();
      processingTimeInfo.processingEndDateTime = stopDate
        ? stopDate.toISOString()
        : new Date().toISOString();
    }

    const now = Date.now();

    const record = {
      granuleId: granule.granuleId,
      pdrName: get(message, 'meta.pdr.name'),
      collectionId,
      status: get(message, 'meta.status', get(granule, 'status')),
      provider: get(message, 'meta.provider.id'),
      execution: executionUrl,
      cmrLink: granule.cmrLink,
      files: granuleFiles,
      error: parseException(message.exception),
      createdAt: get(message, 'cumulus_meta.workflow_start_time'),
      timestamp: now,
      updatedAt: now,
      productVolume: getGranuleProductVolume(granuleFiles),
      timeToPreprocess: get(granule, 'sync_granule_duration', 0) / 1000,
      timeToArchive: get(granule, 'post_to_cmr_duration', 0) / 1000,
      ...processingTimeInfo,
      ...temporalInfo
    };

    record.published = get(granule, 'published', false);
    // Duration is also used as timeToXfer for the EMS report
    record.duration = (record.timestamp - record.createdAt) / 1000;

    return removeNilProperties(record);
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
      ExpressionAttributeNames: {
        '#collectionId': 'collectionId',
        '#granuleId': 'granuleId',
        '#files': 'files',
        '#published': 'published',
        '#createdAt': 'createdAt'
      },
      ExpressionAttributeValues: { ':collectionId': collectionId },
      KeyConditionExpression: '#collectionId = :collectionId',
      ProjectionExpression: '#granuleId, #collectionId, #files, #published, #createdAt'
    };

    // add status filter
    if (status) {
      params.ExpressionAttributeNames['#status'] = 'status';
      params.ExpressionAttributeValues[':status'] = status;
      params.FilterExpression = '#status = :status';
    }

    return new GranuleSearchQueue(params, 'query');
  }

  granuleAttributeScan() {
    const params = {
      TableName: this.tableName,
      ExpressionAttributeNames:
      {
        '#granuleId': 'granuleId',
        '#collectionId': 'collectionId',
        '#beginningDateTime': 'beginningDateTime',
        '#endingDateTime': 'endingDateTime',
        '#createdAt': 'createdAt',
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#published': 'published'
      },
      ProjectionExpression: '#granuleId, #collectionId, #createdAt, #beginningDateTime, #endingDateTime, #status, #updatedAt, #published'
    };

    return new GranuleSearchQueue(params);
  }

  /**
   * Delete a granule record and remove its files from S3.
   *
   * @param {Object} granule - A granule record
   * @returns {Promise}
   * @private
   */
  async _deleteRecord(granule) {
    // Delete granule files
    await pMap(
      get(granule, 'files', []),
      (file) => {
        const bucket = FileUtils.getBucket(file);
        const key = FileUtils.getKey(file);
        return s3Utils.deleteS3Object(bucket, key);
      }
    );

    return super.delete({ granuleId: granule.granuleId });
  }

  /**
   * Unpublish and delete granule.
   *
   * @param {Object} granule - A granule record
   * @returns {Promise}
   */
  async unpublishAndDeleteGranule(granule) {
    await this._removeGranuleFromCmr(granule);
    // Intentionally do not update the record to set `published: false`.
    // So if _deleteRecord fails, the record is still in a state where this
    // operation can be retried.
    return this._deleteRecord(granule);
  }

  /**
   * Delete a granule
   *
   * @param {Object} granule record
   * @returns {Promise}
   */
  async delete(granule) {
    if (granule.published) {
      throw new DeletePublishedGranule('You cannot delete a granule that is published to CMR. Remove it from CMR first');
    }

    return this._deleteRecord(granule);
  }

  /**
   * Only used for tests
   */
  async deleteGranules() {
    const granules = await this.scan();
    return Promise.all(granules.Items.map((granule) =>
      this.delete(granule)));
  }

  /**
   * Get the set of fields which are mutable based on the granule status.
   *
   * @param {Object} record - A granule record
   * @returns {Array} - The array of mutable field names
   */
  _getMutableFieldNames(record) {
    if (record.status === 'running') {
      return ['updatedAt', 'timestamp', 'status', 'execution'];
    }
    return Object.keys(record);
  }

  /**
   * Parse a Cumulus message and build granule records for the embedded granules.
   *
   * @param {Object} cumulusMessage - A Cumulus message
   * @returns {Promise<Array<Object>>} - An array of granule records
   */
  static async _getGranuleRecordsFromCumulusMessage(cumulusMessage) {
    const granules = getMessageGranules(cumulusMessage);
    if (!granules) {
      log.info(`No granules to process in the payload: ${JSON.stringify(cumulusMessage.payload)}`);
      return [];
    }

    const executionArn = getMessageExecutionArn(cumulusMessage);
    const executionUrl = StepFunctionUtils.getExecutionUrl(executionArn);

    let executionDescription;
    try {
      executionDescription = await StepFunctions.describeExecution({ executionArn });
    } catch (error) {
      log.error(`Could not describe execution ${executionArn}`, error);
    }

    const promisedGranuleRecords = granules
      .map(
        async (granule) => {
          try {
            return await Granule.generateGranuleRecord({
              s3: awsClients.s3(),
              granule,
              message: cumulusMessage,
              executionUrl,
              executionDescription
            });
          } catch (error) {
            log.logAdditionalKeys(
              {
                error: {
                  name: error.name,
                  message: error.message,
                  stack: error.stack.split('\n')
                },
                cumulusMessage
              },
              'Unable to get granule records from Cumulus Message'
            );

            return undefined;
          }
        }
      );

    const granuleRecords = await Promise.all(promisedGranuleRecords);

    return granuleRecords.filter((r) => !isNil(r));
  }

  /**
   * Validate and store a granule record.
   *
   * @param {Object} granuleRecord - A granule record.
   * @returns {Promise}
   */
  async _validateAndStoreGranuleRecord(granuleRecord) {
    try {
      // TODO: Refactor this all to use model.update() to avoid having to manually call
      // schema validation and the actual client.update() method.
      await this.constructor.recordIsValid(granuleRecord, this.schema, this.removeAdditional);

      const mutableFieldNames = this._getMutableFieldNames(granuleRecord);
      const updateParams = this._buildDocClientUpdateParams({
        item: granuleRecord,
        itemKey: { granuleId: granuleRecord.granuleId },
        mutableFieldNames
      });

      // Only allow "running" granule to replace completed/failed
      // granule if the execution has changed
      if (granuleRecord.status === 'running') {
        updateParams.ConditionExpression = '#execution <> :execution';
      }

      await this.dynamodbDocClient.update(updateParams).promise();
    } catch (error) {
      log.error(
        'Could not store granule record: ', granuleRecord,
        error
      );
    }
  }

  /**
   * Generate and store granule records from a Cumulus message.
   *
   * @param {Object} cumulusMessage - Cumulus workflow message
   * @returns {Promise}
   */
  async storeGranulesFromCumulusMessage(cumulusMessage) {
    const granuleRecords = await this.constructor
      ._getGranuleRecordsFromCumulusMessage(cumulusMessage);
    return Promise.all(granuleRecords.map(this._validateAndStoreGranuleRecord, this));
  }
}

module.exports = Granule;
