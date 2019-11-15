# @cumulus/api

## An API for the Cumulus Framework

This module builds the Cumulus API for the Cumulus framework. It uses a combination of AWS services to create an API interface for configuring, managing and monitoring the Cumulus framework.

For the full documentation of the API see <https://nasa.github.io/cumulus-api>.

## Development

### Running the API locally

To run the API locally using Localstack for AWS services without Earthdata authentication required:

```bash
  npm run serve
```

To run the API locally using Localstack for AWS services with Earthdata authentication required:

```bash
  EARTHDATA_CLIENT_ID=<your_client_id> \
    EARTHDATA_CLIENT_PASSWORD=<your_password> \
    USERNAME=<username> \
    npm run serve-oauth
```

**Note**: The Cumulus API checks whether the username used to login with Earthdata is an allowed user for the API. In order to add your Earthdata username as an allowed user when running the API against Localstack, you must specify it using the `USERNAME` environment variable.

To run the API locally using your deployed stack with Earthdata authentication required:

```bash
  stackName=<your_stack_name> \
    system_bucket=<your_system_bucket> \
    EARTHDATA_CLIENT_ID=<your_client_id> \
    EARTHDATA_CLIENT_PASSWORD=<your_password> \
    ES_HOST=<your_elasticsearch_host> \
    npm run serve-remote
```

**Please note that if your Elasticsearch instance is deployed behind a VPC, your local endpoints will not be able to interact with it.**

If Elasticsearch is not deployed behind a VPC and you want endpoints that interact with Elasticsearch to work, you must specify the `ES_HOST` environment variable for this command.

You can get the value for `ES_HOST` for your stack using the AWS CLI, where `<your_es_domain_name>` is the value of `<stackName>-<es.name>` for your app deployment in config.yml:

```bash
  aws es describe-elasticsearch-domain --domain-name <your_es_domain_name> --query 'DomainStatus.Endpoint'
```

### Running the distribution API locally

To run the distribution API locally using Localstack for AWS services without Earthdata authentication required:

```bash
  npm run serve-dist
```

To run the distribution API locally using Localstack for AWS services with Earthdata authentication required:

```bash
  EARTHDATA_CLIENT_ID=<your_client_id> EARTHDATA_CLIENT_PASSWORD=<your_password> npm run serve-dist-oauth
```

To run the distribution API locally using your deployed stack with Earthdata authentication required:

```bash
  stackName=<your_stack_name> \
    EARTHDATA_CLIENT_ID=<your_client_id> \
    EARTHDATA_CLIENT_PASSWORD=<your_password> \
    npm run serve-dist-remote
```

In order for the locally running API to interact with your deployed stack, you must set the `stackName` environment variable for this command, which should match the stack name in Cloudformation for your app deployment. (default: `prefix` in config.yml)

### Config

Includes the Kes configuration files needed for the deployment of the Api:

- `config/lambdas.yml`: Includes that Lambdas that do internal Api related tasks such as listening to SNS events or consuming SQS queues
- `config/api_v1.yml`: Includes all the Api endpoints and is versioned. Future versions of the Api should duplicate and rename this file
- `config/distribution.yml`: Includes config needed for the distribution endpoint that handles file downloads with EarthLogin

## Command Line Interface

A command line interface is available to provide some additional API functionality. To see the available commands, install the Cumulus API package and run `cumulus-api --help`.

## Running Tests

Running tests for message-consumer depends on localstack. Once you have installed localstack, start it:

```bash
localstack start
```

Then you can run tests locally via:

```bash
LOCALSTACK_HOST=localhost IS_LOCAL=true npm run test
```

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).
