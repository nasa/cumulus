/**
 * Simple utility functions
 *
 * @module util
 */

// eslint-disable-next-line lodash/import-scope
import type {
  PropertyName,
  PartialObject,
  ValueKeyIteratee,
  NumericDictionary,
  Dictionary,
} from 'lodash';
import isPlainObject from 'lodash/isplainobject';
import curry from 'lodash/curry';
import isNil from 'lodash/isNil';
import omitBy from 'lodash/omitBy';
import * as log from './log';

/**
 * Mark a piece of code as deprecated.
 *
 * Each deprecation notice for a given name and version combination will
 * only be printed once.
 *
 * @param {string} name - the name of the function / method / class to deprecate
 * @param {string} version - the version after which the code will be marked
 *   as deprecated
 * @param {string} [alternative] - the function / method / class to use instead
 *   of this deprecated code
 *
 * @alias module:util
 */
export const deprecate = (() => {
  const warned = new Set();

  return (name: string, version: string, alternative?: string) => {
    const key = `${name}-${version}`;
    if (warned.has(key)) return;

    warned.add(key);
    let message = `${name} is deprecated after version ${version} and will be removed in a future release.`;
    if (alternative) message += ` Use ${alternative} instead.`;
    log.warn(message);
  };
})();

/**
 * Remove properties whose values are `null` or `undefined`
 *
 * @param {Object} obj - object to update
 * @returns {Object} a shallow clone of the object with `null` and `undefined`
 *   properties removed
 *
 * @alias module:util
 */

export const removeNilProperties = <T extends object>(obj: T) =>
  omitBy(obj, isNil) as { [P in keyof T]: Exclude<T[P], null> };
/**
 * Test if a value is included in a list of items
 *
 * This is a curried function - https://lodash.com/docs/4.17.11#curry
 *
 * @param {Array} collection - the list of items to check against
 * @param {Object} val - the item to check for in the collection
 * @returns {boolean}
 *
 * @alias module:util
 * @kind function
 */
export const isOneOf = curry(
  (collection: unknown[], val: unknown) => collection.includes(val),
  2
);

export const returnNullOrUndefinedOrDate = (
  dateVal: string | number | null | undefined
) => (isNil(dateVal) ? dateVal : new Date(dateVal));

interface OmitDeepBy {
  <T>(object: Dictionary<T> | null | undefined, predicate?: ValueKeyIteratee<T>): Dictionary<T>;
  <T>(
    object: NumericDictionary<T> | null | undefined,
    predicate?: ValueKeyIteratee<T>
  ): NumericDictionary<T>;
  <T extends object>(
    object: T | null | undefined,
    predicate: ValueKeyIteratee<T[keyof T]>
  ): PartialObject<T>;
}

export const omitDeepBy: OmitDeepBy = (object: any, cb: any) => {
  function omitByDeepByOnOwnProps(obj: any) {
    if (!Array.isArray(obj) && !isPlainObject(obj)) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((element) => omitDeepBy(element, cb));
    }

    const temp = {};
    for (const [key, value] of Object.entries<{
      [x: string]: PropertyName | object;
    }>(obj)) {
      (temp as any)[key] = omitDeepBy(value, cb);
    }
    return omitBy(temp, cb);
  }

  return omitByDeepByOnOwnProps(object);
};
