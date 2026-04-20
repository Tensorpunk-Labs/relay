-- ============================================================
-- RELAY CONTEXT CORE — Example Seed Data
-- ============================================================
--
-- These rows are illustrative. Replace with your own projects
-- via `relay projects create` or the API. The `owner_id` is
-- whatever actor_id you configured for your install.

insert into projects (id, name, description, owner_id)
values (
  'proj_example_api',
  'Example API',
  'Backend service — HTTP API and database layer',
  'your-actor-id'
);

insert into projects (id, name, description, owner_id)
values (
  'proj_example_web',
  'Example Web',
  'Frontend app — dashboard and user-facing surfaces',
  'your-actor-id'
);

insert into projects (id, name, description, owner_id)
values (
  'proj_dev_relay',
  'Relay',
  'Continuous context flow for human-agent teams — the system itself',
  'your-actor-id'
);
