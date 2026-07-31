/**
 * Help-topic registry.
 *
 * `help <thing>` already answers "what can I do with this object" from the
 * affordance lists examine uses. This is the other half: "how does this SYSTEM
 * work" — a page a plugin owns and keeps beside its own code, so the guide can't
 * drift from the mechanics the way a hand-written doc does.
 *
 * A topic is `{ name, summary, build() }`. `build` returns the body text and is
 * called at request time, so a topic can derive its content from the live
 * catalogs (how many recipes exist, what doneness levels a food offers) instead
 * of restating them.
 */
const topics = new Map();

export function registerHelpTopic({ name, summary, build, aliases = [] }) {
  if (!name || typeof build !== 'function') throw new Error('registerHelpTopic requires { name, build }');
  const topic = { name: name.toLowerCase(), summary: summary || '', build };
  topics.set(topic.name, topic);
  for (const a of aliases) topics.set(String(a).toLowerCase(), topic);
}

// Exact name or alias only — never fuzzy. `help cooking oil` must reach the
// ITEM, not the cooking topic, so topic lookup has to be unambiguous.
export function getHelpTopic(name) {
  return topics.get(String(name || '').toLowerCase().trim()) || null;
}

// Distinct topics (aliases collapse), for the "see also" line on `help`.
export function listHelpTopics() {
  return [...new Set(topics.values())].sort((a, b) => a.name.localeCompare(b.name));
}
