# ingestLoad_queueGranPassThruSF

- This test script validates Cumulus framework being able to handle ingestion of +200K granules by executing the QueueGranulesPassthrough workflow to ingest granules into the database on "completed" status. No S3 data staging is involved in this test. 

## Test In-line Configuration
    - workflowName: QueueGranulesPassthrough
    - inputPayload: ingestLoadTestPassthrough.input.payload.json (Post processing payload template)
    - granuleCountPerWorkflow - 450 granules per workflow is the max allowable by the API
    - totalWorkflowCount - number of workflows to fire off

## Usage

`../node_modules/.bin/jasmine spec/loadTest/ingestLoad_queueGranPassThruSF.js`

# ingestLoad_queueGranSFCompleted

- This script performs a load test toward Cumulus components by executing the QueueGranlues workflow to ingest granules into the database on "completed" status. Granule files test data will be staged in S3 since the ingestion is going through the IngestGranule workflow.

## Test In-line Configuration
    - workflowName: QueueGranules
    - inputPayload: ingestLoadTest.input.payload.json
    - granuleCountPerWorkflow - 425 granules per workflow is the max allowable by the API
    - totalWorkflowCount - number of workflows to fire off

## Usage

`../node_modules/.bin/jasmine spec/loadTest/ingestLoad_queueGranSFCompleted.js`

# ingestLoad_queueGranSFQueued

- This script accomplishes a load ingestion of granules into the database on "queued" status by executing the QueueGranlues workflow, but without triggering the downstream granuleIngestWorkflow in the definition which is the IngestGranule workflow. This is achieved by not providing the queueUrl in the event.config. No S3 data staging is involved in this test.

## Test In-line Configuration
    - workflowName: QueueGranules
    - inputPayload: ingestLoadTestPassthrough.input.payload.json
    - granuleCountPerWorkflow - 450 granules per workflow is the max allowable by the API
    - totalWorkflowCount - number of workflows to fire off

## Usage

`../node_modules/.bin/jasmine spec/loadTest/ingestLoad_queueGranSFQueued.js`
