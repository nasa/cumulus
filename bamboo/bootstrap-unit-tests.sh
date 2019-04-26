#!/bin/bash
set -e

SSH_USERS=user:$(id -u):$(id -u)
container_id=${bamboo_planKey,,}
container_id=${container_id/-/}

docker ps -a
## Setup the compose stack
docker-compose -p ${container_id} down
docker-compose -p ${container_id} rm -f
docker-compose -p ${container_id} up -d
docker ps -a

while ! docker container inspect ${container_id}\_build_env_1; do
  echo 'Waiting for build env to be available';
  sleep 5;
done

## Setup the build env container once it's started
# docker exec -t ${container_id}\_build_env_1 /bin/bash -c 'npm install --silent --no-progress -g nyc; cd /source/cumulus; npm install --silent  --no-progress; npm run bootstrap-silent'

# Wait for the FTP server to be available
while ! curl --connect-timeout 5 -sS -o /dev/null ftp://testuser:testpass@127.0.0.1/README.md; do
  echo 'Waiting for FTP to start'
  sleep 2
done
echo 'FTP service is available'

# Wait for the HTTP server to be available
while ! curl --connect-timeout 5 -sS -o /dev/null http://127.0.0.1:3030/README.md; do
  echo 'Waiting for HTTP to start'
  sleep 2
done
echo 'HTTP service is available'

# Set permissions on sftp credentials
chmod 0400 ../packages/test-data/keys/ssh_client_rsa_key

# Wait for the SFTP server to be available
while ! sftp \
  -P 2222 \
  -i ../packages/test-data/keys/ssh_client_rsa_key \
  -o 'ConnectTimeout=5' \
  -o 'StrictHostKeyChecking=no' \
  -o 'UserKnownHostsFile=/dev/null' \
  -o "PreferredAuthentications=publickey" \
  user@127.0.0.1:/keys/ssh_client_rsa_key.pub /dev/null; do
  echo 'Waiting for SFTP to start'
  sleep 2
done
echo 'SFTP service is available'

# Wait for the Elasticsearch service to be available
while ! nc -z 127.0.0.1 9200; do
  echo 'Waiting for Elasticsearch to start'
  sleep 2
done
echo 'Elasticsearch service is started'

while ! curl --connect-timeout 5 -sS http://127.0.0.1:9200/_cluster/health | grep green > /dev/null 2>&1; do
  echo 'Waiting for Elasticsearch status to be green'
  sleep 2
done
echo 'Elasticsearch status is green'

# Update Elasticsearch config to stop complaining about running out of disk space
curl -XPUT "http://127.0.0.1:9200/_cluster/settings" -d '
{
  "persistent": {
    "cluster.routing.allocation.disk.threshold_enabled": true,
    "cluster.routing.allocation.disk.watermark.low": "1g",
    "cluster.routing.allocation.disk.watermark.high": "500m",
    "cluster.info.update.interval": "5m"
  }
}'

# Lambda seems to be the last service that's started up by Localstack
while ! nc -z 127.0.0.1 4574; do
  echo 'Waiting for Localstack Lambda service to start'
  sleep 2
done
echo 'Localstack Lambda service is started'

