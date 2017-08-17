const test = require('ava').test;
const jsToPVL = require('../t').jsToPVL;
const PVLRoot = require('../lib/models').PVLRoot;
const PVLObject = require('../lib/models').PVLObject;
const PVLGroup = require('../lib/models').PVLGroup;
const PVLNumeric = require('../lib/models').PVLNumeric;
const PVLDateTime = require('../lib/models').PVLDateTime;
const PVLTextString = require('../lib/models').PVLTextString;

test('write one attribute', t => {
  const input = new PVLRoot()
    .add('FOO', new PVLTextString('BAR'));
  const expected = 'FOO = "BAR";\n';
  t.deepEqual(jsToPVL(input), expected);
});

test('write multiple attributes', t => {
  const input = new PVLRoot()
    .add('FOO', new PVLTextString('BAR'))
    .add('BAZ', new PVLTextString('QUX'))
    .add('BAZ', new PVLTextString('FIZZ'));
  const expected =
    'FOO = "BAR";\n' +
    'BAZ = "QUX";\n' +
    'BAZ = "FIZZ";\n';
  t.deepEqual(jsToPVL(input), expected);
});

test('write one group', t => {
  const input = new PVLRoot()
    .addAggregate(new PVLGroup('FOO')
      .add('BAR', new PVLTextString('BAZ'))
    );
  const expected =
    'GROUP = FOO;\n' +
    '  BAR = "BAZ";\n' +
    'END_GROUP = FOO;\n';
  t.deepEqual(jsToPVL(input), expected);
});

test('write multiple groups', t => {
  const input = new PVLRoot()
    .addAggregate(new PVLGroup('FOO')
      .add('BAR', new PVLTextString('BAZ'))
    )
    .addAggregate(new PVLGroup('QUX')
      .add('BAR', new PVLTextString('FIZZ'))
    );
  const expected =
    'GROUP = FOO;\n' +
    '  BAR = "BAZ";\n' +
    'END_GROUP = FOO;\n' +
    'GROUP = QUX;\n' +
    '  BAR = "FIZZ";\n' +
    'END_GROUP = QUX;\n';
  t.deepEqual(jsToPVL(input), expected);
});

test('write nested groups', t => {
  const input = new PVLRoot()
    .addAggregate(new PVLGroup('FOO')
      .addAggregate(new PVLObject('QUX')
        .add('BAR', new PVLTextString('BAZ'))
      )
    );
  const expected =
    'GROUP = FOO;\n' +
    '  OBJECT = QUX;\n' +
    '    BAR = "BAZ";\n' +
    '  END_OBJECT = QUX;\n' +
    'END_GROUP = FOO;\n';
  t.deepEqual(jsToPVL(input), expected);
});

test('write Numeric', t => {
  const input = new PVLRoot()
    .add('FOO', new PVLNumeric(12345));
  const expected = 'FOO = 12345;\n';
  t.is(jsToPVL(input), expected);
});

test('write DateTime', t => {
  const input = new PVLRoot()
    .add('FOO', new PVLDateTime('2016-12-05T23:24Z'));
  const expected = 'FOO = 2016-12-05T23:24:00.000Z;\n';
  t.is(jsToPVL(input), expected);
});

test('write TextString', t => {
  const input = new PVLRoot()
    .add('FOO', new PVLTextString('201612-BAZ'));
  const expected = 'FOO = "201612-BAZ";\n';
  t.is(jsToPVL(input), expected);
});

test('write TextString with embedded double-quote', t => {
  const input = new PVLRoot()
    .add('FOO', new PVLTextString('Dwayne "The Rock" Johnson'));
  const expected = "FOO = 'Dwayne \"The Rock\" Johnson';\n";
  t.is(jsToPVL(input), expected);
});
