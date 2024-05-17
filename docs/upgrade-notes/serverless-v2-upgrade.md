---
id: serverless-v2-upgrade
title: Upgrading from Aurora Serverless V1 to V2
hide_title: false
---

## There are 2 approaches to this migration

### Option 1: Snapshot and Restore (simple process, more downtime)

1. Take a manual snapshot of the v1 instance, including the current YYYY-MM-DD in the name of the snapshot. Wait for successful completion showing Status = Available. If this is an initial snapshot of the instance, it may take a substantial amount of time to complete.
2. Ensure delete protection is turned off on the v1 instance, as it will be deleted and replaced with a v2 cluster and instance. Deletion protection can be toggled in the AWS Console under RDS > Databases > select database > Modify.
3. Run "terraform show" to view the current state for module.rds_cluster.aws_rds_cluster.cumulus.
Ensure final_snapshot_identifier is set in resource "aws_rds_cluster" "cumulus". Copy the value. If a snapshot exists with that name, delete that snapshot.
Ensure skip_final_snapshot is false in resource "aws_rds_cluster" "cumulus".
4. Update /example/rds-cluster-tf/terraform.tfvars (or custom .tfvars filename) to:
remove: enable_upgrade
add: snapshot_identifier = "final_snapshot_identifier" (Paste value from prior step)
5. Stop ingest.
6. Run "terraform apply" to create a new v2 cluster and instance(s) based on the v1 final snapshot, using the updated tfvars file (or custom .tfvars filename). Wait for completion.
terraform apply -var-file=terraform.tfvars (or custom .tfvars filename)
7. Resume ingest.
8. The end result is the new v2 cluster is created containing the existing v1 data.

### Option 2: Blue/Green Cutover (complex process, less downtime)

AWS instructions for setting up a blue/green deployment: https://aws.amazon.com/blogs/database/upgrade-from-amazon-aurora-serverless-v1-to-v2-with-minimal-downtime/