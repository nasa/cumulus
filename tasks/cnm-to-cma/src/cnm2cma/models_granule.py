from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class File(BaseModel):
    name: str = Field(..., description='name of file to be synced')
    filename: Optional[str] = Field(
        None, description='optional field - usage depends on provider type'
    )
    type: Optional[str] = None
    source_bucket: Optional[str] = Field(
        None,
        description='optional - alternate source bucket to use for this file instead of the provider bucket.  Works with s3 provider only, ignored for other providers',
    )
    path: str = Field(..., description='provider path of file to be synced')


class Granule(BaseModel):
    granuleId: str
    dataType: Optional[str] = None
    version: Optional[str] = None
    producerGranuleId: Optional[str] = Field(
        None, description='Granule ID from the producer, if available'
    )
    files: List[File]


class SyncGranuleInput(BaseModel):
    granules: List[Granule]
