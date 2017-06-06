'use strict';

const { fromSfnExecutionName } = require('ingest-common/aws');

module.exports = {

  /**
   * Parses the AWS Step Function name into a map containing collection id and granule id.
   * Example name with collection id: VNGCR_SQD_C1__20db2dff-49cf-4b11-81aa-b5a35ba382fe
   * Example name with both: VIIRS__VNGCR_NQD_C1__2017140__201f9667-2e53-4c5c-8318-f3bdfa83a453
   * collectionId: VNGCR_NQD_C1
   * granuleId: 2017140
   * uuid: 201f9667-2e53-4c5c-8318-f3bdfa83a453
   */
  parseExecutionName: (name) => {
    const parts = fromSfnExecutionName(name);
    let collectionId;
    let granuleId;
    // eslint-disable-next-line no-unused-vars
    let ignored;
    if (parts.length === 2) {
      collectionId = parts[0];
    }
    else {
      [ignored, collectionId, granuleId] = parts;
    }
    const uuid = parts[-1];
    return { collectionId, granuleId, uuid };
  }
};
