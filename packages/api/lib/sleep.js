/**
 * @param {number} duration - sleep duration in milliseconds
 * @returns {Promise<void>}
 */
const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

module.exports = {
  sleep,
};
