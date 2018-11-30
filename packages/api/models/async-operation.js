'use strict';

const Ajv = require('ajv');
const { ecs, s3 } = require('@cumulus/common/aws');
const uuidv4 = require('uuid/v4');
const schemas = require('./schemas');
const { RecordDoesNotExist } = require('../lib/errors');
const Registry = require('../Registry');

/**
 * A class for tracking AsyncOperations using DynamoDB.
 *
 * @class AsyncOperation
 * @extends {Manager}
 */
class AsyncOperation {
  static recordIsValid(item, schema = null, removeAdditional = false) {
    if (schemas.asyncOperation) {
      const ajv = new Ajv({
        useDefaults: true,
        v5: true,
        removeAdditional: removeAdditional
      });
      const validate = ajv.compile(schemas.asyncOperation);
      const valid = validate(item);
      if (!valid) {
        const err = new Error('The record has validation errors');
        err.name = 'SchemaValidationError';
        err.detail = validate.errors;
        throw err;
      }
    }
  }

  /**
   * Creates an instance of AsyncOperation.
   *
   * @param {Object} params - params
   * @param {string} params.stackName - the Cumulus stack name
   * @param {string} params.systemBucket - the name of the Cumulus system bucket
   * @param {string} params.tableName - the name of the AsyncOperation DynamoDB
   *   table
   * @returns {undefined} creates a new AsyncOperation object
   * @memberof AsyncOperation
   */
  constructor(params) {
    if (!params.stackName) throw new TypeError('stackName is required');
    if (!params.systemBucket) throw new TypeError('systemBucket is required');

    this.systemBucket = params.systemBucket;
    this.stackName = params.stackName;
  }

  get tableName() {
    return 'deprecated';
  }

  table() {
    return Registry.knex()('async_operations');
  }

  async createTable() {} // eslint-disable-line no-empty-function

  async deleteTable() {} // eslint-disable-line no-empty-function

  /**
   * creates record(s)
   *
   * @param {Object<Array|Object>} items - the Item/Items to be added to the database
   * @returns {Promise<Array|Object>} an array of created records or a single
   *   created record
   */
  async create(items) {
    // This is confusing because the argument named "items" could either be
    // an Array of items or a single item.  To make this function a little
    // easier to understand, converting the single item case here to an array
    // containing one item.
    const itemsArray = Array.isArray(items) ? items : [items];

    // Make sure that all of the items are valid
    itemsArray.forEach((item) => {
      this.constructor.recordIsValid(item, this.schema, this.removeAdditional);
    });

    const insertItems = itemsArray.map((i) => ({
      id: i.id,
      output: i.output,
      task_arn: i.taskArn,
      status: i.status
    }));

    await this.table().insert(insertItems);

    // If the original item was an Array, return an Array.  If the original item
    // was an Object, return an Object.
    return Array.isArray(items) ? itemsArray : itemsArray[0];
  }

  /**
   * Fetch the AsyncOperation with the given id
   *
   * @param {string} id - an AsyncOperation id
   * @returns {Promise<Object>} - an AsyncOperation record
   * @memberof AsyncOperation
   */
  async get(id) {
    const records = await this.table().where({ id });

    if (records.length === 0) {
      throw new RecordDoesNotExist('No record found');
    }

    const record = records[0];

    return {
      id: record.id,
      output: record.output,
      status: record.status,
      taskArn: record.task_arn
    };
  }

  /**
   * Update an AsyncOperation in the database
   *
   * @param {string} id - the ID of the AsyncOperation
   * @param {Object} updates - key / value pairs of fields to be updated
   * @param {Array<string>} keysToDelete - deprecated
   * @returns {Promise<Object>} - a Promise that resolves to the object after it
   *   is updated
   * @memberof AsyncOperation
   */
  async update(id, updates = {}, keysToDelete = []) {
    await this.table()
      .where({ id })
      .update({
        output: updates.output,
        task_arn: updates.taskArn,
        status: updates.status
      });

    return { id };
  }

  /**
   * Start an AsyncOperation in ECS and store its associate record to DynamoDB
   *
   * @param {Object} params - params
   * @param {string} params.id - the id of the AsyncOperation to start
   * @param {string} params.asyncOperationTaskDefinition - the name or ARN of the
   *   async-operation ECS task definition
   * @param {string} params.cluster - the name of the ECS cluster
   * @param {string} params.lambdaName - the name of the Lambda task to be run
   * @param {Object|Array} params.payload - the event to be passed to the lambda task.
   *   Must be a simple Object or Array which can be converted to JSON.
   * @returns {Promise<Object>} - an AsyncOperation record
   * @memberof AsyncOperation
   */
  async start(params) {
    const {
      asyncOperationTaskDefinition,
      cluster,
      lambdaName,
      payload
    } = params;

    // Create the record in the database
    const id = uuidv4();
    await this.create({ id, status: 'RUNNING' });

    // Store the payload to S3
    const payloadBucket = this.systemBucket;
    const payloadKey = `${this.stackName}/async-operation-payloads/${id}.json`;

    await s3().putObject({
      Bucket: payloadBucket,
      Key: payloadKey,
      Body: JSON.stringify(payload)
    }).promise();

    // Start the task in ECS
    const runTaskResponse = await ecs().runTask({
      cluster,
      taskDefinition: asyncOperationTaskDefinition,
      launchType: 'EC2',
      overrides: {
        containerOverrides: [
          {
            name: 'AsyncOperation',
            environment: [
              { name: 'asyncOperationId', value: id },
              { name: 'asyncOperationsTable', value: this.tableName },
              { name: 'lambdaName', value: lambdaName },
              { name: 'payloadUrl', value: `s3://${payloadBucket}/${payloadKey}` }
            ]
          }
        ]
      }
    }).promise();

    // If creating the stack failed, update the database
    if (runTaskResponse.failures.length > 0) {
      return this.update(
        id,
        {
          status: 'RUNNER_FAILED',
          output: JSON.stringify({
            name: 'EcsStartTaskError',
            message: `Failed to start AsyncOperation: ${runTaskResponse.failures[0].reason}`,
            stack: (new Error()).stack
          })
        }
      );
    }

    // Update the database with the taskArn
    await this.update(
      id,
      {
        status: 'RUNNING',
        taskArn: runTaskResponse.tasks[0].taskArn
      }
    );

    return {
      id,
      taskArn: runTaskResponse.tasks[0].taskArn
    };
  }
}
module.exports = AsyncOperation;
