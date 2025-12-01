## Dockerfile to create integration/unit test environment
FROM node:20.19.6-bullseye
RUN apt update &&\
    apt install -y netcat zip jq rsync zip
RUN apt-get install -y make build-essential libssl-dev zlib1g-dev libbz2-dev \
libreadline-dev libsqlite3-dev wget curl llvm libncurses5-dev libncursesw5-dev \
xz-utils tk-dev libffi-dev liblzma-dev python3-pip
# install python
WORKDIR /opt
ARG PYTHON_VERSION=3.12
ARG PYTHON_VERSION_PATCH=11
RUN wget -c https://www.python.org/ftp/python/$PYTHON_VERSION.$PYTHON_VERSION_PATCH/Python-$PYTHON_VERSION.$PYTHON_VERSION_PATCH.tgz
RUN tar -zxf Python-$PYTHON_VERSION.$PYTHON_VERSION_PATCH.tgz
WORKDIR "/opt/Python-$PYTHON_VERSION.$PYTHON_VERSION_PATCH"
RUN ./configure --enable-optimizations && make -j4 && make altinstall

WORKDIR /
RUN update-alternatives --install /usr/bin/python python /usr/local/bin/python3.12 1 && \
    update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1
RUN python -m pip install -U pip
RUN npm config --global set script-shell /bin/bash
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && unzip awscliv2.zip && ./aws/install
