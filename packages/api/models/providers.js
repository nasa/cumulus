'use strict';

const isIp = require('is-ip');
const { DefaultProvider } = require('@cumulus/common/key-pair-provider');
const { isNil } = require('@cumulus/common/util');
const { isValidHostname } = require('@cumulus/common/string');

const Manager = require('./base');
const providerSchema = require('./schemas').provider;
const Rule = require('./rules');
const { AssociatedRulesError } = require('../lib/errors');

const buildValidationError = ({ detail }) => {
  const err = new Error('The record has validation errors');
  err.name = 'ValidationError';
  err.detail = detail;

  return err;
};

const validateHost = (host) => {
  if (isNil(host)) return;
  if (isValidHostname(host)) return;
  if (isIp(host)) return;

  throw buildValidationError({
    detail: `${host} is not a valid hostname or IP address`
  });
};

class Provider extends Manager {
  static recordIsValid(item, schema = null) {
    super.recordIsValid(item, schema);

    validateHost(item.host);
  }

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
    return DefaultProvider.encrypt(value);
  }

  decrypt(value) {
    return DefaultProvider.decrypt(value);
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
  async delete({ id }) {
    const associatedRuleNames = (await this.getAssociatedRules(id))
      .map((rule) => rule.name);

    if (associatedRuleNames.length > 0) {
      throw new AssociatedRulesError(
        'Cannot delete a provider that has associated rules',
        associatedRuleNames
      );
    }

    await super.delete({ id });
  }

  /**
   * Get any rules associated with the provider
   *
   * @param {string} id - the provider id
   * @returns {Promise<boolean>}
   */
  async getAssociatedRules(id) {
    const ruleModel = new Rule();

    const scanResult = await ruleModel.scan({
      filter: 'provider = :provider',
      values: { ':provider': id }
    });

    return scanResult.Items;
  }
}

module.exports = Provider;
