
/**
 * Given a character, replaces the JS unicode-escape sequence for the character
 *
 * @param {char} char - The character to escape
 * @returns {string} - The unicode escape sequence for char
 */
const unicodeEscapeCharacter = (char) =>
  ['\\u', `0000${char.charCodeAt().toString(16)}`.slice(-4)].join('');

/**
   * Given a string, replaces all characters matching the passed regex with their unicode
   * escape sequences
   *
   * @param {string} str - The string to escape
   * @param {string} regex - The regex matching characters to replace (default: all chars)
   * @returns {string} - The string with characters unicode-escaped
   */
const unicodeEscape = (str, regex = /[\s\S]/g) => str.replace(regex, unicodeEscapeCharacter);

/**
 * Globally replaces oldSubstring in string with newSubString
 *
 * @param {string} string - The string to modify
 * @param {string} oldSubString - The string to replace
 * @param {string} newSubString - The string replacement
 * @returns {string} the modified string
 */
function globalReplace(string, oldSubString, newSubString) {
  return string.replace(new RegExp(oldSubString, 'g'), newSubString);
}

/**
 * Changes camel cased names to snakecase column names
 *
 * @param {string} string column name to translate
 * @returns {string} updated column name
 */
function translateCamelCaseColumnName(string) {
  // change js camel case to all lower/seperated with "_"
  return string.replace(/([A-Z])/g, (v) => `_${v.toLowerCase()}`).replace(/^_/, '');
}

/**
 * Changes snakecase column names to camel cased names
 *
 * @param {string} string column name to translate
 * @returns {string} updated column name
 */
function translateSnakeCaseColumnName(string) {
  return string.replace(/_+([a-z])/g, (_, match) => match.toUpperCase());
}

module.exports = {
  globalReplace,
  translateCamelCaseColumnName,
  translateSnakeCaseColumnName,
  unicodeEscape
};
