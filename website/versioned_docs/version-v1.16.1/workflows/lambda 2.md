---
id: version-v1.16.1-lambda
title: Develop Lambda Functions
hide_title: true
original_id: lambda
---

# Develop Lambda Functions

## Develop a new Cumulus Lambda

AWS provides great getting started guide for building Lambdas in the [developer guide](https://docs.aws.amazon.com/lambda/latest/dg/getting-started.html).

Cumulus currently supports the following environments for Cumulus Message Adapter enabled functions:

* [Node.js 8.10](https://docs.aws.amazon.com/lambda/latest/dg/programming-model.html)
* [Java 8](https://docs.aws.amazon.com/lambda/latest/dg/java-programming-model.html)
* [Python 2.7, 3.6](https://docs.aws.amazon.com/lambda/latest/dg/python-programming-model.html)

Additionally you may chose to include any of the other languages AWS [supports](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) as a resource with reduced feature support.

## Deploy a Lambda

### Node.js Lambda

For a new Node.js Lambda, create a new function and add an `aws_lambda_function` resource to your Cumulus deployment (for examples, see the example in source [example/lambdas.tf](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/lambdas.tf) and [ingest/lambda-functions.tf](https://github.com/nasa/cumulus/blob/master/tf-modules/ingest/lambda-functions.tf)) as either a new `.tf` file, or added to an existing `.tf` file:

```hcl
resource "aws_lambda_function" "myfunction" {
  function_name    = "${var.prefix}-function"
  filename         = "/path/to/zip/lambda.zip"
  source_code_hash = filebase64sha256("/path/to/zip/lambda.zip")
  handler          = "index.handler"
  role             = module.cumulus.lambda_processing_role_arn
  runtime          = "nodejs8.10"

  tags = { Deployment = var.prefix }

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_group_ids
  }
}
```

**Please note**: This example contains the minimum set of required configuration.

Make sure to include a `vpc_config` that matches the information you've provided the `cumulus` module if intending to integrate the lambda with a Cumulus deployment.

Also note that for this example to work, you will need to have `default_tags` defined as in the [example](https://github.com/nasa/cumulus/blob/master/example/cumulus-tf/main.tf), or in the [template-deploy-repo](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/main.tf).

**Please note**: Cumulus follows the convention of tagging resources with the `prefix` variable `{ Deployment = var.prefix }` that you pass to the `cumulus` module.   For resources defined outside of Core, it's recommended that you adopt this convention as it makes resources and/or deployment recovery scenarios much easier to manage.

### Java Lambda

Java Lambdas are created in much the same way as the Node.js example [above](#node.js-lambda).

The source points to a folder with the compiled .class files and dependency libraries in the Lambda Java zip folder structure (details [here](https://docs.aws.amazon.com/lambda/latest/dg/create-deployment-pkg-zip-java.html)), not an uber-jar.

The deploy folder referenced here would contain a folder 'test_task/task/' which contains Task.class and TaskLogic.class as well as a lib folder containing dependency jars.

### Python Lambda

Python Lambdas are created the same way as the Node.js example [above](#node.js-lambda).

## Cumulus Message Adapter

For Lambdas wishing to utilize the [Cumulus Message Adapter(CMA)](cumulus-task-message-flow), you should define a `layers` key on your Lambda resource with the CMA you wish to include. See the [input_output docs](workflows/input_output.md) for more on how to create/use the CMA.

## Other Lambda Options

Cumulus supports all of the options available to you via the `aws_lambda_function` Terraform resource.   For more information on what's available, check out the [Terraform resource docs](https://www.terraform.io/docs/providers/aws/r/lambda_function.html).

### Cloudwatch log groups

If you want to enable [Cloudwatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/index.html) logging for your Lambda resource, you'll need to add a `aws_cloudwatch_log_group` resource to your Lambda definition:

```hcl
resource "aws_cloudwatch_log_group" "myfunction_log_group" {
  name = "/aws/lambda/${aws_lambda_function.myfunction.function_name}"
  retention_in_days = 30
  tags = { Deployment = var.prefix }
}
```
