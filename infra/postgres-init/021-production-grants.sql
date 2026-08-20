\set ON_ERROR_STOP on

GRANT CONNECT, CREATE ON DATABASE codevault TO codevault_app;
GRANT USAGE, CREATE ON SCHEMA public TO codevault_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO codevault_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO codevault_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO codevault_app;

ALTER DEFAULT PRIVILEGES FOR ROLE codevault_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO codevault_app;
ALTER DEFAULT PRIVILEGES FOR ROLE codevault_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO codevault_app;
ALTER DEFAULT PRIVILEGES FOR ROLE codevault_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO codevault_app;

GRANT codevault_media_runtime TO codevault_media_login;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM codevault_media_login;
REVOKE CREATE ON SCHEMA public FROM codevault_media_function_owner;
