const test = require('ava').test;
const pvlToJS = require('../t').pvlToJS;
const parseValue = require('../t').parseValue;
const PVLRoot = require('../lib/models').PVLRoot;
const PVLObject = require('../lib/models').PVLObject;
const PVLGroup = require('../lib/models').PVLGroup;
const PVLNumeric = require('../lib/models').PVLNumeric;
const PVLDateTime = require('../lib/models').PVLDateTime;
const PVLTextString = require('../lib/models').PVLTextString;

test('parsing empty string returns empty object', t => {
  t.deepEqual(pvlToJS(''), new PVLRoot());
});

test('parsing non-nested items', t => {
  const input =
    'THIS = THAT;\n' +
    'HERE = THERE;';
  const expected = new PVLRoot()
    .add('THIS', new PVLTextString('THAT'))
    .add('HERE', new PVLTextString('THERE'));
  t.deepEqual(pvlToJS(input), expected);
});

test('ignore full-line comment when parsing', t => {
  const input =
    '/*Comment*/\n' +
    'THIS = THAT;\n' +
    'HERE = THERE;';
  const expected = new PVLRoot()
    .add('THIS', new PVLTextString('THAT'))
    .add('HERE', new PVLTextString('THERE'));
  t.deepEqual(pvlToJS(input), expected);
});

test('ignore leading white space when parsing', t => {
  const input =
    '      THIS = THAT;\n' +
    '  HERE = THERE;';
  const expected = new PVLRoot()
    .add('THIS', new PVLTextString('THAT'))
    .add('HERE', new PVLTextString('THERE'));
  t.deepEqual(pvlToJS(input), expected);
});

test('ignore trailing white space when parsing', t => {
  const input =
    'THIS = THAT;         \n' +
    'HERE = THERE;      ';
  const expected = new PVLRoot()
    .add('THIS', new PVLTextString('THAT'))
    .add('HERE', new PVLTextString('THERE'));
  t.deepEqual(pvlToJS(input), expected);
});

test('allow duplicate keys when parsing', t => {
  const input =
    'THIS = THAT;\n' +
    'THIS = THERE;';
  const expectedStore = [['THIS', new PVLTextString('THAT')], ['THIS', new PVLTextString('THERE')]];
  t.deepEqual(pvlToJS(input).store, expectedStore);
});

test('parsing a singly-nested item', t => {
  const input =
    'GROUP = THAT;\n' +
    '  HERE = THERE;\n' +
    'END_GROUP;';
  const expected = new PVLRoot()
    .addAggregate(new PVLGroup('THAT')
      .add('HERE', new PVLTextString('THERE'))
    );
  t.deepEqual(pvlToJS(input), expected);
});

test('parsing a singly-nested item with a named end-aggregate', t => {
  const input =
    'OBJECT = THAT;\n' +
    '  HERE = THERE;\n' +
    'END_OBJECT = THAT;';
  const expected = new PVLRoot()
    .addAggregate(new PVLObject('THAT')
      .add('HERE', new PVLTextString('THERE'))
    );
  t.deepEqual(pvlToJS(input), expected);
});

test('parsing a doubly-nested item', t => {
  const input =
    'GROUP = THAT;\n' +
    '  GROUP = THOSE;\n' +
    '    HERE = THERE;\n' +
    '  END_GROUP;\n' +
    'END_GROUP;';
  const expected = new PVLRoot()
    .addAggregate(new PVLGroup('THAT')
      .addAggregate(new PVLGroup('THOSE')
        .add('HERE', new PVLTextString('THERE'))
      )
    );
  t.deepEqual(pvlToJS(input), expected);
});

test('parsing Objects within a Group', t => {
  const input =
    'GROUP = THAT;\n' +
    '  OBJECT = THOSE;\n' +
    '    HERE = THERE;\n' +
    '  END_OBJECT;\n' +
    '  OBJECT = THOSE;\n' +
    '    HERE = WHERE;\n' +
    '  END_OBJECT;\n' +
    'END_GROUP;';
  const expected = new PVLRoot()
    .addAggregate(new PVLGroup('THAT')
      .addAggregate(new PVLObject('THOSE')
        .add('HERE', new PVLTextString('THERE'))
      )
      .addAggregate(new PVLObject('THOSE')
        .add('HERE', new PVLTextString('WHERE'))
      )
    );
  t.deepEqual(pvlToJS(input), expected);
});

test('parsing nested item with attribute', t => {
  const input =
    'GROUP = THAT;\n' +
    '  PROP = YEAH_IT_EXISTS;\n' +
    '  GROUP = THOSE;\n' +
    '    HERE = THERE;\n' +
    '  END_GROUP;\n' +
    'END_GROUP;';
  const expected = new PVLRoot()
    .addAggregate(new PVLGroup('THAT')
      .add('PROP', new PVLTextString('YEAH_IT_EXISTS'))
      .addAggregate(new PVLGroup('THOSE')
        .add('HERE', new PVLTextString('THERE'))
      )
    );
  t.deepEqual(pvlToJS(input), expected);
});

test('parsing an aggregate name wrapped in quotes', t => {
  const inputSimple =
    "OBJECT = 'THAT';\n" +
    '  FOO = BAR;\n' +
    'END_OBJECT;';
  const expectedSimple = new PVLRoot()
    .addAggregate(new PVLObject('THAT')
      .add('FOO', new PVLTextString('BAR'))
    );
  t.deepEqual(pvlToJS(inputSimple), expectedSimple);

  const inputComplex =
    'GROUP = "THAT";\n' +
    "  HERE = 'THERE';\n" +
    '  FOO = BAR;\n' +
    '  FIZZ = "BUZZ";\n' +
    "  WHO = 'William Magear \"Boss\" Tweed';\n" +
    'END_GROUP;';
  const expectedComplex = new PVLRoot()
    .addAggregate(new PVLGroup('THAT')
      .add('HERE', new PVLTextString('THERE'))
      .add('FOO', new PVLTextString('BAR'))
      .add('FIZZ', new PVLTextString('BUZZ'))
      .add('WHO', new PVLTextString('William Magear "Boss" Tweed'))
    );
  t.deepEqual(pvlToJS(inputComplex), expectedComplex);
});

test('parsing Numeric value', t => {
  t.deepEqual(parseValue('12345'), new PVLNumeric('12345'));
  t.deepEqual(parseValue('12345'), new PVLNumeric(12345));
  t.is(parseValue('12345').value, 12345);
});

test('parsing DateTime value', t => {
  t.deepEqual(parseValue('1990-07-04T12:00'), new PVLDateTime('1990-07-04T12:00'));
  t.deepEqual(parseValue('1990-07-04T12:00').value, new Date('1990-07-04T12:00'));
});

test('parsing quoted TextString value', t => {
  t.deepEqual(parseValue('foobar'), new PVLTextString('foobar'));
  t.is(parseValue('foobar').value, 'foobar');

  t.deepEqual(parseValue("\"'FOOBAR'\""), new PVLTextString("'FOOBAR'"));
  t.deepEqual(parseValue("\"'FOobaR'\""), new PVLTextString("'FOobaR'"));
  t.is(parseValue("\"'FOobaR'\"").value, "'FOobaR'");

  t.deepEqual(parseValue("'FO\"obaR'"), new PVLTextString('FO"obaR'));
  t.deepEqual(parseValue('"FO\'obaR"'), new PVLTextString("FO'obaR"));
  t.deepEqual(parseValue('"FO\'obaR\'"'), new PVLTextString("FO'obaR'"));
});

test('parsing unquoted TextString value', t => {
  t.deepEqual(parseValue('FOOBAR'), new PVLTextString('FOOBAR'));
  t.deepEqual(parseValue('foobAR'), new PVLTextString('foobAR'));
});
