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

## Deploy

Run the following command with the stack name to use. (Suggested name is your `first two initials + -gibs-api`)

`bin/deploy.sh my-stack-name`
