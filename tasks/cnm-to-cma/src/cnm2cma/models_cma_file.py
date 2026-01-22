from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, RootModel


class ModelItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    bucket: str = Field(..., description="Bucket where file is archived in S3")
    checksum: Optional[str] = Field(None, description="Checksum value for file")
    checksumType: Optional[str] = Field(
        None, description="Type of checksum (e.g. md5, sha256, etc)"
    )
    fileName: Optional[str] = Field(None, description="Name of file (e.g. file.txt)")
    key: str = Field(..., description="S3 Key for archived file")
    size: Optional[float] = Field(None, description="Size of file (in bytes)")
    source: Optional[str] = Field(
        None,
        description="Source URI of the file from origin system (e.g. S3, FTP, HTTP)",
    )
    type: Optional[str] = Field(
        None, description="Type of file (e.g. data, metadata, browse)"
    )


class Model(RootModel[List[ModelItem]]):
    root: List[ModelItem]
