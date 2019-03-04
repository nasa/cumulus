'use strict';

const isArray = require('lodash.isarray');
const isBoolean = require('lodash.isboolean');
const isEmpty = require('lodash.isempty');
const isNumber = require('lodash.isnumber');
const isObject = require('lodash.isobject');
const isString = require('lodash.isstring');
const mapValues = require('lodash.mapvalues');
const allPass = require('lodash.overevery');
const overSome = require('lodash.oversome');
const {
  all,
  isUndefined,
  isNil,
  isNull,
  negate,
  omitBy
} = require('@cumulus/common/util');

const isNotEmpty = negate(isEmpty);
const isNonEmptyArray = allPass([isArray, isNotEmpty]);
const isArrayOfNumbers = allPass([isNonEmptyArray, all(isNumber)]);
const isArrayOfStrings = allPass([isNonEmptyArray, all(isString)]);
const isEmptyString = allPass([isString, isEmpty]);
const isUndefinedOrEmptyString = overSome([isUndefined, isEmptyString]);

const filterOutInvalidValues = omitBy(isUndefinedOrEmptyString);

const numberToString = (x) => (x).toString();

/**
 * Convert a JavaScript value to a value compatible with DynamoDB's item format
 *
 * Docs: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#batchWriteItem-property
 *
 * @param {*} val - the value to be converted to DynamoDB's item format
 * @returns {Object} the DynamoDB item-formatted value
 */
const toDynamoItemFormat = (val) => {
  if (isArrayOfNumbers(val)) return { NS: val.map(numberToString) };
  if (isArrayOfStrings(val)) return { SS: val };
  if (isArray(val)) return { L: val.map(toDynamoItemFormat) };
  if (isBoolean(val)) return { BOOL: val };
  if (isNull(val)) return { NULL: true };
  if (isNumber(val)) return { N: numberToString(val) };
  if (isString(val)) return { S: val };
  if (isObject(val)) return { M: mapValues(filterOutInvalidValues(val), toDynamoItemFormat) };

  throw new TypeError(`Unable to convert "${JSON.stringify(val)}" to a DynamoDB item`);
};
exports.toDynamoItemFormat = toDynamoItemFormat;

/**
 * Convert a JavaScript object to a DynamoDB Item
 *
 * Note: DynamoDB Items do not support undefined values or empty strings, so
 * those are removed.
 *
 * Docs: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/DynamoDB.html#batchWriteItem-property
 *
 * @param {Object} record - the object to convert
 * @returns {Object} a DynamoDB Item
 */
exports.recordToDynamoItem = (record) => {
  if (isNil(record)) return record;

  return mapValues(
    filterOutInvalidValues(record),
    toDynamoItemFormat
  );
};
