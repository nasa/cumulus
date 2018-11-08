'use strict';

const { CollectionConfigStore } = require('@cumulus/common');
const Manager = require('./base');
const collectionSchema = require('./schemas').collection;
const Rule = require('./rules');

function checkRegex(regex, sampleFileName) {
  const validation = new RegExp(regex);
  const match = validation.test(sampleFileName);

  if (!match) throw new Error(`regex cannot validate ${sampleFileName}`);
}

class Collection extends Manager {
  static recordIsValid(_item, schema = null) {
    const item = _item;
    super.recordIsValid(item, schema);

    // make sure regexes are correct
    // first test granuleId extraction and validation regex
    const extraction = new RegExp(item.granuleIdExtraction);
    const match = item.sampleFileName.match(extraction);

    if (!match) throw new Error('granuleIdExtraction regex returns null when applied to sampleFileName');

    checkRegex(item.granuleId, match[1]);

    // then check all the files
    item.files.forEach((i) => checkRegex(i.regex, i.sampleFileName));
  }

  constructor() {
    super({
      tableName: process.env.CollectionsTable,
      tableHash: { name: 'name', type: 'S' },
      tableRange: { name: 'version', type: 'S' },
      schema: collectionSchema
    });
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

  async create(item) {
    const collectionConfigStore = new CollectionConfigStore(
      process.env.internal,
      process.env.stackName
    );

    let dataType = item.dataType;
    if (!dataType) {
      dataType = item.name;
    }

    await collectionConfigStore.put(dataType, item.version, item);

    return super.create(item);
  }

  /**
   * Delete a collection
   *
   * @param {string} name - the collection name
   * @param {string} version - the collection version
   */
  async delete(name, version) {
    if (!(await this.exists(name, version))) throw new Error('Collection does not exist');

    if (await this.hasAssociatedRules(name, version)) {
      throw new Error('Cannot delete a collection that has associated rules');
    }

    await super.delete({ name, version });
  }

  /**
   * Test if there are any rules associated with the collection
   *
   * @param {string} name - collection name
   * @param {string} version - collection version
   * @returns {Promise<boolean>}
   */
  async hasAssociatedRules(name, version) {
    const ruleModel = new Rule();
    const rules = (await ruleModel.scan()).Items;
    const associatedRules = rules.filter(
      (r) =>
        r.collection.name === name
        && r.collection.version === version
    );

    return associatedRules.length > 0;
  }
}

module.exports = Collection;
