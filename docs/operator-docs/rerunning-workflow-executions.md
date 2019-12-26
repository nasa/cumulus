---
id: rerunning-workflow-executions
title: Re-running workflow executions
hide_title: true
---

# Re-running workflow executions

To re-run a Cumulus workflow execution from the AWS console:

1. Visit the page for an individual workflow execution
2. Click the "New execution" button at the top right of the screen

    ![Screenshot of the AWS console for a Step Function execution highlighting the "New execution" button at the top right of the screen](../../assets/new_execution.png)

3. In the "New execution" modal that appears, replace the `cumulus_meta.execution_name` value in the default input with the value of the new execution ID as seen in the screenshot below

    ![Screenshot of the AWS console showing the modal window for entering input when running a new Step Function execution](../../assets/rerun_execution.png)

4. Click the "Start execution" button
