FROM centos:6

USER root

WORKDIR /tmp/install
RUN curl --silent --location https://rpm.nodesource.com/setup_4.x | bash -
RUN curl -s -O -L https://github.com/nasa-gibs/mrf/releases/download/v1.0.0/mrf-1.0.0.tar.gz
RUN tar -zxvf mrf-*.tar.gz

RUN yum install -y epel-release
RUN yum install -y \
       gcc-c++ \
       gibs-gdal-* \
       make \
       nodejs

RUN curl -L -o /usr/bin/RGBApng2Palpng 'https://github.com/nasa-gibs/onearth/blob/1.0.1/src/mrfgen/RGBApng2Palpng?raw=true' \
 && chmod a+rx /usr/bin/RGBApng2Palpng \
 && curl -L -o /usr/bin/mrfgen 'https://github.com/nasa-gibs/onearth/blob/1.0.1/src/mrfgen/mrfgen.py?raw=true' \
 && chmod a+rx /usr/bin/mrfgen \
 && curl -L -o /usr/bin/colormap2vrt.py 'https://github.com/nasa-gibs/onearth/blob/1.0.1/src/mrfgen/colormap2vrt.py?raw=true' \
 && chmod a+rx /usr/bin/colormap2vrt.py


RUN rm -rf /tmp/install

RUN yum install -y \
       unzip

WORKDIR /home/runner
COPY . /home/runner

RUN groupadd -r runner -g 433 \
 && useradd -u 431 -r -g runner -d /home/runner -s /sbin/nologin -c "Docker image user" runner \
 && chown -R runner:runner /home/runner

USER runner

RUN npm install

ENTRYPOINT [ "node", "--harmony", "index.js" ]
