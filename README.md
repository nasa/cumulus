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
