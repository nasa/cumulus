---
id: ecs_autoscaling
title: ECS Auto Scaling
hide_title: true
---

# ECS Auto Scaling

Cumulus deployments are configured to scale out ECS Services' desired tasks and ECS Cluster EC2 instances.

## ECS Service Auto Scaling Scale Out

[ECS Service Auto Scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html) is configured per-service to scale whenever AWS Step Functions schedules more activities than can be started by running ECS Tasks. The `ActivitiesWaiting` metric is calculated using metrics from the AWS `States/Activities` namespace. The `ActivitiesWaiting` metric is derived in the AWS Cloudformation template using `ActivitesScheduled - ActivitiesStarted` (see: [MetricDataQuery](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cloudwatch-alarm-metricdataquery.html). 

By default, the ECS Service Scale Out policy increases desired tasks by 10% whenever the `ActivitiesWaiting` metric is above 0 for 5 periods of 1 minute (using [StepScaling](https://docs.aws.amazon.com/autoscaling/application/userguide/application-auto-scaling-step-scaling-policies.html)). Note - `ActivitesWaiting` can go negative. However, these settings can be configured in `app/config.yml`:

```yaml
  ecs:
    service_scaling:
      scale_in:
        evaluation_periods: 1
      scale_out:
        threshold: 1
        evaluation_periods: 1
        step_adjustment_config:
          AdjustmentType: PercentChangeInCapacity
          StepAdjustments:
          - MetricIntervalLowerBound: 0
            MetricIntervalUpperBound: 10
            ScalingAdjustment: 5
          - MetricIntervalLowerBound: 10
            MetricIntervalUpperBound: 20
            ScalingAdjustment: 10
          - MetricIntervalLowerBound: 20
            MetricIntervalUpperBound: 30
            ScalingAdjustment: 20
          - MetricIntervalLowerBound: 30
            ScalingAdjustment: 30
```

## ECS Cluster Scale Out / In

This ECS Service Scale Out Scaling Policy operations increases the number of services' desired tasks. However, it may be the case that not all of those desired tasks can be placed due to memory and CPU limits of the current ECS Cluster. When this happens, ECS Cluster Auto Scaling should kick in. By default, the ECS Cluster will scale out 10% when the AWS/ECS `MemoryReservation` metric is greater than or equal to 75%. 

By default, a Scale In Policy scales in the ECS Cluster by 10% whenever `MemoryReservation` at or below 50%.

The metric, threshold and evaluation periods used in ECS Cluster Scale In / Out can also be configured in `app/config.yml`:

```yaml
    autoscaling_policies:
      metric: CPU
      scale_out:
        evaluation_periods: 1
        threshold: 90
      scale_in:
        evaluation_periods: 1
        threshold: 60 
```

## ECS Service Scale In

However, in order for the `Memory` or `CPUReservation` ECS Cluster metrics to decrease, the number of running / desired tasks needs to be scaled in.

In order to scale in desired tasks, the default configuration uses a [`TargetTracking`](https://docs.aws.amazon.com/autoscaling/application/userguide/application-auto-scaling-target-tracking.html) scaling policy type to keep `ECSServiceAverageCPUUtilization` at 20%. A utilization metric must be used because States/Activities metric cannot be used to affect gradual scale in or scale out: States/Activities metrics are not are not persistent - e.g. when no activities are scheduled, Cloudwatch regards this as "missing data" and missing data can only be trigger one Alarm state change (e.g. from ALARM to OK).

The scale in target tracking can also be configured in `app/config.yml`:

```yaml
  ecs:
    service_scaling:
      target_value: 50
      predefined_metric_type: ECSServiceAverageMemoryUtilization
```

### CloudWatch Metrics

For reference, here are the available CloudWatch metrics available (by namespace and metric name) for use in scaling ECS services and clusters:

ECS/Cluster
* MemoryReservation
* CPUReservation

ECS/Cluster, ECS/Service
* MemoryUtilization
* CPUUtilization

States/Activities
* ActivitiesStarted
* ActivitiesTimedOut
* ActivitiesSucceeded
* ActivitiesFailed
* ActivitiesScheduled
* ActivitiesHeartbeatTimedOut

### Cloudformation Resources:

* For ECS Service Autoscaling, see [AWS::ApplicationAutoScaling::ScalingPolicy](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-applicationautoscaling-scalingpolicy.html#cfn-applicationautoscaling-scalingpolicy-stepscalingpolicyconfiguration)
* For ECS Cluster Autoscaling, see [AWS::AutoScaling::ScalingPolicy](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-as-policy.html)
