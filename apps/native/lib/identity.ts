// Deterministic friendly identity for anonymous visitors, ported from the
// revklik web app (apps/web/src/components/analytics/identity.ts): the
// visitor UUID is hashed into a stable pseudonym that doubles as the
// DiceBear seed, so avatar + name stay consistent everywhere.

const NAMES_FIRST = [
  "bronze",
  "amethyst",
  "scarlet",
  "emerald",
  "cobalt",
  "amber",
  "ivory",
  "crimson",
  "golden",
  "silver",
  "midnight",
  "ruby",
  "coral",
  "indigo",
  "jade",
  "onyx",
  "pearl",
  "copper",
  "azure",
  "maple",
  "cedar",
  "frost",
  "storm",
  "lunar",
  "solar",
  "ember",
  "quartz",
  "velvet",
  "canyon",
  "harbor",
];

const NAMES_LAST = [
  "ptarmigan",
  "reindeer",
  "vicuna",
  "quokka",
  "heron",
  "lynx",
  "otter",
  "falcon",
  "badger",
  "ibex",
  "puffin",
  "marmot",
  "gecko",
  "narwhal",
  "tapir",
  "lemur",
  "okapi",
  "axolotl",
  "pangolin",
  "kinkajou",
  "capybara",
  "jerboa",
  "kudu",
  "solandon",
  "saola",
];

export const nameFromVisitorId = (id: string): string => {
  let h = 5381;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 33 + (id.codePointAt(i) ?? 0)) % 2_147_483_647;
  }
  const first = NAMES_FIRST[h % NAMES_FIRST.length] ?? "";
  const last =
    NAMES_LAST[Math.floor(h / NAMES_FIRST.length) % NAMES_LAST.length] ?? "";
  return `${first} ${last}`;
};

export const avatarUrl = (name: string): string =>
  `https://api.dicebear.com/9.x/big-smile/svg?seed=${encodeURIComponent(name)}`;
