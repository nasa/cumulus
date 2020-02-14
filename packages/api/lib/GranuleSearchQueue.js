const DynamoDbSearchQueue = require('@cumulus/aws-client/DynamoDbSearchQueue');
const { isNil } = require('@cumulus/common/util');

const { buildDatabaseFiles } = require('./FileUtils');

const translateGranule = async (granule) => {
  if (isNil(granule.files)) return granule;

  return {
    ...granule,
    files: await buildDatabaseFiles({ files: granule.files })
  };
};

class GranuleSearchQueue extends DynamoDbSearchQueue {
  peek() {
    return super.peek().then((g) => (isNil(g) ? g : translateGranule(g)));
  }

  shift() {
    return super.shift().then((g) => (isNil(g) ? g : translateGranule(g)));
  }
}

module.exports = GranuleSearchQueue;
