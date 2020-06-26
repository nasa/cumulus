---
id: run-a-stress-test
title: Run A Stress Test
hide_title: true
---

# Run A Stress Test

## UAT Stress Test

1. Login CloudTamer

2. Select the Project

3. Generate AWS Long Term Access Key

* For steps on creating an AWS Access Key go to [AWS Long Term Access Key](../operator-docs/aws-long-term-access-key).
* Copy the AWS Long Term Access Key.

4. AWS CloudFront

5. Run Local Test

* In your terminal, enter the following:

```bash

git clone <your test repository git URL>
git checkout develop
git status

```

* Then run CNMTestHarness log file. Check with your developer on where to find your python resource for this test.

6. Scale Down

You will need to scale down your AWS project instances.

* In the AWS Console, click on the ECS cluster.
* Click on the link for `Service Name`.
* Click on `Tasks` tab to see your list of running instances.
* In the top corner, click on `Update` and this will show you the number os set tasks. There will be sequence of detailed step:
  * Change number of tasks (your integrator may advise you on what that number should be) and proceed to the next `Next Step`,
  * Click on `Configure Network Page`,
  * Click on `Set Auto Scaling Page`,
  * Click on `Review Page` and then select `Update Service` button.
  * Please wait for the instances to drop down to the number you had set.
  * On the left-side menu, select `Auto Scaling - Auto Scaling Groups`.
  * Under the `Actions` menu, click `Edit`.
  * Change capacity to 1 and then select `Save`. The instances should shut down to 1.
