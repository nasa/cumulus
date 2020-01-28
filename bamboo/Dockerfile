## Dockerfile to create integration/unit test environment
FROM node:10.16.3
RUN apt update && npm config set unsafe-perm true &&\
    apt install -y netcat zip jq rsync zip python-pip && \
    apt-get install -y python-pip && pip install awscli && \
    npm install -g npm
RUN git clone https://github.com/nasa/cumulus && cd cumulus && npm install --no-package-lock && npx lerna bootstrap --no-ci --force-local --ignore-scripts && rm -Rf ./example/node_modules