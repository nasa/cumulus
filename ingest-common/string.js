
/**
 * Given a character, replaces the JS unicode-escape sequence for the character
 * @param{char} char - The character to escape
 * @return{string} - The unicode escape sequence for char
 */
const unicodeEscapeCharacter = (char) =>
  ['\\u', `0000${char.charCodeAt().toString(16)}`.slice(-4)].join('');

module.exports = {
  /**
   * Given a string, replaces all characters matching the passed regex with their unicode
   * escape sequences
   *
   * @param{string} str - The string to escape
   * @param{string} regex - The regex matching characters to replace (default: all chars)
   * @return{string} - The string with characters unicode-escaped
   */
  unicodeEscape: (str, regex = /[\s\S]/g) => str.replace(regex, unicodeEscapeCharacter)
};
