---
id: version-v5.0.0-about-cookbooks
title: About Cookbooks
hide_title: false
original_id: about-cookbooks
---

## Introduction

The following data cookbooks are documents containing examples and explanations of workflows in the Cumulus framework. Additionally, the following data cookbooks should serve to help unify an institution/user group on a set of terms.

## Setup

The data cookbooks assume you can configure providers, collections, and rules to run workflows. Visit [Cumulus data management types](../configuration/data-management-types) for information on how to configure Cumulus data management types.

## Adding a page

As shown in detail in the "Add a New Page and Sidebars" section in [Cumulus Docs: How To's](docs-how-to.md), you can add a new page to the data cookbook by creating a markdown (`.md`) file in the `docs/data-cookbooks` directory. The new page can then be linked to the sidebar by adding it to the `Data-Cookbooks` object in the `website/sidebar.json` file as `data-cookbooks/${id}`.

## More about workflows

[Workflow general information](workflows/README.md)

[Input & Output](workflows/input_output.md)

[Developing Workflow Tasks](workflows/developing-workflow-tasks.md)

[Workflow Configuration How-to's](workflows/workflow-configuration-how-to.md)
