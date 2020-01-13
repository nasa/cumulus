'use strict';

const AWSCloudFormationGateway = require('@cumulus/aws-client/CloudFormationGateway');
const { deprecate } = require('./util');

class CloudFormationGateway extends AWSCloudFormationGateway {
  constructor(cloudFormationService) {
    deprecate('@cumulus/common/CloudFormationGateway', '1.17.0', '@cumulus/aws-client/CloudFormationGateway');
    super(cloudFormationService);
  }
}

module.exports = CloudFormationGateway;
