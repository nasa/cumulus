---
id: python-best-practices
---

# Python Best Practices

## Package Management

Package and project management in Python is managed using [uv](https://docs.astral.sh/uv/). The sections below provide a brief overview of starting a new project with `uv` or migrating a current project into using `uv`.

### Initializing a New Python Project

To start a new project or module, under the proper directory run `uv init <name>` where `<name>` is the name of the project or module. The init will create the _`<name>` folder_, _pyproject.toml_, _README.md_, and _main.py_ files. It is recommended to layout the structure of the code like the image below. The _src_ folder contains the code for the module, library, or application. The _tests_ folder contains the unit and integration tests for the application. The _bin_ folder contains utility scripts for building, testing, deploying or performing other utilities with the code. The _deploy_ folder contains the infrastructure as code for deploying the project or task into AWS.

```text
.
└── python-reference-task
    ├── bin
    │   └── package.sh
    ├── Dockerfile
    ├── package.json
    ├── pyproject.toml
    ├── README.md
    ├── src
    │   ├── main.py
    │   └── python_reference_task
    │       ├── __init__.py
    │       ├── schema.py
    │       └── task.py
    ├── deploy
    │   ├── main.tf
    │   ├── output.tf
    │   └── variables.tf
    └── tests
        ├── integration_tests
        └── unit_tests
            ├── __init__.py
            ├── python_reference_task
            │   ├── __init__.py
            │   └── test_task.py
            └── test_main.py
```

### Migrating a Current Python Project

To migrate a current Python project to uv, perform the following steps.

1. `cd` to the app directory.
2. Run the `uv init` command to create the _pyproject.toml_ file.
3. Run the `uv add -r requirements.txt` to update the _pyproject.toml_ and lock dependency versions in the _uv.lock_ files.
4. Remove the _requirements.txt_ file as the requirements are now tracked by `uv`.

### Updating PyProject.toml

As a minimum, the following fields in the _pyproject.toml_ file should be filled out completely, as seen below.

- Under `project`
  - name
  - version
  - description
  - readme
  - requires-python
- Under `project.urls`
  - homepage
  - documentation
  - repository

Below is an example of a minimally filled out _pyproject.toml_ file.

```toml
[project]
name = "example-app"
version = "0.0.1"
description = "This is a long description of what the app is and what it does."
readme = "README.md"
requires-python = ">=3.14"

[project.urls]
homepage = "https://github.com/nasa/cumulus/blob/master/example-app/"
documentation = "https://github.com/nasa/cumulus/blob/master/example-app/README.md"
repository = "https://github.com/nasa/cumulus.git"

```

## Code Quality and Format

Python projects in this repo leverage [ruff](https://docs.astral.sh/ruff/) for code linting and formatting and [mypy](https://mypy.readthedocs.io/en/stable/) for type checking.

To add `ruff` to the project run the command `uv tool install ruff`. To add `mypy` to the project, run `uv add --dev mypy`

To check the quality of your code run `npm run lint`. To run the checks individually use the following commands.

- Python linting - `uvx ruff check .`
- Python formatting - `uvx ruff format --diff .`
- Python type checking - `uv run mypy $(find . -type f -name "*.py")`

### Configuring Ruff

The Ruff configuration found in the [root pyproject.toml file](https://github.com/nasa/cumulus/blob/master/pyproject.toml) contains the ruff configuration for the project. Ruff configuration can be extended or overridden using the [extend feature](https://docs.astral.sh/ruff/settings/#extend).

:::warning Extend Feature

Use of the extend feature for ruff should generally be avoided so that the current global configuration is applied consistently everywhere. Only use the extend feature for when absolutely necessary, providing ample documentation for the deviation from the current global settings.

:::

### Configuring MyPy

The MyPy configuration can be found in the [root pyproject.toml file](https://github.com/nasa/cumulus/blob/master/pyproject.toml).

## Code Auditing

Python projects in this repo use [uv-secure](https://github.com/owenlamont/uv-secure) to check for code security.

To add `uv-secure` to the project, run the command `uv tool install uv-secure`.

To audit the dependencies of your code run `npm run audit` or `uvx uv-secure`. Configuration for `uv-secure` is found in the [root pyproject.toml file](https://github.com/nasa/cumulus/blob/master/pyproject.toml).

## Code Testing and Coverage

The testing framework for python projects in [pytest](https://docs.pytest.org/en/stable/).

To add `pytest` to the project run the command `uv add --dev pytest pytest-cov`.

To configure `pytest` add commandline options for `pytest` in the `pyproject.toml` file like the example seen below. More `pytest` options are available in the [documentation](https://docs.pytest.org/en/stable/reference/reference.html#ini-options-ref). Additional options for `pytest-cov` are found in the [pytest-cov documentation](https://pytest-cov.readthedocs.io/en/latest/config.html).

```toml
[tool.pytest]
minversion = "9.0"
addopts = [
    "--maxfail=1",
    "-ra",
    "-q",
    "--cov=myproject",
    "--cov-report=lcov:.nyc_output"
]
testpaths = [
    "tests",
]
```

To run `pytest` use the command `uv run pytest`.

In addition to `pytest`, developers should strongly consider using [moto](https://docs.getmoto.org/en/latest/) for mocking AWS services within code when using the boto3 SDK and the AWS API. The [moto](https://github.com/getmoto/moto?tab=readme-ov-file) library is the preferred library for performing unit tests against AWS mocked services.

## Code Documentation

It is expected that whenever possible the code functionality should be documented via a README that includes critical usage and development information such as inputs, outputs, internal and external dependencies, use cases, and critical development information. In addition, the README markdown file should utilize the proper template and conform with [markdown quality standards](docs/development/quality-and-coverage.md).
