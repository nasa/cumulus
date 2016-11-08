'use strict';

const aws = require('gitc-common/aws');
const log = require('gitc-common/log');

const startTimedIngest = (entrypoint, periodMs, offsetMs, baseEventData) => {
  const run = async () => {
    try {
      const timestampedTransaction = Object.assign(
        {},
        baseEventData.transaction,
        { startDate: new Date().toISOString() }
      );
      const eventData = Object.assign({}, baseEventData, { transaction: timestampedTransaction });
      log.info(`Initiating ${entrypoint}`, JSON.stringify(eventData));
      await aws.sqs().sendMessage({
        MessageBody: JSON.stringify(eventData),
        QueueUrl: `${eventData.transaction.queue}${entrypoint}-events`,
        MessageAttributes: {
          event: {
            DataType: 'String',
            StringValue: entrypoint
          }
        }
      }).promise();
    }
    catch (err) {
      log.error(err, err.stack);
    }
  };

  setTimeout(() => {
    setInterval(run, periodMs);
    run();
  }, offsetMs);
};

module.exports.handler = async (event, context) => {
  const arn = context.invokedFunctionArn;

  const productsData = await aws.s3().getObject(event.products).promise();
  const products = JSON.parse(productsData.Body.toString());

  for (const group of products) {
    const globals = {
      groupId: group.groupId,
      bucket: event.bucket,
      mrf_bucket: event.mrf_bucket,
      config_bucket: event.products.Bucket,
      queue: aws.getQueueUrl(arn, `${event.prefix}-`)
    };
    for (const trigger of group.triggers) {
      if (trigger.type === 'timer') {
        const periodMs = 1000 * trigger.period_s;
        const staggerMs = periodMs / trigger.transactions.length;
        let offsetMs = 0;
        for (const transaction of trigger.transactions) {
          startTimedIngest(trigger.event, periodMs, offsetMs, {
            bucket: event.bucket,
            config: event.products,
            transaction: Object.assign({}, globals, transaction)
          });
          offsetMs += staggerMs;
        }
      }
    }
  }
};
