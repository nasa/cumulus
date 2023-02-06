---
id: version-v3.0.0-getting-started
title: Getting Started
hide_title: false
original_id: getting-started
---

This serves as a guide for new Cumulus users to deploy and learn how to use Cumulus.

Cumulus is deployed to an AWS account, so you must have access to deploy resources to an AWS account to get started.

## 1. Deploy Cumulus and Cumulus dashboard to AWS

Follow the [deployment instructions](deployment/deployment-readme) to deploy Cumulus to your AWS account.

## 2. Configure and run the HelloWorld workflow

If you have deployed using the [cumulus-template-deploy repository](https://github.com/nasa/cumulus-template-deploy), you have a `HelloWorld` workflow deployed to your Cumulus backend.

You can see your deployed workflows on the `Workflows` page of your Cumulus dashboard.

Configure a collection and provider using the [setup guidance](data-cookbooks/setup) on the Cumulus dashboard.

Then [create a rule](operator-docs/create-rule-in-cumulus) to trigger your HelloWorld workflow. You can select a rule type of `one time`.

Navigate to the `Executions` page of the dashboard to check the status of your workflow execution.

## 3. Configure a custom workflow

See [Developing a custom workflow](workflows/developing-a-cumulus-workflow) documentation for adding a new workflow to your deployment.

There are plenty of workflow examples using Cumulus tasks [here](https://github.com/nasa/cumulus/tree/master/example/cumulus-tf). The [Data Cookbooks](data-cookbooks/about-cookbooks) provide a more in-depth look at some of these more advanced workflows and their configurations.

There is a list of Cumulus tasks already included in your deployment [here](tasks).

After configuring your workflow and redeploying, you can configure and run your workflow using the same steps as in step 2.
