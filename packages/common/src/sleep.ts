/**
 * Sleep for the given number of milliseconds
 */
export const sleep = (duration: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, duration));
