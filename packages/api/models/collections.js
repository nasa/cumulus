'use strict';

const { CollectionConfigStore } = require('@cumulus/common');
const Manager = require('./base');
const collectionSchema = require('./schemas').collection;
const Rule = require('./rules');
const { AssociatedRulesError, BadRequestError } = require('../lib/errors');

function checkRegex(regex, sampleFileName) {
  const validation = new RegExp(regex);
  const match = validation.test(sampleFileName);

  if (!match) throw new BadRequestError(`regex ${regex} cannot validate ${sampleFileName}`);
}

class Collection extends Manager {
  static recordIsValid(item, schema = null) {
    super.recordIsValid(item, schema);

    // make sure regexes are correct
    // first test granuleId extraction and validation regex
    const extraction = new RegExp(item.granuleIdExtraction);
    const match = item.sampleFileName.match(extraction);

    if (!match) {
      throw new BadRequestError('granuleIdExtraction regex returns null when applied to sampleFileName');
    }

    checkRegex(item.granuleId, match[1]);

    // then check all the files
    item.files.forEach((file) => checkRegex(file.regex, file.sampleFileName));
  }

  constructor() {
    super({
      tableName: process.env.CollectionsTable,
      tableHash: { name: 'name', type: 'S' },
      tableRange: { name: 'version', type: 'S' },
      schema: collectionSchema
    });

    this.collectionConfigStore = new CollectionConfigStore(
      process.env.system_bucket,
      process.env.stackName
    );
  }

  /**
   * Check if a given collection exists
   *
   * @param {string} name - collection name
   * @param {string} version - collection version
   * @returns {boolean}
   */
  async exists(name, version) {
    return super.exists({ name, version });
  }

  /**
   * Creates a collection and puts it into a collection configuration store.
   * Uses the item's `dataType` (if specified, otherwise, it's `name`) and
   * `version` as the key for putting the item in a config store specific to
   * the S3 bucket and stack given by the environment variables `system_bucket`
   * and `stackName`, respectively.
   *
   * @param {Object} item - the collection configuration
   * @param {string} [item.dataType] - the collection's data type
   * @param {string} item.name - the collection name
   * @param {string} item.version - the collection version
   * @see Manager#create
   * @see CollectionConfigStore#put
   * @returns {Promise<Object>} the created record
   */
  async create(item) {
    const { dataType, name, version } = item;
    await this.collectionConfigStore.put(dataType || name, version, item);

    return super.create(item);
  }

  /**
   * Deletes a collection and removes it from the corresponding collection
   * configuration store that was used during {@link #create creation}.
   *
   * @param {Object} params - the collection configuration
   * @param {string} params.name - the collection name
   * @param {string} params.version - the collection version
   * @throws {AssociatedRulesError} if the collection has associated rules
   * @returns {Promise<Object>} the de-serialized data returned from the request
   * @see #create
   * @see Manager#delete
   * @see CollectionConfigStore#delete
   */
  async delete(params = {}) {
    const { name, version } = params;
    const associatedRuleNames = (await this.getAssociatedRules(name, version))
      .map((rule) => rule.name);

    if (associatedRuleNames.length > 0) {
      throw new AssociatedRulesError(
        'Cannot delete a collection that has associated rules',
        associatedRuleNames
      );
    }

    // Since the `create` method uses the collection's `dataType` when calling
    // `CollectionConfigStore.put`, we must also use `dataType` to delete it
    // from the store.  However, we have only the collection's name and version,
    // so we need to retrieve the full collection object in order to retrieve
    // its dataType.
    const { dataType } = await super.get({ name, version });
    await this.collectionConfigStore.delete(dataType || name, version);

    return super.delete({ name, version });
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
          '#v': 'version'
        },
        filter: '#c.#n = :n AND #c.#v = :v',
        values: {
          ':n': name,
          ':v': version
        }
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
    return this.scan(
      {
        names: {
          '#name': 'name',
          '#version': 'version',
          '#reportToEms': 'reportToEms',
          '#createdAt': 'createdAt',
          '#updatedAt': 'updatedAt'
        }
      },
      '#name, #version, #reportToEms, #createdAt, #updatedAt'
    ).then((result) => result.Items);
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
