from __future__ import annotations

from pydantic import BaseModel, Field


class Granule(BaseModel):
    granuleId: str  # noqa: N815
    collectionId: str  # noqa: N815


class Model(BaseModel):
    granules: list[Granule] = Field(
        ...,
        description='Array of granules identified for removal with their ' \
                    'collection information',
    )
    forceRemoveFromCmr: bool = Field(  # noqa: N815
        ..., description='Flag indicating whether to force remove granules from CMR'
    )
    granules_to_be_deleted_count: int = Field(
        ..., description='Total count of granules to be deleted'
    )
    aggregated_stats: str = Field(
        ...,
        description='Summary statistics including counts of granules to be removed '
                    'and retained, broken down by invalidation type',
    )
