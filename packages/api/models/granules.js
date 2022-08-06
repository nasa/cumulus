'use strict';

const isArray = require('lodash/isArray');

const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const cmrjsCmrUtils = require('@cumulus/cmrjs/cmr-utils');
const { removeNilProperties } = require('@cumulus/common/util');
const {
  DeletePublishedGranule,
} = require('@cumulus/errors');

const Manager = require('./base');

const FileUtils = require('../lib/FileUtils');
const {
  translateGranule,
} = require('../lib/granules');
const GranuleSearchQueue = require('../lib/GranuleSearchQueue');

const granuleSchema = require('./schemas').granule;

class Granule extends Manager {
  constructor({
    fileUtils = FileUtils,
    stepFunctionUtils = StepFunctions,
    cmrUtils = cmrjsCmrUtils,
  } = {}) {
    const globalSecondaryIndexes = [{
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
    }];

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
  }

  async scan(...args) {
    const scanResponse = await super.scan(...args);

    if (scanResponse.Items) {
      return {
        ...scanResponse,
        Items: await Promise.all(scanResponse.Items.map(
          (response) => translateGranule(response)
        )),
      };
    }

    return scanResponse;
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
        if (!isQuery && (field === 'granuleId')) {
          expression = `contains(#${field}, :${key})`;
        } else {
          expression = `#${field} ${operation} :${key}`;
        }
      }

      if (isQuery && (field === 'granuleId')) {
        keyConditionArray.push(expression);
      } else {
        filterArray.push(expression);
      }
    });

    return {
      attributeNames,
      attributeValues,
      filterArray,
      filterExpression: (filterArray.length > 0) ? filterArray.join(' AND ') : undefined,
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
    const {
      attributeNames,
      attributeValues,
      filterExpression,
    } = this.getDynamoDbSearchParams(searchParams, false);

    const projectionArray = [];
    const fields = ['granuleId', 'collectionId', 'createdAt', 'beginningDateTime',
      'endingDateTime', 'status', 'updatedAt', 'published', 'provider'];
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
   * Get the set of fields which are mutable based on the granule status.
   *
   * @param {Object} record - A granule record
   * @returns {Array} - The array of mutable field names
   */
  _getMutableFieldNames(record) {
    if (record.status === 'running') {
      return ['createdAt', 'updatedAt', 'timestamp', 'status', 'execution'];
    }
    return Object.keys(record);
  }
}

module.exports = Granule;
