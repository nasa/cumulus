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
   * Changes camel cased names to snakecase column names
   *
   * @param {string} columnName column name to translate
   * @returns {string} updated column name
   */
  translateCamelCaseColumnName(columnName) {
    // change js camel case to all lower/seperated with "_"
    return columnName.replace(/([A-Z])/g, (v) => `_${v.toLowerCase()}`).replace(/^_/, '');
  }

  /**
   * Changes snakecase column names to camel cased names
   *
   * @param {string} columnName column name to translate
   * @returns {string} updated column name
   */
  translateSnakeCaseColumnName(columnName) {
    return columnName.replace(/_+([a-z])/g, (_, match) => match.toUpperCase());
  }


  /**
   * Translates database object keys (columms) from camel-case to downcase/underscore seperated
   * column/Object names
   * @param {Object} item database object
   * @returns { Object } Provider database object with keys translated
   */
  translateItemToSnakeCase(item) {
    const translatedItem = {};
    Object.keys(item).forEach((key) => {
      translatedItem[this.translateCamelCaseColumnName(key)] = item[key];
    });
    return translatedItem;
  }

  /**
   * Translates database object keys (columns) from downcase/underscore seperated
   * column/Object names to camelCase.
   * @param { Object } item database object
   * @returns { Object }  database object with keys translated
   */
  translateItemToCamelCase(item) {
    const translatedItem = {};
    Object.keys(item).forEach((key) => {
      translatedItem[this.translateSnakeCaseColumnName(key)] = item[key];
    });
    return translatedItem;
  }
}

module.exports = Model;
