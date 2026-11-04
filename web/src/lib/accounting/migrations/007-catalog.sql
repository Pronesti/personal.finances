CREATE TABLE catalog_commands (key text PRIMARY KEY,digest text NOT NULL,result jsonb NOT NULL);
CREATE TABLE account_name_revisions (id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts(id),custom_name text CHECK(custom_name IS NULL OR length(trim(custom_name))>0),recorded_at timestamptz NOT NULL);
CREATE TABLE account_groups (id text PRIMARY KEY);
CREATE TABLE account_group_revisions (id text PRIMARY KEY,group_id text NOT NULL REFERENCES account_groups(id),payload jsonb NOT NULL,recorded_at timestamptz NOT NULL,ordinal bigserial UNIQUE);
CREATE TRIGGER catalog_command_immutable BEFORE UPDATE OR DELETE ON catalog_commands FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER account_name_immutable BEFORE UPDATE OR DELETE ON account_name_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER group_revision_immutable BEFORE UPDATE OR DELETE ON account_group_revisions FOR EACH ROW EXECUTE FUNCTION immutable_row();
INSERT INTO schema_migrations(version) VALUES(7);
