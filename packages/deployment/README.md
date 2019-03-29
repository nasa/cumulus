# @cumulus/deployment

[![Build Status](https://travis-ci.org/nasa/cumulus.svg?branch=master)](https://travis-ci.org/nasa/cumulus)

@cumulus/deployment includes cloudformation templates needed for a successful deployment of a Cumulus Instance. The templates can be used with [kes](https://github.com/developmentseed/kes), a node CLI helper for AWS CloudFormation.

## What is Cumulus?

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Usage

1. Copy `app.example` to a new deployment project.
2. Edit `app.example/config.yml` and your deployment information

3. Rename `app.example` to `app`.
4. Execute kes command:

     $ ./node_modules/.bin/kes cf deploy --kes-folder app --deployment \<my-deployment\> --template node_modules/@cumulus/deployment/app

All additions to app/api.yml should contain sources with a path to the corresponding npm installed packages, not a path to the folder in the local cumulus repository.

For example:

    $ source: 'node_modules/@cumulus/api/dist/'

## config.yml Explained

| field | default     | description
| ----- | ----------- | -----------
| stackName | (required) | the name used as a prefix in all aws resources
| stackNameNoDash | (required) | stackName with no dash
| urs_url | uat.urs | urs url used for OAuth
| api_backend_url | apigateway backend url | the API backend url
| api_distribution_url | apigateway dist url | the API url used for file distribution
| shared_data_bucket | cumulus-data-shared | the bucket has the shared data artifacts
| system_bucket | (required) | the bucket used for storing deployment artifacts
| buckets | N/A | Configuration of buckets with key, bucket name, and type (i.e. internal, public private)
| cmr.username | devseed | the username used for posting metadata to CMR
| cmr.provider | CUMULUS | the provider used for posting metadata to CMR
| cmr.clientId | CUMULUS | the clientId used to authenticate with the CMR
| cmr.password | (required) | the password used to authenticate with the CMR
| ems.provider | CUMULUS | the provider used for sending reports to EMS
| vpc.vpcId | (required if ecs is used) | the vpcId used with the deployment
| vpc.subnets | (required) | the subnets used
| ecs.amiid | ami-9eb4b1e5 | amiid of an optimized ecs instance (differnet for each region)
| ecs.instanceType | (required) | the instance type of the ec2 machine used for running ecs tasks
| ecs.volumeSize | 50 | the storage on ec2 instance running the ecs tasks
| ecs.availabilityZone | us-east-1a | the availibity zone used for launching ec2 machines
| ecs.maxInstances | 1 | max number of ec2 instances to launch in an autoscaling group
| ecs.desiredInstances | 0 | desired number of ec2 instances needed in an autoscaling group
| es.name | es5 | name of the elasticsearch cluster
| es.elasticSearchMapping | 4 | version number of the elasticsearch mapping used
| es.version | 5.3 | elasticsearch software version
| es.instanceCount | 1 | number of elasticsearch nodes
| es.instanceType | t2.small.elasticsearch | size of the ec2 instance used for the elasticsearch
| es.volumeSize | 35 | the storage used in each elasticsearch node
| sns.\<name\> | N/A | name of the sns topic
| sns.\<name\>.subscriptions.lambda.endpoint | sns2elasticsearch | lambda function triggered for each message in the topic
| apis.\<name\> | N/A | name of the apigateway application
| apiStage | dev | stage name used for each api gateway deployment stage
| dynamos.\<name\> | N/A | name of the dynamoDB table
| dynamos.\<name\>.read | 5 | number of reads per second
| dynamos.\<name\>.write | 1 | number of writes per second
| dynamos.\<name\>.attributes | N/A | list of attributes
| sqs.\<name\> | N/A | name of the queue
| sqs.\<name\>.visibilityTimeout | 20 | # of seconds the message returns to the queue after it is read by a consumer
| sqs.\<name\>.retry | 30 | number of time the message is returned to the queue before being discarded
| sqs.\<name\>.consumer | N/A | list of lambda function queue consumers
| rules.\<name\> | N/A | list of cloudwathch rules
| rules.\<name\>.schedule | N/A | rule's schedule
| rules.\<name\>.state | ENABLED | state of the rule
| rules.\<name\>.targets | N/A | list of lambda functions to be invoked
| stepFunctions | N/A | list of step functions
| lambdas | N/A | list of lambda functions


## Contributing

See [Cumulus README](https://github.com/nasa/cumulus/blob/master/README.md#installing-and-deploying)


