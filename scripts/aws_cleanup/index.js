// eslint-disable-next-line node/no-extraneous-require
const moment = require('moment');
const { ec2 } = require('@cumulus/aws-client/services');

const shouldBeCleanedUp = (instanceObject, todayFunc) => {
  const timeoutKey = process.env.timeout_key || 'Rotate By';
  return instanceObject.Tags.reduce((ret, tag) => {

    if (tag.Key && tag.Value && tag.Key === timeoutKey && moment(tag.Value) < todayFunc()) {
      return true;
    }
    return ret;
  }, false);
};

const getInstancesToClean = async (describeFunc, todayFunc) => {
  const describeResponse = await describeFunc();
  const instances = describeResponse.Reservations?.flatMap((reservation) => reservation?.Instances);
  if (!instances) {
    return [];
  }
  return instances.filter((instance) => instance && shouldBeCleanedUp(instance, todayFunc))
    .map((instance) => instance.InstanceId);
};

const terminateInstances = async(toClean, terminateFunc) => {
  if (toClean.length > 0) {
    const termination = await terminateFunc();
    return {
      statusCode: 200,
      message: `termination completed with response ${JSON.stringify(termination)}`,
    };
  }
  return {
    statusCode: 200,
    message: 'termination completed with no instances out of date',
  };
}

const handler = async () => {
  const client = ec2();
  const toClean = await getInstancesToClean(client.describeInstances, moment);
  return terminateInstances(toClean, (toClean) => client.terminateInstances({InstanceIds: toClean}));
};

module.exports = {
  shouldBeCleanedUp,
  getInstancesToClean,
  terminateInstances,
  handler
};
