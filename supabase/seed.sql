-- ============================================================
-- RELAY CONTEXT CORE — Dev Seed Data
-- ============================================================

-- Insert a default project for development
insert into projects (id, name, description, owner_id)
values (
  'proj_dev_neuraldistortion',
  'NeuralDistortion',
  'Neural audio effects VST3 plugin — production pipeline',
  'jordan'
);

insert into projects (id, name, description, owner_id)
values (
  'proj_dev_latentsampler',
  'LatentSampler',
  'Neural audio sampler — Stable Audio latent space FX',
  'jordan'
);

insert into projects (id, name, description, owner_id)
values (
  'proj_dev_relay',
  'Relay',
  'Continuous context flow for human-agent teams — the system itself',
  'jordan'
);
