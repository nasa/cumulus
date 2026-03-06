"""Helpers for customizing schema generation."""

from pydantic.json_schema import SkipJsonSchema

SkipNone = SkipJsonSchema[None]


def pop_default(s: dict) -> None:
    """Remove 'default' key from json schema.

    This can be used in a model like:
    ```python
    class Model(BaseModel):
        foo: str = Field("", json_schema_extra=pop_default)
    ```
    """
    s.pop("default", None)
