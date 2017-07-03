'use strict';
/**
 * Conversions to and from Step Function execution names
 */
const expect = require('expect.js');
const { toSfnExecutionName, fromSfnExecutionName } = require('../aws');

describe('toSfnExecutionName', () => {
  it('truncates names to 80 characters', () => {
    expect(toSfnExecutionName([
      '123456789_123456789_123456789_123456789_',
      '123456789_123456789_123456789_123456789_'
    ], ''))
      .to.be('123456789_123456789_123456789_123456789_' +
             '123456789_123456789_123456789_123456789_');
  });

  it('joins fields by the given delimiter', () => {
    expect(toSfnExecutionName(['a', 'b', 'c'], '-'))
      .to.be('a-b-c');
  });

  it('escapes occurrences of the delimiter in fields', () => {
    expect(toSfnExecutionName(['a', 'b-c', 'd'], '-'))
      .to.be('a-b!u002dc-d');
  });

  it('escapes unsafe characters with unicode-like escape codes', () => {
    expect(toSfnExecutionName(['a', 'b$c', 'd'], '-'))
      .to.be('a-b!u0024c-d');
  });

  it('escapes exclammation points (used for escape codes)', () => {
    expect(toSfnExecutionName(['a', 'b!c', 'd'], '-'))
      .to.be('a-b!u0021c-d');
  });

  it('does not escape safe characters', () => {
    expect(toSfnExecutionName(['a', 'b.+-_=', 'c'], 'z'))
      .to.be('azb.+-_=zc');
  });
});

describe('fromSfnExecutionName', () => {
  it('returns fields separated by the given delimiter', () => {
    expect(fromSfnExecutionName('a-b-c', '-'))
      .to.eql(['a', 'b', 'c']);
  });

  it('interprets bang-escaped unicode in the input string', () => {
    expect(fromSfnExecutionName('a-b!u002dc-d', '-'))
      .to.eql(['a', 'b-c', 'd']);
  });

  it('copes with quotes in the input string', () => {
    expect(fromSfnExecutionName('foo"bar')).to.eql(['foo"bar']);
  });
});
