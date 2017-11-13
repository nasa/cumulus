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

WORKDIR /tmp/mrf-dev

# Build mrf_insert from GIBS
RUN \
  git clone --branch v1.1.2 --depth 1 https://github.com/nasa-gibs/mrf.git && \
  mv mrf/src/gdal_mrf/mrf_apps /tmp/gdal-dev/gdal/ && \
  cd /tmp/gdal-dev/gdal/mrf_apps && \
  make && \
  mv .libs/mrf_insert /var/task/bin/mrf_insert

WORKDIR /var/task

RUN \
  strip lib/libgdal.so.20.3.1 && \
  strip lib/libproj.so.12.0.0

RUN \
  zip --symlinks \
    -r /tmp/task.zip \
    lib/libgdal.so* \
    lib/libproj.so* \
    bin/ \
    share/gdal/
