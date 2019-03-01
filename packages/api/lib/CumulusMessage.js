'use strict';

const { constructCollectionId } = require('@cumulus/common');
const { getExecutionArn } = require('@cumulus/common/aws');

exports.getCollectionId = (cumulusMessage) =>
  constructCollectionId(
    cumulusMessage.meta.collection.name,
    cumulusMessage.meta.collection.version
  );

exports.getExecutionArn = (cumulusMessage) =>
  getExecutionArn(
    cumulusMessage.cumulus_meta.state_machine,
    cumulusMessage.cumulus_meta.execution_name
  );
