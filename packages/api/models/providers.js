'use strict';

const Crypto = require('@cumulus/ingest/crypto').DefaultProvider;

const { AssociatedRulesError } = require('../lib/errors');
const Model = require('./modelBase');
const Registry = require('../Registry');
const Rule = require('./rules');

class Provider extends Model {
  /**
   * Creates an instance of Provider
   */
  constructor() {
    super();
    this.removeAdditional = 'all';
  }

  /**
   * Returns rows matching id
   *
   * @param {string} id provider id
   * @returns {Object[]} array of matching providers
   */
  async get(id) {
    const results = this.table()
      .select()
      .where({ id: id });
    return results.map((result) => this.translateItemFromPostgres(result));
  }


  /**
   * Check if a given provider exists
   *
   * @param {string} id - provider id
   * @returns {boolean}
   */
  async exists(id) {
    const result = await this.get(id);
    if (result.length > 0) {
      return true;
    }
    return false;
  }

  /**
   * Get a knex table object for the 'providers' table
   * @returns {Object} knex table object
   */
  table() {
    return Registry.knex()(process.env.ProvidersTable);
  }

  encrypt(value) {
    return Crypto.encrypt(value);
  }

  decrypt(value) {
    return Crypto.decrypt(value);
  }

  async encryptItem(_item) {
    const item = _item;
    if (item.password) {
      item.password = await this.encrypt(item.password);
      item.encrypted = true;
    }

    if (item.username) {
      item.username = await this.encrypt(item.username);
      item.encrypted = true;
    }
    return item;
  }

  /**
   * Updates a provider
   *
   * @param { string } id Provider id to update
   * @param { Object } _item an object with key/value pairs to update
   * @param { keysToDelete[] } keysToDelete array of keys to set to null.
   * @returns { string } id updated Provider id
   **/
  async update(id, _item, keysToDelete = []) {
    const item = _item;

    keysToDelete.forEach((key) => {
      item[key] = null;
    });

    // encrypt the password
    this.encryptItem(item);

    await this.table()
      .where({ id: id })
      .update(this.translateItemToPostgres(item));
    return id;
  }

  /**
   * Insert new row into database.  Alias for 'insert' function.
   *
   * @param {Object} _item provider 'object' representing a row to create
   * @returns {Object} the the full item added with modifications made by the model
   */
  async create(_item) {
    return this.insert(_item);
  }

  /**
   * Insert new row into the database
   *
   * @param {Object} _item provider 'object' representing a row to create
   * @returns {Object} the the full item added with modifications made by the model
   */
  async insert(_item) {
    const item = _item;

    // encrypt the password
    this.encryptItem(item);

    await this.table()
      .insert(this.translateItemToPostgres(item));
    return item;
  }

  /**
   * Delete a provider
   *
   * @param { Object } item  Provider item to delete, uses ID field to identify row to remove.
   */
  async delete(item) {
    const associatedRuleNames = (await this.getAssociatedRules(item.id))
      .map((rule) => rule.name);

    if (associatedRuleNames.length > 0) {
      throw new AssociatedRulesError(
        'Cannot delete a provider that has associated rules',
        associatedRuleNames
      );
    }
    await this.table()
      .where({ id: item.id })
      .del();
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
