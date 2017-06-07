'use strict';

// TODO test the cache

/**
 * TODO
 */
const createCache = () => ({});

/**
 * TODO
 * Add info about assumptions of data that's safe to cache
 */
const cacheLookup = async (cache, name, lookupFn) => {
  const cachedValue = cache[name];
  let result;
  if (cachedValue === null || cachedValue === undefined) {
    console.info(`Cache miss on ${name}`);
    const valueToCache = lookupFn(name);
    if (valueToCache.then) {
      result = await valueToCache;
    }
    else {
      result = valueToCache;
    }
    // eslint-disable-next-line no-param-reassign
    cache[name] = valueToCache;
  }
  else {
    console.info(`Cache hit on ${name}`);
    result = cachedValue;
  }
  return result;
};

/**
 * TODO
 */
const memoize = (f) => {
  const cache = createCache();
  return lookupId => cacheLookup(cache, lookupId, f);
};

module.exports = {
  createCache,
  cacheLookup,
  memoize
};
