
/**
 * Given a character, replaces the JS unicode-escape sequence for the character
 * @param{char} char - The character to escape
 * @return{string} - The unicode escape sequence for char
 */
const unicodeEscapeCharacter = (char) =>
  ['\\u', `0000${char.charCodeAt().toString(16)}`.slice(-4)].join('');

// https://gist.github.com/jed/982883
// eslint-disable-next-line
function uuid(a){return a?(a^Math.random()*16>>a/4).toString(16):([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,uuid)}

module.exports = {
  /**
   * Given a string, replaces all characters matching the passed regex with their unicode
   * escape sequences
   *
   * @param{string} str - The string to escape
   * @param{string} regex - The regex matching characters to replace (default: all chars)
   * @return{string} - The string with characters unicode-escaped
   */
  unicodeEscape: (str, regex = /[\s\S]/g) => str.replace(regex, unicodeEscapeCharacter),
  uuid: uuid
};
