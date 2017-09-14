'use strict';

const Crypto = require('@cumulus/ingest/crypto').DefaultProvider;
const Manager = require('./base');
const providerSchema = require('./schemas').provider;

class Provider extends Manager {
  constructor() {
    super(process.env.ProvidersTable, providerSchema);
    this.removeAdditional = 'all';
  }

  async encryptPassword(password) {
    return await Crypto.encrypt(password);
  }

  async decryptPassword(password) {
    return await Crypto.decrypt(password);
  }

  async update(key, _item, keysToDelete = []) {
    const item = _item;
    // encrypt the password
    if (item.password) {
      item.password = await this.encryptPassword(item.password);
      item.encrypted = true;
    }

    return super.update(key, item, keysToDelete);
  }

  async create(_item) {
    const item = _item;

    // encrypt the password
    if (item.password) {
      item.password = await this.encryptPassword(item.password);
      item.encrypted = true;
    }

    return super.create(item);
  }
}

module.exports = Provider;
