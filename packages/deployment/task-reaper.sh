#!/bin/sh

set -e

echo "$(date) Starting task-reaper.sh"

INSTANCE_ID=$(curl http://169.254.169.254/latest/meta-data/instance-id)

CLUSTER=$(grep 'ECS_CLUSTER=' /etc/ecs/ecs.config | cut -d '=' -f 2)

CONTAINER_INSTANCE_ARN=$(
  aws ecs list-container-instances \
    --cluster "$CLUSTER" \
    --filter "ec2InstanceId == $INSTANCE_ID" |\
  jq -r '.containerInstanceArns[0]'
)
CONTAINER_INSTANCE_STATUS=$(
  aws ecs describe-container-instances \
    --cluster "$CLUSTER" \
    --container-instances "$CONTAINER_INSTANCE_ARN" |\
  jq -r .containerInstances[0].status
)

if [ "$CONTAINER_INSTANCE_STATUS" = 'ACTIVE' ]; then
  LIFECYCLE_STATE=$(
    aws autoscaling describe-auto-scaling-instances \
      --instance-ids "$INSTANCE_ID" |\
    jq -r '.AutoScalingInstances[0].LifecycleState'
  )

  if [ "$LIFECYCLE_STATE" = 'Terminating:Wait' ]; then
    echo "Draining ${INSTANCE_ID}"
    aws ecs update-container-instances-state \
      --cluster "$CLUSTER" \
      --container-instances "$CONTAINER_INSTANCE_ARN" \
      --status DRAINING
  else
    echo "Nothing to be done, exiting"
  fi
else
  TASKS_COUNT=$(
    aws ecs list-tasks \
      --cluster "$CLUSTER" \
      --container-instance "$CONTAINER_INSTANCE_ARN" |\
    jq -r '.taskArns | length'
  )
  ASG_NAME=$(
    aws autoscaling describe-auto-scaling-instances \
      --instance-ids "$INSTANCE_ID" |\
    jq -r '.AutoScalingInstances[0].AutoScalingGroupName'
  )

  if [ "$TASKS_COUNT" -eq "0" ]; then
    echo "Removing $INSTANCE_ID from the $CLUSTER cluster"
    aws ecs deregister-container-instance \
      --cluster "$CLUSTER" \
      --container-instance "$CONTAINER_INSTANCE_ARN"
    aws autoscaling complete-lifecycle-action \
      --auto-scaling-group-name "$ASG_NAME" \
      --instance-id "$INSTANCE_ID" \
      --lifecycle-action-result CONTINUE \
      --lifecycle-hook-name "$LIFECYCLE_HOOK_NAME"
  else
    echo "Draining, still waiting for $TASKS_COUNT tasks to finish"
    aws autoscaling record-lifecycle-action-heartbeat \
      --auto-scaling-group-name "$ASG_NAME" \
      --instance-id "$INSTANCE_ID" \
      --lifecycle-hook-name "$LIFECYCLE_HOOK_NAME"
  fi
fi
