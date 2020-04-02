#!/bin/bash
set -e
echo 'user:password' | chpasswd
sed -i 's/^Port .*/Port 2222/' /etc/ssh/sshd_config
chmod 600 /etc/authorized_keys/user
if [[ $CI = true ]]; then
  rm -Rf /data/*
  cp -Rp /data_volume/* /data/ || true
fi
/usr/sbin/sshd -D -f /etc/ssh/sshd_config
