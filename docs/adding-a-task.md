---
id: adding-a-task
title: Contributing a Task
hide_title: false
---


We're tracking reusable Cumulus tasks [in this list](tasks.md) and, if you've got one you'd like to share with others, read on to learn how.

## The tasks.md file is generated in the build process

The tasks list in docs/tasks.md is generated from the list of task package names from the tasks folder.

:::caution

Do not edit the docs/tasks.md file directly.

:::


## Software Best Practices and Expectations

The repository uses lerna to manage the repository. Please reference the [Quality and Coverage documentation](development/quality-and-coverage.md) and the [Python Best Practices](development/python-best-practices.md) or [TypeScript Best Practices](development/typescript-best-practices.md) documentation for expectations and tooling for the specific language.

## Example Templates and Task Messaging

Example templates have been created for both [Python](https://github.com/nasa/cumulus/tree/master/example/lambdas/python-reference-task) and [Typescript](https://github.com/nasa/cumulus/tree/master/tasks/add-missing-file-checksums) tasks for developers that exhibit the best practices and expectations for creating a Cumulus task. Tasks should conform to the Cumulus Message Adapter Schema for inter task messaging. This is the accepted input and output scheme.


## Task Layout and Standards

### Creating a task

To create a task, start by making a directory under the tasks directory. The new task directory name should be a descriptive name of the task. the name should be in lower case with `-` used in place of spaces. Copy the contents of the task language example to the new task directory.

The new task directory should look something like the following. Note that the files may differ slightly depending on the language. Files marked with a `*` indicate a language specific file or folder.

```text
.
├── bin
│   └── package.sh
├── Dockerfile
├── package.json
├── pyproject.toml*
├── README.md
├── schemas
│   ├── config.json
│   ├── input.json
│   └── output.json
├── src
│   ├── main.py*
│   └── python_refrence_task*
│       ├── __init__.py*
│       ├── schema.py*
│       └── task.py*
├── deploy
│   ├── main.tf
│   ├── output.tf
│   └── variables.tf
├── tests
│   ├── integration_tests
│   └── unit_tests
│       ├── __init__.py*
│       ├── python_reference_task*
│       │   ├── __init__.py*
│       │   └── test_task.py*
│       └── test_main.py*
├── tsconfig.json*
└── webpack.config.js*
```

:::note

Those files and directories with a trailing `*` are language specific files and directories and may not be present depending on the language and example template related to the task.

:::

### Explanation of directories

The task layout should include the following directories.

#### `src` directory

The `src` directory should contain the code for your task.

#### `tests` directory

The `tests` directory should contain all unit tests and if possible, all integraton tests.

#### `deploy` directory

The `deploy` directory should contain the terraform code for deploying the task.

#### `schemas` directory

The `schemas` directory contains JSON schemas for the input, output , and configuration the task. These files can be generated documentation or JSON schema documentation used for interface validation.

#### `bin` directory

The `bin` directory contains various scripts, often written in bash, to help build, test, and deploy the task.

### Explanation of files

The task should contain the following files.

#### `README.md` file

The `README.md` file should provide sufficient documentation about the task. The template for the task README.md file can be found below. Those strings surrounded by `<>` are indicators where a developer should replace the information with that specific to the task.

```md
# @cumulus/<task-name>

<Extended description of what the task does along with any unique use cases, corner cases, or functionality explained.>

## Usage

This lambda takes the following input and config objects, derived from workflow configuration using the [Cumulus Message Adapter](https://github.com/nasa/cumulus-message-adapter/blob/master/CONTRACT.md) to drive configuration from the full cumulus message. The output from the task follows the Cumulus Message Adapter contract and provides the information detailed below.

### Configuration

<This section provides information on the configuration along with a schema for valid configuration settings, and an example of a valid configuration that is expected.>

### Input

<This section provides information on the task input along with a schema for valid input values and an example of a valid input.>

### Output

<This section provides information on the task output. This section may include a schema for a valid output, and example of a message output, and any other example artifacts and/or descriptions related to the final products and functionality of the task.>

### Example workflow configuration

<This section explains how the task should be configured in a workflow and provide a valid workflow configuration block example of using the task in a workflow.>

### Example use in workflow

<This section provides an example of the task in a workflow and ideally point to an workflow integration task that uses the task in the repository.>

## Architecture

<This section should provide a brief description of the task architecture. Ideally, an architectural drawing should be provided if able.>

### Internal Dependencies

<This section should describe any internal dependencies on Cumulus the task relies on. Examples may include the Cumulus catalog API, database, or AWS specific components like S3 or SNS.>

### External Dependencies

<This section should describe any external dependencies the task relies on. Examples include CMR, LZRDS, or other enterprise applications.>

## Development and Deployment

<This section is optional and provides any specifics that are unique to developing with this task. This may include specific use cases and unit tests, test files, or development strategies. This section may also contain instructions for deploying the task as an individual lambda without the entire Cumulus stack or as a part of a trimmed down deployment that can be used for testing.>

## Contributing

To make a contribution, please [see our Cumulus contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md) and our documentation on [adding a task](https://nasa.github.io/cumulus/docs/adding-a-task)

## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)
```

#### `package.json` file

The `package.json` file contains information on the task including executable commands for scripts to perform quality checking, building, and deploying of tasks. 

:::note

In Python tasks, the `package.json` file is generated from the `pyproject.toml` file using a script. This file is used throughout the repository to perform repo wide CI/CD builds, deploys, and testing.

:::

## Quality Testing, Building, and Deploying

All tasks should have worthwhile unit tests that accurately represent the input/output data that is expected from the task. Tasks should have a minimum of 80% coverage for unit tests. In addition to unit tests, integration tests should also be created and automated. Generally, integration tests should be done using the proper generic workflow patterns the task is expected to be a part of that covers known use cases. Additional Enterprise level testing verification and validation will be done in coordination with the Enterprise Test and Quality team in a production like setting and with production like data to validate performance and regression tests for any potential production issues.

The task should build using one of two methods. For tasks that will be packaged for AWS lambdas, a zip file should be created for deployment. All other tasks should be built using an OCI compliant image. Examples of both build types are available in the language specific example.

Deploying a task should be self contained as a terraform module. The task should be able to be deployed either as itself and as part of the larger software deployment.
