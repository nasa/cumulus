# GIBS Ops API

Provides an API for operating GIBS.

## Project layout

The project is laid out in the following structure

* **app/** - Contains the code for the application.
  * **views/** - Markdown and HTML for rendering documentation views.
  * **app.js** - Defines the routes of the application.
  * **local.js** - Runner for locally running.
  * **lambda.js** - Runner for when deployed in lambda.
* **bin/** - Scripts for deploying etc.
* **config/** - Configuration files for AWS.
* **public/** - Public files to expose. These are mostly CSS for documentation rendering.
* **test/** - Tests.

## Running Locally

Run this to start the application. It will specify which port it's listening on.

`npm start`

### Watching With Automatic Reload

It can also be run in a way that will automatically recompile and restart the app on every change to the file system. This is good when actively developing the project.

`npm run start-watch`

### Debug Mode

You can also start it in debug mode to debug problems using the Chrome dev tools

`npm run start-debug`

This will output a message like

```
To start debugging, open the following URL in Chrome:
    chrome-devtools://devtools/bundled/inspector.html?experiments=true&v8only=true&ws=127.0.0.1:9229/bae74702-93c5-44dd-ab30-fe29a9bddbb9
```

Open up Chrome to that URL and then you can use Chrome dev tools to set break points

## Running Tests

Tests can be run with the following command.

`npm test`

You can also run linting individually.

`npm run lint`

You can run the mocha tests individually.

`npm run mocha`

### Running tests in Bamboo

Run eslint.  This is a pass / fail test.

```(bash)
docker run \
  --rm \
  -v "$(pwd):/source:ro" \
  -w /source \
  node \
  npm run lint
```

Run mocha tests.  This creates **test-results.xml**.

```(bash)
docker run \
  -e RELEASE_UID=$(id -u) \
  -e RELEASE_GID=$(id -g) \
  --rm \
  -v "$(pwd):/source" \
  node \
  /source/ngap/bamboo/mocha_in_docker.sh
```

## Deploy

To deploy to NGAP, run **ngap/bamboo/deploy_to_ngap.sh**.  It expects the following environment variables to be set:

* bamboo_APP_NAME
* bamboo_NGAP_API
* bamboo_NGAP_API_PASSWORD

It also expects **release.tar** to be present.  That release package can be created with

```(bash)
docker run \
  -e RELEASE_UID=$(id -u) \
  -e RELEASE_GID=$(id -g) \
  --rm \
  -v "$(pwd):/source" \
  -w /source \
  node \
  /source/ngap/bamboo/npm_release_in_docker.sh
```

## Configure IAM permissions

IAM permissions required by this project are defined in **config/iam-permissions.yml**.

### Update IAM permissions in the ngap-test account

```(bash)
aws cloudformation --region=us-east-1 deploy \
  --stack-name ngap-test-gibs-ops-api-iam \
  --template-file ./config/iam-permissions.yml \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM
```
