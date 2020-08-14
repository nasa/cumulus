'use strict';

const PVLRoot = require('./lib/models').PVLRoot;
const PVLObject = require('./lib/models').PVLObject;
const PVLGroup = require('./lib/models').PVLGroup;
const PVLNumeric = require('./lib/models').PVLNumeric;
const PVLDateTime = require('./lib/models').PVLDateTime;
const PVLTextString = require('./lib/models').PVLTextString;
const patterns = require('./lib/patterns');
const checkRegexes = require('./lib/utils').checkRegexes;

function parseValue(value, key) {
  const numericValue = checkRegexes(value, patterns.numericPatterns);
  if (numericValue !== null) return new PVLNumeric(numericValue);

  const dateTimeValue = checkRegexes(value, patterns.dateTimePatterns);
  if (dateTimeValue !== null) return new PVLDateTime(dateTimeValue);

  const textStringValue = checkRegexes(value, patterns.textStringPatterns);
  if (textStringValue !== null) return new PVLTextString(textStringValue);

  throw new Error(`Failed to parse value ('${value}') of ${key}`);
}

function pvlToJS(pvlString) {
  const result = new PVLRoot();
  // Keep track of which aggregate is "active" in the stack,
  // as far as assigning further attributes and aggregates
  const aggregates = [result];

  // Split into statements
  // Currently assumes single-line statements, not allowing multi-line values
  const pvlStatements = pvlString
    .split('\n')
    .map((s) => s.trim())
    // Strip statement-ending semicolons
    .map((s) => s.replace(/;$/, ''))
    // Ignore blank lines
    .filter((s) => s !== '')
    // Ignore full-line comments
    .filter((s) => !(s.startsWith('/*') && s.endsWith('*/')));

  let keyAndValue;
  let key;
  let aggregate;
  let s = pvlStatements.shift();
  while (s !== undefined && s !== 'END') {
    keyAndValue = s.split(/ = /);
    key = keyAndValue[0].trim();
    // Need to account for string-embedded `=`s
    let value = keyAndValue.slice(1).join(' = ').trim();

    if (['BEGIN_GROUP', 'GROUP', 'BEGIN_OBJECT', 'OBJECT'].includes(key)) {
      // Group names _can_ be wrapped in quotes
      value = value.replace(/["']/g, '');
      aggregate = key.includes('GROUP') ? new PVLGroup(value) : new PVLObject(value);
      aggregates[aggregates.length - 1].addAggregate(aggregate);
      aggregates.push(aggregate);
    } else if (['END_OBJECT', 'END_GROUP'].includes(key)) {
      aggregates.pop();
    } else {
      aggregates[aggregates.length - 1].add(key, parseValue(value, key));
    }

    s = pvlStatements.shift();
  }

  return result;
}

function jsToPVL(pvlObject) {
  const stringified = pvlObject.toPVL();
  const INDENTATION_WIDTH = 2;

  // Spec doesn't require indentation, but does highly recommended it
  let depth = 0;
  const indented = stringified.split('\n').map((s) => {
    if (s.match(/^END_(GROUP|OBJECT)( = .+)?$/)) {
      depth -= 1;
    }
    const thisLine = `${' '.repeat(depth * INDENTATION_WIDTH)}${s}`;
    if (s.match(/^(BEGIN_)?(GROUP|OBJECT) = .+$/)) {
      depth += 1;
    }
    return thisLine;
  }).join('\n');

  return indented;
}

module.exports = {
  pvlToJS: pvlToJS,
  jsToPVL: jsToPVL,
  parseValue: parseValue,
  models: {
    PVLRoot: PVLRoot,
    PVLObject: PVLObject,
    PVLGroup: PVLGroup,
    PVLNumeric: PVLNumeric,
    PVLDateTime: PVLDateTime,
    PVLTextString: PVLTextString,
  },
};
