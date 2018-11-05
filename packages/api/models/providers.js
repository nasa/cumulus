'use strict';

const Crypto = require('@cumulus/ingest/crypto').DefaultProvider;
const Manager = require('./base');
const providerSchema = require('./schemas').provider;
const Rule = require('./rules');

class Provider extends Manager {
  constructor() {
    super({
      tableName: process.env.ProvidersTable,
      tableHash: { name: 'id', type: 'S' },
      schema: providerSchema
    });

    this.removeAdditional = 'all';
  }

  /**
   * Check if a given provider exists
   *
   * @param {string} id - provider id
   * @returns {boolean}
   */
  async exists(id) {
    return super.exists({ id });
  }

  encrypt(value) {
    return Crypto.encrypt(value);
  }

  decrypt(value) {
    return Crypto.decrypt(value);
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

  /**
   * Delete a provider
   *
   * @param {string} id - the provider id
   */
  async delete(id) {
    if (!(await this.exists(id))) throw new Error('Provider does not exist');

    if (await this.hasAssociatedRules(id)) {
      throw new Error('Cannot delete a provider that has associated rules');
    }

    await super.delete({ id });
  }

  /**
   * Test if there are any rules associated with the provider
   *
   * @param {string} id - the provider id
   * @returns {Promise<boolean>}
   */
  async hasAssociatedRules(id) {
    const ruleModel = new Rule();
    const rules = (await ruleModel.scan()).Items;
    const associatedRules = rules.filter((r) => r.provider === id);

    return associatedRules.length > 0;
  }
}

module.exports = Provider;
