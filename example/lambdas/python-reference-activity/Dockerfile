FROM python:3.12.11-slim-bookworm
ADD . /source
WORKDIR /source
RUN pip install pipenv && pipenv install --system --deploy --ignore-pipfile
