FROM lambci/lambda:build-nodejs6.10

# Install deps

RUN \
  touch /var/lib/rpm/* \
  && yum install -y \
    automake16 \
    libcurl-devel \
    libpng-devel

# Fetch PROJ.4

RUN \
  curl -L http://download.osgeo.org/proj/proj-4.9.3.tar.gz | tar zxf - -C /tmp

# Build and install PROJ.4

WORKDIR /tmp/proj-4.9.3

RUN \
  ./configure \
    --prefix=/var/task && \
  make -j $(nproc) && \
  make install

# Fetch GDAL

RUN \
  mkdir -p /tmp/gdal-dev && \
  curl -L https://github.com/OSGeo/gdal/archive/2.2.tar.gz | tar zxf - -C /tmp/gdal-dev --strip-components=1

# Build + install GDAL

WORKDIR /tmp/gdal-dev/gdal

RUN \
  ./configure \
    --prefix=/var/task \
    --datarootdir=/var/task/share/gdal \
    --with-jpeg=internal \
    --without-qhull \
    --without-grib \
    --without-pcraster \
    --without-gif \
    --without-pcidsk && \
  make -j $(nproc) && \
  make install

WORKDIR /tmp/gdal-dev/gdal/swig/python

RUN \
  python setup.py install && \
  mkdir -p /var/task/lib64/python2.7/site-packages && \
  mv /usr/local/lib64/python2.7/site-packages/GDAL-2.2.2-py2.7-linux-x86_64.egg/* /var/task/lib64/python2.7/site-packages

WORKDIR /var/task/lib64/python2.7/site-packages

RUN \
  rm -r EGG-INFO && \
  curl -o numpy.tar.gz 'https://raw.githubusercontent.com/Miserlou/lambda-packages/master/lambda_packages/numpy/python2.7-numpy-1.10.4.tar.gz' && \
  tar xf numpy.tar.gz && \
  rm numpy.tar.gz

WORKDIR /tmp/mrf-dev

# Build mrf_insert from GIBS
RUN \
  git clone --branch v1.1.2 --depth 1 https://github.com/nasa-gibs/mrf.git && \
  mv mrf/src/gdal_mrf/mrf_apps /tmp/gdal-dev/gdal/ && \
  cd /tmp/gdal-dev/gdal/mrf_apps && \
  make && \
  mv .libs/mrf_insert /var/task/bin/mrf_insert

WORKDIR /tmp/mrfgen-dev

# Build mrfgen from GIBS
RUN \
  git clone --depth 1 https://github.com/nasa-gibs/onearth.git && \
  mv onearth/src/mrfgen/* /var/task/bin/

WORKDIR /var/task

RUN \
  strip lib/libgdal.so.20.* && \
  strip lib/libproj.so.12.*

RUN \
  zip --symlinks \
    -r /tmp/task.zip \
    lib/libgdal.so* \
    lib/libproj.so* \
    lib64/ \
    bin/ \
    share/gdal/
