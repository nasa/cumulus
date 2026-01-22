"""Pydantic schemas for task configuration."""

from typing import Literal

from pydantic import BaseModel, Field


class GranuleInvalidationsCrossCollection(BaseModel):
    """Schema for cross-collection granule invalidations."""

    type: Literal["cross_collection"]
    invalidating_collection: str
    invalidating_version: str


class GranuleInvalidationsScienceDate(BaseModel):
    """Schema for science date-based granule invalidations."""

    type: Literal["science_date"]
    maximum_minutes_old: int


class GranuleInvalidationsIngestDate(BaseModel):
    """Schema for ingest date-based granule invalidations."""

    type: Literal["ingest_date"]
    maximum_minutes_old: int


class Model(BaseModel):
    """Configuration schema for granule invalidator task."""

    granule_invalidations: list[
        GranuleInvalidationsIngestDate
        | GranuleInvalidationsScienceDate
        | GranuleInvalidationsCrossCollection
    ] = Field(min_length=1)
    collection: str
    version: str
