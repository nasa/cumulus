# Cumulus Api Versioning:

Original document about the versioning is posted [here](https://docs.google.com/document/d/1UbJE_U3CEYvSho9uuBrwZlEGubZlAvT1MsYk_LnaUgQ/edit). This document goes over the issues that were discovered during implementation of API versioning and proposes a solution on how to resolve them.

## Background

The current implementation of Cumulus Api uses a Kes configuration file to build the lambdas and apiGateway endpoints needed to deploy the api.

An example entry of a lambda function with its path in a Kes configuration file looks like this:

    ApiExecutions:

## How to Version (the original plan)

These configurations for the api are stored in a file called `api.yml` which is then referenced in the larger Kes configuration file.  The original plan was to have separate `api.yml` files that are configured for `default`, `v1`, and future versions. For example, the version 1 file would be `api_v1.yml`.

## The problem with the original plan

Since each `api.yml` file includes lambda function information, when we have a separate configuration for `api.yml` and `api_v1.yml` we will end up with duplicate lambda functions that have the same code and do the same thing but are created twice because of how we have organized the configuration files.

Here are two small examples to describe the problem:

## api.yml (default)

    ApiExecutions:

## api_v1.yml

    ApiExecutionsV1:

This is not ideal, although it is not catastrophic either because you only pay for the lambdas and apiGateway endpoints that are used. Therefore having redundant lambdas does not have a cost impact.

However, it results in a very crowded list of API endpoints and lambda functions and could potential management, configuration and bug fixes ramifications.

## Alternatives

## Alternative 1

Include default and v1 path in the same file. Example:

    ApiCollections:

**Advantage:** No duplicate lambdas

**Disadvantage:** Difficult to manage the config file and a bit confusing

**Level of Effort:** Minimal

## Alternative 2

Rework how Kes configuration is structured now in order to separate the ApiGateway paths from the lambda functions. In this alternative, we will define the Lambda functions separately and the endpoints separately and somehow make a connection between them.

**Advantage:**

- easier to manage
- possible to reuse lambdas for unrelated endpoints

**Disadvantage:**

- Requires changing the `cloudformation.template.yml` and `kes.override.js`
- More difficult to implement

**Level of Effort:** High

## Alternative 3

Pass version as a variable from ApiGateway to the Lambda function and let the lambda function handles the version. 

the `versionNumber`  is passed to the lambda as a variable. The lambda function for that Api endpoint will decide what to call internally based on the version number provided.

**Advantage:**

- The configuration file becomes simpler. There is need for `api_vX.yml` files. A single `api.yml` will cover all the versions

**Disadvantage:**

- Requires updates to the existing lambda files
- Might involve complicated logic inside each lambda function to cover code consistency in the future
- More difficult to test

**Level of Effort:** High

## Next Action:

We are going to rename the `api.yml`  to `api_v1.yml` and include both `default`  and `v1` paths there as shown in Alternative 1. When the daacs are transitioned to use the v1 path, we will remove the default path from the config file.

When we decide to have a v2, we will revisit this document and decide how the version 2 is going to be implemented.

This approach requires least amount of change in the existing code and carries little risk.