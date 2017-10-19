# Documentation for Deployment of Cumulus

## Contents

* [Cumulus Deployment](#cumulus-deployment)
* [Cumulus Dashboard Deployment](#cumulus-dashboard-deployment)
* [Cumulus Lambda Function Development](#cumulus-lambda-function-development)
* [Cumulus Development Best Practices](#cumulus-development-best-practices)

# Cumulus Deployment

----
## Cumulus Configuration Credential Requirements:

**Posting to CMR:**
In order to post the CMR, you need to have setup a earthlogin user account with previlidges to post granules to a PROVIDER in the CMR

* CMR Password 

----
## Prepare `cumulus` Repo

    $ git clone https://github.com/cumulus-nasa/cumulus
    $ cd cumulus
    $ npm install
    $ npm run bootstrap
    $ npm run build

Note: In-house SSL certificates may prevent successful bootstrap. (i.e. `PEM_read_bio` errors)

----
## Prepare `<daac>-deploy` Repo (e.g. `lpdaac-deploy`)

    $ cd ..
    $ git clone https://github.com/cumulus-nasa/lpdaac-deploy
    $ cd lpdaac-deploy
    $ npm install
    
----
## Prepare AWS

**Create S3 Buckets:**

* internal/deployment
* private
* protected
* public

**Create EC2 Key Pair**

* EC2 -> Networks & Security -> Key Pairs -> Create Key Pair

**Set Access Keys**

    $ export AWS_ACCESS_KEY_ID=<AWS access key> (User with IAM Create-User Permission)
    $ export AWS_SECRET_ACCESS_KEY=<AWS secret key> (User with IAM Create-User Permission)
    $ export AWS_REGION=us-east-1

----
## Create Deployer

**Changes to <daac>-deploy/deployer/stage.yml**

Add new stage:

    <stage>:                             # e.g. dev (Note: NOT <dev>)
      buckets:
        internal: <deployment-bucket>

**Create Deployer**

    $ kes cf create --kes-folder deployer --stage <stage>

----
## Create IAM Roles

**Changes to <daac>-deploy/iam/stage.yml**

Add new stage:

    <stage>:
      buckets:
        internal: <deployment-bucket-name>
        private: <private-bucket-name>
        protected: <protected-bucket-name>
        public: <public-bucket-name>

**Create IAM Roles**

    $ kes cf create --kes-folder iam --stage <stage>

**Assign sts:AssumeRole policy to new or existing user**
Policy JSON:

    {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": "sts:AssumeRole",
                "Resource": "<arn:DeployerRole>" 
            }
        ]
    }

**Change AWS Access Keys**

* Create Access Keys for AssumeRole user
* Export access keys:

    $ export AWS_ACCESS_KEY_ID=<AWS access key> (User with sts:AssumeRole Permission)
    $ export AWS_SECRET_ACCESS_KEY=<AWS secret key> (User with sts:AssumeRole Permission)
    $ export AWS_REGION=us-east-1

---- 
## Configure Deployment

**Changes to <daac>-deploy/config/stage.yml**

Add new stage:

    <stage>:
      stage: <stage>
      stageNoDash: <stage>
      buckets:
        internal: <deployment-bucket-name>
        private: <private-bucket-name>
        protected: <protected-bucket-name>
        public: <public-bucket-name>
      iamroles:
        ecsRoleArn:
        lambdaApiGatewayRoleArn:
        lambdaProcessingRoleArn:
        stepRoleArn:
        instanceProfile: <as-default>
      cmr:
        username: 
        provider: 
        clientId: 
      es:
        name: es5
      distribution:
        endpoint: 
        redirect: 
        client_id: {{ EARTHDATA_CLIENT_ID }}
        client_password: {{ EARTHDATA_CLIENT_PASSWORD }}
      lambdasNeedVpc: false
      securityGroupId: EC2 security group ID
      keyPair: <keyPair name>

----
## ECS Container Setup

**Login to Docker with personal credentials to pull docker image from devseed**

    docker pull developmentseed/cumulus:modis

**Login to Docker with AWS ECS credential**

    docker tag developmentseed/cumulus:modis <ECS  Repository URI>:latest 
    docker push <ECS Repository URI>:latest

**Edit <daac>-deploy/lambdas.yml**

* Change AsterProcessing key to .zip location in internal (deployment) S3 bucket
* Change ModisProcessing key to .zip location in internal (deployment) S3 bucket

Note: In case ECS image fails, update Docker image commands:

* Add new commands under <daac>-deploy/config/config.yml

----
## Environment setup:

**Change .env to suit needs:**

    cumulus_user_password=<mypassword>
    CMR_PASSWORD=<cmrpassword>
    EARTHDATA_CLIENT_ID=<clientid>
    EARTHDATA_CLIENT_PASSWORD=<clientpassword>

----
## Run deployment of Cumulus stack
    
    $ kes cf create --kes-folder config --stage <stage> --role <arn:deployerRole>
    
Monitor deployment via the AWS CloudFormation Stack Details page reports (esp. "Events" and "Resources" sections) for creation failure.





# Cumulus Dashboard Deployment

----
## Prepare AWS

**Create S3 bucket:**

* dashboard (Enable "Properties" -> "Static Website Hosting", point to "index.html")

----
## Install dashboard

    $ cd ..
    $ git clone https://github.com/cumulus-nasa/cumulus-dashboard/
    $ cd cumulus-dashboard
    $ npm install

----
## Dashboard Configuration & Deployment

Configure dashboard:

* Update `const altApiRoot` in `app/scripts/config.js`:

    const altApiRoot = {
      podaac: 'https//cumulus.ds.io/api/podaac/',
      ghrc: 'https://cumulus.ds.io/api/ghrc/',
      lpdaac: 'https://cumulus.ds.io/api/lpdaac/',
      <stage>: <API-Gateway-backend-invoke-URL>

* Build Dashboard and go to dist directory:

    $ DS_TARGET=<stage> npm run staging
    $ cd dist

* Deploy dashboard to s3 bucket from the `cumulus-dashboard/dist` directory:

    $ aws s3 sync . s3://<dashboard-bucket-name> --acl public-read

* Open Dashboard: Dashboard-Bucket -> "Properties" -> "Static Website Hosting" -> "Endpoint" URL


* Before posting to CMR, update ../../<daac>-deploy/config/stage.yml
    
    endpoint: <API-Gateway-distribution-invoke-URL>             # added to CMR link when pushed
    redirect: <API-Gateway-distribution-invoke-URL>/redirect    # dashboard internal redirect
    
(Posting to CMR requires correct EarthLogin username/password)

----
## Run updates to cumulus deployment (e.g. after pulling in github changes)
    
(Require Access Keys for user with IAM Permissions)

    $ kes cf update --kes-folder deployer --stage <stage>
    $ kes cf update --kes-folder iam --stage <stage>
    
(Requires Access Keys for user with sts:AssumeRole Permission)

    $ kes cf update --kes-folder config --stage <stage> --role <arn:deployerRole>
    
    
    


# Cumulus Lambda Function Development

----
## Develop Lambda Functions

To develop a new lambda from a sample, copy an existing lambda function:

    $ cd ../cumulus/cumulus/tasks
    $ cp discover-pdrs new-lambda

Modify package.json:

* name
* version
* description
* test script
* dependencies (NOT devDependencies)




----
## Build Lambda Function

To build node.js lambda functions, use webpack to pack into single .js with dependencies:
        
    $ npm run build

Alternatively, to monitor for changes and auto-rebuild:

    $ npm run watch

For non-node lambdas not included in cumulus repo, upload .zip to s3 and modify lambdas.yml as previously shown.

----
## Lambda  Deployment

For new lambdas, update <daac>-deploy/lambdas.yml by adding a new entry. 
E.g.: node.js sample for '../cumulus/cumulus/tasks/sample-lambda'):

    - name: <LambdaName>                                       # eg:  LambdaSample (does not need to conform to dirname)
      handler: <dir>.<function>                                # eg:  sample-lambda.handler (assuming file has module.exports.handler = <someFunc>)
      timeout: <ms>                                            # eg:  300
      source: '../cumulus/cumulus/tasks/<dir>/dist/<file.js>'  # eg:  '../cumulus/cumulus/tasks/sample-lambda/dist/index.js'

For non-node.js lambda code (e.g. python) uploaded as a .zip to an S3 bucket:

    - name: PyLambda                      
      handler: <file.py>.<function>               # eg:  lambda_handler.handler for lambda_handler.py with:  def handler(event, context):
      timeout: <ms>
      s3Source:
        bucket: '{{buckets.internal}}'            # refers to bucket set in stage.yml
        key: deploy/cumulus-process/<dir>/<file>  # eg: deploy/cumulus-process/modis/0.3.0b3.zip
      runtime: python2.7                          # Node is default, otherwise specify.

To deploy all changes to /tasks/ and lambdas.yml:

    $ kes cf update --kes-folder config --stage <stage> --role <arn:deployerRole>
    
To deploy modifications to a single lambda package:

    $ kes lambda <LambdaName> --kes-folder config  --role <arn:deployerRole>





----
## Cumulus Development Best Practices

* config.yml should not hard code, refer via {{ <var_name> }} to stage.yml
* stage.yml should define fields in each stage, refer via env to security credentials and include a default.
* add new fields (esp. in default) to all stages (e.g. with comment #FIXME) so that other stage users are aware of changes.