---
id: faqs
title: Frequently Asked Questions
hide_title: false
---

Below are some commonly asked questions that you may encounter that can assist you along the way when working with Cumulus.

[General](#general) | [Workflows](#workflows) | [Integrators & Developers](#integrators--developers) | [Operators](#operators)

---

### General

<details>
  <summary>What prerequisites are needed to setup Cumulus?</summary>
  Answer: Here is a list of the tools and access that you will need in order to get started. To maintain the up-to-date versions that we are using please visit our [Cumulus main README](https://github.com/nasa/cumulus) for details.

- [NVM](https://github.com/creationix/nvm) for node versioning
- [AWS CLI](http://docs.aws.amazon.com/cli/latest/userguide/installing.html)
- Bash
- Docker (only required for testing)
- docker-compose (only required for testing `pip install docker-compose`)
- Python
- [pipenv](https://pypi.org/project/pipenv/)
  
> Keep in mind you will need access to the AWS console and an [Earthdata account](https://urs.earthdata.nasa.gov/) before you can deploy Cumulus.

</details>

<details>
  <summary>What is the preferred web browser for the Cumulus environment?</summary>

  Answer: Our preferred web browser is the latest version of [Google Chrome](https://www.google.com/chrome/).
</details>

<details>
  <summary>How do I deploy a new instance in Cumulus?</summary>

  Answer: For steps on the Cumulus deployment process go to [How to Deploy Cumulus](deployment).
</details>

<details>
  <summary>Where can I find Cumulus release notes?</summary>

  Answer: To get the latest information about updates to Cumulus go to [Cumulus Versions](https://nasa.github.io/cumulus/versions).
</details>

<details>
  <summary>How do I quickly troubleshoot an issue in Cumulus?</summary>

  Answer: To troubleshoot and fix issues in Cumulus reference our recommended solutions in [Troubleshooting Cumulus](troubleshooting).
</details>

<details>
  <summary>Where can I get support help?</summary>

  Answer: The following options are available for assistance:

- Cumulus: Outside NASA users should file a [GitHub issue](https://github.com/nasa/cumulus/issues) and inside NASA users should file a Cumulus JIRA ticket.
- AWS: You can create a case in the [AWS Support Center](https://console.aws.amazon.com/support/home), accessible via your AWS Console.

> For more information on how to submit an issue or contribute to Cumulus follow our guidelines at [Contributing](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md)

</details>

---

### Workflows

<details>
  <summary>What is a Cumulus workflow?</summary>

  Answer: A workflow is a provider-configured set of steps that describe the process to ingest data. Workflows are defined using [AWS Step Functions](https://docs.aws.amazon.com/step-functions/index.html). For more details, we suggest visiting the [Workflows](workflows) section.
</details>

<details>
  <summary>How do I set up a Cumulus workflow?</summary>

  Answer: You will need to create a provider, have an associated collection (add a new one), and generate a new rule first. Then you can set up a Cumulus workflow by following these steps [here](workflows/developing-a-cumulus-workflow).
</details>

<details>
  <summary>Where can I find a list of workflow tasks?</summary>

  Answer: You can access a list of reusable tasks for Cumulus development at [Cumulus Tasks](tasks).
</details>

<details>
  <summary>Are there any third-party workflows or applications that I can use with Cumulus?</summary>

  Answer: The Cumulus team works with various partners to help build a robust framework. You can visit our [External Contributions](external-contributions/external-contributions.md) section to see what other options are available to help you customize Cumulus for your needs.
</details>

---

### Integrators & Developers

<details>
  <summary>What is a Cumulus integrator?</summary>

  Answer: Those who are working within Cumulus and AWS for deployments and to manage workflows. They may perform the following functions:

- Configure and deploy Cumulus to the AWS environment
- Configure Cumulus workflows
- Write custom workflow tasks

</details>

<details>
  <summary>What are the steps if I run into an issue during deployment?</summary>

  Answer: If you encounter an issue with your deployment go to the [Troubleshooting Deployment](troubleshooting/troubleshoot_deployment.md) guide.
</details>

<details>
  <summary>Is Cumulus customizable and flexible?</summary>

  Answer: Yes. Cumulus is a modular architecture that allows you to decide which components that you want/need to deploy. These components are maintained as Terraform modules.
</details>

<details>
  <summary>What are Terraform modules?</summary>

  Answer: They are modules that are composed to create a Cumulus deployment, which gives integrators the flexibility to choose the components of Cumulus that want/need. To view Cumulus maintained modules or steps on how to create a module go to [Terraform modules](https://github.com/nasa/cumulus/tree/master/tf-modules).
</details>

<details>
  <summary>Where do I find Terraform module variables</summary>

  Answer: Go [here](https://github.com/nasa/cumulus/blob/master/tf-modules/cumulus/variables.tf) for a list of Cumulus maintained variables.
</details>

<details>
  <summary>What are the common use cases that a Cumulus integrator encounters?</summary>

  Answer: The following are some examples of possible use cases you may see:

- [Creating Cumulus Data Management Types](configuration/data-management-types)
- [Workflow: Add New Lambda](integrator-guide/workflow-add-new-lambda)
- [Workflow: Troubleshoot Failed Step(s)](integrator-guide/workflow-ts-failed-step)

</details>

---

### Operators

<details>
  <summary>What is a Cumulus operator?</summary>

  Answer: Those that ingests, archives, and troubleshoots datasets (called collections in Cumulus). Your daily activities might include but not limited to the following:

- Ingesting datasets
- Maintaining historical data ingest
- Starting and stopping data handlers
- Managing collections
- Managing provider definitions
- Creating, enabling, and disabling rules
- Investigating errors for granules and deleting or re-ingesting granules
- Investigating errors in executions and isolating failed workflow step(s)

</details>

<details>
  <summary>What are the common use cases that a Cumulus operator encounters?</summary>

  Answer: The following are some examples of possible use cases you may see:

- [Kinesis Stream For Ingest](operator-docs/kinesis-stream-for-ingest)
- [Create Rule In Cumulus](operator-docs/create-rule-in-cumulus)
- [Granule Workflows](operator-docs/granule-workflows)

Explore more Cumulus operator best practices and how-tos in the dedicated [Operator Docs](operator-docs/about-operator-docs).
</details>

<details>
  <summary>Can you re-run a workflow execution in AWS?</summary>

  Answer: Yes. For steps on how to re-run a workflow execution go to [Re-running workflow executions](troubleshooting/rerunning-workflow-executions) in the [Cumulus Operator Docs](operator-docs/about-operator-docs).
</details>
