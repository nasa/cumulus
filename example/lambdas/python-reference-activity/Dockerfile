FROM python:3.10-bullseye
ADD . /source
WORKDIR /source
RUN pip install pipenv && pipenv install --system --deploy --ignore-pipfile
