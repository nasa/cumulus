'use strict';

const log = require('@cumulus/common/log');
const Manager = require('./base');
const Provider = require('./providers');
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
    super.recordIsValid(item, schema, 'all');

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

  async delete(item) {
    const collection = await this.get({ collectionName: item.collectionName });
    const response = await super.delete(item);

    // remove the collectionName from the provider table
    const p = new Provider();
    if (collection.providers) {
      for (const provider of collection.providers) {
        try {
          await p.removeRegex(provider, item.collectionName);
        }
        catch (e) {
          log.error(e);
        }
      }
    }
    return response;
  }
}

module.exports = Collection;
