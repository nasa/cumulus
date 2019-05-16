#!/bin/bash
set -e

. ./set-bamboo-env-variables.sh
if [[ $GIT_PR != true ]]; then
  echo "******Branch HEAD is not a github PR, and this isn't a redeployment build, skipping bootstrap/deploy step"
  exit 0
fi

# Export user information for sshd container
export SSH_USERS=user:$(id -u):$(id -u)

## Set container_id for docker-compose to use to identify the compose stack per planKey
container_id=${bamboo_planKey,,}
container_id=${container_id/-/}
docker_command="docker exec -t ${container_id}_build_env_1 /bin/bash -c"

docker ps -a

## Setup the compose stack
docker-compose -p ${container_id} down
docker-compose -p ${container_id} rm -f
docker-compose -p ${container_id} up -d

docker ps -a

while ! docker container inspect ${container_id}\_build_env_1; do
  echo 'Waiting for build env to be available';
  docker ps -a
  sleep 5;
done

## Setup the build env container once it's started
$docker_command 'npm install --error --no-progress -g nyc; cd /source/cumulus; npm install --error  --no-progress; npm run bootstrap-quiet'

# Wait for the FTP server to be available
while ! $docker_command  'curl --connect-timeout 5 -sS -o /dev/null ftp://testuser:testpass@127.0.0.1/README.md'; do
  echo 'Waiting for FTP to start'
  docker ps -a
  sleep 2
done
echo 'FTP service is available'

# Wait for the HTTP server to be available
while ! $docker_command  'curl --connect-timeout 5 -sS -o /dev/null http://127.0.0.1:3030/README.md'; do
  echo 'Waiting for HTTP to start'
  docker ps -a
  sleep 2
done
echo 'HTTP service is available'

# Set permissions on sftp credentials
chmod 0400 ../packages/test-data/keys/ssh_client_rsa_key

# Wait for the SFTP server to be available
while ! $docker_command 'sftp\
  -P 2222\
  -i /source/cumulus/packages/test-data/keys/ssh_client_rsa_key\
  -o "ConnectTimeout=5"\
  -o "StrictHostKeyChecking=no"\
  -o "UserKnownHostsFile=/dev/null"\
  -o "PreferredAuthentications=publickey"\
  user@127.0.0.1:/keys/ssh_client_rsa_key.pub /dev/null'; do
  echo 'Waiting for SFTP to start'
  docker ps -a
  sleep 2
done
echo 'SFTP service is available'

# Wait for the Elasticsearch service to be available
while ! $docker_command  'nc -z 127.0.0.1 9200'; do
  echo 'Waiting for Elasticsearch to start'
  docker ps -a
  sleep 2
done
echo 'Elasticsearch service is started'

while ! $docker_command 'curl --connect-timeout 5 -sS http://127.0.0.1:9200/_cluster/health | grep green > /dev/null 2>&1'; do
  echo 'Waiting for Elasticsearch status to be green'
  sleep 2
done
echo 'Elasticsearch status is green'

# Update Elasticsearch config to stop complaining about running out of disk space
$docker_command 'curl -XPUT "http://127.0.0.1:9200/_cluster/settings" -d @/source/cumulus/bamboo/elasticsearch.config'

# Lambda seems to be the last service that's started up by Localstack
while ! $docker_command 'nc -z 127.0.0.1 4574'; do
  echo 'Waiting for Localstack Lambda service to start'
  docker ps -a
  sleep 2
done
echo 'Localstack Lambda service is started'

