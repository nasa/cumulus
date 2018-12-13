'use strict';

const Ajv = require('ajv');
const Registry = require('../lib/Registry');
const camelCase = require('lodash.camelcase');
const { deprecate } = require('@cumulus/common/util');
const mapKeys = require('lodash.mapkeys');
const snakeCase = require('lodash.snakecase');
const { RecordDoesNotExist } = require('../lib/errors');

class Model {
  static recordIsValid(item, schema = null, removeAdditional = false) {
    if (schema) {
      const ajv = new Ajv({
        useDefaults: true,
        v5: true,
        removeAdditional: removeAdditional
      });
      const validate = ajv.compile(schema);
      const valid = validate(item);
      if (!valid) {
        const err = new Error('The record has validation errors');
        err.name = 'SchemaValidationError';
        err.detail = validate.errors;
        throw err;
      }
    }
  }

  // Void function to prevent upstream tests from failing when they attempt to
  // clean up
  async createTable() {} // eslint-disable-line no-empty-function

  async deleteTable() {} // eslint-disable-line no-empty-function

  /**
   * Insert new row into database.  Alias for 'insert' function.
   *
   * @param {Object} item mapper 'object' representing a row to create
   * @returns {Object} the the full item added with modifications made by the 'model'
   */
  create(item) {
    return this.insert(item);
  }

  /**
   * Check if an object exists.  Uses 'model' get method,
   * searches on primary key.
   *
   * @param {string} id - provider id
   * @returns {boolean}
   */
  async exists(primaryKeySearchObject) {
    try {
      await this.get(primaryKeySearchObject);
      return true;
    }
    catch (error) {
      if (error instanceof RecordDoesNotExist) {
        return false;
      }
      throw error;
    }
  }

  scan() {
    // TODO: This deprecation is going to be resolved when we take on
    // the functionality es.indexer is currently sorting.
    // Prior to RDS migration most table searching is done
    // via elasitcSearch
    throw new Error('Deprecated');
  }

  enableStream() {
    throw new Error('Deprecated');
  }

  batchGet() {
    throw new Error('Deprecated');
  }

  batchWrite() {
    throw new Error('Deprecated');
  }


  /**
   * Get a knex table object for the 'providers' table
   * @returns {Object} knex table object
   */
  table() {
    return Registry.knex()(this.tableName);
  }

  /**
   * Translates database object keys (columms) from camel-case to downcase/underscore seperated
   * column/Object names
   * @param {Object} item database object
   * @returns { Object } Provider database object with keys translated
   */
  translateItemToSnakeCase(item) {
    return mapKeys(item, (_value, key) => snakeCase(key));
  }

  /**
   * Translates database object keys (columns) from downcase/underscore seperated
   * column/Object names to camelCase.
   * @param { Object } item database object
   * @returns { Object }  database object with keys translated
   */
  translateItemToCamelCase(item) {
    return mapKeys(item, (value, key) => camelCase(key));
  }
}

module.exports = Model;
