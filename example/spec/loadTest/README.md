# queueGranulePassThroughLoadTest

- This test script validates Cumulus framework being able to handle ingestion of +200K granules by executing the QueueGranulesPassthrough workflow to ingest granules into the database on "completed" status. No S3 data staging is involved in this test.

## Test In-line Configuration
    - workflowName: QueueGranulesPassthrough
    - inputPayload: ingestLoadTestPassthrough.input.payload.json (Post processing payload template)
    - granuleCountPerWorkflow - 450 granules per workflow is the max allowable by the API
    - totalWorkflowCount - number of workflows to fire off

## Usage

`../node_modules/.bin/jasmine spec/loadTest/queueGranulePassThroughLoadTest.js`

