ALTER TABLE case_members
  ADD COLUMN can_write boolean NOT NULL DEFAULT false,
  ADD COLUMN can_approve boolean NOT NULL DEFAULT false,
  ADD COLUMN can_disclose boolean NOT NULL DEFAULT false;

UPDATE case_members
SET
  can_write = access = 'WRITE',
  can_approve = access = 'WRITE',
  can_disclose = access = 'WRITE';

ALTER TABLE case_members
  DROP CONSTRAINT case_members_access_check,
  DROP COLUMN access;
