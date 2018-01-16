'use strict';

const Crypto = require('@cumulus/ingest/crypto').DefaultProvider;
const Manager = require('./base');
const providerSchema = require('./schemas').provider;

class Provider extends Manager {
  constructor() {
    super(process.env.ProvidersTable, providerSchema);
    this.removeAdditional = 'all';
  }

  async encrypt(value) {
    return await Crypto.encrypt(value);
  }

  async decrypt(value) {
    return await Crypto.decrypt(value);
  }

  async update(key, _item, keysToDelete = []) {
    const item = _item;
    // encrypt the password
    if (item.password) {
      item.password = await this.encrypt(item.password);
      item.encrypted = true;
    }

    if (item.username) {
      item.username = await this.encrypt(item.username);
      item.encrypted = true;
    }


    return super.update(key, item, keysToDelete);
  }

  async create(_item) {
    const item = _item;

    // encrypt the password
    if (item.password) {
      item.password = await this.encrypt(item.password);
      item.encrypted = true;
    }

    if (item.username) {
      item.username = await this.encrypt(item.username);
      item.encrypted = true;
    }

    return super.create(item);
  }
}

module.exports = Provider;
