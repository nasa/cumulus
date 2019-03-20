---
id: version-v1.10.1-doc_installation
title: Cumulus Docs Installation
hide_title: true
original_id: doc_installation
---

# Cumulus Docs

# Local Setup

```sh
git clone git@github.com:nasa/cumulus
cd cumulus
npm install
npm run docs-serve
```

## Add a new page
Add a `.md` file to `docs` folder and then a new item to `SUMMARY.md`.

## Add a new task
The tasks list in docs/tasks.md is generated from the list of task package in the task folder. Do not edit the docs/tasks.md file directly.

[Read more about adding a new task.](adding-a-task.md)

## Editing the tasks.md header or template

Look at the `bin/build-tasks-doc.js` and `bin/tasks-header.md` files to edit the output of the tasks build script.

## Deployment
The `master` branch is automatically built and deployed to `gh-pages` branch. The `gh-pages` branch is served by Github Pages. Do not make edits to the `gh-pages` branch.
