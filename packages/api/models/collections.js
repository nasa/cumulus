'use strict';

const { S3 } = require('@cumulus/ingest/aws');
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
    item.files.forEach(i => checkRegex(i.regex, i.sampleFileName));
  }

  constructor() {
    super(process.env.CollectionsTable, collectionSchema);
  }

  async create(item) {
    // write the record to S3
    const key = `${process.env.stackName}/collections/${item.name}.json`;
    await S3.put(process.env.internal, key, JSON.stringify(item));

    return super.create(item);
  }
}

module.exports = Collection;
