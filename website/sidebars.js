const sidebars = {
  docs: [
    {
      type: 'category',
      label: 'Getting Started',
      link: {
        type: 'generated-index',
      },
      collapsed: false,
      items: [
        'cumulus-docs-readme',
        'getting-started',
        'glossary',
        'faqs',
      ],
    },
    {
      type: 'category',
      label: 'About Cumulus',
      link: {
        type: 'generated-index',
      },
      collapsed: false,
      items: [
        'architecture',
        'interfaces',
        'team',
      ],
    },
    {
      type: 'category',
      label: 'Deployment',
      link: {
        type: 'generated-index',
        title: 'Cumulus Deployment',
        description:
          'Here you are going to learn about how to deploy Cumulus and to setup approved APIs and databases.',
        keywords: ['deployment', 'TEA', 'Cumulus API', 'RDS', 'Postgres'],
      },
      collapsed: false,
      items: [
        'deployment/deployment-readme',
        'deployment/create_bucket',
        'deployment/terraform-best-practices',
        'deployment/components',
        {
          type: 'category',
          label: 'Databases',
          link: {
            type: 'doc',
            id: 'deployment/databases-introduction',
          },
          collapsed: false,
          items: [
            'deployment/postgres_database_deployment',
            'deployment/choosing_configuring_rds',
          ],
        },
        {
          type: 'category',
          label: 'APIs',
          link: {
            type: 'doc',
            id: 'deployment/apis-introduction',
          },
          collapsed: false,
          items: [
            'deployment/thin_egress_app',
            'deployment/cumulus_distribution',
          ],
        },
        {
          type: 'category',
          label: 'Logs',
          link: {
            type: 'generated-index',
          },
          collapsed: false,
          items: [
            'deployment/api-gateway-logging',
            'deployment/share-s3-access-logs',
            'deployment/cloudwatch-logs-delivery',
          ],
        },
        'deployment/upgrade-readme',
      ],
    },
    {
      type: 'category',
      label: 'Configuration',
      link: {
        type: 'generated-index',
      },
      collapsed: false,
      items: [
        'configuration/data-management-types',
        'configuration/monitoring-readme',
        'configuration/server_access_logging',
        'configuration/cloudwatch-retention',
        'configuration/lifecycle-policies',
        'configuration/collection-storage-best-practices',
        'configuration/task-configuration',
      ],
    },
    {
      type: 'category',
      label: 'Development',
      link: {
        type: 'generated-index',
      },
      collapsed: false,
      items: [
        'workflows/developing-a-cumulus-workflow',
        'workflows/developing-workflow-tasks',
        'workflows/lambda',
        'workflows/docker',
        'workflows/workflow-configuration-how-to',
        'adding-a-task',
      ],
    },
    {
      type: 'category',
      label: 'Workflows',
      link: {
        type: 'generated-index',
      },
      collapsed: false,
      items: [
        'workflows/workflows-readme',
        'workflows/protocol',
        'workflows/input_output',
        'workflows/workflow-triggers',
        'workflows/message_granule_writes',
        {
          type: 'category',
          label: 'Workflow Tasks',
          link: {
            type: 'generated-index',
          },
          collapsed: false,
          items: [
            'tasks',
            'workflows/cumulus-task-message-flow',
            'workflow_tasks/discover_granules',
            'workflow_tasks/files_to_granules',
            'workflow_tasks/move_granules',
            'workflow_tasks/queue_granules',
            'workflow_tasks/lzards_backup',
            'workflow_tasks/parse_pdr',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Features',
      link: {
        type: 'generated-index',
      },
      collapsed: false,
      items: [
        'features/backup_and_restore',
        'features/dead_letter_queues',
        'features/dead_letter_archive',
        'features/execution_payload_retention',
        'features/generate_unique_granuleId',
        'features/reports',
        'features/ancillary_metadata',
        'features/distribution-metrics',
        'features/logging-esdis-metrics',
        'features/replay-kinesis-messages',
        'features/replay-archived-sqs-messages',
        'features/change_granule_collection',
        'features/record_archival',
      ],
    },
    {
      type: 'category',
      label: 'Troubleshooting',
      link: {
        type: 'generated-index',
      },
      collapsed: false,
      items: [
        'troubleshooting/troubleshooting-readme',
        'troubleshooting/troubleshooting-deployment',
        'troubleshooting/rerunning-workflow-executions',
        'troubleshooting/reindex-elasticsearch',
        'troubleshooting/troubleshooting-database-migrations',
      ],
    },
    {
      type: 'category',
      label: 'Cumulus Development',
      link: {
        type: 'generated-index',
      },
      collapsed: false,
      items: [
        'adding-a-task',
        'docs-how-to',
        'development/release',
      ],
    },
    {
      type: 'category',
      label: 'Integrator Guide',
      link: {
        type: 'generated-index',
      },
      collapsed: false,
      items: [
        'integrator-guide/about-int-guide',
        'integrator-guide/int-common-use-cases',
        'integrator-guide/workflow-add-new-lambda',
        'integrator-guide/workflow-ts-failed-step',
      ],
    },
    {
      type: 'category',
      label: 'Upgrade Notes',
      link: {
        type: 'generated-index',
      },
      collapsed: false,
      items: [
        'upgrade-notes/migrate_tea_standalone',
        'upgrade-notes/upgrade_tf_version_0.13.6',
        'upgrade-notes/upgrade_tf_version_1.5.3',
        'upgrade-notes/upgrade-rds',
        'upgrade-notes/cumulus_distribution_migration',
        'upgrade-notes/update-task-file-schemas',
        'upgrade-notes/update-cma-2.0.2',
        'upgrade-notes/upgrade-rds-phase-3-release',
        'upgrade-notes/rds-phase-3-data-migration-guidance',
        'upgrade-notes/upgrade-rds-cluster-tf-postgres-13',
        'upgrade-notes/upgrade-rds-cluster-tf-postgres-17',
        'upgrade-notes/update-cumulus_id-type-indexes-CUMULUS-3449',
        'upgrade-notes/upgrade_execution_table_CUMULUS_3320',
        'upgrade-notes/update_table_indexes_CUMULUS_3792',
        'upgrade-notes/serverless-v2-upgrade',
        'upgrade-notes/upgrade-terraform-1.12',
        'upgrade-notes/archived_column_indexing',
        'upgrade-notes/update-granules-to-include-producer_granule_id',
      ],
    },
    {
      type: 'category',
      label: 'External Contributions',
      link: {
        type: 'generated-index',
      },
      collapsed: false,
      items: [
        'external-contributions/external-contributions',
      ],
    },
    {
      type: 'category',
      label: 'Data Cookbooks',
      link: {
        type: 'doc',
        id: 'data-cookbooks/about-cookbooks',
      },
      collapsed: false,
      items: [
        'data-cookbooks/about-cookbooks',
        {
          type: 'category',
          label: 'Cookbooks',
          link: {
            type: 'generated-index',
          },
          items: [
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
            'data-cookbooks/queue-post-to-cmr',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Operator Docs',
      link: {
        type: 'doc',
        id: 'operator-docs/about-operator-docs',
      },
      collapsed: false,
      items: [
        {
          type: 'category',
          label: 'Configuration',
          link: {
            type: 'generated-index',
          },
          items: [
            'operator-docs/locating-access-logs',
            'configuration/data-management-types',
          ],
        },
        {
          type: 'category',
          label: 'Operations',
          link: {
            type: 'generated-index',
          },
          items: [
            'operator-docs/discovery-filtering',
            'operator-docs/bulk-operations',
            'operator-docs/cmr-operations',
            'operator-docs/naming-executions',
            'troubleshooting/rerunning-workflow-executions',
            'features/replay-kinesis-messages',
          ],
        },
        {
          type: 'category',
          label: 'Common Use Cases',
          link: {
            type: 'generated-index',
          },
          items: [
            'operator-docs/ops-common-use-cases',
            'operator-docs/kinesis-stream-for-ingest',
            'operator-docs/create-rule-in-cumulus',
            'operator-docs/granule-workflows',
            'operator-docs/trigger-workflow',
          ],
        },
      ],
    },
  ],
};

module.exports = sidebars;
