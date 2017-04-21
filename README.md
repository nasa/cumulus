# GIBS Dashboard

A dashboard for operating GIBS running in AWS.

## Project Layout

TODO describe the project layout.

TODO describe how to add a new page and API operation

## Running Locally

```Bash
nvm use
npm install
npm start
```

After running this the website will load in your browser. The website will automatically load on changes.

## Deploy

Deploying requires two stack names.

1. Dashboard stack name - The name of the dashboard client itself.
2. GIBs Ops API stack name - The name of the stack used for deploying the GIBS Ops API. This is used to determine and configure the URL to use when talking to the API.

It also requires that the gibs-ops-api is checked out in a local directory.

Run the following with both specified stack names.

`bin/deploy.sh xx-gibs-dashboard xx-gibs-api`

## TODOs

* define state
* Add in the actions and reducers
* Add tests
* Update eslint definition
* Finish documenting this file
* Consider combining the repositories


## Random notes

There are multiple states to data

1. Not present
2. In flight (in the process of being requested as cumulus refers to it)
3. Present with a value

We need to represent the state of the store.

State:

Any of the keys may not be present.

```Javascript
{ apiHealth: { healthy: true, inFlight: true } }
```

Actions:

* API_HEALTH_IN_FLIGHT - Represents a change to the state to indicate the health request has been made.
  * This would be represented in the store to indicate
* API_HEALTH_RCVD - Represents a change to the state to indicate API health has been received.
  * Should include healthy true or false

Action Creators:

* getApiHealth
  * Starts requesting the API health.
* receiveApiHealth
  * Marks the state updated to be healthy or not. Also marks inflight to false.

Project layout

* scripts
  * components
    * ...
  * actions.js
    * At the top level for now. It can be split up as it makes sense later.
  * reducers.js
  * api.js

What do we want to test?

* reducers
* possibly combination of actions, apis, reducers and the api.
  * This would be an integration test that did not include the GUI at all.
* GUI
  * Is there a way to test that the GUI is rendered correctly in the presence of some specific actions?
  * We would do a test of the GUI combining components, store, and actions manually injected.