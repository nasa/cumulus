'use strict';

const Manager = require('./base');
const Collection = require('./collections');
const Granule = require('./granules');
const Pdr = require('./pdrs');
const Provider = require('./providers');
const granuleSchema = require('../lib/schemas').granule;

export class User extends Manager {
  constructor() {
    super(process.env.UsersTable);
  }
}

export class Resource extends Manager {
  constructor() {
    super(process.env.ResourcesTable);
  }
}

export class Distribution extends Manager {
  constructor() {
    super(process.env.DistributionTable);
  }
}

export class DuplicateGranule extends Manager {
  constructor() {
    super(process.env.DuplicateGranulesTable, granuleSchema);
  }

  async ingestCompleted(key, granule) {
    const record = await this.get(key);

    const updatedRecord = {};
    const recordFiles = record.files;

    for (const file of granule.files) {
      for (const fileDefintion of Object.entries(recordFiles)) {
        // get fileName from uri and regex from file definition
        const test = new RegExp(fileDefintion[1].regex);

        // if file belong to the fileDefinition group
        if (file.filename.match(test)) {
          const s3Uri = `s3://${process.env.internal}/staging/${file.filename}`;
          recordFiles[fileDefintion[0]].sipFile = file.url;
          recordFiles[fileDefintion[0]].stagingFile = s3Uri;
        }
      }
    }

    updatedRecord.files = recordFiles;
    updatedRecord.updatedAt = Date.now();
    updatedRecord.ingestEndedAt = Date.now();

    const duration = (
      updatedRecord.ingestEndedAt -
      updatedRecord.ingestStartedAt
    );

    updatedRecord.ingestDuration = duration ? duration / 1000 : 0;
    updatedRecord.status = 'duplicate';

    return this.update(key, updatedRecord);
  }
}

export class Pan extends Manager {
  constructor() {
    super(process.env.PANsTable);
  }

  static buildRecord(pdrName, pdrId, type, message) {
    return {
      pdrName,
      pdrId,
      type,
      message,
      createdAt: Date.now()
    };
  }
}


export {
  Collection,
  Granule,
  Pdr,
  Provider,
  Manager
};
