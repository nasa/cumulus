FROM python:3.13.9-slim-bookworm
ADD . /source
WORKDIR /source
RUN pip install pipenv && pipenv install --system --deploy --ignore-pipfile
