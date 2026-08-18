-- Serialize the deferred final-administrator invariant with a transaction
-- advisory lock. A row lock is unsafe here: membership foreign-key checks can
-- give concurrent transactions compatible locks on the organization row and
-- then deadlock when both deferred triggers try to upgrade to FOR UPDATE.
CREATE OR REPLACE FUNCTION assert_single_active_organization_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- CodeVault deliberately supports one organization. This reserved lock key
  -- serializes its authority invariant without sharing a lock domain with any
  -- table or foreign-key operation. The following statement receives a fresh
  -- READ COMMITTED snapshot after a waiter acquires the lock.
  PERFORM pg_advisory_xact_lock(1129270868, 1);

  IF EXISTS (
    SELECT 1
    FROM public.organizations AS organization
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.organization_memberships AS membership
      JOIN public.users AS account ON account.id = membership.user_id
      WHERE membership.organization_id = organization.id
        AND membership.role = 'ADMIN'
        AND account.disabled = false
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'organization must retain an active administrator',
      CONSTRAINT = 'organization_requires_active_admin';
  END IF;

  RETURN NULL;
END
$$;
