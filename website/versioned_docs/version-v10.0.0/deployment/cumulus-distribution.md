---
id: cumulus_distribution
title: Using the Cumulus Distribution API
hide_title: false
---

The Cumulus Distribution API is a set of endpoints that can be used to enable AWS Cognito authentication when downloading data from S3.

## Configuring a Cumulus Distribution deployment

The Cumulus Distribution API is included in the main [Cumulus](https://github.com/nasa/cumulus/tree/master/tf-modules/cumulus_distribution) repo. It is available as part of the `terraform-aws-cumulus.zip` archive in the [latest release](https://github.com/nasa/cumulus/releases).

These steps assume you're using [the Cumulus Deployment Template](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/main.tf) but can also be used for custom deployments.

To configure a deployment to use Cumulus Distribution:

 1. Remove or comment the "Thin Egress App Settings" in [the Cumulus Template Deploy](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/main.tf) and enable the Cumulus Distribution settings.
 2. Delete or comment the contents of [thin_egress_app.tf](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/thin_egress_app.tf) and the corresponding Thin Egress App outputs in [outputs.tf](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/outputs.tf). These are not necessary for a Cumulus Distribution deployment.
 3. Uncomment the Cumulus Distribution outputs in [outputs.tf](https://github.com/nasa/cumulus-template-deploy/blob/master/cumulus-tf/outputs.tf).
 4. Rename `cumulus-template-deploy/cumulus-tf/cumulus_distribution.tf.example` to `cumulus-template-deploy/cumulus-tf/cumulus_distribution.tf`.

## Cognito Application and User Credentials

The major prerequisite for using the Cumulus Distribution API is to set up Cognito. If operating within NGAP, this should already be done for you. If operating outside of NGAP, you must set up Cognito yourself, which is beyond the scope of this documentation.

Given that Cognito is set up, in order to be able to download granule files via the Cumulus Distribution API, you must obtain Cognito user credentials, because any attempt to download such files (that will be, or have been, published to the CMR via your Cumulus deployment) will result in a prompt for you to supply Cognito user credentials. To obtain your own user credentials, talk to your product owner or scrum master for additional information. They should either know how to create the credentials, know who can create them for the team, or be the liaison to the Cognito team.

Further, whoever helps to obtain your Cognito user credentials should also be able to supply you with the values for the following new variables that you must add to your `cumulus-tf/terraform.tfvars` file:

* `csdap_host_url`: The URL of the Cognito service to which your Cumulus deployment will make Cognito API calls during a distribution (download) event
* `csdap_client_id`: The client ID for the Cumulus application registered within the Cognito service
* `csdap_client_password`: The client password for the Cumulus application registered within the Cognito service

Although you might have to wait a bit for your Cognito user credentials, the remaining instructions do not depend upon having them, so you may continue with these instructions while waiting for your credentials.

## Cumulus Distribution URL

Your Cumulus Distribution URL is used by Cumulus to generate download URLs as part of the granule metadata generated and published to the CMR. For example, a granule download URL will be of the form `<distribution url>/<protected bucket>/<key>` (or `<distribution url>/path/to/file`, if using a custom bucket map, as explained further below).

By default, the value of your distribution URL is the URL of your private Cumulus Distribution API Gateway (the API Gateway named `<prefix>-distribution`, once you deploy the Cumulus Distribution module). Therefore, by default, the generated download URLs are private, and thus inaccessible directly, but there are 2 ways to address this issue (both of which are detailed below): (a) use tunneling (typically in development) or (b) put a CloudFront URL in front of your API Gateway (typically in production, and perhaps UAT and/or SIT).

In either case, you must first know the default URL (i.e., the URL for the private Cumulus Distribution API Gateway). In order to obtain this default URL, you must first deploy your `cumulus-tf` module with the new Cumulus Distribution module, and once your initial deployment is complete, one of the Terraform outputs will be `cumulus_distribution_api_uri`, which is the URL for the private API Gateway.

You may override this default URL by adding a `cumulus_distribution_url` variable to your `cumulus-tf/terraform.tfvars` file, and setting it to one of the following values (both of which are explained below):

1. The default URL, but with a port added to it, in order to allow you to configure tunneling (typically only in development)
2. A CloudFront URL placed in front of your Cumulus Distribution API Gateway (typically only for Production, but perhaps also for a UAT or SIT environment)

The following subsections explain these approaches, in turn.

### Using your Cumulus Distribution API Gateway URL as your distribution URL

Since your Cumulus Distribution API Gateway URL is private, the only way you can use it to confirm that your integration with Cognito is working is by using tunneling (again, generally for development), as described here. Here is an outline of the required steps, with details provided further below:

1. Create/import a key pair into your AWS EC2 service (if you haven't already done so)
2. Add a reference to the name of the key pair to your Terraform variables (we'll set the key_name Terraform variable)
3. Choose an open local port on your machine (we'll use 9000 in the following details)
4. Add a reference to the value of your cumulus_distribution_api_uri (mentioned earlier), including your chosen port (we'll set the cumulus_distribution_url Terraform variable)
5. Redeploy Cumulus
6. Add an entry to your /etc/hosts file
7. Add a redirect URI to Cognito, via the Cognito API
8. Install the Session Manager Plugin for the AWS CLI (if you haven't already done so; assuming you have already installed the AWS CLI)
9. Add a sample file to S3 to test downloading via Cognito

To create or import an existing key pair, you can use the AWS CLI (see aws [ec2 import-key-pair](https://docs.aws.amazon.com/cli/latest/reference/ec2/import-key-pair.html)), or the AWS Console (see [Amazon EC2 key pairs and Linux instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-key-pairs.html)).

Once your key pair is added to AWS, add the following to your `cumulus-tf/terraform.tfvars` file:

```plain
key_name = "<name>"
cumulus_distribution_url = "https://<id>.execute-api.<region>.amazonaws.com:<port>/dev/"
```

where:

* `<name>` is the name of the key pair you just added to AWS
* `<id>` and `<region>` are the corresponding parts from your `cumulus_distribution_api_uri` output variable
* `<port>` is your open local port of choice (9000 is typically a good choice)

Once you save your variable changes, redeploy your `cumulus-tf` module.

While your deployment runs, add the following entry to your `/etc/hosts` file, replacing `<hostname>` with the host name of the `cumulus_distribution_url` Terraform variable you just added above:

```plain
localhost <hostname>
```

Next, you'll need to use the Cognito API to add the value of your `cumulus_distribution_url` Terraform variable as a Cognito redirect URI. To do so, use your favorite tool (e.g., curl, wget, Postman, etc.) to make a BasicAuth request to the Cognito API, using the following details:

* method: POST
* base URL: the value of your `csdap_host_url` Terraform variable
* path: /authclient/updateRedirectUri
* username: the value of your `csdap_client_id` Terraform variable
* password: the value of your `csdap_client_password` Terraform variable
* headers: Content-Type='application/x-www-form-urlencoded'
* body: redirect_uri=<cumulus_distribution_url>/login

where `<cumulus_distribution_url>` is the value of your `cumulus_distribution_url` Terraform variable. Note the `/login` path at the end of the `redirect_uri` value.

For reference, see the [Cognito Authentication Service API](https://wiki.earthdata.nasa.gov/display/ACAS/Cognito+Authentication+Service+API).

Next, [install the Session Manager Plugin for the AWS CLI](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html). If running on macOS, and you use Homebrew, you can install it simply as follows:

```bash
brew install --cask session-manager-plugin --no-quarantine
```

As your final setup step, add a sample file to one of the protected buckets listed in your `buckets` Terraform variable in your `cumulus-tf/terraform.tfvars` file. The key for the S3 object doesn't matter, nor does it matter what file you use. All that matters is that the file is an S3 object in one of your protected buckets, because Cognito is triggered when attempting to download from one of those buckets.

At this point, you should be ready to open a tunnel and attempt to download your sample file via your browser, summarized as follows:

1. Determine your ec2 instance ID
2. Connect to the NASA VPN
3. Start an AWS SSM session
4. Open an ssh tunnel
5. Use a browser to navigate to your file

To determine your ec2 instance ID for your Cumulus deployment, run the follow command, where `<profile>` is the name of the appropriate AWS profile to use, and `<prefix>` is the value of your `prefix` Terraform variable:

```bash
aws --profile <profile> ec2 describe-instances --filters Name=tag:Deployment,Values=<prefix> Name=instance-state-name,Values=running --query "Reservations[0].Instances[].InstanceId" --output text
```

IMPORTANT: Before proceeding with the remaining steps, make sure you're connected to the NASA VPN.

Use the value output from the command above in place of `<id>` in the following command, which will start an SSM session:

```bash
aws ssm start-session --target <id> --document-name AWS-StartPortForwardingSession --parameters portNumber=22,localPortNumber=6000
```

If successful, you should see output similar to the following:

```plain
Starting session with SessionId: NGAPShApplicationDeveloper-***
Port 6000 opened for sessionId NGAPShApplicationDeveloper-***.
Waiting for connections...
```

Open another terminal window, and open a tunnel with port forwarding, using your chosen port from above (e.g., 9000):

```bash
ssh -4 -p 6000 -N -L <port>:<api-gateway-host>:443 ec2-user@127.0.0.1
```

where:

* `<port>` is the open local port you chose earlier (e.g., 9000)
* `<api-gateway-host>` is the hostname of your private API Gateway (i.e., the host portion of the URL you used as the value of your `cumulus_distribution_url` Terraform variable above)

Finally, use your chosen browser to navigate to `<cumulus_distribution_url>/<bucket>/<key>`, where `<bucket>` and `<key>` reference the sample file you added to S3 above.

If all goes well, you should be prompted for your Cognito username and password. If you have obtained your Cognito user credentials, enter them, followed by entering a code generated by the authenticator application you registered at the time you completed your Cognito registration process. Once your credentials and auth code are correctly supplied, after a few moments, the download process will begin.

Once you're finished testing, clean up as follows:

1. Kill your ssh tunnel (Ctrl-C)
2. Kill your AWS SSM session (Ctrl-C)
3. If you like, disconnect from the NASA VPC

While this is a relatively lengthy process, things are much easier when using CloudFront, such as in Production (OPS), SIT, or UAT, as explained next.

### Using a CloudFront URL as your distribution URL

In Production (OPS), and perhaps in other environments, such as UAT and SIT, you'll need to provide a publicly accessible URL for users to use for downloading (distributing) granule files.

This is generally done by placing a CloudFront URL in front of your private Cumulus Distribution API Gateway. In order to create such a CloudFront URL, contact the person who helped you obtain your Cognito credentials, and request a CloudFront URL with the following details:

* The private, backing URL, which is the value of your `cumulus_distribution_api_uri` Terraform output value
* A request to add the AWS account's VPC to the whitelist

Once this request is completed, and you obtain the new CloudFront URL, override your default distribution URL with the CloudFront URL by adding the following to your `cumulus-tf/terraform.tfvars` file:

```plain
cumulus_distribution_url = <cloudfront_url>
```

In addition, add a Cognito redirect URI, as detailed in the previous section. Note that in this case, the value you'll use for `redirect_uri` is `<cloudfront_url>/login` since the value of your `cumulus_distribution_url` is now your CloudFront URL.

At this point, it is assumed that you have added the appropriate values for this environment for the variables described at the top (`csdap_host_url`, `csdap_client_id`, and `csdap_client_password`).

Redeploy Cumulus with your new/updated Terraform variables.

As your final setup step, add a sample file to one of the protected buckets listed in your `buckets` Terraform variable in your `cumulus-tf/terraform.tfvars` file. The key for the S3 object doesn't matter, nor does it matter what file you use. All that matters is that the file is an S3 object in one of your protected buckets, because Cognito is triggered when attempting to download from one of those buckets.

Finally, use your chosen browser to navigate to `<cumulus_distribution_url>/<bucket>/<key>`, where `<bucket>` and `<key>` reference the sample file you added to S3.

If all goes well, you should be prompted for your Cognito username and password. If you have obtained your Cognito user credentials, enter them, followed by entering a code generated by the authenticator application you registered at the time you completed your Cognito registration process. Once your credentials and auth code are correctly supplied, after a few moments, the download process will begin.

## S3 Bucket Mapping

An S3 Bucket map allows users to abstract bucket names. If the bucket names change at any point, only the bucket map would need to be updated instead of every S3 link.

The Cumulus Distribution API uses a `bucket_map.yaml` or `bucket_map.yaml.tmpl` file to determine which buckets to
serve. [See the examples](https://github.com/nasa/cumulus/tree/master/example/cumulus-tf/cumulus_distribution).

The default Cumulus module generates a file at `s3://${system_bucket}/distribution_bucket_map.json`.

The configuration file is a simple json mapping of the form:

```json
{
  "daac-public-data-bucket": "/path/to/this/kind/of/data"
}
```

> Note: Cumulus only supports a one-to-one mapping of bucket -> Cumulus Distribution path for 'distribution' buckets. Also, the bucket map **must include mappings for all of the `protected` and `public` buckets specified in the `buckets` variable in `cumulus-tf/terraform.tfvars`**, otherwise Cumulus may not be able to determine the correct distribution URL for ingested files and you may encounter errors.

## Switching from the Thin Egress App to Cumulus Distribution

If you have previously deployed the Thin Egress App (TEA) as your distribution app, you can switch to Cumulus Distribution by following the steps above.

Note, however, that the `cumulus_distribution` module will generate a bucket map cache and overwrite any existing bucket map caches created by TEA.

There will also be downtime while your API gateway is updated.
