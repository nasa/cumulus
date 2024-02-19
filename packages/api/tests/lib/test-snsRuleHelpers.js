const test = require('ava');

const { randomId } = require('@cumulus/common/test-utils');

const {
  getSnsPermissionIdMaxLength,
  getSnsPermissionIdSuffix,
  getSnsTriggerPermissionId,
} = require('../../lib/snsRuleHelpers');
const { fakeRuleFactoryV2 } = require('../../lib/testUtils');

test('getSnsTriggerPermissionId() returns correct permission ID based on rule input', (t) => {
  const topicName = randomId('sns');
  const topicArn = `arn:aws:sns:us-east-1:000000000000:${topicName}`;
  const rule = fakeRuleFactoryV2({
    rule: {
      value: topicArn,
    },
  });
  t.is(getSnsTriggerPermissionId(rule), `${topicName}Permission`);
});

test('getSnsTriggerPermissionId() correct limits ID length to 64 characters', (t) => {
  const permissionIdSuffix = getSnsPermissionIdSuffix();
  const topicName = new Array((getSnsPermissionIdMaxLength() + 2) - permissionIdSuffix.length).join('a');
  const topicArn = `arn:aws:sns:us-east-1:000000000000:${topicName}`;
  const rule = fakeRuleFactoryV2({
    rule: {
      value: topicArn,
    },
  });
  // last character of suffix should have been trimmed by substring
  t.is(getSnsTriggerPermissionId(rule), `${topicName}${permissionIdSuffix.substring(0, permissionIdSuffix.length - 1)}`);
});
