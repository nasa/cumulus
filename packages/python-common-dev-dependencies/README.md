# Python Common Dev Dependencies
This package is used to make managing python development dependencies across the
repo easier. Each python task or package in the repo should depend on this
package in the dev dependency group in order to pull in common testing and
linting tools.

Example configuration with UV:
```pyproject.toml
[dependency-groups]
dev = [
    "python-common-dev-dependencies",
]

[tool.uv.sources]
python-common-dev-dependencies = { path = "../../packages/python-common-dev-dependencies" }
```
