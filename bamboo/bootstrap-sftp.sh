#!/bin/sh
set -e
echo 'user:password' | chpasswd

sed -i 's/Port 22/Port 2222/g' /etc/ssh/sshd_config
chmod 600 /etc/authorized_keys/user
/usr/sbin/sshd -D -f /etc/ssh/sshd_config
