const test = require('ava').test;
const pvlToJS = require('../t').pvlToJS;
const PVLTextString = require('../lib/models').PVLTextString;

test('accessing aggregates', t => {
  const input = pvlToJS(
    'GROUP = THAT;\n' +
    '  OBJECT = THOSE;\n' +
    '    HERE = THERE;\n' +
    '  END_OBJECT;\n' +
    '  OBJECT = THOSE;\n' +
    '    HERE = WHERE;\n' +
    '  END_OBJECT;\n' +
    'END_GROUP;\n' +
    'GROUP = FOO;\n' +
    '  BAR = BAZ;\n' +
    'END_GROUP;\n' +
    'OBJECT = THOSE;\n' +
    '  BAR = BAZ;\n' +
    'END_OBJECT;'
  );

  t.is(input.aggregates().length, 3);
  t.is(input.groups().length, 2);
  t.is(input.objects().length, 1);
  t.is(input.aggregates('THOSE').length, 1);
  t.is(input.groups('FOO').length, 1);
  t.is(input.objects('FOO').length, 0);
  t.is(input.aggregates('thOse').length, 0);
  // Quotes aren't acceptable in identifiers
  t.is(input.objects('"thOse"').length, 0);
  t.is(input.objects("'thOse'").length, 0);
});

test('parsing non-nested items', t => {
  const input = pvlToJS(
    'THIS = THAT;\n' +
    'HERE = THERE;'
  );

  t.deepEqual(input.get('HERE'), new PVLTextString('THERE'));
  t.is(input.get('WHERE'), null);
});
