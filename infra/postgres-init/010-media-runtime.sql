-- Development-only credentials. Production provisions its media login through
-- the deployment secret manager and grants the same NOLOGIN capability role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'codevault_media_runtime') THEN
    CREATE ROLE codevault_media_runtime NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'codevault_media_login') THEN
    CREATE ROLE codevault_media_login LOGIN INHERIT
      PASSWORD 'codevault_media_dev_password';
  END IF;
END
$$;

GRANT codevault_media_runtime TO codevault_media_login;
