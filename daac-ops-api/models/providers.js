'use strict';

const Manager = require('./base');
const { KMS } = require('@cumulus/ingest/aws');
const providerSchema = require('./schemas').provider;

class Provider extends Manager {
  constructor() {
    super(process.env.ProvidersTable, providerSchema);
    this.removeAdditional = 'all';
  }

  async encryptPassword(password) {
    const kmsId = process.env.KMS_ID;
    return KMS.encrypt(password, kmsId);
  }

  async decryptPassword(password) {
    return KMS.decrypt(password);
  }

  async update(key, _item, keysToDelete = []) {
    const item = _item;
    // encrypt the password
    if (item.password) {
      item.password = await this.encryptPassword(item.password);
    }

    return super.update(key, item, keysToDelete);
  }

  async create(_item) {
    const item = _item;
    // encrypt the password
    if (item.password) {
      item.password = await this.encryptPassword(item.password);
    }

    return super.create(item);
  }
}

module.exports = Provider;
