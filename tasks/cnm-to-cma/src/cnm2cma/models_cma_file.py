from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, RootModel


class ModelItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    bucket: str = Field(..., description="Bucket where file is archived in S3")
    checksum: str | None = Field(None, description="Checksum value for file")
    checksumType: str | None = Field(
        None, description="Type of checksum (e.g. md5, sha256, etc)"
    )
    fileName: str | None = Field(None, description="Name of file (e.g. file.txt)")
    key: str = Field(..., description="S3 Key for archived file")
    size: float | None = Field(None, description="Size of file (in bytes)")
    source: str | None = Field(
        None,
        description="Source URI of the file from origin system (e.g. S3, FTP, HTTP)",
    )
    type: str | None = Field(
        None, description="Type of file (e.g. data, metadata, browse)"
    )


class Model(RootModel[list[ModelItem]]):
    root: list[ModelItem]
