const DynamoDbSearchQueue = require('@cumulus/aws-client/DynamoDbSearchQueue');
const { isNil } = require('@cumulus/common/util');

const { translateGranule } = require('./granules');

class GranuleSearchQueue extends DynamoDbSearchQueue {
  peek() {
    return super.peek().then((g) => (isNil(g) ? g : translateGranule(g)));
  }

  shift() {
    return super.shift().then((g) => (isNil(g) ? g : translateGranule(g)));
  }
}

module.exports = GranuleSearchQueue;
