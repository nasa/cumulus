from __future__ import annotations

from pydantic import BaseModel, Field


class File(BaseModel):
    name: str = Field(..., description='name of file to be synced')
    filename: str | None = Field(
        None, description='optional field - usage depends on provider type'
    )
    type: str | None = None
    source_bucket: str | None = Field(
        None,
        description='optional - alternate source bucket to use for this file instead of the provider bucket.  Works with s3 provider only, ignored for other providers',
    )
    path: str = Field(..., description='provider path of file to be synced')


class Granule(BaseModel):
    granuleId: str
    dataType: str | None = None
    version: str | None = None
    producerGranuleId: str | None = Field(
        None, description='Granule ID from the producer, if available'
    )
    files: list[File]


class SyncGranuleInput(BaseModel):
    granules: list[Granule]
