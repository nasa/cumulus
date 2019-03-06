FROM node:8.10

USER root
RUN apt-get update && apt-get install -y unzip

RUN groupadd -r task -g 433
RUN useradd -u 431 -r -g task -m -s /sbin/nologin -c "Docker image user" task

USER task
WORKDIR /home/task

COPY package.json /home/task/
RUN npm ci

COPY index.js /home/task/

CMD [ "node", "--harmony", "index.js" ]
