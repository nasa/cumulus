---
id: glossary
title: Cumulus Glossary
hide_title: true
---

# AWS Glossary

For terms/items from Amazon/AWS not mentioned in this glossary, please refer to the [AWS Glossary](https://docs.aws.amazon.com/general/latest/gr/glos-chap.html).

# Cumulus Glossary of Terms

### API Gateway

  A Cumulus component that provides an API that provides accessors to Cumulus functionality.

  This component is published as a [NPM package](https://www.npmjs.com/package/@cumulus/apiAPI).   API documentation can be viewed [here](https://nasa.github.io/cumulus-api/).

### ARN

  Refers to an AWS "Amazon Resource Name".

  For more info, see the [AWS documentation](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html).

### AWS

  Amazon's Cloud Services Platform "Amazon Web Services".

### AWS Lambda/Lambda Function

  AWS's 'serverless' option.   Allows the running of code without provisioning a service or managing server/ECS instances/etc.

  For more information, see the [AWS Lambda documentation](https://aws.amazon.com/lambda/).

### AWS Access Keys

  Access credentials that give you access to AWS to act as a IAM user programatically or from the command line.

  For more information, see the [AWS IAM Documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html).

### Bucket

  An Amazon S3 cloud storage resource.

  For more information, see the [AWS Bucket Documentation](https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingBucket.html).

### CloudFormation

  An AWS service that allows you to define and manage cloud resources as a preconfigured block.

  For more information, see the [AWS CloudFormation User Guide](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html).

### Cloudformation Template

  A template that defines an AWS Cloud Formation.

  For more information, see the [ AWS intro page](https://aws.amazon.com/cloudformation/aws-cloudformation-templates/).

### Cloudwatch

  AWS service that allows logging and metrics collections on various cloud resources you have in AWS.

  For more information, see the [AWS User Guide](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html).

### Cloud Notification Mechanism (CNM)

  An interface mechanism to support cloud-based ingest messageing.

### Common Metadata Repository (CMR)

  "A high-performance, high-quality, continuously evolving metadata system that catalogs Earth Science data and associated service metadata records".  For more information, see [NASA's CMR page](https://cmr.earthdata.nasa.gov/).

### Collection (Cumulus)

  Cumulus Collections are logical sets of data objects of the same data type and version.

  For more information, see [cookbook reference page](data-cookbooks/setup.md#collections).

### Cumulus Message Adapter (CMA)

  A library designed to help task developers integrate step function tasks into a Cumulus workflow by adapting task input/output into the Cumulus Message format.

  For more information, see [CMA workflow reference page](workflows/input_output#cumulus-message-adapter).

### Distributed Active Archive Center (DAAC)

  Refers to a specific organization that's part of NASA's distributed system of archive centers.   For more information see [EOSDIS's DAAC page](https://earthdata.nasa.gov/about/daacs)

### Dead Letter Queue (DLQ)

  This refers to Amazon SQS Dead-Letter Queues - these SQS queues are specifically configured to capture failed messages from other services/SQS queues/etc to allow for processing of failed messages.

  For more on DLQs, see the [Amazon Documentation](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) and the [Cumulus DLQ feature page](features/dead_letter_queues.md).

### ECS

  Amazon's Elastic Container Service.   Used in Cumulus by workflow steps that require more flexibility than Lambda can provide.

  For more information, see [AWS's developer guide](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html).

### ECS Activity

  An ECS instance run via a Step Function.

### EMS

  [ESDIS Metrics System](https://earthdata.nasa.gov/about/science-system-description/eosdis-components/esdis-metrics-system-ems)

### Execution (Cumulus)

  A Cumulus execution refers to a single execution of a (Cumulus) Workflow.

### GIBS

  [Global Imagery Browse Services](https://earthdata.nasa.gov/about/science-system-description/eosdis-components/global-imagery-browse-services-gibs)

### Granule

  A granule is the smallest aggregation of data that can be independently managed (described, inventoried, and retrieved). Granules are always associated with a collection, which is a grouping of granules. A granule is a grouping of data files.

### IAM

  AWS Identity and Access Management.

  For more information, see [AWS IAMs](https://aws.amazon.com/iam/).

### Kes

  A tool used for managing and deploying AWS Cloudformation Stacks.  Used in Cumulus to deploy various stacks.

  For more information, see the [devseed documentation page](http://devseed.com/kes/).

### Kinesis

  Amazon's platform for streaming data on AWS.

  See [AWS Kinesis](https://docs.aws.amazon.com/kinesis/index.html) for more information.

### Lambda

  AWS's cloud  service that lets you run code without provisioning or managing servers.

  For more information, see [AWS's lambda page](https://aws.amazon.com/lambda/).

### Node

  See [node.js](https://nodejs.org/en/about).

### Npm

  Node package manager.

  For more information, see [npmjs.com](https://www.npmjs.com/).

### Operator

  Refers to those tasked with monitoring, configuring or otherwise utilizing Cumulus in an operational deployment.

### PDR

  "Polling Delivery Mechanism" used in "DAAC Ingest" workflows.

  For more information, see [nasa.gov](https://earthdata.nasa.gov/user-resources/standards-and-references/polling-with-delivery-record-pdr-mechanism).

### Packages (NPM)

  [NPM](https://www.npm.js.com) hosted node.js packages.   Cumulus packages can be found on NPM's site [here](https://www.npmjs.com/search?q=%40cumulus%2F)

### Provider

  Data source that generates and/or distributes data for Cumulus workflows to act upon.

  For more information, see the [Cumulus documentation](./data-cookbooks/setup#providers).

### Rule

  Rules are configurable scheduled events that trigger workflows based on various criteria.

  For more information, see the [Cumulus Rules documentation](./data-cookbooks/setup#rules).

### S3

  Amazon's Simple Storage Service provides data object storage in the cloud.   Used in Cumulus to store configuration, data and more.

  For more information, see [AWS's s3 page](https://imgs.xkcd.com/comics/marsiforming_2x.png).


### SIPS

  Science Investigator-led Processing Systems.   In the context of DAAC ingest, this refers to data producers/providers.

  For more information, see [nasa.gov](https://earthdata.nasa.gov/about/sips).

### SNS

  Amazon's Simple Notification Service provides a messaging service that allows publication of and subscription to events.   Used in Cumulus to trigger workflow events, track event failures, and others.

  For more information, see [AWS's SNS page](https://aws.amazon.com/sns/).

### SQS

  Amazon's Simple Queue Service.

  For more information, see [AWS's SQS page](https://aws.amazon.com/sqs/).

### Stack

  A collection of AWS resources you can manage as a single unit.

  In the context of Cumulus this is managed via [CloudFormation Templates](https://aws.amazon.com/cloudformation/aws-cloudformation-templates/).

### Step Function

  AWS's web service that allows you to compose complex workflows as a state machine comprised of tasks (Lambdas, activities hosted on EC2/ECS, some AWS service APIs, etc).   See [AWS's Step Function Documentation](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html) for more information.    In the context of Cumulus these are the underlying AWS service used to create Workflows.

### Workflows

  [Workflows](workflows/workflows-readme) are comprised of one or more AWS Lambda Functions and ECS Activities to discover, ingest, process, manage and archive data.
