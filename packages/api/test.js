const { sendSNSMessage } = require('@cumulus/aws-client/SNS');
const { randomId } = require('@cumulus/common/test-utils');

async function haha() {
  console.log(await sendSNSMessage({ Name: randomId('topic1_') }, 'CreateTopicCommand'));
  const topic1 = await sendSNSMessage({ Name: randomId('topic1_') }, 'CreateTopicCommand');
  console.log(await sendSNSMessage({
    TopicArn: topic1.TopicArn,
    Message: JSON.stringify('HELLO'),
  }, 'PublishCommand'));
  console.log(await sendSNSMessage({ TopicArn: 'arn:aws:sns:us-east-1:596205514787:topic1_bb311f4144' }, 'DeleteTopicCommand'));
  console.log(topic1.TopicArn);
}

haha();
