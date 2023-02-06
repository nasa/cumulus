---
id: faqs
title: Frequently Asked Questions
hide_title: false
---

Below are some commonly asked questions that you may encounter that can assist you along the way when working with Cumulus.

### General

<details>
  <summary>How do I deploy a new instance in Cumulus?</summary>

  Answer: For steps on the Cumulus deployment process go to [How to Deploy Cumulus](../deployment/deployment-readme).
</details>

<details>
  <summary>What prerequisites are needed to setup Cumulus?</summary>

  Answer: You will need access to the AWS console and an [Earthdata login](https://urs.earthdata.nasa.gov/) before you can deploy Cumulus.
</details>

<details>
  <summary>What is the preferred web browser for the Cumulus environment?</summary>

  Answer: Our preferred web browser is the latest version of [Google Chrome](https://www.google.com/chrome/).
</details>

<details>
  <summary>How do I quickly troubleshoot an issue in Cumulus?</summary>

  Answer: To troubleshoot and fix issues in Cumulus reference our recommended solutions in [Troubleshooting Cumulus](../troubleshooting/troubleshooting-readme).
</details>

<details>
  <summary>Where can I get support help?</summary>

  Answer: The following options are available for assistance:

* Cumulus: Outside NASA users should file a GitHub issue and inside NASA users should file a JIRA issue.
* AWS: You can create a case in the [AWS Support Center](https://console.aws.amazon.com/support/home), accessible via your AWS Console.

</details>

---

### Integrators & Developers

<details>
  <summary>What is a Cumulus integrator?</summary>

  Answer: Those who are working within Cumulus and AWS for deployments and to manage workflows. They may perform the following functions:

* Configure and deploy Cumulus to the AWS environment
* Configure Cumulus workflows
* Write custom workflow tasks

</details>

<details>
  <summary>What are the steps if I run into an issue during deployment?</summary>

  Answer: If you encounter an issue with your deployment go to the [Troubleshooting Deployment](../troubleshooting/troubleshooting-deployment) guide.
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
  <summary>What is a Cumulus workflow?</summary>

  Answer: A workflow is a provider-configured set of steps that describe the process to ingest data. Workflows are defined using [AWS Step Functions](https://docs.aws.amazon.com/step-functions/index.html). For more details, we suggest visiting [here](../workflows/workflows-readme).
</details>

<details>
  <summary>How do I set up a Cumulus workflow?</summary>

  Answer: You will need to create a provider, have an associated collection (add a new one), and generate a new rule first. Then you can set up a Cumulus workflow by following these steps [here](../workflows/developing-a-cumulus-workflow).
</details>

<details>
  <summary>What are the common use cases that a Cumulus integrator encounters?</summary>

  Answer: The following are some examples of possible use cases you may see:

* [Creating Cumulus Data Management Types](../integrator-guide/create-cumulus-data-mgmt-types)
* [Workflow: Add New Lambda](../integrator-guide/workflow-add-new-lambda)
* [Workflow: Troubleshoot Failed Step(s)](../integrator-guide/workflow-ts-failed-step)

</details>

---

### Operators

<details>
  <summary>What is a Cumulus operator?</summary>

  Answer: Those that ingests, archives, and troubleshoots datasets (called collections in Cumulus). Your daily activities might include but not limited to the following:

* Ingesting datasets
* Maintaining historical data ingest
* Starting and stopping data handlers
* Managing collections
* Managing provider definitions
* Creating, enabling, and disabling rules
* Investigating errors for granules and deleting or re-ingesting granules
* Investigating errors in executions and isolating failed workflow step(s)

</details>

<details>
  <summary>What are the common use cases that a Cumulus operator encounters?</summary>

  Answer: The following are some examples of possible use cases you may see:

* [Kinesis Stream For Ingest](../operator-docs/kinesis-stream-for-ingest)
* [Create Rule In Cumulus](../operator-docs/create-rule-in-cumulus)
* [Granule Workflows](../operator-docs/granule-workflows)

</details>

<details>
  <summary>Can you re-run a workflow execution in AWS?</summary>

  Answer: Yes. For steps on how to re-run a workflow execution go to [Re-running workflow executions](../operator-docs/rerunning-workflow-executions) in the [Cumulus Operator Docs](../operator-docs/about-operator-docs).
</details>
