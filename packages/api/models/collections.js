'use strict';

const { CollectionConfigStore } = require('@cumulus/common/collection-config-store');
const { publishSnsMessage } = require('@cumulus/aws-client/SNS');
const log = require('@cumulus/common/log');
const Manager = require('./base');
const { collection: collectionSchema } = require('./schemas');
const Rule = require('./rules');
const { AssociatedRulesError, BadRequestError } = require('../lib/errors');

function checkRegex(regex, sampleFileName) {
  const validation = new RegExp(regex);
  const match = validation.test(sampleFileName);

  if (!match) throw new BadRequestError(`regex ${regex} cannot validate ${sampleFileName}`);
}

/**
 * Publish SNS message for Collection reporting.
 *
 * @param {Object} collectionRecord - A Collection record with event type
 * @returns {Promise<undefined>}
 */
async function publishCollectionSnsMessage(collectionRecord) {
  try {
    const collectionSnsTopicArn = process.env.collection_sns_topic_arn;
    await publishSnsMessage(collectionSnsTopicArn, collectionRecord);
  } catch (err) {
    log.warn(
      `Failed to create record for collection ${collectionRecord.record.name} ${collectionRecord.record.version}: ${err.message}`,
      'Cause: ', err,
      'Collection record: ', collectionRecord
    );
  }
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
   * Returns `true` if the collection with the specified name and version
   * exists; `false` otherwise.
   *
   * @param {string} name - collection name
   * @param {string} version - collection version
   * @returns {boolean} `true` if the collection with the specified name and
   *    version exists; `false` otherwise
   */
  async exists(name, version) {
    return super.exists({ name, version });
  }

  /**
   * Creates the specified collection and puts it into the collection
   * configuration store that was specified during this model's construction.
   * Uses the specified item's `dataType` (if specified, otherwise, it's `name`)
   * and `version` as the key for putting the item in the config store.
   *
   * @param {Object} item - the collection configuration
   * @param {string} [item.dataType] - the collection's data type
   * @param {string} item.name - the collection name
   * @param {string} item.version - the collection version
   * @returns {Promise<Object>} the created record
   * @see #constructor
   * @see Manager#create
   * @see CollectionConfigStore#put
   */
  async create(item) {
    const { dataType, name, version } = item;
    await this.collectionConfigStore.put(dataType || name, version, item);

    const collectionRecord = await super.create(item);
    if (!process.env.noSNS) {
      const publishRecord = {
        event: 'Create',
        record: collectionRecord
      };
      await publishCollectionSnsMessage(publishRecord);
    }

    return collectionRecord;
  }

  /**
   * Deletes the specified collection and removes it from the corresponding
   * collection configuration store that was specified during this model's
   * construction, where it was stored upon {@link #create creation}, unless
   * the collection has associated rules.
   *
   * @param {Object} item - collection parameters
   * @param {string} [item.dataType] - the collection data type; if not
   *    specified, the collection is retrieved in order to determine its data
   *    type, and if there is no data type, the name is used instead when
   *    deleting the collection from the collection store
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

    // Since the `create` method uses the collection's `dataType` when calling
    // `CollectionConfigStore.put`, we must also use `dataType` to delete it
    // from the store.  However, we may only have the collection's name and
    // version, so in that case we need to retrieve the full collection object
    // in order to retrieve its `dataType`.  If the item does not exist, then
    // fall back to using the specified name.
    const { dataType } = item.dataType
      ? item : await this.get(item).catch(() => item);
    await this.collectionConfigStore.delete(dataType || name, version);

    if (!process.env.noSNS) {
      const record = {
        event: 'Delete',
        deletedAt: Date.now(),
        record: {
          name,
          version
        }
      };
      await publishCollectionSnsMessage(record);
    }

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
