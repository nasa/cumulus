---
id: version-v1.10.3-docs-how-to
title: Cumulus Documentation: How To's
hide_title: true
original_id: docs-how-to
---

# Cumulus Docs Installation

# Local Setup

```sh
git clone git@github.com:nasa/cumulus
cd cumulus
npm run docs-install
npm run docs-serve
```

Note: `docs-build` will build the documents into `website/build/Cumulus`.

## Cumulus Documentation

Our project documentation is hosted on [GitHub Pages](https://pages.github.com/). The resources published to this website are housed in `docs/` directory at the top of the Cumulus repository. Those resources primarily consist of markdown files and images.

We use the open-source static website generator [Docusaurus](https://docusaurus.io) to build html files from our markdown documentation, add some organization and navigation, and provide some other niceties in the final website (search, easy templating, etc.).

### Add a New Page and Sidebars

Adding a new page should be as simple as writing some documentation in markdown, placing it under the correct directory in the `docs/` folder and adding some configuration values wrapped by `---` at the top of the file. There are many files that already have this header which can be used as reference.

```
---
id: doc-unique-id    # unique id for this document. This must be unique accross ALL documentation under docs/
title: Title Of Doc  # Whatever title you feel like adding. This will show up as the index to this page on the sidebar.
hide_title: true     # So the title of the Doc doesn't show up at the top of the webpage (generally we already have the title written as h1 in the documentation).
---
```

**Note:** To have the new page show up in a sidebar the designated `id` must be added to a sidebar in the `website/sidebars.json` file. Docusaurus has an in depth explanation of sidebars [here](https://docusaurus.io/docs/en/navigation).

### Versioning Docs

We lean heavily on Docusaurus for versioning. Their suggestions and walkthrough can be found [here](https://docusaurus.io/docs/en/versioning). It is worth noting that we would like the Documentation versions to match up directly with release versions. Cumulus versioning is explained in the [Versioning Docs](https://github.com/nasa/cumulus/tree/master/docs/development/release.md).

## Add a new task
The tasks list in docs/tasks.md is generated from the list of task package in the task folder. Do not edit the docs/tasks.md file directly.

[Read more about adding a new task.](adding-a-task.md)

## Editing the tasks.md header or template

Look at the `bin/build-tasks-doc.js` and `bin/tasks-header.md` files to edit the output of the tasks build script.

## Deployment
The `master` branch is automatically built and deployed to `gh-pages` branch. The `gh-pages` branch is served by Github Pages. Do not make edits to the `gh-pages` branch.
