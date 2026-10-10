import type { Guidance, OutdoorContext } from '../context/types';
import type { SafetyCategory, SafetyRequest } from './types';

/**
 * Deterministic safety rules. Three kinds, so this is more than one big blacklist:
 *
 *  - LexiconRule   : hazard vocabulary. `excusable` hazards may be MENTIONED when clearly avoided
 *                    ("stay away from the road"); non-excusable ones (climbing, trespass, "without
 *                    looking", injection artefacts, health claims) are never allowed.
 *  - ProximityRule : an unsafe VERB close to an animal noun ("feed the dog"), in either context.
 *  - PlanRule      : a constraint on the plan as a whole ("in poor conditions the plan must stay by shelter").
 *
 * Context-dependent rules (`when`) read the OutdoorContext and the request, so the same plan can be
 * acceptable in clear daylight and rejected in a storm or after dark. No numeric weather thresholds
 * are invented here: every condition comes from the guidance codes Checkpoint 3 already derives.
 *
 * Conservative on purpose: a false positive costs one deterministic fallback walk; a false negative
 * costs trust. This is basic application-level filtering, not a safety certification.
 */

export interface RuleScope {
  context: OutdoorContext;
  request: SafetyRequest;
}

export interface LexiconRule {
  kind: 'lexicon';
  id: string;
  category: SafetyCategory;
  /** Exact tokens (after normalisation). */
  tokens?: string[];
  /** Token prefixes. Only stems that cannot collide with ordinary words. */
  stems?: string[];
  /** Multi-word phrases. */
  phrases?: string[];
  excusable: boolean;
  /** Remove "put your phone away" style phrases before matching. */
  allowPhoneAway?: boolean;
  when?: (scope: RuleScope) => boolean;
}

export interface ProximityRule {
  kind: 'proximity';
  id: string;
  category: SafetyCategory;
  verbs: string[];
  nouns: string[];
  /** Max tokens between verb start and noun. */
  window: number;
  when?: (scope: RuleScope) => boolean;
}

export interface PlanRule {
  kind: 'plan';
  id: string;
  category: SafetyCategory;
  when?: (scope: RuleScope) => boolean;
  /** True when the plan BREAKS the constraint. Receives every normalised token of the plan. */
  violated: (tokens: readonly string[]) => boolean;
}

export type SafetyRule = LexiconRule | ProximityRule | PlanRule;

const has = (code: Guidance) => (s: RuleScope): boolean => s.context.guidance?.includes(code) ?? false;
const hasAny = (...codes: Guidance[]) => (s: RuleScope): boolean => codes.some((c) => has(c)(s));

// ---------------------------------------------------------------------------------------------
// Always-on rules: independent of weather, light or request.
// ---------------------------------------------------------------------------------------------

const ALWAYS: SafetyRule[] = [
  {
    kind: 'lexicon', id: 'traffic_mention', category: 'traffic', excusable: true,
    tokens: [
      'road', 'roads', 'roadside', 'roadway', 'traffic', 'car', 'cars', 'vehicle', 'vehicles', 'bus', 'buses',
      'truck', 'trucks', 'lorry', 'lorries', 'motorbike', 'motorbikes', 'scooter', 'scooters', 'cyclist', 'cyclists',
      'bicycle', 'bicycles', 'bike', 'bikes', 'rickshaw', 'rickshaws', 'tuktuk', 'junction', 'intersection', 'crossing',
      'crossings', 'crosswalk', 'zebra', 'kerb', 'curb', 'street', 'streets', 'lane', 'lanes', 'roundabout', 'driveway',
    ],
    stems: ['highway', 'motorway', 'freeway', 'expressway', 'carriageway'],
    phrases: ['traffic light', 'traffic lights', 'pedestrian crossing', 'car park'],
  },
  {
    kind: 'lexicon', id: 'restricted_mention', category: 'restricted_area', excusable: true,
    tokens: [
      'restricted', 'abandoned', 'derelict', 'construction', 'scaffolding', 'scaffold', 'tunnel', 'tunnels', 'quarry',
      'railway', 'railways', 'cliff', 'cliffs', 'ledge', 'ledges', 'rooftop', 'rooftops',
    ],
    stems: ['trespass'],
    phrases: ['train tracks', 'rail tracks', 'level crossing', 'on the tracks', 'building site', 'private property', 'private land', 'private garden', 'no entry', 'keep out', 'off limits', 'out of bounds'],
  },
  {
    kind: 'lexicon', id: 'restricted_breach', category: 'restricted_area', excusable: false,
    tokens: ['sneak', 'sneaking', 'barrier', 'barriers', 'fence', 'fences'],
    phrases: [
      'ignore the sign', 'ignore the signs', 'ignore signs', 'ignore the warning', 'ignore warnings', 'through the gap',
      'enter the building', 'enter the site', 'enter the area', 'enter the property', 'enter the garden', 'enter the tunnel',
      'cut through private',
    ],
  },
  {
    kind: 'lexicon', id: 'climbing', category: 'climbing', excusable: false,
    stems: ['climb', 'clamber', 'scrambl', 'abseil'],
    phrases: [
      'jump over', 'jump across', 'jump off', 'jump from', 'hop over', 'leap over', 'swing on', 'hang from', 'hang off',
      'balance on', 'stand on the wall', 'walk on the wall', 'walk along the wall', 'walk along the railing', 'over the wall',
      'over the gate', 'up the tree', 'up a tree', 'up the wall', 'on the roof', 'onto the roof', 'on the ledge', 'on the fence',
    ],
  },
  {
    kind: 'lexicon', id: 'animal_mention', category: 'animals', excusable: true,
    tokens: [
      'dog', 'dogs', 'puppy', 'puppies', 'stray', 'strays', 'cow', 'cows', 'cattle', 'bull', 'bulls', 'horse', 'horses',
      'monkey', 'monkeys', 'snake', 'snakes', 'boar', 'bear', 'bears', 'wolf', 'wolves', 'wildlife', 'animal', 'animals',
      'aggressive', 'bee', 'bees', 'wasp', 'wasps', 'hornet', 'hornets',
    ],
  },
  {
    kind: 'proximity', id: 'animal_interaction', category: 'animals', window: 3,
    verbs: ['approach', 'approaching', 'pet', 'petting', 'pat', 'stroke', 'stroking', 'feed', 'feeding', 'touch', 'touching', 'chase', 'chasing', 'tease', 'follow', 'following', 'corner', 'catch', 'hold', 'hug', 'greet', 'play'],
    nouns: ['dog', 'dogs', 'puppy', 'cat', 'cats', 'kitten', 'bird', 'birds', 'squirrel', 'squirrels', 'duck', 'ducks', 'animal', 'animals', 'wildlife', 'stray', 'strays', 'cow', 'cows', 'horse', 'horses', 'monkey', 'monkeys'],
  },
  {
    kind: 'lexicon', id: 'water_mention', category: 'water', excusable: true,
    tokens: [
      'river', 'rivers', 'riverbank', 'lake', 'lakes', 'canal', 'canals', 'pond', 'ponds', 'stream', 'streams', 'creek', 'sea',
      'seaside', 'ocean', 'beach', 'shore', 'waterfall', 'reservoir', 'dam', 'ditch', 'water', 'waters', 'waterside', 'waterfront',
    ],
    stems: ['swim', 'wade', 'wading', 'paddl'],
  },
  {
    kind: 'lexicon', id: 'ingestion_mention', category: 'ingestion', excusable: true,
    tokens: [
      'eat', 'eating', 'taste', 'tasting', 'drink', 'drinking', 'sip', 'berries', 'berry', 'mushroom', 'mushrooms', 'fungi',
      'fungus', 'snack', 'picnic', 'food',
    ],
    stems: ['forag'],
  },
  {
    kind: 'lexicon', id: 'fire_mention', category: 'fire', excusable: true,
    tokens: ['fire', 'campfire', 'bonfire', 'firework', 'fireworks', 'lighter', 'flame', 'flames'],
  },
  {
    kind: 'lexicon', id: 'stranger_mention', category: 'strangers', excusable: true,
    tokens: ['stranger', 'strangers', 'hitchhike', 'hitchhiking'],
  },
  {
    kind: 'lexicon', id: 'unsafe_behaviour', category: 'unsafe_behaviour', excusable: false,
    tokens: ['blindfold', 'blindfolded', 'blindly', 'dare', 'dares'],
    phrases: [
      'without looking', 'without checking', 'eyes closed', 'close your eyes', 'closing your eyes', 'shut your eyes',
      'walk backwards', 'walk backward', 'ignore traffic', 'ignore the traffic', 'run into',
    ],
  },
  {
    // PocketWalk's whole point is a short screen moment, then the phone goes away.
    kind: 'lexicon', id: 'device_use', category: 'device_use', excusable: true, allowPhoneAway: true,
    tokens: [
      'phone', 'phones', 'smartphone', 'mobile', 'screen', 'screens', 'app', 'apps', 'gps', 'navigation', 'navigate',
      'navigating', 'map', 'maps', 'scroll', 'scrolling', 'video', 'videos', 'photo', 'photos', 'selfie', 'selfies', 'camera',
      'livestream', 'headphones', 'earphones', 'earbuds', 'airpods', 'podcast', 'podcasts', 'texting', 'whatsapp', 'instagram',
      'tiktok', 'youtube', 'online', 'internet', 'wifi', 'smartwatch', 'timer', 'stopwatch', 'alarm', 'notification', 'notifications',
    ],
  },
  {
    // PocketWalk must never present itself, or a walk, as medical or guaranteed.
    kind: 'lexicon', id: 'health_or_safety_claim', category: 'claims', excusable: false,
    tokens: ['cure', 'cures', 'cured', 'diagnose', 'diagnosis', 'medication', 'medicine', 'prescription', 'therapy', 'clinically', 'medically', 'guaranteed', 'guarantee'],
    phrases: ['risk free', '100 safe', 'completely safe', 'totally safe', 'perfectly safe', 'safe for everyone'],
  },
  {
    // Model output that talks about its own instructions is never a walk. Never excusable.
    kind: 'lexicon', id: 'instruction_artifact', category: 'injection_artifact', excusable: false,
    tokens: ['disregard', 'jailbreak', 'override'],
    phrases: [
      'ignore all', 'ignore any', 'ignore previous', 'ignore prior', 'ignore the above', 'ignore your', 'ignore these', 'ignore earlier',
      'previous instructions', 'prior instructions', 'new instructions', 'system prompt', 'as an ai', 'language model', 'developer mode',
      'i cannot', 'i cant', 'you are now', 'reveal your',
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// Request-dependent: how hard the walk may be.
// ---------------------------------------------------------------------------------------------

const INTENSITY: SafetyRule[] = [
  {
    kind: 'lexicon', id: 'strenuous_any', category: 'intensity', excusable: false,
    tokens: ['running', 'race', 'racing', 'workout', 'intense', 'intensity', 'vigorous', 'cardio', 'interval', 'intervals', 'calories', 'pushups', 'squats', 'lunges'],
    stems: ['sprint', 'jog'],
    phrases: ['run to', 'run up', 'run down', 'run across', 'run through', 'run around', 'run along', 'run fast', 'run ahead'],
  },
  {
    kind: 'lexicon', id: 'strenuous_for_easy', category: 'intensity', excusable: false,
    when: (s) => s.request.energy === 'easy',
    tokens: ['hike', 'hiking', 'uphill', 'steep', 'stairs', 'staircase', 'hurry', 'hurried', 'fast', 'faster', 'rush', 'rushing', 'brisk', 'quickly'],
  },
];

// ---------------------------------------------------------------------------------------------
// Context-dependent: derived from the Checkpoint 3 guidance codes and the observed facts.
// ---------------------------------------------------------------------------------------------

const SHELTER = new Set(['shelter', 'sheltered', 'cover', 'covered', 'door', 'doorstep', 'doorway', 'porch', 'indoors', 'inside', 'awning', 'canopy']);

const SITTING = ['sit', 'sitting', 'seated', 'lie', 'lying', 'picnic'];
const REMOTE_TERRAIN = ['trail', 'trails', 'woods', 'forest', 'park', 'parks', 'field', 'fields', 'hill', 'hills', 'shortcut', 'alley', 'alleyway', 'wasteland', 'unlit', 'isolated', 'deserted', 'remote'];
const FAR_VIEW = ['view', 'views', 'scenery', 'horizon', 'skyline', 'distant', 'far', 'faraway'];

const CONTEXTUAL: SafetyRule[] = [
  // --- poor conditions (thunderstorm, freezing rain, heavy precipitation, very strong wind, extreme heat/cold)
  {
    kind: 'plan', id: 'poor_conditions_needs_shelter', category: 'weather', when: has('poor_conditions'),
    violated: (tokens) => !tokens.some((t) => SHELTER.has(t)),
  },
  {
    kind: 'lexicon', id: 'poor_conditions_exposure', category: 'weather', excusable: true, when: has('poor_conditions'),
    tokens: [...REMOTE_TERRAIN, 'tree', 'trees', 'branches', 'hike', 'hiking', 'open', 'exposed', 'far', 'distant', 'distance', 'further', 'farther', 'beyond', 'destination'],
  },
  // --- wet
  {
    kind: 'lexicon', id: 'wet_needs_dry_surface', category: 'weather', excusable: true, when: has('wet'),
    tokens: [...SITTING, 'lawn', 'blanket', 'bench', 'benches'],
  },
  // --- wind (very strong wind already triggers poor_conditions)
  {
    kind: 'lexicon', id: 'windy_exposure', category: 'weather', excusable: true, when: has('windy'),
    tokens: ['tree', 'trees', 'branch', 'branches', 'exposed', 'hilltop', 'hill', 'hills'],
    phrases: ['open ground', 'open space', 'open field'],
  },
  // --- heat
  {
    kind: 'lexicon', id: 'hot_sun_and_effort', category: 'weather', excusable: true, when: has('hot'),
    tokens: ['sun', 'sunny', 'sunlit', 'sunshine', 'sunbathe', 'bask', 'basking', 'midday', 'uphill', 'steep'],
  },
  // --- cold
  {
    kind: 'lexicon', id: 'cold_long_pauses', category: 'weather', excusable: true, when: has('cold'),
    tokens: [...SITTING, 'linger', 'lingering', 'wait', 'waiting', 'rest', 'resting'],
  },
  // --- darkness
  {
    kind: 'lexicon', id: 'dark_light_dependent', category: 'visibility', excusable: true, when: has('dark'),
    tokens: [
      'look', 'looking', 'watch', 'watching', 'spot', 'spotting', 'gaze', 'gazing', 'admire', 'observe', 'observing', 'scan',
      'sunset', 'sunrise', 'colour', 'colours', 'color', 'colors', 'shades', 'dark', 'darkness',
      ...FAR_VIEW, ...SITTING, ...REMOTE_TERRAIN,
    ],
  },
  // --- low or fading light, or fog
  {
    kind: 'lexicon', id: 'low_visibility_terrain', category: 'visibility', excusable: true, when: hasAny('low_visibility'),
    tokens: [...REMOTE_TERRAIN, 'dark', 'darkness'],
  },
  {
    kind: 'lexicon', id: 'fog_far_view', category: 'visibility', excusable: true, when: (s) => s.context.weather?.condition === 'fog',
    tokens: FAR_VIEW,
  },
];

export const DEFAULT_RULES: readonly SafetyRule[] = [...ALWAYS, ...INTENSITY, ...CONTEXTUAL];
