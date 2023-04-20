# async-operation Docker image

This image is intended for use with the AsyncOperation model. It will:

1. Download an AWS Lambda function from AWS
2. Download a payload from S3
3. Execute the lambda function (inside the Docker container)
4. Update the RDS database record for the AsyncOperation with the result of the lambda function.

The Docker container expects a number of environment variables to be set:

* lambdaName - the name of the lambda function to be executed
* payloadUrl - an S3 URL containing the event to be passed to the lambda
  function
* asyncOperationId - the ID of the AsyncOperation record

The built image is deployed to
<https://hub.docker.com/r/cumuluss/async-operation/>

## Logs

Logs will be output to `${stackName}-${OperationName}EcsLogs`

## Building and pushing Docker images

For the following commands, replace `<build-number>` with the next build number. You can
find the latest build number at <https://hub.docker.com/r/cumuluss/async-operation/tags>.
Currently we are using a regular number as the build number (e.g. `41`) and not a semantic
versioning string (e.g. `1.0.0`).

To build a new Docker image:

`docker build -t cumuluss/async-operation:<build-number> .`

To push the new image to Dockerhub, you will need to log in to Docker using your credentials:

`docker login`

Then you can push the new image to Dockerhub:

`docker push cumuluss/async-operation:<build-number>`

### Pushing images to ECR

We also keep a copy of this Docker image in the AWS ECR service for all of our Cumulus
testing accounts in order to work around limits on how many times an image can be pulled
from DockerHub.

**IMPORTANT: You must follow these steps to push the image to ECR in both the Cumulus sandbox and SIT accounts.**

First, copy the tag you created for DockerHub with the name of the image that
is expected for ECR:

```shell
docker tag cumuluss/async-operation:<build-number> <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/async_operations:<build-number>
```

Then you will need to follow the [AWS documentation to log in to ECR for your account from the command line](https://docs.aws.amazon.com/AmazonECR/latest/userguide/getting-started-cli.html#cli-authenticate-registry).

Lastly, you can push the image to ECR in the AWS account:

```shell
docker push <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/async_operations:<build-number>
```

## Updating Cumulus deployment configuration

Once you have built a new image, you should configure the Cumulus Terraform module to use that new image by updating the `async_operation_image` variable in the
[`variables.tf` file for the `cumulus` module](../../../../tf-modules/cumulus/variables.tf)
to match the new `<build-number>`.

You should also update the `async_operation_image_version` in [`variables.tf` for our example Cumulus deployment](../../../../example/cumulus-tf/variables.tf) that is used to pull the images from ECR.
