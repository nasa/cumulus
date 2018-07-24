FROM node:8.11.0

USER root
RUN apt-get update
RUN apt-get install -y unzip

RUN groupadd -r task -g 433
RUN useradd -u 431 -r -g task -m -s /sbin/nologin -c "Docker image user" task

USER task

COPY . /home/task

WORKDIR /home/task

RUN npm install

CMD [ "node", "--harmony", "index.js" ]
