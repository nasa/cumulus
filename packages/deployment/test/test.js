
const test = require('ava');
const kes = require('../app/kes.override');

test('test cumulus message syntax fix', (t) => {
  const fix = kes.fixCumulusMessageSyntax;
  const testObj = {
    useQueue: true,
    someKey: 'myKey{meta.stack}end',
    stack: '{$.meta.stack}',
    collections: '[$.meta.collections]',
    obj: {
      key1: 'key1',
      key2: 'key2'
    }
  };
  const returnObj = fix(Object.assign({}, testObj));
  t.is(`{${testObj.stack}}`, returnObj.stack);
  t.is(`{${testObj.collections}}`, returnObj.collections);
  t.is(testObj.useQueue, returnObj.useQueue);
  t.is(testObj.someKey, returnObj.someKey);
  t.is(testObj.obj.key1, returnObj.obj.key1);
});
