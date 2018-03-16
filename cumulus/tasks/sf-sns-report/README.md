# @cumulus/sf-sns-report

[![CircleCI](https://circleci.com/gh/cumulus-nasa/cumulus.svg?style=svg)](https://circleci.com/gh/cumulus-nasa/cumulus)

Broadcast an incoming Cumulus message to SNS.  This lambda function works with Cumulus Message Adapter, and it can be used anywhere in a step function workflow to report granule and PDR status.

To report the PDR's progress as it's being processed, add the following step after the pdr-status-check:

    PdrStatusReport:
      CumulusConfig:
        cumulus_message:
          input: '{$}'
      ResultPath: null
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn}

To report the start status of the step function:

    StartAt: StatusReport
    States:
     StatusReport:
      CumulusConfig:
        cumulus_message:
          input: '{$}'
      ResultPath: null
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn}

To report the final status of the step function:

    StopStatus:
      CumulusConfig:
        sfnEnd: true
        stack: '{$.meta.stack}'
        bucket: '{$.meta.buckets.internal}'
        stateMachine: '{$.cumulus_meta.state_machine}'
        executionName: '{$.cumulus_meta.execution_name}'
        cumulus_message:
          input: '{$}'
      ResultPath: null
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn}

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://cumulus-nasa.github.io/)

## Contributing

See [Cumulus README](https://github.com/cumulus-nasa/cumulus/blob/master/README.md#installing-and-deploying)
