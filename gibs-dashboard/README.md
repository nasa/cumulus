# GIBS Dashboard

A dashboard for operating GIBS running in AWS.

## Project Layout

* **app/** - Contains all code for the application, html, styles
  * **font/** - Fonts
  * **graphics/** - Images and icons
  * **scripts/** - Javascript Code
    * **components/** - Visual JSX compoents
    * **config/ & config.js** - Configuration files. Some of them are automatically generated during deployment.
    * **main.js** - The main entry point for the application.
    * **<other.js>** - These other javascript files define additional react actions and reducers.
  * **styles/** -
  * **index.html** -
* **bin/** - Scripts for deploying etc.
* **config/** - Configuration files for AWS.
* **test/** - Tests.

This project is setup using these technologies.

* React
* Redux
* Immutable.js for state

## Running Locally

```Bash
nvm use
npm install
npm start
```

After running this the website will load in your browser. The website will automatically load on changes.

## Running Tests

`npm test` runs all tests

`npm run lint` runs the linter

`npm run mocha` runs the mocha tests

## Deploy

Deploying requires two stack names.

1. Dashboard stack name - The name of the dashboard client itself.
2. GIBs Ops API stack name - The name of the stack used for deploying the GIBS Ops API. This is used to determine and configure the URL to use when talking to the API.

It also requires that the gibs-ops-api is checked out in a local directory.

Run the following with both specified stack names.

`bin/deploy.sh xx-gibs-dashboard xx-gibs-api`
