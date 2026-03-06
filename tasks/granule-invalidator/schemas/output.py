"""Pydantic schemas for task output."""

from pydantic import BaseModel, ConfigDict, Field


class Model(BaseModel):
    """Output schema for granule invalidator task."""

    model_config = ConfigDict(title="GranuleInvalidatorOutput")

    granules: list[str] = Field(
        description="Array of granuleId's identified for removal",
    )
    forceRemoveFromCmr: bool = Field(
        description="Flag indicating whether to force remove granules from CMR",
    )
    granules_to_be_deleted_count: int = Field(
        description="Total count of granules to be deleted",
    )
    aggregated_stats: str = Field(
        description="Summary statistics including counts of granules to be removed "
        "and retained, broken down by invalidation type",
    )
