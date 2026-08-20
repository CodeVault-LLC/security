\set ON_ERROR_STOP on

SELECT format(
  'CREATE ROLE codevault_migrator LOGIN PASSWORD %L CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION',
  :'migrator_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'codevault_migrator')
\gexec

ALTER ROLE codevault_migrator LOGIN PASSWORD :'migrator_password'
  CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION;

SELECT format(
  'CREATE ROLE codevault_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'codevault_app')
\gexec

ALTER ROLE codevault_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

SELECT format(
  'CREATE ROLE codevault_media_login LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  :'media_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'codevault_media_login')
\gexec

ALTER ROLE codevault_media_login LOGIN PASSWORD :'media_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

SELECT 'CREATE ROLE codevault_media_function_owner NOLOGIN NOINHERIT'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'codevault_media_function_owner'
)
\gexec

SELECT 'CREATE ROLE codevault_media_runtime NOLOGIN NOINHERIT'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'codevault_media_runtime'
)
\gexec

-- PostgreSQL requires membership in a target owner role before ALTER ... OWNER.
-- The migrator is short-lived and needs ADMIN so the migration can grant the
-- runtime capability role without using the database administrator identity.
GRANT codevault_media_function_owner TO codevault_migrator WITH ADMIN OPTION;
GRANT codevault_media_runtime TO codevault_migrator WITH ADMIN OPTION;

ALTER DATABASE codevault OWNER TO codevault_migrator;
ALTER SCHEMA public OWNER TO codevault_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON DATABASE codevault FROM PUBLIC;
GRANT CONNECT ON DATABASE codevault TO codevault_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO codevault_media_function_owner;
