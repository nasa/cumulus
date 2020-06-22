---
id: common-use-cases
title: Common Use Cases
hide_title: true
---

# Common Use Cases

Here are some example use cases that you may encounter during your daily activities.

## AWS Long Term Access Key

### Create & Generate AWS Access Key

For instructions on how to create and generate a AWS Long Term Access Key via CloudTamer go to [Get Access Keys Through CloudTamer](https://wiki.earthdata.nasa.gov/display/ESKB/Get+Access+Keys+Through+CloudTamer).

Note: Keep in mind that CloudTamer only allows 2 AWS API Keys to be stored. If you encounter the error that you already have 2 AWS API Keys then you will have to select "remove" on one of the keys. Then retry to add another key.


## Granule Workflows

### Ingest Kinesis

1. Generate AWS Long Term Access Key

  * For steps on creating an AWS Access Key go to [## AWS Long Term Access Key].
  * Copy the AWS Long Term Access Key.

2. Bulk Re-ingest Granules
  * Detail


### Failed Granule

1. Delete from CMR

2. Re-ingest Granule

### Multiple Failed Granules

1. Go to Granules Page
  * In the Cumulus dashboard, go to the Granules page
  * Click on "Failed Granules"

2. Bulk Re-ingest Granules


## Run A Stress Test

### UAT Stress Test

1. Login CloudTamer

2. Select the Project

3. Generate AWS Long Term Access Key

  * For steps on creating an AWS Access Key go to AWS Long Term Access Key.
  * Copy the AWS Long Term Access Key

4. AWS CloudFront

5. Run Local Test
  * In your terminal, enter the following:

  ```bash

    $ git clone <your test repository git URL>
    $ git checkout develop
    $ git status

  ```

6. Scale Down
You will need to scale down your AWS project instances.

  * In the AWS Console, click on the ECS cluster.
  * Click on the link for 'Service Name'.
  * Click on 'Tasks' tab to see your list of running instances.
  * In the top corner, click on 'Update' and this will show you the number os set tasks
  * Change number of tasks (your integrator may advise you on what that number should be).
  * Click on 'Next Step'.
  * Then click on
  * Please wait for the instances to drop down to the number you had set.