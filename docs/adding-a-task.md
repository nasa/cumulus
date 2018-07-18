# Adding a task

We're tracking reusable Cumulus tasks [in this list]() and, if you've got one you'd like to share with others, you can add it!

Right now we're focused on tasks distributed via npm, but are open to including others. For now the script that pulls all the data for each package only supports npm.

## The tasks.md file is generated in the build process
The tasks list in docs/tasks.md is generated from the list of task package names in tasks.json.

Do not edit the docs/tasks.md file directly.

Instead, add the package name to the tasks.json file.

## Add your task to tasks.json

Before making any contributions, please review the [contributing guidelines](https://github.com/cumulus-nasa/cumulus-nasa.github.io/blob/develop/CONTRIBUTING.md).

Once you've done that, check that your package.json file has the following:

- a `description`
- a `homepage` url ([npm docs on `homepage`](https://docs.npmjs.com/files/package.json#homepage))
- a `repository` url ([npm docs on `respository`](https://docs.npmjs.com/files/package.json#repository))

Make sure your task is published to npm. That's required by our script that pulls package metadata for our list.

Next, create a pull request that adds your package name to the array in [tasks.json](https://github.com/cumulus-nasa/cumulus-nasa.github.io/blob/develop/tasks.json).

The order doesn't matter. We sort them into alphabetical order in the build script.

Someone from the Cumulus core team will take a look and let you know if we need any other info about the task.
