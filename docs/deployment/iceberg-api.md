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

| Endpoint | Description |
|---|---|
| `GET /version` | API version (no auth required) |
| `GET /granules` | List granules |
| `GET /collections` | List collections |
| `GET /executions` | List executions |
| `GET /providers` | List providers |
| `GET /pdrs` | List PDRs |
| `GET /rules` | List rules |
| `GET /async-operations` | List async operations |
| `GET /reconciliation-reports` | List reconciliation reports |
| `GET /stats` | Statistics summary |
| `GET /stats/aggregate/:type?` | Aggregate statistics |

## Request Parameters

For corresponding list endpoints, Iceberg API supports the same query parameters as Cumulus API.

Use the matching Cumulus API endpoint documentation for parameter details:

- Cumulus API docs: <https://nasa.github.io/cumulus-api>
