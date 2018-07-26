# CNM Basic Workflow

This entry documents setup of a basic workflow that utilizes the built-in CNM/Kinesis functionality in Cumulus.

Prior to using this entry you should be familiar with the [Cloud Notification Mechanism](https://wiki.earthdata.nasa.gov/display/CUMULUS/Cloud+Notification+Mechanism).

## Prerequisites

### AWS CLI

Use of this entry assumes you have the [AWS CLI](https://www.google.com/search?q=aws+cli) installed and configured.   If you do not, take a moment to review the documentation and install it now.

### Kinesis

Use of this entry assumes you already have a [Kinesis](https://aws.amazon.com/kinesis/) data steam created for use as a CNM notification stream.

If you do not have a stream setup, please take a moment to review the documentation and setup a basic single-shard stream.

Basic stream manipulation for testing/learning purposes can be accomplished via the [AWS CLI](https://docs.aws.amazon.com/streams/latest/dev/fundamental-stream.html)

For more information on how this process works and how to develop a process that will add records to a stream, read the [Kinesis documentation](https://aws.amazon.com/documentation/kinesis/) and the [developer guide](https://docs.aws.amazon.com/streams/latest/dev/introduction.html).

## Cumulus Configuration

    The following are steps that are required to set up your Cumulus instance to run the example workflow

### Collection and Provider

Cumulus will need to be configured with a Collection and Provider entry of your choosing.

This can be done via the [Cumulus Dashboard](https://github.com/nasa/cumulus-dashboard) if installed or the [API](../api.md).  It is strongly recommended to use the dashboard if possible.

### Workflows Configuration

For our example, we're going to trigger the HelloWorld task that is provided in the example deployment, using a custom workflow.

The following [workflow definition](../workflows/README.md) should be added to your deployment's workflows.yml:

```
CMMExampleWorkflow:
  Comment: CNMExampleWorkflow
  StartAt: StartStatus
  States:
    StartStatus:
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn}
      CumulusConfig:
        cumulus_message:
          input: '{$}'
      Next: HelloWorld
    HelloWorld:
      CumulusConfig:
        buckets: '{$.meta.buckets}'
        provider: '{$.meta.provider}'
        collection: '{$.meta.collection}'
      Type: Task
      Resource: ${HelloWorldLambdaFunction.Arn}
      Catch:
        - ErrorEquals:
          - States.ALL
          ResultPath: '$.exception'
          Next: StopStatus
      Next: CnmResponse
    CnmResponse:
      CumulusConfig:
        OriginalCNM: '{$.meta.cnm}'
        CNMResponseStream: '${CNMResponseStream}'
        region: 'us-east-1'
        WorkflowException: '{$.exception}'
        cumulus_message:
          outputs:
            - source: '{$}'
              destination: '{$.meta.cnmResponse}'
      Type: Task
      Resource: ${CnmResponseLambdaFunction.Arn}
      Retry:
        - ErrorEquals:
            - States.ALL
          IntervalSeconds: 5
          MaxAttempts: 3
      Catch:
        - ErrorEquals:
          - States.ALL
          ResultPath: '$.exception'
          Next: StopStatus
      Next: StopStatus
    StopStatus:
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn}
      CumulusConfig:
        sfnEnd: true
        stack: '{$.meta.stack}'
        bucket: '{$.meta.buckets.internal.name}'
        stateMachine: '{$.cumulus_meta.state_machine}'
        executionName: '{$.cumulus_meta.execution_name}'
        cumulus_message:
          input: '{$}'
      Catch:
        - ErrorEquals:
          - States.ALL
          Next: WorkflowFailed
      End: true
    WorkflowFailed:
      Type: Fail
      Cause: 'Workflow failed'
```

### Task Configuration
#### HelloWorld

This entry assumes the HelloWorld [task](../workflows/developing-workflow-tasks.md) is defined in the deployment's `lambdas.yml` configuration file:

```
HelloWorld:
  handler: index.handler
  timeout: 300
  memory: 256
  source: 'node_modules/@cumulus/hello-world/dist/'
  useMessageAdapter: true
```

This task defines a task that runs the HelloWorld lambda.

#### CnmResponse
This entry assumes you have a CNM response task defined in the `lambdas.yml` configuration file:

```
CnmResponse:
  handler: 'gov.nasa.cumulus.CNMResponse::handleRequestStreams'
  timeout: 300
  useMessageAdapter: false
  runtime: java8
  memory: 256
  s3Source:
    bucket: 'cumulus-data-shared''
    key: 'daacs/podaac/cnmResponse-1.0.zip'
  launchInVpc: true
```

This defines a task that runs a lambda that generates a CNM response output and puts it on a Kinesis stream

The CnmResponse task utilizes a response lambda provided (as of release 1.8) in the `cumulus-data-shared` bucket, with documentation provided in the [source repository](https://git.earthdata.nasa.gov/projects/POCUMULUS/repos/cnmresponsetask/browse).

##### CNMToCMA

This entry assumes you have a CNM to Cumulus Granule translation lambda defined in the `lambdas.yml` configuration file as `CNMToCMA`:

```
CNMToCMA:
  handler: 'gov.nasa.cumulus.CnmToGranuleHandler::handleRequestStreams'
  timeout: 300
  runtime: java8
  memory: 128
  s3Source:
    bucket: 'cumulus-data-shared'
    key: 'daacs/podaac/cnmToGranule-1.0-wCMA.zip'
  useMessageAdapter: false
  launchInVpc: true
```

This defines a task that runs a lambda at the begining of the workflow that will extract CMA-compatible granule information into the payload.   This workflow will not utilize that payload, as HelloWorld doesn't actualy process data, however if this were an ingest workflow, you would need to ensure that downstream tasks in your workflow either speak CNM *or* include a translation-to-common-format task like this one.

### Redeploy

Once the above configuration changes have been made, you'll need to redeploy your stack to ensure the updates to the workflows/tasks are available.    Please refer to `Updating Cumulus deployment` in the [deployment documentation][../deployment/README.md] if you are unfamiliar with that process.

### Rule Configuration

Cumulus provides a built-in Kinesis consumer lambda function ([kinesis-consumer](https://github.com/nasa/cumulus/blob/master/packages/api/lambdas/kinesis-consumer.js)) that will read CNM formatted events off of a preconfigured Kinesis stream and trigger a workflow when a Cumulus rule is configured via the Cumulus dashboard or API.

This example will focus on using the Cumulus dashboard to schedule the execution of a HelloWorld workflow when events are posted to the Kinesis stream.

To add a rule via the dashboard, navigate to the `Rules` page and click `Add a rule`, then configure the new rule using the following template (substituting correct values for parameters denoted by `${}`:

```
name: helloworld_cnm_rule
Workflow Name: HelloWorldWorkflow
Provider ID: ${provider_id} # found on the Providers page
collection - Collection Name: ${collection_name} # configured and found in the Collections page
collection - Collection Version: ${collection_version} # configured and found in the Collections page
rule - type: kinesis
rule - value: ${Kinesis_Stream_ARN} # See below
Rule State: ENABLED
Optional tags for search:
```

**Please Note:**
- The rule - value key must match the Amazon resource name [ARN](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html) for the Kinesis data stream you've preconfigured.   You should be able to obtain this ARN from the Kinesis Dashboard entry for the selected stream.
- The collection/provider values will not actually be used in any meaningful way for the HelloWorld workflow.   These values are required for Cumulus Rules, but are not utilized by the HelloWorld lambda itself.

Once you've clicked on 'submit' a new rule should appear in the dashboard Rules list.

## Execution

Once Cumulus has been configured and a Rule has been added, we're ready to trigger the workflow and watch it execute.

### Triggering Workflow

As of release 1.8 the kinesis consumer requires the incoming data to be a CNM JSON object.   Upon validation it will trigger all rules that match the `collection` for all versions of that collection.

To trigger this workflow, you will need to put a record on the Kinesis stream that the [kinesis-consumer](https://github.com/nasa/cumulus/blob/master/packages/api/lambdas/kinesis-consumer.js) lambda will recognize as a matching event.

For the purpose of this example, the easiest way to accomplish this is using the [AWS CLI](https://aws.amazon.com/cli/):

- Construct a JSON file containing an object that matches the rule you previously created.   This JSON object should be a valid [CNM message]().  `collection`, `Product: name`,  and `Product: dataVersion` keys should match the collection name and version you setup in the rule, and the provider name should match the provider:

```
{
  "provider": "Test Provider,'
  "collection": ${COLLECTION}  ## The collection configured previously ,
  "identifier": "Test Identifier",
  "product": {
    "name": "GranuleUR",
    "dataVersion": ${VERSION},  ## The data version defined in the rule above
    "files": [
      {
        "bucket": "private",
        "regex": ".*.dat",
        "sampleFileName": "not-a-real-file.dat"
      }
    ]
   }
}
```

-  Using the JSON file you created, push it as a record to the Kinesis stream:

```
aws kinesis put-record --stream-name ${kinesis_stream_name} --partition-key 1 --data file:///path/to/file.json
```

**Please note**: The above command uses the stream name, *not* the ARN

This command will put a record containing the JSON value from the --data flag onto the Kinesis data stream, which should be picked up by the kinesis-consumer.  This will trigger the HelloWorld workflow targeted by the rule you previously configured.

### Output/Results

Once the message is added to the Kinesis Stream, the kinesis-consumer will be triggered based on the rule configured in the configuration section.   The kinesis-consumer will validate the event data to ensure it's a valid CNM/JSON message, then trigger all of the rules that match that collection name and pass the stream data to the workflow as the payload.

In this instance, if you were to look at the input to the HelloWorld workflow in the [Step Function](https://aws.amazon.com/documentation/step-functions/) dashboard, the payload would contain the JSON object provided to the `kinesis put-record` command.

You can view the current running executions on The `Executions` dashboard page which presents a list of all executions, their status (running, failed, or completed), to which workflow the execution belongs, along with other information.   You should see a HelloWorldWorkflow run successfully for the defined collection name for each rule you have configured.

## Summary

This example demonstrated how to use the built-in Cumulus functionality to trigger a workflow from events added to a Kinesis data stream.  It explained how to configure a Cumulus deployment to deploy the HelloWorld workflow, configure a rule to utilize a Kinesis data stream, and how to trigger the workflow by putting a CNM record on the Kinesis data stream.
