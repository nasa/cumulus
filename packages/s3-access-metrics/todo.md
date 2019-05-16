+ Figure out how to deploy this into a VPC
+ Make the PermissionsBoundary of the role optional
+ Make deployment bucket configurable
+ Refactor IAM policy
+ Figure out IAM error when deploying a single function
+ Consider using webpack
+ Try to only pull in S3 and Cloudwatch libraries
+ If using statistic sets, test what happens when you publish different stats for the same minute
+ Figure out how to publish 0 for minutes without any records
+ Handle events from multiple log files (different buckets) for the same periods
+ Make the bucket configurable
+ Remove the conditional from the IAM permissions
- Throw an exception if vpcId is set but subnetIds is not
- Add comments or improve function names in index.js
- Add a README
  - what it does
  - how it works
  - how to configure
  - how to deploy
