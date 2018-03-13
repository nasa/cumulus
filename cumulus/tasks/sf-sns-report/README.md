# @cumulus/queue-pdrs

[![CircleCI](https://circleci.com/gh/cumulus-nasa/cumulus.svg?style=svg)](https://circleci.com/gh/cumulus-nasa/cumulus)

Broadcast an incoming Cumulus message to SNS.  This lambda function works with Cumulus Message Adapter, and it can be used anywhere in a step function workflow to report granule and PDR status.

To report the PDR's progress as it's being processed, add the following step after each pdr-status-check:
`   PdrStatusReport:
      CumulusConfig:
        cumulus_message:
          input: '{$}'
          outputs:
            - source: '{$.payload}'
              destination: '{$.payload}'
      Type: Task
      Resource: ${SfSnsReportLambdaFunction.Arn}
`

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://cumulus-nasa.github.io/)

## Contributing

See [Cumulus README](https://github.com/cumulus-nasa/cumulus/blob/master/README.md#installing-and-deploying)
