## Dockerfile to create integration/unit test environment
FROM node:10.16.3
ADD ./bamboo/install_pyenv.sh /install_pyenv.sh
RUN apt update && npm config set unsafe-perm true &&\
    apt install -y netcat zip jq rsync zip
RUN apt-get install -y make build-essential libssl-dev zlib1g-dev libbz2-dev \
libreadline-dev libsqlite3-dev wget curl llvm libncurses5-dev libncursesw5-dev \
xz-utils tk-dev libffi-dev liblzma-dev
RUN npm install -g npm
RUN /install_pyenv.sh
ENV PATH="/root/.pyenv/bin:$PATH"
RUN echo 'eval "$(pyenv init -)"' >> ~/.shinit && \
    echo 'eval "$(pyenv virtualenv-init -)"' >> ~/.shinit && \
    echo 'eval "$(pyenv init -)"' >> ~/.bashrc && \
    echo 'eval "$(pyenv virtualenv-init -)"' >> ~/.bashrc
ENV ENV=/root/.shinit
RUN pyenv install 3.6.4 && pyenv global 3.6.4
RUN /root/.pyenv/shims/pip install pylint>=1.8.2
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && unzip awscliv2.zip && ./aws/install


