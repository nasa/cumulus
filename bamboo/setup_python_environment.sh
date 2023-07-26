PYTHON_VERSION=$(cat .python-version)

export DEBIAN_FRONTEND=noninteractive
export TZ=Etc/UTC
apt update -y
apt-get install -y \
  libbz2-dev \
  libsqlite3-dev \
  llvm \
  libncurses5-dev \
  libncursesw5-dev \
  tk-dev \
  liblzma-dev \
  git \
  curl

PROJ=pyenv-installer
SCRIPT_URL=https://github.com/pyenv/$PROJ/raw/master/bin/$PROJ
curl -L $SCRIPT_URL | bash
# setup
export PATH="~/.pyenv/bin:$PATH"
eval "$(pyenv init -)"
eval "$(pyenv virtualenv-init -)"
# apt install software-properties-common -y
# add-apt-repository ppa:deadsnakes/ppa -y
# apt install python3.10 python3-pip -y
# update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1 &&     update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1