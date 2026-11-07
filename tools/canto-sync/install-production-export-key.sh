#!/bin/sh
set -eu
umask 077
mkdir -p /root/.ssh
touch /root/.ssh/authorized_keys
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys
KEY='restrict,command="cd / && exec /usr/bin/sudo -u postgres /usr/bin/env PGOPTIONS='"'"'-c default_transaction_read_only=on -c statement_timeout=1800000'"'"' /usr/bin/pg_dump --dbname=scott_international_backend_production --format=custom --schema=public --no-owner --no-privileges --lock-wait-timeout=10000" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFdX7d2xRiYdYR0eSCkvqzH3sWKGeakWqTWKF96Ym9bB canto-readonly-snapshot-sync'
if ! grep -qF AAAAC3NzaC1lZDI1NTE5AAAAIFdX7d2xRiYdYR0eSCkvqzH3sWKGeakWqTWKF96Ym9bB /root/.ssh/authorized_keys; then
  printf "\n%s\n" "$KEY" >> /root/.ssh/authorized_keys
fi
