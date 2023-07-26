PYTHON_VERSION=$(cat .python-version)

wget -c https://www.python.org/ftp/python/$PYTHON_VERSION/Python-$PYTHON_VERSION.tar.xz
tar -Jxf Python-3.11.0.tar.xz
cd Python-$PYTHON_VERSION
./configure --enable-optimizations
make -j4 && sudo make altinstall
update-alternatives --set python /usr/local/bin/python$PYTHON_VERSION

update-alternatives --set python3 /usr/local/bin/python$PYTHON_VERSION
#TODO handle this interaction with base python

# PROJ=pyenv-installer
# SCRIPT_URL=https://github.com/pyenv/$PROJ/raw/master/bin/$PROJ
# curl -L $SCRIPT_URL | bash
# # setup
# export PYENV_ROOT="$HOME/.pyenv"
# export PATH="$PYENV_ROOT/bin:$PYENV_ROOT/shims:$PATH"
# eval "$(pyenv init -)"
# eval "$(pyenv virtualenv-init -)"
# apt install software-properties-common -y
# add-apt-repository ppa:deadsnakes/ppa -y
# apt install python3.10 python3-pip -y
# update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1 &&     update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1