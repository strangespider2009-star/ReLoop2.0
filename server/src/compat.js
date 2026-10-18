// Compatibility evidence for hardware listings.
// Rules are deliberately conservative: "Likely" requires the listing text to
// contain the model's specific identifier(s) (e.g. 9310), not just the family name.

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function tokenRegex(token) {
  const parts = token.toLowerCase().split(/[-_/\s]+/).filter(Boolean).map(escapeRegExp);
  return new RegExp(`(?<![a-z0-9])${parts.join("[\\s\\-_/]?")}(?![a-z0-9])`, "i");
}

export function modelProfile(model) {
  const tokens = String(model || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  const compact = (t) => t.replace(/[^a-z0-9]/g, "");
  const identifiers = tokens.filter((t) => /\d/.test(t) && compact(t).length >= 3);
  const others = tokens.filter((t) => !identifiers.includes(t) && compact(t).length >= 2);
  return { identifiers, others };
}

const NEGATIVE = /(?:not|in)\s?compatible|(?:does\s?n['’]?t|do\s?n['’]?t|won['’]?t|will\s?not|not)\s(?:fit|work|support)|not suitable/gi;

function mentionsIncompatibility(text, identifiers) {
  if (!identifiers.length) return false;
  for (const m of text.matchAll(NEGATIVE)) {
    const window = text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80);
    if (identifiers.some((id) => tokenRegex(id).test(window))) return true;
  }
  return false;
}

/** True when the text contains every specific identifier of the model (e.g. "9310"). */
export function mentionsModel(text, model) {
  const { identifiers } = modelProfile(model);
  return identifiers.length > 0 && identifiers.every((id) => tokenRegex(id).test(text));
}

export function assessCompatibility(text, input) {
  const { identifiers, others } = modelProfile(input.model);
  const hasId = (t) => tokenRegex(t).test(text);
  const matchedIds = identifiers.filter(hasId);
  const matchedOthers = others.filter(hasId);

  if (mentionsIncompatibility(text, identifiers)) {
    return { compatibility: "Mismatch", compatibilityEvidence: "The listing text says a part is not compatible near your model number. Do not buy without confirming." };
  }
  if (!identifiers.length) {
    const found = matchedOthers.length ? ` (found: ${matchedOthers.join(", ")})` : "";
    return { compatibility: "Unverified", compatibilityEvidence: `Your model has no specific model number${found}, so exact compatibility can't be confirmed. Add the full model/product number for stricter matching.` };
  }
  const othersOk = !others.length || matchedOthers.length >= Math.ceil(others.length / 2);
  if (matchedIds.length === identifiers.length && othersOk) {
    return { compatibility: "Likely", compatibilityEvidence: `Listing text names your model (${[...matchedIds, ...matchedOthers].join(", ")}). Still verify the exact OEM/FRU part number before buying.` };
  }
  if (matchedIds.length || matchedOthers.length) {
    return { compatibility: "Unverified", compatibilityEvidence: `Only part of your model was found (${[...matchedIds, ...matchedOthers].join(", ")}); the model number ${identifiers.join(", ")} was not fully matched.` };
  }
  return { compatibility: "Unverified", compatibilityEvidence: "Your model number was not found in this listing. Confirm with the seller or manufacturer." };
}

// ---- Spec-level checks (RAM generation, SSD length, interface) ----

export function extractSpecHints(text) {
  const t = String(text || "").toLowerCase();
  const gens = [];
  if (/\b(?:lp)?ddr5x?\b/.test(t)) gens.push("DDR5");
  if (/\b(?:lp)?ddr4x?\b/.test(t)) gens.push("DDR4");
  if (/\b(?:lp)?ddr3l?\b/.test(t)) gens.push("DDR3");
  const ssdLengths = [...new Set(t.match(/\b(?:2230|2242|2260|2280)\b/g) || [])];
  const ramSoldered = /soldered|on-?board (?:ram|memory)|memory is (?:soldered|integrated)|non-?upgrad(?:e)?able|not (?:user[- ])?upgrad(?:e)?able|\blpddr/.test(t);
  return { ramGens: gens, ssdLengths, ramSoldered, nvme: /nvme|pcie/.test(t), sata: /\bsata\b/.test(t) };
}

/** Merge hints from several pages about the same model; ambiguous values are dropped. */
export function mergeSpecHints(list) {
  if (!list.length) return null;
  const uniq = (key) => [...new Set(list.flatMap((h) => h[key]))];
  const gens = uniq("ramGens");
  const lengths = uniq("ssdLengths");
  return {
    ramGen: gens.length === 1 ? gens[0] : null,
    ssdLength: lengths.length === 1 ? lengths[0] : null,
    ramSoldered: list.some((h) => h.ramSoldered),
    nvmeOnly: list.some((h) => h.nvme) && !list.some((h) => h.sata)
  };
}

const isRam = (c) => /\bram\b|memory/i.test(c);
const isStorage = (c) => /ssd|storage|drive/i.test(c);

/** Downgrade/flag an assessed listing if it contradicts the model's known specs. */
export function applySpecCheck(assessed, listingText, component, specs) {
  if (!specs || assessed.compatibility === "Mismatch") return assessed;
  const hints = extractSpecHints(listingText);
  const fail = (reason) => ({ compatibility: "Mismatch", compatibilityEvidence: `Spec check: ${reason}` });

  if (isRam(component)) {
    if (specs.ramGen && hints.ramGens.length === 1 && hints.ramGens[0] !== specs.ramGen) {
      return fail(`listing is ${hints.ramGens[0]}, but your model uses ${specs.ramGen}.`);
    }
  }
  if (isStorage(component)) {
    if (specs.ssdLength && hints.ssdLengths.length === 1 && hints.ssdLengths[0] !== specs.ssdLength) {
      return fail(`listing is M.2 ${hints.ssdLengths[0]}, but your model uses M.2 ${specs.ssdLength}.`);
    }
    if (specs.nvmeOnly && hints.sata && !hints.nvme && assessed.compatibility === "Likely") {
      return { compatibility: "Unverified", compatibilityEvidence: `${assessed.compatibilityEvidence} Spec check: listing looks SATA-only while your model's slot appears to be NVMe.` };
    }
  }
  return assessed;
}
