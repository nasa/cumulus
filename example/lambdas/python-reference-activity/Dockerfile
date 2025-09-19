FROM python:3.14.0rc2-slim-bookworm
ADD . /source
WORKDIR /source
RUN pip install pipenv && pipenv install --system --deploy --ignore-pipfile
