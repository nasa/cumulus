#!/bin/sh

set -evx

echo 'user:password' | chpasswd

/usr/sbin/sshd -D -f /etc/ssh/sshd_config
