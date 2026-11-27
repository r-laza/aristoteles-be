BEGIN;

CREATE TYPE "AdminLevel" AS ENUM ('MAIN', 'REGULAR');
ALTER TABLE "User" ADD COLUMN "adminLevel" "AdminLevel" NOT NULL DEFAULT 'REGULAR';
UPDATE "User" SET "adminLevel" = 'MAIN' WHERE "role" = 'ADMIN' AND "isActive" = true;
ALTER TABLE "User" ADD CONSTRAINT "User_admin_level_role_check"
  CHECK ("role" = 'ADMIN' OR "adminLevel" = 'REGULAR');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User")
     AND NOT EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ADMIN' AND "isActive" AND "adminLevel" = 'MAIN') THEN
    RAISE EXCEPTION 'An active administrator is required before migrating administrator levels';
  END IF;
END;
$$;

CREATE FUNCTION protect_active_main_administrator() RETURNS trigger AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND OLD."role" = 'ADMIN')
     OR (TG_OP <> 'DELETE' AND NEW."role" = 'ADMIN') THEN
    PERFORM pg_advisory_xact_lock(849217001);
    IF NOT EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ADMIN' AND "isActive" AND "adminLevel" = 'MAIN') THEN
      RAISE EXCEPTION 'At least one active Main Administrator is required'
        USING ERRCODE = '23514', CONSTRAINT = 'User_active_main_administrator';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "User_active_main_administrator"
AFTER INSERT OR UPDATE OR DELETE ON "User"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION protect_active_main_administrator();

COMMIT;
