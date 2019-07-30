---
id: lambda
title: Develop Lambda Functions
hide_title: true
---

# Develop Lambda Functions

## Develop a new Lambda

To develop a new lambda from a sample, create a new folder in `cumulus/tasks/` and run `npm init`:

```bash
  $ cd ../cumulus/tasks
  $ mkdir new-lambda
  $ cd new-lambda
  $ npm init
```

Or copy an existing lambda function to customize:

```bash
  $ cd ../cumulus/tasks
  $ cp discover-pdrs new-lambda
```

Modify package.json:

* name
* version
* description
* test script
* dependencies (NOT devDependencies)

## Build a Lambda

To build Node.js lambda functions, use webpack to pack the Lambda code into a single `.js` file with dependencies:

```bash
  $ npm run build
```

Alternatively, to monitor for changes and auto-rebuild:

```bash
  $ npm run watch
```

For non-node lambdas not included in Cumulus repo, upload .zip to s3 and modify lambdas.yml as previously shown.

## Deploy a Lambda

For new Node.js lambdas, update `<daac>-deploy/lambdas.yml` by adding a new entry.

```yaml
    <LambdaName>:                                   # eg:  LambdaSample (does not need to conform to dirname)
      handler: <dir>.<function>                     # eg:  sample-lambda.handler (assuming file has module.exports.handler = <someFunc>)
      timeout: <s>                                  # eg:  300
      source: 'node_modules/@cumulus/<dir>/dist/'   # eg:  '../cumulus/cumulus/tasks/sample-lambda/dist/index.js'
      useMessageAdapter: true                       # necessary if this Lambda is included as part of a Cumulus workflow
      layers:                                       # Optional to use Lambda Layers
        - <layer1-arn>
```

For non-Node.js lambda code (e.g. python) uploaded as a .zip to an S3 bucket:

```yaml
  PyLambda:
    handler: <file.py>.<function>               # eg:  lambda_handler.handler for lambda_handler.py with:  def handler(event, context):
    timeout: <s>
    s3Source:
      bucket: '{{buckets.internal.name}}'       # refers to bucket set in config.yml
      key: deploy/cumulus-process/<dir>/<file>  # eg: deploy/cumulus-process/modis/0.3.0b3.zip
    runtime: python2.7                          # Node is default, otherwise specify.
```

To deploy all changes to `/tasks/` and `lambdas.yml`:

```bash
  $ kes cf deploy --kes-folder app --template ../cumulus/packages/deployment/app --region <region> --deployment <deployment-name> --role <arn:deployerRole>
```

To deploy modifications to a single lambda package:

```bash
  $ kes lambda <LambdaName> --kes-folder app --template ../cumulus/packages/deployment/app --deployment <deployment-name> --role <arn:deployerRole>
```