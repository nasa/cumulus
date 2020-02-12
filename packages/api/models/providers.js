'use strict';

const isIp = require('is-ip');
const KMS = require('@cumulus/aws-client/KMS');
const { isNil } = require('@cumulus/common/util');
const { isValidHostname } = require('@cumulus/common/string');

const Manager = require('./base');
const Rule = require('./rules');
const schemas = require('./schemas');
const { AssociatedRulesError } = require('../lib/errors');

const encryptValueWithKMS = (value) =>
  KMS.encrypt(process.env.provider_kms_key_id, value);

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
      schema: schemas.provider
    });

    this.removeAdditional = 'all';
  }

  /**
   * Check if a given provider exists
   *
   * @param {string} id - provider id
   * @returns {boolean}
   */
  exists(id) {
    return super.exists({ id });
  }

  async update(key, item, keysToDelete = []) {
    const record = { ...item };

    if (item.username || item.password) record.encrypted = true;

    if (item.username) {
      record.username = await encryptValueWithKMS(item.username);
    }
    if (item.password) {
      record.password = await encryptValueWithKMS(item.password);
    }

    return super.update(key, record, keysToDelete);
  }

  async create(item) {
    const record = { ...item };

    if (item.username || item.password) record.encrypted = true;

    if (item.username) {
      record.username = await encryptValueWithKMS(item.username);
    }
    if (item.password) {
      record.password = await encryptValueWithKMS(item.password);
    }

    return super.create(record);
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

  async deleteProviders() {
    const providers = await this.scan();
    return Promise.all(providers.Items.map((p) => this.delete({ id: p.id })));
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
