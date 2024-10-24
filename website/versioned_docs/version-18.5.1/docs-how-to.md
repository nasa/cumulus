---
id: docs-how-to
title: "Cumulus Documentation: How To's"
hide_title: false
---

## Cumulus Docs Installation

### Run a Local Server

Environment variables `DOCSEARCH_APP_ID`, `DOCSEARCH_API_KEY` and `DOCSEARCH_INDEX_NAME` must be set for search to work. At the moment, search is only truly functional on prod because that is the only website we have registered to be indexed with DocSearch (see below on search).

```sh
git clone git@github.com:nasa/cumulus
cd cumulus
npm run docs-install
npm run docs-serve
```

:::note

`docs-build` will build the documents into `website/build`.
`docs-clear` will clear the documents.

:::

:::caution

Fix any broken links reported by Docusaurus if you see the following messages during build.

[INFO] Docusaurus found broken links!

Exhaustive list of all broken links found:

:::

### Cumulus Documentation

Our project documentation is hosted on [GitHub Pages](https://pages.github.com/). The resources published to this website are housed in `docs/` directory at the top of the Cumulus repository. Those resources primarily consist of markdown files and images.

We use the open-source static website generator [Docusaurus](https://docusaurus.io/docs) to build html files from our markdown documentation, add some organization and navigation, and provide some other niceties in the final website (search, easy templating, etc.).

#### Add a New Page and Sidebars

Adding a new page should be as simple as writing some documentation in markdown, placing it under the correct directory in the `docs/` folder and adding some configuration values wrapped by `---` at the top of the file. There are many files that already have this header which can be used as reference.

```markdown
---
id: doc-unique-id    # unique id for this document. This must be unique across ALL documentation under docs/
title: Title Of Doc  # Whatever title you feel like adding. This will show up as the index to this page on the sidebar.
hide_title: false
---
```

:::note

To have the new page show up in a sidebar the designated `id` must be added to a sidebar in the `website/sidebars.js` file. Docusaurus has an in depth explanation of sidebars [here](https://docusaurus.io/docs/en/navigation).

:::

#### Versioning Docs

We lean heavily on Docusaurus for versioning. Their suggestions and walk-through can be found [here](https://docusaurus.io/docs/versioning). Docusaurus v2 uses snapshot approach for documentation versioning. Every versioned docs does not depends on other version.
It is worth noting that we would like the Documentation versions to match up directly with release versions. However, a new versioned docs can take up a lot of repo space and require maintenance, we suggest to update existing versioned docs for minor releases when there are no significant functionality changes.  Cumulus versioning is explained in the [Versioning Docs](https://github.com/nasa/cumulus/tree/master/docs/development/release.md).

#### Search

Search on our documentation site is taken care of by [DocSearch](https://docsearch.algolia.com/). We have been provided with an `apiId`, `apiKey` and an `indexName` by DocSearch that we include in our `website/docusaurus.config.js` file. The rest, indexing and actual searching, we leave to DocSearch. Our builds expect environment variables for these values to exist - `DOCSEARCH_APP_ID`, `DOCSEARCH_API_KEY` and `DOCSEARCH_NAME_INDEX`.

#### Add a new task

The tasks list in docs/tasks.md is generated from the list of task package in the task folder. Do not edit the docs/tasks.md file directly.

[Read more about adding a new task.](adding-a-task.md)

#### Editing the tasks.md header or template

Look at the `bin/build-tasks-doc.js` and `bin/tasks-header.md` files to edit the output of the tasks build script.

#### Editing diagrams

For some diagrams included in the documentation, the raw source is included in the `docs/assets/raw` directory to allow for easy updating in the future:

- `assets/interfaces.svg` -> `assets/raw/interfaces.drawio` (generated using [draw.io](https://www.draw.io/))

### Deployment

The `master` branch is automatically built and deployed to `gh-pages` branch. The `gh-pages` branch is served by Github Pages. Do not make edits to the `gh-pages` branch.
