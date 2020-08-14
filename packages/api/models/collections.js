'use strict';

const isEmpty = require('lodash/isEmpty');
const omit = require('lodash/omit');
const CollectionConfigStore = require('@cumulus/collection-config-store');
const { InvalidRegexError, UnmatchedRegexError } = require('@cumulus/errors');
const DynamoDbSearchQueue = require('@cumulus/aws-client/DynamoDbSearchQueue');
const Manager = require('./base');
const { collection: collectionSchema } = require('./schemas');
const Rule = require('./rules');
const { AssociatedRulesError } = require('../lib/errors');

/**
 * Test a regular expression against a sample filename.
 *
 * @param {string} regex - a regular expression
 * @param {string} sampleFileName - the same filename to test the regular expression
 * @param {string} regexFieldName - Name of the field name for the regular expression, if any
 * @throws {InvalidRegexError|UnmatchedRegexError}
 * @returns {Array<string>} - Array of matches from applying the regex to the sample filename.
 *  See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/match.
 */
function checkRegex(regex, sampleFileName, regexFieldName = 'regex') {
  let matchingRegex;
  try {
    matchingRegex = new RegExp(regex);
  } catch (error) {
    throw new InvalidRegexError(`Invalid ${regexFieldName}: ${error.message}`);
  }

  const match = sampleFileName.match(matchingRegex);
  if (!match) {
    throw new UnmatchedRegexError(`${regexFieldName} "${regex}" cannot validate "${sampleFileName}"`);
  }

  return match;
}

const validateCollectionCoreConfig = (collection) => {
  // Test that granuleIdExtraction regex matches against sampleFileName
  const match = checkRegex(collection.granuleIdExtraction, collection.sampleFileName, 'granuleIdExtraction');

  if (!match[1]) {
    throw new UnmatchedRegexError(
      `granuleIdExtraction regex "${collection.granuleIdExtraction}" does not return a matched group when applied to sampleFileName "${collection.sampleFileName}". `
      + 'Ensure that your regex includes capturing groups.'
    );
  }

  // Test that granuleId regex matches the what was extracted from the
  // sampleFileName using the granuleIdExtraction
  checkRegex(collection.granuleId, match[1], 'granuleId');
};

const validateCollectionFilesConfig = (collection) => {
  // Check that each file.regex matches against file.sampleFileName
  collection.files.forEach((file) => checkRegex(file.regex, file.sampleFileName));

  // Check that any files with a `checksumFor` field match one of the other files;
  collection.files.forEach((fileConfig) => {
    const checksumFor = fileConfig.checksumFor;
    if (!checksumFor) return;
    const matchingFiles = collection.files.filter((f) => f.regex === checksumFor);
    if (matchingFiles.length === 0) {
      throw new UnmatchedRegexError(`checksumFor '${checksumFor}' does not match any file regex`);
    }
    if (matchingFiles.length > 1) {
      throw new InvalidRegexError(`checksumFor '${checksumFor}' matches multiple file regexes`);
    }
    if (matchingFiles[0] === fileConfig) {
      throw new InvalidRegexError(`checksumFor '${checksumFor}' cannot be used to validate itself`);
    }
  });
};

const validateCollection = (collection) => {
  validateCollectionCoreConfig(collection);
  validateCollectionFilesConfig(collection);
};

// Fields which are no longer supported in collection items, and which should
// not be returned when records are read from the database.
const deprecatedFields = Object.freeze([
  'provider_path',
]);

class Collection {
  /**
   * Creates a new Collection model for managing storage and retrieval of
   * collections against a DynamoDB table. The name of the table is specified
   * by the environment variable `CollectionsTable`.  The table is partitioned
   * by collection `name`, with `version` as the sort key, both of which are of
   * type `S`.  The table schema is defined by the
   * {@link collectionSchema collection schema}.
   *
   * Collections created by this model are also put into a
   * {@link CollectionConfigStore} upon {@link #create creation} and removed
   * from it when {@link #delete deleted}.  The store is
   * {@link CollectionConfigStore#constructor created} by using the S3 bucket
   * name and CloudFormation stack name given by the values of the environment
   * variables `system_bucket` and `stackName`, respectively.
   *
   * @see Manager#constructor
   */
  constructor() {
    this.dynamoDbClient = new Manager({
      tableName: process.env.CollectionsTable,
      tableHash: { name: 'name', type: 'S' },
      tableRange: { name: 'version', type: 'S' },
      schema: collectionSchema,
    });

    this.collectionConfigStore = new CollectionConfigStore(
      process.env.system_bucket,
      process.env.stackName
    );
  }

  createTable() {
    return this.dynamoDbClient.createTable();
  }

  deleteTable() {
    return this.dynamoDbClient.deleteTable();
  }

  async get({ name, version }) {
    const fetchedCollection = await this.dynamoDbClient.get({ name, version });

    return omit(fetchedCollection, deprecatedFields);
  }

  /**
   * Returns `true` if the collection with the specified name and version
   * exists; `false` otherwise.
   *
   * @param {string} name - collection name
   * @param {string} version - collection version
   * @returns {boolean} `true` if the collection with the specified name and
   *    version exists; `false` otherwise
   */
  async exists(name, version) {
    return this.dynamoDbClient.exists({ name, version });
  }

  /**
   * Creates the specified collection and puts it into the collection
   * configuration store that was specified during this model's construction.
   * Uses the specified item's `name` and `version` as the key for putting the
   * item in the config store.
   *
   * @param {Object} item - the collection configuration
   * @param {string} item.name - the collection name
   * @param {string} item.version - the collection version
   * @returns {Promise<Object>} the created record
   * @see #constructor
   * @see Manager#create
   * @see CollectionConfigStore#put
   */
  async createItem(item) {
    validateCollection(item);

    const { name, version } = item;
    await this.collectionConfigStore.put(name, version, item);

    return this.dynamoDbClient.create(item);
  }

  createItems(items) {
    return Promise.all(
      items.map((item) => this.createItem(item))
    );
  }

  create(input) {
    if (Array.isArray(input)) {
      return this.createItems(input);
    }

    return this.createItem(input);
  }

  /**
   * Deletes the specified collection and removes it from the corresponding
   * collection configuration store that was specified during this model's
   * construction, where it was stored upon {@link #create creation}, unless
   * the collection has associated rules.
   *
   * @param {Object} item - collection parameters
   * @param {string} item.name - the collection name
   * @param {string} item.version - the collection version
   * @returns {Promise<Object>} promise that resolves to the de-serialized data
   *    returned from the request
   * @throws {AssociatedRulesError} if the collection has associated rules
   * @see #constructor
   * @see #create
   * @see Manager#delete
   * @see CollectionConfigStore#delete
   */
  async delete(item) {
    const { name, version } = item;
    const associatedRuleNames = (await this.getAssociatedRules(name, version))
      .map((rule) => rule.name);

    if (associatedRuleNames.length > 0) {
      throw new AssociatedRulesError(
        'Cannot delete a collection that has associated rules',
        associatedRuleNames
      );
    }

    await this.collectionConfigStore.delete(name, version);

    return this.dynamoDbClient.delete({ name, version });
  }

  /**
   * Get any rules associated with the collection
   *
   * @param {string} name - collection name
   * @param {string} version - collection version
   * @returns {Promise<Object>}
   */
  async getAssociatedRules(name, version) {
    const ruleModel = new Rule();

    const scanResult = await ruleModel.scan(
      {
        names: {
          '#c': 'collection',
          '#n': 'name',
          '#v': 'version',
        },
        filter: '#c.#n = :n AND #c.#v = :v',
        values: {
          ':n': name,
          ':v': version,
        },
      }
    );

    return scanResult.Items;
  }

  /**
   * return all collections
   *
   * @returns {Array<Object>} list of collections
   */
  async getAllCollections() {
    return this.dynamoDbClient.scan(
      {
        names: {
          '#name': 'name',
          '#version': 'version',
          '#reportToEms': 'reportToEms',
          '#createdAt': 'createdAt',
          '#updatedAt': 'updatedAt',
        },
      },
      '#name, #version, #reportToEms, #createdAt, #updatedAt'
    ).then((result) => result.Items);
  }

  async getCollections(searchParams) {
    const attributeNames = {};
    const attributeValues = {};
    const filterExpressions = [];

    Object.entries(searchParams).forEach(([key, value]) => {
      let field = key;
      let operation = '=';
      if (key.includes('__')) {
        field = key.split('__').shift();
        operation = key.endsWith('__from') ? '>=' : '<=';
      }

      attributeNames[`#${field}`] = field;
      attributeValues[`:${key}`] = value;
      filterExpressions.push(`#${field} ${operation} :${key}`);
    });

    const params = (searchParams && !isEmpty(searchParams))
      ? {
        TableName: this.dynamoDbClient.tableName,
        ExpressionAttributeNames: attributeNames,
        ExpressionAttributeValues: attributeValues,
        FilterExpression: filterExpressions.join(' AND '),
      }
      : {
        TableName: this.dynamoDbClient.tableName,
      };

    console.log(params);
    return new DynamoDbSearchQueue(params, 'scan');
  }

  async deleteCollections() {
    const collections = await this.getAllCollections();
    return Promise.all(collections.map((collection) => {
      const name = collection.name;
      const version = collection.version;
      return this.delete({ name, version });
    }));
  }
}

module.exports = Collection;
