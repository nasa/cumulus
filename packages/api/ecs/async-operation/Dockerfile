FROM amazon/aws-lambda-nodejs:20

USER root
RUN dnf install -y unzip shadow-utils

RUN /usr/sbin/groupadd -r task -g 433
RUN /usr/sbin/useradd -u 431 -r -g task -m -s /sbin/nologin -c "Docker image user" task

USER task
WORKDIR /home/task

COPY package.json /home/task/
RUN npm install

RUN cp -a /var/runtime/node_modules/. /home/task/node_modules/

COPY index.js /home/task/

CMD [ "node", "--harmony", "index.js" ]

ENTRYPOINT [ ]
