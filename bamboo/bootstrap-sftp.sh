#!/bin/bash
echo 'bootstrap-sftp.sh start'

set -e
echo 'user:password' | chpasswd

sed -i 's/^Port .*/Port 2222/' /etc/ssh/sshd_config

echo 'cp /ssh_client_rsa_key.pub /etc/authorized_keys/user'
cp /ssh_client_rsa_key.pub /etc/authorized_keys/user

echo 'chmod 600 /etc/authorized_keys/user'
chmod 600 /etc/authorized_keys/user

echo 'chown user:user /etc/authorized_keys/user'
chown user:user /etc/authorized_keys/user

if [[ $CI = true ]]; then
  echo 'if [[ $CI = true ]]; then'
  rm -Rf /data/*
  cp -Rp /data_volume/* /data/ || true
fi
echo 'chgrp user /data/granules'
chgrp user /data/granules

echo 'chmod 775 /data/granules'
chmod 775 /data/granules

echo '/usr/sbin/sshd -D -f /etc/ssh/sshd_config'
/usr/sbin/sshd -D -f /etc/ssh/sshd_config
echo 'bootstrap-sftp.sh end'
