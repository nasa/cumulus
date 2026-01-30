FROM python:3.12.11-slim-bookworm

WORKDIR /source

# Install uv
RUN pip install uv

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies
RUN uv sync --frozen --no-dev

# Copy the task source
COPY src/ ./src/

# Update PATH
ENV PATH="/source/.venv/bin:$PATH"
