## Dockerfile to create integration/unit test environment
FROM node:16.19.0-buster
RUN apt update && npm config set unsafe-perm true &&\
    apt install -y netcat zip jq rsync zip
RUN apt-get install -y make build-essential libssl-dev zlib1g-dev libbz2-dev \
libreadline-dev libsqlite3-dev wget curl llvm libncurses5-dev libncursesw5-dev \
xz-utils tk-dev libffi-dev liblzma-dev python3-pip
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.7 1 && \
    update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1
RUN python -m pip install -U pip
RUN npm install -g npm@8.6 && npm config --global set script-shell /bin/bash
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && unzip awscliv2.zip && ./aws/install
