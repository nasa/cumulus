# Basic CNM Workflow

This entry documents setup of a basic workflow that utilizes the built-in CNM/Kinesis functionality in Cumulus.

Prior to using this entry you should be familiar with the [Cloud Notification Mechanism](https://wiki.earthdata.nasa.gov/display/CUMULUS/Cloud+Notification+Mechanism).

## Configuration

### AWS CLI

Use of this entry assumes you have the [AWS CLI](https://www.google.com/search?q=aws+cli) installed and configured.   If you do not, take a moment to review the documentation and install it now.

### Kinesis

Use of this entry assumes you already have a [Kinesis](https://aws.amazon.com/kinesis/) data steam created for use as a CNM notification stream.

If you do not have a stream setup, please take a moment to review the documentation and setup a basic single-shard stream.

Basic stream manipulation for testing/learning purposes can be accomplished via the [AWS CLI](https://docs.aws.amazon.com/streams/latest/dev/fundamental-stream.html)

For more information on how this process works and how to develop a process that will add records to a stream, read the [Kinesis documentation](https://aws.amazon.com/documentation/kinesis/) and the [developer guide](https://docs.aws.amazon.com/streams/latest/dev/introduction.html).

### Cumulus

Cumulus will need to be configured with a Collection and Provider entry of your choosing.

This can be done via the [Cumulus Dashboard](https://github.com/nasa/cumulus-dashboard) if installed or the [API](../api.md).  It is strongly recommended to use the dashboard if possible.

### Workflow Configurations

For our initial example, we're going to trigger HelloWorld workflow that is provided in the example deployment.

The [workflow definition](../workflows/README.md) can be found in [cumulus/example/workflows.yml](https://github.com/nasa/cumulus/blob/master/example/workflows.yml)  under `HelloWorldWorkflow:`

(Please note this snippet is included as a sample only, please review the source file for the most up-to-date workflow)

```
HelloWorldWorkflow:
  Comment: 'Returns Hello World'
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
If you're using the example deployment this workflow will already be included.  If you're attempting to use this example in a custom deployment you'll need to include the HelloWorld in your workflows.yml, then re-deploy to utilize it.

### Task Configuration

This cookbook entry assumes the HelloWorld [task](../workflows/developing-workflow-tasks.md) is defined in the `lambdas.yml` configuration file under `HelloWorld:`

```
HelloWorld:
  handler: index.handler
  timeout: 300
  memory: 256
  source: 'node_modules/@cumulus/hello-world/dist/'
  useMessageAdapter: true
```

If you are using the example deployment this task will already be included in the configuration file.

If you are attempting to use this example in a custom deployment you'll need to include the HelloWorld task in your lambdas.yml, then re-deploy to utilize it.

##### Rule Configuration

Cumulus provides a built-in Kinesis consumer lambda function ([kinesis-consumer](https://github.com/nasa/cumulus/blob/master/packages/api/lambdas/kinesis-consumer.js)) that will read events off of a preconfigured Kinesis stream and trigger a workflow when a Cumulus rule is configured via the Cumulus dashboard or API.

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
### Triggering Workflow

As of release 1.8 the kinesis consumer requires the incoming data to be a CNM JSON object.   Upon validation it will trigger all rules that match the `collection` for all versions of that collection.

To trigger this workflow, you will need to put a record on the Kinesis stream that the [kinesis-consumer](https://github.com/nasa/cumulus/blob/master/packages/api/lambdas/kinesis-consumer.js) lambda will recognize as a matching event.

For the purpose of this example, the easiest way to accomplish this is using the [AWS CLI](https://www.google.com/search?q=aws+cli):

- Construct a JSON file containing an object that matches the rule you previously created.   This JSON object should be a valid [CNM message]().  `collection`, `Product: name`,  and `Product: dataVersion` keys should match the collection name and version you setup in the rule, and the provider name should match the provider:

```
{
  "provider": "Test Provider,'
  "collection": ${COLLECTION}  ## The collection configured previously ,
  "identifier": "Test Identifier",
  "product": {
    "name": "GranuleUR",
    "dataVersion": ${VERSION},  ## The data version defined in the rule above
    "files": []
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
