'use strict';

const { CollectionConfigStore } = require('@cumulus/common');
const Manager = require('./base');
const collectionSchema = require('./schemas').collection;

function checkRegex(regex, sampleFileName) {
  const validation = new RegExp(regex);
  const match = validation.test(sampleFileName);

  if (!match) {
    const err = {
      message: `regex cannot validate ${sampleFileName}`
    };
    throw err;
  }
}

class Collection extends Manager {
  static recordIsValid(_item, schema = null) {
    const item = _item;
    super.recordIsValid(item, schema);

    // make sure regexes are correct
    // first test granuleId extraction and validation regex
    const extraction = new RegExp(item.granuleIdExtraction);
    const match = item.sampleFileName.match(extraction);

    if (!match) {
      const err = {
        message: 'granuleIdExtraction regex returns null when applied to sampleFileName'
      };
      throw err;
    }

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
}

module.exports = Collection;
