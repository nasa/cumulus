#!/bin/bash
set -ex

. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh
. ./bamboo/abort-if-skip-unit-tests.sh

# Export user information for sshd container
export SSH_USERS=user:$(id -u):$(id -u)
export COMPOSE_FILE=./bamboo/docker-compose.yml

## Set container_id for docker compose to use to identify the compose stack per planKey
docker_command="docker exec -t ${container_id}-build_env-1 /bin/bash -c"

docker ps -a

echo 'Removing running docker containers...'

docker rm -f $(docker ps -q) || true

echo 'Setting up Core containers'

## Setup the compose stack
docker compose -p ${container_id} down
docker compose -p ${container_id} rm -f
docker compose -p ${container_id} up -d

docker ps -a
while ! docker container inspect ${container_id}-build_env-1; do
  echo 'Waiting for build env to be available';
  docker ps -a
  sleep 5;
done

## Setup the build env container once it's started
$docker_command "npm install --error --no-progress -g nyc; cd $UNIT_TEST_BUILD_DIR; git fetch --all; git checkout $GIT_SHA"
# Copy build cache of compiled TS code into cached bootstrap dir, if necessary
docker cp $TS_BUILD_CACHE_FILE "${container_id}-build_env-1:$UNIT_TEST_BUILD_DIR"
docker cp bamboo/extract-ts-build-cache.sh "${container_id}-build_env-1:$UNIT_TEST_BUILD_DIR/bamboo"

# Extract build cache of compiled TS files
$docker_command "cd $UNIT_TEST_BUILD_DIR; TS_BUILD_CACHE_FILE=$TS_BUILD_CACHE_FILE ./bamboo/extract-ts-build-cache.sh"
$docker_command "cd $UNIT_TEST_BUILD_DIR; npm install --error --no-progress; npm run ci:bootstrap-no-scripts-quiet"
$docker_command "cd $UNIT_TEST_BUILD_DIR; npm run install-python-deps"

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

docker ps -a

sftp_container_name="${container_id}-sftp-1"
sftp_container_id=$(docker ps -aqf name=$sftp_container_name)

# $docker_command "ls -l $UNIT_TEST_BUILD_DIR/packages/test-data/keys || true"
# $docker_command "ls -l /keys || true"

# # Ensure the SFTP container has the matching public key in its authorized_keys
# if [ -n "${sftp_container_id}" ]; then
#   if [ -f "$UNIT_TEST_BUILD_DIR/packages/test-data/keys/ssh_client_rsa_key.pub" ]; then
#     echo "Copying public key into sftp container ${sftp_container_id}"
#     docker cp "$UNIT_TEST_BUILD_DIR/packages/test-data/keys/ssh_client_rsa_key.pub" "${sftp_container_id}:/tmp/ssh_client_rsa_key.pub" || true
#     docker exec "${sftp_container_id}" bash -lc "mkdir -p /home/user/.ssh && chmod 700 /home/user/.ssh && cat /tmp/ssh_client_rsa_key.pub >> /home/user/.ssh/authorized_keys && chmod 600 /home/user/.ssh/authorized_keys && chown -R user:user /home/user/.ssh" || true
#     docker exec "${sftp_container_id}" bash -lc "ls -la /home/user/.ssh || true; cat /home/user/.ssh/authorized_keys 2>/dev/null || true" || true
#   else
#     echo "Public key not found: $UNIT_TEST_BUILD_DIR/packages/test-data/keys/ssh_client_rsa_key.pub"
#   fi
# fi

$docker_command "mkdir /keys; cp $UNIT_TEST_BUILD_DIR/packages/test-data/keys/ssh_client_rsa_key /keys/; chmod -R 400 /keys; ls -l /keys"
# $docker_command "ls -l /keys || true"

# Wait for the SFTP server to be available
SFTP_MAX_RETRIES=${SFTP_MAX_RETRIES:-12}
SFTP_RETRY_SLEEP=${SFTP_RETRY_SLEEP:-10}
sftp_attempt=0
while true; do
  sftp_attempt=$((sftp_attempt+1))
  if $docker_command "sftp -P 2222 -i /keys/ssh_client_rsa_key -o 'ConnectTimeout=5' -o 'StrictHostKeyChecking=no' -o 'UserKnownHostsFile=/dev/null' -o 'PreferredAuthentications=publickey' user@127.0.0.1:/keys/ssh_client_rsa_key.pub /dev/null"; then
    echo 'SFTP service is available'
    break
  fi
  # echo "SFTP attempt ${sftp_attempt}/${SFTP_MAX_RETRIES} failed"
  echo "SFTP attempt ${sftp_attempt}/${SFTP_MAX_RETRIES} failed — collecting diagnostics"
  docker logs --tail 300 ${sftp_container_id} || true
  echo 'Verbose SFTP client output from build_env:'
  $docker_command "sftp -vvv -P 2222 -i /keys/ssh_client_rsa_key -o 'StrictHostKeyChecking=no' -o 'UserKnownHostsFile=/dev/null' user@127.0.0.1:/keys/ssh_client_rsa_key.pub 2>&1 || true" || true
  docker ps -a
  if [ "$sftp_attempt" -ge "$SFTP_MAX_RETRIES" ]; then
    echo "SFTP failed after ${sftp_attempt} attempts — aborting"
    echo "SFTP FAILED SFTP FAILED"
    break
  fi
  sleep ${SFTP_RETRY_SLEEP}
done

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
$docker_command "curl -XPUT 'http://127.0.0.1:9200/_cluster/settings' -d \@/$UNIT_TEST_BUILD_DIR/bamboo/elasticsearch.config"

# Lambda seems to be the last service that's started up by Localstack
while ! $docker_command 'nc -z 127.0.0.1 4566'; do
  echo 'Waiting for Localstack Lambda service to start'
  docker ps -a
  sleep 2
done
echo 'Localstack Lambda service is started'
