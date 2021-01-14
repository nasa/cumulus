---
id: version-v5.0.0-getting-started
title: Getting Started
hide_title: false
original_id: getting-started
---

[Overview](#overview) | [Quick Tutorials](#quick-tutorials) | [Helpful Tips](#helpful-tips)

## Overview

This serves as a guide for new Cumulus users to deploy and learn how to use Cumulus. Here you will learn what you need in order to complete any prerequisites, what Cumulus is and how it works, and how to successfully navigate and deploy a Cumulus environment.

### What is Cumulus

Cumulus is an open source set of components for creating cloud-based data ingest, archive, distribution and management designed for NASA's future Earth Science data streams.

### Who uses Cumulus

Data integrators/developers and operators across projects not limited to NASA use Cumulus for their daily work functions.

### Cumulus Roles

#### Integrator/Developer

Cumulus integrators/developers are those who work within Cumulus and AWS for deployments and to manage workflows.

#### Operator

Cumulus operators are those who work within Cumulus to ingest/archive data and manage collections.

#### Role Guides

As a developer, integrator, or operator, you will need to set up your environments to work in Cumulus. The following docs can get you started in your role specific activities.

* [Developers](https://github.com/nasa/cumulus)
* [Integrators](integrator-guide/about-int-guide)
* [Operators](operator-docs/about-operator-docs)

### What is a Cumulus Data Type

In Cumulus, we have the following types of data that you can create and manage:

* Collections
* Granules
* Providers
* Rules
* Workflows
* Executions
* Reports

For details on how to create or manage data types go to [Data Management Types](configuration/data-management-types).

---

## Quick Tutorials

### Deployment & Configuration

Cumulus is deployed to an AWS account, so you must have access to deploy resources to an AWS account to get started.

### 1. Deploy Cumulus and Cumulus Dashboard to AWS

Follow the [deployment instructions](deployment/deployment-readme) to deploy Cumulus to your AWS account.

### 2. Configure and Run the HelloWorld Workflow

If you have deployed using the [cumulus-template-deploy repository](https://github.com/nasa/cumulus-template-deploy), you have a `HelloWorld` workflow deployed to your Cumulus backend.

You can see your deployed workflows on the `Workflows` page of your Cumulus dashboard.

Configure a collection and provider using the [setup guidance](data-cookbooks/about-cookbooks#setup) on the Cumulus dashboard.

Then [create a rule](operator-docs/create-rule-in-cumulus) to trigger your HelloWorld workflow. You can select a rule type of `one time`.

Navigate to the `Executions` page of the dashboard to check the status of your workflow execution.

### 3. Configure a Custom Workflow

See [Developing a custom workflow](workflows/developing-a-cumulus-workflow) documentation for adding a new workflow to your deployment.

There are plenty of workflow examples using Cumulus tasks [here](https://github.com/nasa/cumulus/tree/master/example/cumulus-tf). The [Data Cookbooks](data-cookbooks/about-cookbooks) provide a more in-depth look at some of these more advanced workflows and their configurations.

There is a list of Cumulus tasks already included in your deployment [here](tasks).

After configuring your workflow and redeploying, you can configure and run your workflow using the same steps as in step 2.

---

## Helpful Tips

Here are some useful tips to keep in mind when deploying or working in Cumulus.

### Integrator/Developer

* [Versioning and Releases](https://github.com/nasa/cumulus/blob/master/docs/development/release.md): This documentation gives information on our global versioning approach. We suggest upgrading to the supported version for Cumulus, Cumulus dashboard, and Thin Egress App (TEA).
* [Cumulus Developer Documentation](https://github.com/nasa/cumulus#cumulus-framework): We suggest that you read through and reference this resource for development best practices in Cumulus.
* [Cumulus Deployment](../deployment/deployment-readme): It's good to know how to manually deploy to a Cumulus sandbox environment.
* [Integrator Common Use Cases](../integrator-guide/int-common-use-cases): Scenarios to help integrators along in the Cumulus environment.

### Operator

* [Operator Common Use Cases](../operator-docs/ops-common-use-cases): Scenarios to help operators along in the Cumulus environment.

### Troubleshooting

[Troubleshooting](../troubleshooting/troubleshooting-readme): Some suggestions to help you troubleshoot and solve issues you may encounter.

### Resources

* Glossary - [here](glossary)
* FAQs - [here](faqs)
