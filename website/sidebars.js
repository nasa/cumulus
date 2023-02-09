module.exports = {
  'docs': {
    'Getting Started':[
      'cumulus-docs-readme',
      'getting-started',
      'glossary',
      'faqs'
    ],
    'About Cumulus': [
      'architecture',
      'interfaces',
      'team'
    ],
    'Overviews': [
      'workflows/workflows-readme',
      'workflows/protocol',
      'workflows/input_output',
      'workflows/cumulus-task-message-flow',
      'workflows/workflow-triggers'
    ],
    'Deployment': [
      'deployment/deployment-readme',
      'deployment/create_bucket',
      'deployment/terraform-best-practices',
      'deployment/choosing_configuring_rds',
      'deployment/postgres_database_deployment',
      'deployment/components',
      'deployment/thin_egress_app',
      'deployment/cumulus_distribution',
      'deployment/api-gateway-logging',
      'deployment/share-s3-access-logs',
      'deployment/cloudwatch-logs-delivery',
      'deployment/upgrade-readme'
    ],
    'Configuration': [
      'configuration/data-management-types',
      'configuration/monitoring-readme',
      'configuration/server_access_logging',
      'configuration/cloudwatch-retention',
      'configuration/lifecycle-policies',
      'configuration/collection-storage-best-practices',
      'configuration/task-configuration'
    ],
    'Development': [
      'workflows/developing-a-cumulus-workflow',
      'workflows/developing-workflow-tasks',
      'workflows/lambda',
      'workflows/docker',
      'workflows/workflow-configuration-how-to',
      'adding-a-task'
    ],
    'Workflow Tasks': [
      'tasks',
      'workflow_tasks/discover_granules',
      'workflow_tasks/files_to_granules',
      'workflow_tasks/lzards_backup',
      'workflow_tasks/move_granules',
      'workflow_tasks/parse_pdr',
      'workflow_tasks/queue_granules'
    ],
    'Features': [
      'features/backup_and_restore',
      'features/dead_letter_queues',
      'features/dead_letter_archive',
      'features/execution_payload_retention',
      'features/reports',
      'features/ancillary_metadata',
      'features/distribution-metrics',
      'features/logging-esdis-metrics',
      'features/replay-kinesis-messages',
      'features/replay-archived-sqs-messages'
    ],
    'Troubleshooting': [
      'troubleshooting/troubleshooting-readme',
      'troubleshooting/troubleshooting-deployment',
      'troubleshooting/rerunning-workflow-executions',
      'troubleshooting/troubleshooting-deployment',
      'troubleshooting/reindex-elasticsearch'
    ],
    'Cumulus Development': [
      'adding-a-task',
      'docs-how-to'
    ],
    'Integrator Guide': [
      'integrator-guide/about-int-guide',
      'integrator-guide/int-common-use-cases',
      'integrator-guide/workflow-add-new-lambda',
      'integrator-guide/workflow-ts-failed-step'
    ],
    'Upgrade Notes': [
      'upgrade-notes/migrate_tea_standalone',
      'upgrade-notes/upgrade_tf_version_0.13.6',
      'upgrade-notes/upgrade-rds',
      'upgrade-notes/cumulus_distribution_migration',
      'upgrade-notes/update-task-file-schemas',
      'upgrade-notes/update-cma-2.0.2'
    ],
    'External Contributions': [
      'external-contributions/external-contributions'
    ]
  },
  'Data Cookbooks': {
    'About Cookbooks': [
      'data-cookbooks/about-cookbooks'
    ],
    'Cookbooks': [
      'data-cookbooks/hello-world',
      'data-cookbooks/ingest-notifications',
      'data-cookbooks/sips-workflow',
      'data-cookbooks/cnm-workflow',
      'data-cookbooks/error-handling',
      'data-cookbooks/choice-states',
      'data-cookbooks/browse-generation',
      'data-cookbooks/tracking-files',
      'data-cookbooks/run-tasks-in-lambda-or-docker',
      'data-cookbooks/throttling-queued-executions',
      'data-cookbooks/queue-post-to-cmr'
    ]
  },
  'Operator Docs': {
    'About Operator Docs': [
      'operator-docs/about-operator-docs'
    ],
    'Configuration': [
      'operator-docs/locating-access-logs',
      'configuration/data-management-types'
    ],
    'Operations': [
      'operator-docs/discovery-filtering',
      'operator-docs/bulk-operations',
      'operator-docs/cmr-operations',
      'operator-docs/naming-executions',
      'troubleshooting/rerunning-workflow-executions',
      'features/replay-kinesis-messages'
    ],
    'Common Use Cases': [
      'operator-docs/ops-common-use-cases',
      'operator-docs/kinesis-stream-for-ingest',
      'operator-docs/create-rule-in-cumulus',
      'operator-docs/granule-workflows',
      'operator-docs/trigger-workflow'
    ]
  }
};
