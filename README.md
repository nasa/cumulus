# Cumulus Framework

## Installing and deploying

### Prerequisites

* node.js >= 4.3 (https://nodejs.org/en/). We recommend using nvm (https://github.com/creationix/nvm)
* AWS CLI (http://docs.aws.amazon.com/cli/latest/userguide/installing.html)
* Ruby
* BASH
* Docker (only required for building new container images)

Install the correct node version:

```
nvm install 4.3
```

Ensure that the aws cli is configured and that the default output format is either JSON or None:

```
aws configure
```

### Deployment

Deploy a new stack into AWS
```
$ bin/deploy my-stack-name
```

See `bin/deploy --help` for information about the multitude of deployment options
