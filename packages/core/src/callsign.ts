/**
 * Callsign generator — Docker/Heroku-style human-readable session names.
 *
 * Produces `adjective-noun` pairs ("coral-heron", "molten-fox", "quiet-lynx")
 * for tagging agent runs. Every Relay session gets one when it starts so
 * the agent can announce itself to the operator and deposits carry a
 * memorable audit marker across time.
 *
 * Pool size: 64 × 64 = 4,096 combinations. More than enough for any single
 * project's session history; collisions are tolerated (callsigns are
 * memorability aids, not unique keys — session.id is the real PK).
 */

const ADJECTIVES = [
  'amber', 'arctic', 'brisk', 'bronze', 'cobalt', 'coral', 'crystal', 'deep',
  'driftwood', 'electric', 'ember', 'feral', 'fractal', 'gilded', 'glass', 'golden',
  'hollow', 'hushed', 'inkblot', 'iron', 'jade', 'jasper', 'keen', 'kinetic',
  'liquid', 'luminous', 'meridian', 'midnight', 'molten', 'neon', 'nimble', 'nocturne',
  'obsidian', 'opal', 'opaline', 'pearl', 'plasma', 'prism', 'quartz', 'quicksilver',
  'quiet', 'radiant', 'ripple', 'ruby', 'scarlet', 'silver', 'stellar', 'thunder',
  'tidal', 'twilight', 'umber', 'ultra', 'velvet', 'vivid', 'wandering', 'woven',
  'xenon', 'yielding', 'zephyr', 'azure', 'boreal', 'crimson', 'dusky', 'ethereal',
];

const NOUNS = [
  'albatross', 'aurora', 'badger', 'beacon', 'blossom', 'canyon', 'cedar', 'comet',
  'compass', 'crane', 'dawn', 'drift', 'dune', 'ember', 'falcon', 'fern',
  'fjord', 'forest', 'fox', 'gale', 'glacier', 'granite', 'harbor', 'haven',
  'heron', 'ibis', 'iris', 'jackal', 'jasper', 'juniper', 'kelp', 'kestrel',
  'koi', 'lantern', 'lyre', 'marsh', 'mesa', 'mist', 'moth', 'nebula',
  'nest', 'nova', 'oak', 'orb', 'pine', 'pulse', 'quasar', 'raven',
  'ridge', 'river', 'siren', 'spire', 'thorn', 'tide', 'totem', 'umbra',
  'vale', 'vortex', 'willow', 'wolf', 'yew', 'zephyr', 'grove', 'harrier',
];

/**
 * Generate a random callsign. Non-deterministic by design — each call
 * produces a fresh pairing.
 */
export function generateCallsign(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
}

/**
 * Validate a callsign string — must match `adjective-noun` shape using
 * lowercase words. Useful for rejecting bad inputs if a caller tries to
 * override the auto-generated name with something malformed.
 */
export function isValidCallsign(s: string): boolean {
  return /^[a-z]+-[a-z]+$/.test(s) && s.length >= 5 && s.length <= 32;
}
