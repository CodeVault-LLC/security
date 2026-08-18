-- Narrow capability boundary for the process that decodes hostile media.
-- Deployment grants the runtime login membership in codevault_media_runtime;
-- that login receives no direct table privileges.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'codevault_media_function_owner') THEN
    CREATE ROLE codevault_media_function_owner NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'codevault_media_runtime') THEN
    CREATE ROLE codevault_media_runtime NOLOGIN NOINHERIT;
  END IF;
END
$roles$;

GRANT USAGE ON SCHEMA public TO codevault_media_function_owner;
GRANT USAGE ON SCHEMA public TO codevault_media_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM codevault_media_runtime;
GRANT SELECT, UPDATE ON public.media_jobs, public.avatar_images
  TO codevault_media_function_owner;
GRANT INSERT ON public.audit_events TO codevault_media_function_owner;

DROP FUNCTION IF EXISTS public.claim_media_job(text, text);

CREATE OR REPLACE FUNCTION public.claim_media_job(
  p_worker_id text,
  p_lease_token text
) RETURNS TABLE (
  job_id uuid,
  target_id uuid,
  input_object_key text,
  attempt_count integer,
  observed_size_bytes bigint,
  observed_sha256 text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH candidate AS (
    SELECT job.id
    FROM public.media_jobs AS job
    WHERE job.purpose = 'AVATAR_SANITIZE'
      AND job.attempt_count < 3
      AND job.available_at <= clock_timestamp()
      AND (
        job.state = 'QUEUED'
        OR (job.state = 'RUNNING' AND job.lease_expires_at < clock_timestamp())
      )
      AND length(p_worker_id) BETWEEN 1 AND 100
      AND length(p_lease_token) BETWEEN 32 AND 200
    ORDER BY job.available_at, job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.media_jobs AS job
    SET state = 'RUNNING',
        attempt_count = job.attempt_count + 1,
        lease_owner = p_worker_id,
        lease_token = p_lease_token,
        lease_expires_at = clock_timestamp() + interval '30 seconds',
        updated_at = clock_timestamp()
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.id, job.target_id, job.input_object_key, job.attempt_count
  )
  UPDATE public.avatar_images AS avatar
  SET status = 'PROCESSING', updated_at = clock_timestamp()
  FROM claimed
  WHERE avatar.id = claimed.target_id AND avatar.status = 'QUARANTINED'
  RETURNING claimed.id, claimed.target_id, claimed.input_object_key,
            claimed.attempt_count, avatar.observed_size_bytes,
            avatar.observed_sha256;
$function$;

CREATE OR REPLACE FUNCTION public.complete_media_job(
  p_job_id uuid,
  p_lease_token text,
  p_output_object_key text,
  p_output_sha256 text,
  p_width integer,
  p_height integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  claimed public.media_jobs%ROWTYPE;
  avatar public.avatar_images%ROWTYPE;
BEGIN
  IF p_output_object_key !~ '^derivatives/avatars/[0-9a-f-]{36}\.webp$'
     OR p_output_sha256 !~ '^[0-9a-f]{64}$'
     OR p_width NOT BETWEEN 1 AND 512
     OR p_height NOT BETWEEN 1 AND 512
     OR length(p_lease_token) NOT BETWEEN 32 AND 200 THEN
    RETURN false;
  END IF;

  SELECT * INTO claimed FROM public.media_jobs AS job
  WHERE job.id = p_job_id
    AND job.state = 'RUNNING'
    AND job.lease_token = p_lease_token
    AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO avatar FROM public.avatar_images AS image
  WHERE image.id = claimed.target_id AND image.status = 'PROCESSING'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  -- A compromised decoder may choose bytes, but it must not redirect one
  -- tenant-visible database row to another avatar's object.
  IF p_output_object_key <> 'derivatives/avatars/' || avatar.id::text || '.webp' THEN
    RETURN false;
  END IF;

  UPDATE public.avatar_images AS current_avatar
  SET status = 'SUPERSEDED', updated_at = clock_timestamp()
  WHERE current_avatar.status = 'READY'
    AND current_avatar.id <> avatar.id
    AND (
      (avatar.target = 'USER' AND current_avatar.target_user_id = avatar.target_user_id)
      OR (avatar.target = 'ORGANIZATION'
          AND current_avatar.target_organization_id = avatar.target_organization_id)
    );

  UPDATE public.avatar_images
  SET status = 'READY', sanitized_object_key = p_output_object_key,
      sanitized_sha256 = p_output_sha256, width = p_width, height = p_height,
      ready_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE id = avatar.id AND status = 'PROCESSING';

  UPDATE public.media_jobs
  SET state = 'SUCCEEDED', output_object_key = p_output_object_key,
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE id = claimed.id;

  INSERT INTO public.audit_events (
    id, organization_id, action, entity_type, entity_id, actor_id,
    before, after
  ) VALUES (
    gen_random_uuid(), avatar.organization_id, 'avatar.published', 'avatar',
    avatar.id::text, avatar.requested_by,
    jsonb_build_object('status', 'PROCESSING'),
    jsonb_build_object('status', 'READY')
  );
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.fail_media_job(
  p_job_id uuid,
  p_lease_token text,
  p_failure_code text,
  p_retryable boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  claimed public.media_jobs%ROWTYPE;
BEGIN
  IF p_failure_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
     OR length(p_lease_token) NOT BETWEEN 32 AND 200 THEN
    RETURN false;
  END IF;
  SELECT * INTO claimed FROM public.media_jobs AS job
  WHERE job.id = p_job_id AND job.state = 'RUNNING'
    AND job.lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.media_jobs
  SET state = CASE WHEN p_retryable AND attempt_count < 3 THEN 'QUEUED' ELSE 'FAILED' END,
      failure_code = p_failure_code,
      available_at = CASE WHEN p_retryable THEN clock_timestamp() + interval '10 seconds'
                          ELSE available_at END,
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE id = claimed.id;

  IF NOT p_retryable OR claimed.attempt_count >= 3 THEN
    UPDATE public.avatar_images
    SET status = 'REJECTED', rejection_code = p_failure_code,
        updated_at = clock_timestamp()
    WHERE id = claimed.target_id AND status = 'PROCESSING';
  ELSE
    UPDATE public.avatar_images
    SET status = 'QUARANTINED', updated_at = clock_timestamp()
    WHERE id = claimed.target_id AND status = 'PROCESSING';
  END IF;
  RETURN true;
END
$function$;

ALTER FUNCTION public.claim_media_job(text, text)
  OWNER TO codevault_media_function_owner;
ALTER FUNCTION public.complete_media_job(uuid, text, text, text, integer, integer)
  OWNER TO codevault_media_function_owner;
ALTER FUNCTION public.fail_media_job(uuid, text, text, boolean)
  OWNER TO codevault_media_function_owner;

REVOKE ALL ON FUNCTION public.claim_media_job(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_media_job(uuid, text, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_media_job(uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_media_job(text, text) TO codevault_media_runtime;
GRANT EXECUTE ON FUNCTION public.complete_media_job(uuid, text, text, text, integer, integer)
  TO codevault_media_runtime;
GRANT EXECUTE ON FUNCTION public.fail_media_job(uuid, text, text, boolean)
  TO codevault_media_runtime;
