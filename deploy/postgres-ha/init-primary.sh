#!/bin/bash
# Runs once at primary initdb: a replication role, the security database, and pg_hba entries that
# let the replica stream. Local test wiring only (scram password 'replicator') - not production.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" <<-EOSQL
  CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'replicator';
  CREATE DATABASE security;
EOSQL
{
  echo "host replication replicator all scram-sha-256"
  echo "host all all all scram-sha-256"
} >> "$PGDATA/pg_hba.conf"
