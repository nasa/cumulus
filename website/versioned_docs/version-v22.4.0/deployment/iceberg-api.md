---
id: iceberg-api
title: Iceberg API
hide_title: false
---

The Iceberg API is a read-only API for querying Cumulus metadata backed by Iceberg tables.

It is separate from the main Cumulus API and provides read/list access for supported resources.

## When to use Iceberg API vs Cumulus API

- Use Iceberg API for read-only list and aggregate queries on supported resources. It offers better query performance than the Cumulus API, with results that may be delayed by approximately 1 minute.
- Use Cumulus API for write operations and management workflows (create, update, delete, and operational actions).
- Use Cumulus API when you need endpoints that are not exposed by Iceberg API.

## Endpoints

All list endpoints are also available with the `/v1/` prefix.

| Endpoint | Auth | Description |
|---|---|---|
| `GET /health` | No | Readiness/health status |
| `GET /version` | No | API version metadata |
| `GET /granules` | Yes | List granules |
| `GET /collections` | Yes | List collections |
| `GET /executions` | Yes | List executions |
| `GET /providers` | Yes | List providers |
| `GET /pdrs` | Yes | List PDRs |
| `GET /rules` | Yes | List rules |
| `GET /asyncOperations` | Yes | List async operations |
| `GET /reconciliationReports` | Yes | List reconciliation reports |
| `GET /stats` | Yes | Statistics summary |
| `GET /stats/aggregate/:type?` | Yes | Aggregate statistics |

## Request Parameters

For corresponding list endpoints, Iceberg API supports the same query parameters as Cumulus API.

Use the matching Cumulus API endpoint documentation for parameter details:

- Cumulus API docs: <https://nasa.github.io/cumulus-api>

## Deployment configuration

When deploying with Terraform, configure the Iceberg API container image with:

- `cumulus_iceberg_api_image_repository_url` (repository URL)
- `cumulus_iceberg_api_image_version` (tag)

In Bamboo deployments (`bamboo/bootstrap-tf-deployment.sh`), the repository URL defaults to:

- `ghcr.io/nasa/cumulus-iceberg-api` (master branch)

For non-master branches, Bamboo switches to account ECR and uses tag `latest`:

- `<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/cumulus-iceberg-api:latest`

To override in Bamboo, set:

- `bamboo_ICEBERG_IMAGE_REPOSITORY_URL`

When `DEPLOY_ICEBERG_API=true` and the repository URL starts with `ghcr.io/`, Bamboo waits for the image tag to exist in GHCR before running `terraform apply`.

Optional Bamboo wait controls:

- `bamboo_ICEBERG_IMAGE_WAIT_TIMEOUT_SECONDS` (default: `1800`)
- `bamboo_ICEBERG_IMAGE_WAIT_INTERVAL_SECONDS` (default: `15`)
