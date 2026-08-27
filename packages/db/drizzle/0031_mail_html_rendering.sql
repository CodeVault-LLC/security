ALTER TABLE organization_security_policies
  ADD COLUMN mail_html_rendering_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE users
  ADD COLUMN automatic_html_mail boolean NOT NULL DEFAULT true;
