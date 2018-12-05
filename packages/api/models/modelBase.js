'use strict';

class Model {
  recordIsValid() {
    throw new Error('Deprecated');
  }

  createTable() {
    throw new Error('Deprecated');
  }

  deleteTable() {
    throw new Error('Deprecated');
  }

  enableStream() {
    throw new Error('Deprecated');
  }

  /**
   * Changes camel cased names to downcase-underscore seperated column names
   *
   * @param {string} columnName column name to translate
   * @returns {string} updated column name
   */
  translateDynamoColumnName(columnName) {
    // change js camel case to all lower/seperated with "_"
    return columnName.replace(/([A-Z])/g, (v) => `_${v.toLowerCase()}`).replace(/^_/, '');
  }

  /**
   * Changes downcase-underscore seperated column names to camel cased names
   *
   * @param {string} columnName column name to translate
   * @returns {string} updated column name
   */
  translatePostgresColumnName(columnName) {
    return columnName.replace(/_([a-z])/g, (_, upChar) => upChar.toUpperCase());
  }


  /**
   * Translates database object keys (columms) from camel-case to downcase/underscore seperated
   * column/Object names
   * @param {Object} item database object
   * @returns { Object } Provider database object with keys translated
   */
  translateItemToPostgres(item) {
    const translatedItem = {};
    Object.keys(item).forEach((key) => {
      translatedItem[this.translateDynamoColumnName(key)] = item[key];
    });
    return translatedItem;
  }

  /**
   * Translates database object keys (columns) from downcase/underscore seperated
   * column/Object names to camelCase.
   * @param { Object } item database object
   * @returns { Object }  database object with keys translated
   */
  translateItemFromPostgres(item) {
    const translatedItem = {};
    Object.keys(item).forEach((key) => {
      translatedItem[this.translatePostgresColumnName(key)] = item[key];
    });
    return translatedItem;
  }
}

module.exports = Model;
