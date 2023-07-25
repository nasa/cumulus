PYTHON_VERSION=$(cat .python-version)

export DEBIAN_FRONTEND=noninteractive
export TZ=Etc/UTC
apt update -y
apt install software-properties-common -y
add-apt-repository ppa:deadsnakes/ppa -y
apt install python3.10 python3-pip -y
update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1 &&     update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1