---
id: version-v1.10.1-iam_roles
title: Cumulus IAM Roles
hide_title: true
original_id: iam_roles
---

# Locating Cumulus IAM Role ARNs

This step involves getting the [Amazon Resource Names (ARNS)](https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html) for the Cumulus roles:

* ```<stack-name>-cumulus-ecs```
* ```<stack-name>-lambda-processing```
* ```<stack-name>-lambda-api-gateway```
* ```<stack-name>-steprole```


IAM values can be found by selecting "IAM" under the Security, Identity & Compliance in the AWS management console:

![IAM Managment Console Select](../assets/iam-access.png)

then selecting "Roles":

![IAM Roles](../assets/iam-roles.png)


then selecting the automatically created roles that correspond to the 'iams' roles in the configuration file.    Within each you'll find the Role ARN with the ROLE ARN displayed at the top of the tab:

![Cumulus IAM Role](../assets/cumulus-iam-role.png)


Alternately, you can list all the defined roles via the aws command line interface:

```aws iam list-roles```
