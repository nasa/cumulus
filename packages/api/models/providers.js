'use strict';

const cloneDeep = require('lodash.clonedeep');
const Crypto = require('@cumulus/ingest/crypto').DefaultProvider;

const { AssociatedRulesError } = require('../lib/errors');
const Model = require('./modelBase');
const Rule = require('./rules');
const { RecordDoesNotExist } = require('../lib/errors');
const { ProviderSchema } = require('./schemas').provider;

class Provider extends Model {
  /**
   * Creates an instance of Provider
   */
  constructor() {
    super();
    this.tableName = Provider.tableName;
    this.removeAdditional = 'all';
    this.schema = ProviderSchema;
  }

  /**
   * Returns row matching id
   *
   * @param {string} item Provider item
   * @returns {Object} provider object
   */
  async get(item) {
    const result = await this.table()
      .first()
      .where({ id: item.id });

    if (!result) {
      throw new RecordDoesNotExist(`No record found for ${JSON.stringify(item)}`);
    }
    return this.translateItemToCamelCase(result);
  }


  /**
   * Check if a given provider exists
   *
   * @param {string} id - provider id
   * @returns {boolean}
   */
  async exists(id) {
    try {
      await this.get({ id });
      return true;
    }
    catch (error) {
      if (error instanceof RecordDoesNotExist) {
        return false;
      }
      throw error;
    }
  }


  encrypt(value) {
    return Crypto.encrypt(value);
  }


  decrypt(value) {
    return Crypto.decrypt(value);
  }

  async encryptItem(item) {
    const encryptedItem = cloneDeep(item);

    if (encryptedItem.password) {
      encryptedItem.password = await this.encrypt(encryptedItem.password);
      encryptedItem.encrypted = true;
    }

    if (encryptedItem.username) {
      encryptedItem.username = await this.encrypt(encryptedItem.username);
      encryptedItem.encrypted = true;
    }

    return encryptedItem;
  }

  /**
   * Updates a provider
   *
   * @param { Object } keyObject { id: key } object
   * @param { Object } item an object with key/value pairs to update
   * @param { Array<string> } [keysToDelete=[]] array of keys to set to null.
   * @returns { string } id updated Provider id
   **/
  async update(keyObject, item, keysToDelete = []) {
    const updatedItem = cloneDeep(item);

    keysToDelete.forEach((key) => {
      updatedItem[key] = null;
    });

    // encrypt the password
    const encryptedItem = await this.encryptItem(updatedItem);

    await this.table()
      .where({ id: keyObject.id })
      .update(this.translateItemToSnakeCase(encryptedItem));

    return this.get(keyObject);
  }

  /**
   * Insert new row into database.  Alias for 'insert' function.
   *
   * @param {Object} item provider 'object' representing a row to create
   * @returns {Object} the the full item added with modifications made by the model
   */
  create(item) {
    return this.insert(item);
  }

  /**
   * Insert new row into the database
   *
   * @param {Object} item provider 'object' representing a row to create
\   * @returns {Object} the the full item added with modifications made by the model
   */
  async insert(item) {
    const insertItem = cloneDeep(item);

    // encrypt the password
    const encryptedItem = await this.encryptItem(insertItem);

    await this.table()
      .insert(this.translateItemToSnakeCase(encryptedItem));

    return this.get({ id: insertItem.id });
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

Provider.tableName = 'providers';

module.exports = Provider;
