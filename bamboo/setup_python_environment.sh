RETURN=$(pwd)
cd /opt
PYTHON_VERSION=3.10
PYTHON_VERSION_PATCH=9
wget -c https://www.python.org/ftp/python/$PYTHON_VERSION.$PYTHON_VERSION_PATCH/Python-$PYTHON_VERSION.$PYTHON_VERSION_PATCH.tgz
tar -zxf Python-$PYTHON_VERSION.$PYTHON_VERSION_PATCH.tgz
cd Python-$PYTHON_VERSION.$PYTHON_VERSION_PATCH
./configure --enable-optimizations
make -j4 && make altinstall
update-alternatives --install /usr/bin/python python /usr/local/bin/python$PYTHON_VERSION 1
update-alternatives --set python /usr/local/bin/python$PYTHON_VERSION

cd $RETURN
