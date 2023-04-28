'use strict';

const cloneDeep = require('lodash/cloneDeep');
const isArray = require('lodash/isArray');

const s3Utils = require('@cumulus/aws-client/S3');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const { CMR } = require('@cumulus/cmr-client');
const cmrjsCmrUtils = require('@cumulus/cmrjs/cmr-utils');
const Logger = require('@cumulus/logger');
const { removeNilProperties } = require('@cumulus/common/util');
const {
  DeletePublishedGranule,
  ValidationError,
} = require('@cumulus/errors');
const { RecordDoesNotExist } = require('@cumulus/errors');
const {
  generateMoveFileParams,
} = require('@cumulus/ingest/granule');

const omitBy = require('lodash/omitBy');
const isNull = require('lodash/isNull');

const Manager = require('./base');
const { CumulusModelError } = require('./errors');
const FileUtils = require('../lib/FileUtils');
const {
  translateGranule,
} = require('../lib/granules');
const GranuleSearchQueue = require('../lib/GranuleSearchQueue');

const granuleSchema = require('./schemas').granule;

const logger = new Logger({ sender: '@cumulus/api/models/granules' });

class Granule extends Manager {
  constructor({
    fileUtils = FileUtils,
    stepFunctionUtils = StepFunctions,
    cmrUtils = cmrjsCmrUtils,
  } = {}) {
    const globalSecondaryIndexes = [
      {
        IndexName: 'collectionId-granuleId-index',
        KeySchema: [
          {
            AttributeName: 'collectionId',
            KeyType: 'HASH',
          },
          {
            AttributeName: 'granuleId',
            KeyType: 'RANGE',
          },
        ],
        Projection: {
          ProjectionType: 'ALL',
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 10,
        },
      },
    ];

    super({
      tableName: process.env.GranulesTable,
      tableHash: { name: 'granuleId', type: 'S' },
      tableAttributes: [{ name: 'collectionId', type: 'S' }],
      tableIndexes: { GlobalSecondaryIndexes: globalSecondaryIndexes },
      schema: granuleSchema,
    });

    this.fileUtils = fileUtils;
    this.stepFunctionUtils = stepFunctionUtils;
    this.cmrUtils = cmrUtils;
    this.allowNulls = true;
    this.parseEmptyFilesArrayAsNull = true;
    this.invalidNullFields = [
      'granuleId',
      'collectionId',
      'status',
      'updatedAt',
      'execution',
      'createdAt',
    ];
  }

  async get(...args) {
    return translateGranule(await super.get(...args), this.fileUtils);
  }

  getRecord({ granuleId }) {
    return super.get({ granuleId });
  }

  async batchGet(...args) {
    const result = cloneDeep(await super.batchGet(...args));

    result.Responses[this.tableName] = await Promise.all(
      result.Responses[this.tableName].map((response) =>
        translateGranule(response))
    );

    return result;
  }

  async scan(...args) {
    const scanResponse = await super.scan(...args);

    if (scanResponse.Items) {
      return {
        ...scanResponse,
        Items: await Promise.all(
          scanResponse.Items.map((response) => translateGranule(response))
        ),
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
    logger.info(`granules.removeGranuleFromCmrByGranule ${granule.granuleId}`);

    if (!granule.published || !granule.cmrLink) {
      throw new CumulusModelError(
        `Granule ${granule.granuleId} is not published to CMR, so cannot be removed from CMR`
      );
    }

    const cmrSettings = await this.cmrUtils.getCmrSettings();
    const cmr = new CMR(cmrSettings);
    const metadata = await cmr.getGranuleMetadata(granule.cmrLink);

    // Use granule UR to delete from CMR
    await cmr.deleteGranule(metadata.title, granule.collectionId);
  }

  /*
   * DEPRECATED: This has moved to /lib/granule-remove-from-cmr.js
   */
  async removeGranuleFromCmrByGranule(granule) {
    await this._removeGranuleFromCmr(granule);
    return this.update({ granuleId: granule.granuleId }, { published: false }, [
      'cmrLink',
    ]);
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
      if (target && (await s3Utils.s3ObjectExists(target))) {
        return Promise.resolve(file);
      }

      return Promise.resolve();
    });

    const existingFiles = await Promise.all(fileExistsPromises);

    return existingFiles.filter((file) => file);
  }

  /**
   * Returns the params to pass to GranulesSeachQueue
   * either as an object/array or a joined expression
   * @param {Object} searchParams - optional, search parameters
   * @param {boolean} isQuery - optional, true if the params are for a query
   * @returns {Array<Object>} the granules' queue for a given collection
   */
  getDynamoDbSearchParams(searchParams = {}, isQuery = true) {
    const attributeNames = {};
    const attributeValues = {};
    const filterArray = [];
    const keyConditionArray = [];

    Object.entries(searchParams).forEach(([key, value]) => {
      const field = key.includes('__') ? key.split('__').shift() : key;
      attributeNames[`#${field}`] = field;

      let expression;
      if (key.endsWith('__from') || key.endsWith('__to')) {
        const operation = key.endsWith('__from') ? '>=' : '<=';
        attributeValues[`:${key}`] = value;
        expression = `#${field} ${operation} :${key}`;
      } else if (isArray(value)) {
        const operation = 'IN';
        const keyValues = [];
        value.forEach((val, index) => {
          attributeValues[`:${key}${index}`] = val;
          keyValues.push(`:${key}${index}`);
        });
        expression = `#${field} ${operation} (${keyValues.join(', ')})`;
      } else {
        const operation = '=';
        attributeValues[`:${key}`] = value;
        if (!isQuery && field === 'granuleId') {
          expression = `contains(#${field}, :${key})`;
        } else {
          expression = `#${field} ${operation} :${key}`;
        }
      }

      if (isQuery && field === 'granuleId') {
        keyConditionArray.push(expression);
      } else {
        filterArray.push(expression);
      }
    });

    return {
      attributeNames,
      attributeValues,
      filterArray,
      filterExpression:
        filterArray.length > 0 ? filterArray.join(' AND ') : undefined,
      keyConditionArray,
    };
  }

  /**
   * return all granules filtered by given search params
   *
   * @param {Object} searchParams - optional, search parameters
   * @returns {Array<Object>} the granules' queue for a given collection
   */
  granuleAttributeScan(searchParams) {
    const { attributeNames, attributeValues, filterExpression } =
      this.getDynamoDbSearchParams(searchParams, false);

    const projectionArray = [];
    const fields = [
      'granuleId',
      'collectionId',
      'createdAt',
      'beginningDateTime',
      'endingDateTime',
      'status',
      'updatedAt',
      'published',
      'provider',
    ];
    fields.forEach((field) => {
      attributeNames[`#${field}`] = field;
      projectionArray.push(`#${field}`);
    });

    const params = {
      TableName: this.tableName,
      ExpressionAttributeNames: attributeNames,
      ExpressionAttributeValues: filterExpression ? attributeValues : undefined,
      ProjectionExpression: projectionArray.join(', '),
      FilterExpression: filterExpression,
    };

    return new GranuleSearchQueue(removeNilProperties(params));
  }

  /**
   * Delete a granule record and remove its files from S3.
   *
   * @param {Object} granule - A granule record
   * @returns {Promise}
   * @private
   */
  async _deleteRecord(granule) {
    return await super.delete({ granuleId: granule.granuleId });
  }

  /**
   * Delete a granule
   *
   * @param {Object} granule record
   * @returns {Promise}
   */
  async delete(granule) {
    if (granule.published) {
      throw new DeletePublishedGranule(
        'You cannot delete a granule that is published to CMR. Remove it from CMR first'
      );
    }

    return await this._deleteRecord(granule);
  }

  /**
   * Only used for tests
   */
  async deleteGranules() {
    const granules = await this.scan();
    return await Promise.all(
      granules.Items.map((granule) => this.delete(granule))
    );
  }

  /**
   * Get the set of fields which are mutable based on the granule status.
   *
   * @param {Object} record                  - A granule record
   * @param {boolean} writeConstraints       - boolean toggle restricting if write conditionals
   *                                           should be compared to existing record to determine
   *                                           write eligibility
   * @returns {Array} - The array of mutable field names
   */
  _getMutableFieldNames(record, writeConstraints = true) {
    if (record.status === 'running' && writeConstraints === true) {
      return ['createdAt', 'updatedAt', 'timestamp', 'status', 'execution'];
    }
    return Object.keys(record);
  }

  /**
   * Store a granule record in DynamoDB.
   *
   * @param {Object} granuleRecord           - A granule record.
   * @param {boolean} writeConstraints       - boolean toggle restricting if write conditionals
   *                                           should be compared to existing record to determine
   *                                           write eligibility
   * @returns {Promise<Object|undefined>}
   */
  async _storeGranuleRecord(granuleRecord, writeConstraints = true) {
    const mutableFieldNames = this._getMutableFieldNames(granuleRecord, writeConstraints);
    // Validate values that shouldn't be set to null are not
    Object.keys(granuleRecord).forEach((key) => {
      if (granuleRecord[key] === null && this.invalidNullFields.includes(key)) {
        throw new ValidationError(`Attempted DynamoDb write with invalid key ${key} set to null.  Please remove or change this field and retry`);
      }
    });

    const updateParams = this._buildDocClientUpdateParams({
      item: granuleRecord,
      itemKey: { granuleId: granuleRecord.granuleId },
      mutableFieldNames,
    });

    if (writeConstraints === true) {
      if (granuleRecord.createdAt) {
        // createdAt comes from cumulus_meta.workflow_start_time
        // records should *not* be updating from createdAt times that are *older* start
        // times than the existing record, whatever the status
        // Because both API write and message write chains use the granule model to store records,in
        // cases where createdAt does not exist on the granule, we assume overwrite protections are
        // undesired behavior via business logic on the message write logic
        updateParams.ConditionExpression = '(attribute_not_exists(createdAt) or :createdAt >= #createdAt)';
      }

      // Only allow "running" granule to replace completed/failed
      // granule if the execution has changed for granules with executions.
      // Allow running granule to replace queued granule
      if (
        granuleRecord.status === 'running' && granuleRecord.execution !== undefined
      ) {
        updateParams.ExpressionAttributeValues[':queued'] = 'queued';
        if (updateParams.ConditionExpression) {
          updateParams.ConditionExpression += ' and ';
        } else {
          updateParams.ConditionExpression = '';
        }
        updateParams.ConditionExpression += '(#status = :queued or #execution <> :execution)';
      }

      // Only allow "queued" granule to replace running/completed/failed
      // granule if the execution has changed for granules with executions.
      if (
        granuleRecord.status === 'queued' && granuleRecord.execution !== undefined
      ) {
        if (updateParams.ConditionExpression) {
          updateParams.ConditionExpression += ' and ';
        } else {
          updateParams.ConditionExpression = '';
        }
        updateParams.ConditionExpression += '#execution <> :execution';
      }
    }
    try {
      return await this.dynamodbDocClient.update(updateParams);
    } catch (error) {
      if (
        error.name && error.name.includes('ConditionalCheckFailedException')
      ) {
        logger.error(
          `Did not process delayed event for granule: ${JSON.stringify(
            granuleRecord
          )}, cause:`,
          error
        );
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Validate and store a granule record.
   *
   * @param {Object} granuleRecord           - A granule record.
   * @param {boolean} writeConstraints       - boolean toggle restricting if constraints
   *                                           should be used to determine
   *                                           write eligibility
   * @returns {Promise}
   */
  async _validateAndStoreGranuleRecord(granuleRecord, writeConstraints) {
    // granuleRecord needs to be cloned here as ajv/validation routines mutate the validated granule
    // with schema defaults via ajv, and this is undesirable for PATCH behavior
    const clonedGranuleRecord = cloneDeep(granuleRecord);
    // TODO: Refactor this all to use model.update() to avoid having to manually call
    // schema validation and the actual client.update() method.
    await this.constructor.recordIsValid(
      // Allow null values for PATCH deletion
      // Functionally for new granules they're undefined and
      // and should pass validation
      omitBy(clonedGranuleRecord, isNull),
      this.schema,
      this.removeAdditional
    );
    return this._storeGranuleRecord(
      clonedGranuleRecord,
      writeConstraints
    );
  }

  /**
   * Stores a granule in dynamoDB
   *
   * @param {Object} granuleRecord           - dynamoDB granule
   * @param {boolean} writeConstraints       - boolean toggle restricting if constraints
   *                                           should be used to determine
   *                                           write eligibility
   * @returns {Object} dynamodbDocClient update responses
   */
  async storeGranule(granuleRecord, writeConstraints = true) {
    logger.info(
      `About to write granule with granuleId ${granuleRecord.granuleId}, collectionId ${granuleRecord.collectionId} to DynamoDB`
    );
    const response = await this._validateAndStoreGranuleRecord(
      granuleRecord,
      writeConstraints
    );
    if (response) {
      logger.info(
        `Successfully wrote granule with granuleId ${granuleRecord.granuleId}, collectionId ${granuleRecord.collectionId} to DynamoDB`
      );
    } else {
      logger.info(
        `Did not update granule with granuleId ${granuleRecord.granuleId}, collectionId ${granuleRecord.collectionId} due to granule write constraints`
      );
    }
    return response;
  }

  async describeGranuleExecution(executionArn) {
    let executionDescription;
    try {
      executionDescription = await this.stepFunctionUtils.describeExecution({
        executionArn,
      });
    } catch (error) {
      logger.error(`Could not describe execution ${executionArn}`, error);
    }
    return executionDescription;
  }

  async update(itemKeys, updates = {}, fieldsToDelete = []) {
    let granule;
    try {
      granule = await super.update(itemKeys, updates, fieldsToDelete);
    } catch (error) {
      if (!(error instanceof RecordDoesNotExist)) {
        throw error;
      }
      logger.info(`Granule record ${JSON.stringify(itemKeys)} does not exist.`);
    }
    return granule;
  }
}

module.exports = Granule;
