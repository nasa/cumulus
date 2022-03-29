---
id: version-v11.0.0-terraform-best-practices
title: Terraform Best Practices
hide_title: false
original_id: terraform-best-practices
---

## How to Manage the Terraform State Bucket

### Enable Bucket Versioning

Since the Terraform state file for your Cumulus deployment is stored in S3, in
order to guard against its corruption or loss, it is **strongly recommended**
that versioning is enabled on the S3 bucket used for persisting your
deployment's Terraform state file.

To enable bucket versioning, either use the AWS CLI command given in
[Configuring the Cumulus deployment], or the AWS Management Console, as follows:

1. Go to the S3 service
2. Go to the bucket used for storing Terraform state files
3. Click the **Properties** tab
4. If the **Versioning** property is disabled, click **Disabled** to enable it,
   which should then show the property as **Enabled**, with a check mark next
   to it.

#### How to Recover from a Corrupted State File

If your state file appears to be corrupted, or in some invalid state, and the
containing bucket has bucket versioning enabled, you may be able to recover by
[restoring a previous version] of the state file. There are two primary
approaches, but the AWS documentation does not provide specific instructions
for either one:

- **Option 1:** Copy a previous version of the state file into the same bucket
- **Option 2:** Permanently delete the current version of the file (i.e., the
  corrupted one)

For either approach, when using the **AWS Management Console**, the first steps
are:

1. Go to the S3 service
2. Go to the appropriate bucket
3. On the **Overview** tab for the bucket, click the **Show** button to show
   object versions
4. Locate your state file

To **copy a previous version of your state file into the same bucket**:

1. Select the desired (good) version of the state file that you wish to make
   the latest version
2. Click the **Download** button
3. Choose the location where you wish to save the file
4. **IMPORTANT:** Ensure the file name is identical to the name of the state
   file in the bucket
5. Click **Save**
6. Now click the **Upload** button
7. Click the **Add files** button
8. Choose the file you just downloaded and click **Open**
9. Click the **Next** button (multiple times), then click the **Upload** button

Once the upload completes, the newly uploaded file (identical to the good
version you just downloaded) becomes the **Latest version** of the state file.

**Alternatively,** if you simply wish to delete the latest (corrupted) version
of the state file:

1. Click the latest version of the file (listed at the top)
2. Click the **Actions** button and select **Delete**
3. On the dialog window, click the **Delete** button

At this point, the previous version is now the latest version.

**NOTE:** When attempting to delete the latest (corrupt) version of the file,
you must _explicitly_ choose the latest version. Otherwise, if you simply
choose the file when versions are hidden, deleting it will insert a
_delete marker_ as the latest version of the file. This means that all prior
versions still exist, but the file _appears_ to be deleted. When you **Show**
the versions, you will see all of the previous versions (including the corrupt
one), as well as a _delete marker_ as the current version.

#### How to Recover from a Deleted State File

If your state file appears to be deleted, but the containing bucket has bucket
versioning enabled, you _might_ be able to recover the file. This can occur
when your state file is not _permanently_ deleted, but rather a _delete marker_
is the latest version of your file, and thus the file _appears_ to be deleted.

To recover your deleted state file via the **AWS Management Console, you may
follow one of the options detailed in the previous section** because the
_delete marker_ is simply considered the latest version of your file, and thus
can be treated in the same manner as any other version of your file.

To handle this via the **AWS CLI** instead, first obtain the version ID of the
delete marker by replacing `BUCKET` and `KEY` as appropriate for the state file
in question, in the following command:

```bash
aws s3api list-object-versions \
  --bucket BUCKET \
  --prefix KEY \
  --query "DeleteMarkers[?IsLatest].VersionId | [0]"
```

If the output from this command is `null`, then there is no delete marker, and
you may want to double-check your bucket and key values. If the bucket and key
values are correct, then your state file is either _not_ marked as deleted or
does not exist at all.

Otherwise, you may remove the delete marker so that the state file no longer
appears deleted. This will restore the previous version of the file and make it
the latest version. Run the following command, using the same values for
`BUCKET` and `KEY` as used in the previous command, and replacing `VERSION_ID`
with the value output from the previous command:

```bash
aws s3api delete-object \
  --bucket BUCKET \
  --key KEY \
  --version-id VERSION_ID
```

### Deny DeleteBucket Action

As an additional measure to protect your Terraform state files from accidental
loss, it is also recommended that you deny all users the ability to delete the
bucket itself. At a later time, you may remove this protection when you are
sure you want to delete the bucket.

To perform this action via the **AWS Management Console**:

1. Go to the S3 service
2. Go to the bucket used for storing state files
3. Click the **Permissions** tab
4. Click **Bucket Policy**
5. Add the following policy statement to _deny_ the `s3:DeleteBucket` action for
   all (`"*"`) principals, replacing `BUCKET_NAME` with the name of the bucket:

   ```json
   {
     "Statement": [
       {
         "Sid": "DenyDeleteBucket",
         "Effect": "Deny",
         "Principal": "*",
         "Action": "s3:DeleteBucket",
         "Resource": "arn:aws:s3:::BUCKET_NAME"
       }
     ]
   }
   ```

6. Click **Save**

To perform this action via the **AWS CLI** instead, save the JSON shown above
to a file named `policy.json` and run the following command from the directory
in which you saved `policy.json`, replacing `BUCKET_NAME` with the name of the
bucket:

```bash
aws s3api put-bucket-policy --policy file://policy.json --bucket BUCKET_NAME
```

Afterwards, remove the `policy.json` file.

## Change Resources Only via Terraform

**All resource changes must be made via Terraform**, otherwise you risk that
your Terraform state file does not correctly represent the state of your
deployment resources. Specifically, this means:

- **DO NOT** change deployment resources via the AWS Management Console
- **DO NOT** change deployment resources via the AWS CLI
- **DO NOT** change deployment resources via any of the AWS SDKs

Instead, **DO** change deployment resources **only** via changes to your
Terraform files (along with subsequent Terraform commands), except where
specifically instructed otherwise (such as in the instructions for destroying
a deployment).

### Avoid Changing Connectivity Resources

Keep in mind that changing connectivity resources can affect your ingest
functionality and API availability.

Only update connectivity resources such as your VPC, subnets, and security
groups through Terraform deployments with S3 bucket versioning enabled. Test
connectivity immediately following deployment.

### How to Reconcile Differences

If your state file should get out of synch with the true state of your
resources, there are a number of things you can attempt to reconcile the
differences. However, given that each Cumulus deployment is unique, we can
provide only general guidance:

- Consider restoring a previous version of your state file, as described
  in the earlier section about recovering from a corrupted state file
- If resources exist, but are not listed in your state file, consider using
  `terraform import` (see <https://www.terraform.io/docs/import/index.html>)
- If resources are missing, but are listed in your state file, run
  `terraform plan` or `terraform apply`, both of which automatically run
  `terraform refresh` to reconcile state. You may also run `terraform refresh`
  directly.

## How to Destroy Everything

If you want to completely remove a deployment, note that there is some
protection in place to prevent accidental destruction of your data.  Therefore,
there is an additional step required when you truly want to remove your entire
deployment. Further, destruction is performed in reverse order of creation.

Starting from the root of your deployment repository workspace, perform the
following commands to first **destroy the resources for your `cumulus` module**
deployment.

**NOTE:** If you are using Terraform workspaces, be sure to select the relevant
workspace first.

```bash
tfenv use 0.13.6
cd cumulus-tf
terraform init -reconfigure
terraform destroy
```

The next step is to _manually_ **delete the DynamoDB tables** related to your
deployment. Again, these tables are protected such that they are **not**
_automatically_ deleted by the `terraform destroy` command. This is a safety
measure to prevent _accidental_ removal.

However, this does not prevent manual destruction in case you truly do wish to
remove them. You may do so via either the **AWS Management Console** or the
**AWS CLI**. As an additional precaution, you may want to create a backup for
each table in your deployment _before_ you delete them.

Then, **destroy the resources for your `data-persistence` module**:

```bash
cd ../data-persistence-tf
terraform init -reconfigure
terraform destroy
```

Destroying your data persistence layer does not destroy any of your RDS resources. Next, **destroy your database resources**.

To teardown the entire cluster, if it was deployed by Terraform, use the `terraform destroy` command to delete your cluster.

If using a shared cluster and you just want to destroy the database created by Cumulus for your deployment you must manually delete that individual database. The database is named `<prefix>_db`.

Delete any manual backups you have made that are no longer needed.

Finally, since we tag the resources in your deployment, you should see if there
are any dangling resources left behind for any reason, by running the following
AWS CLI command, replacing `PREFIX` with your deployment prefix name:

```bash
aws resourcegroupstaggingapi get-resources \
  --query "ResourceTagMappingList[].ResourceARN" \
  --tag-filters Key=Deployment,Values=PREFIX
```

Ideally, the output should be an empty list, but if it is not, then you may
need to manually delete the listed resources.

[Configuring the Cumulus deployment]:
  README.md#configuring-the-cumulus-deployment
[restoring a previous version]:
  https://docs.aws.amazon.com/AmazonS3/latest/dev/RestoringPreviousVersions.html
