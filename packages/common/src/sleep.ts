/**
 * Sleep for the given number of milliseconds
 *
 * @param {number} duration - The number of milliseconds to sleep.
 * @returns {Promise} A `Promise` that resolves after the given duration.
 */
export const sleep = (duration: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, duration));
