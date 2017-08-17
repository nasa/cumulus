'use strict';

/* eslint-disable no-console */

/**
 * Creates an empty mutable cache.
 */
const createCache = () => ({});

/**
 * Looks up the given key in the cache and returns the cached value. If there is a cache miss the
 * lookup function is used to find the value. The returned value is then cached.
 *
 * Assumes values returned by lookupFn are safely cachable such as immutable objects. A value
 * returned by lookupFn can be a Promise that resolves to a value. The resolved value will be
 * cached.
 */
const cacheLookup = async (cacheName, cache, key, lookupFn) => {
  console.log(`MTH-DEBUG [${cacheName} - ${key}]: ${cache}`);

  const cachedValue = cache[key];
  let result;
  if (cachedValue === null || cachedValue === undefined) {
    console.info(`Cache miss on ${cacheName}(${key})`);
    const valueToCache = lookupFn(key);
    console.log(`MTH-DEBUG [${cacheName} - ${key}] valueToCache=${valueToCache}`);
    if (valueToCache.then) {
      console.log(`MTH-DEBUG [${cacheName} - ${key}] Found a promise, waiting`);
      result = await valueToCache;
      console.log(`MTH-DEBUG [${cacheName} - ${key}] awaited valueToCache=${result}`);
    }
    else {
      result = valueToCache;
    }
    // eslint-disable-next-line no-param-reassign
    cache[key] = valueToCache;
  }
  else {
    console.info(`Cache hit on ${cacheName}(${key})`);
    console.log(`MTH-DEBUG [${cacheName} - ${key}] cachedValue=${cachedValue}`);
    result = cachedValue;
  }
  return result;
};

/**
 * Memoizes the given function which should take one argument that is a string key. Assumes that the
 * function returns values that are safe to cache and share.
 */
const memoize = (cacheName, f) => {
  const cache = createCache();
  return lookupId => cacheLookup(cacheName, cache, lookupId, f);
};

module.exports = {
  createCache,
  cacheLookup,
  memoize
};
