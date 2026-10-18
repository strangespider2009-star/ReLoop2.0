import {
  tinyfishSearch, enrichListing, rankResults, scoreResult, symbolFor,
  safeHttpUrl, cleanText, parsePrice, extractPartNumber, currencyByCountry
} from "./tinyfish.js";
import { diagnose, normalizeProblem } from "./diagnose.js";
import {
  assessCompatibility, applySpecCheck, extractSpecHints, mergeSpecHints, mentionsModel, modelProfile
} from "./compat.js";

const AGENT_ENDPOINT = "https://agent.tinyfish.ai/v1/automation/run";

const OFFICIAL_HOSTS = ["dell.com", "hp.com", "lenovo.com", "asus.com", "acer.com", "apple.com", "microsoft.com", "samsung.com", "support.google.com", "mi.com", "oneplus.com", "vivo.com", "oppo.com", "sony.com", "playstation.com", "xbox.com", "nintendo.com"];
const COMMUNITY_HINT = /reddit\.|stackexchange\.|stackoverflow\.|askubuntu\.|superuser\.|tomshardware\.|community\.|forum|answers\.microsoft/i;
const SHOP_PATH = /\/(?:dp|product|products|buy|shop|cart|p)\//i;

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function guideKind(url) {
  const host = hostOf(url);
  if (OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return "Official support";
  if (COMMUNITY_HINT.test(url)) return "Community";
  return "Web guide";
}

function problemWords(problem) {
  return [...new Set(normalizeProblem(problem).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4))];
}

// ---------- Software: TinyFish Search (+ optional Agent step extraction) ----------

async function runAgent(url, goal) {
  const response = await fetch(AGENT_ENDPOINT, {
    method: "POST",
    headers: { "X-API-Key": process.env.TINYFISH_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ url, goal, browser_profile: "lite" }),
    signal: AbortSignal.timeout(75_000)
  });
  if (!response.ok) throw new Error(`TinyFish Agent returned HTTP ${response.status}`);
  const data = await response.json();
  const result = data.result ?? data.result_json ?? data.resultJson ?? {};
  if (typeof result === "string") { try { return JSON.parse(result); } catch { return null; } }
  return result && typeof result === "object" ? result : null;
}

async function extractGuideSteps(url, input, problem) {
  const goal = `Read this troubleshooting page for the problem below and extract the fix steps.
Device: ${input.brand} ${input.model}
Problem: ${problem}

Use only what is written on the page. Do not invent steps. Prefer steps that are software, settings, driver or firmware fixes.
Return a JSON object with keys: steps (array of up to 6 short strings), appliesToModel (true, false or null if unclear), summary (one short sentence). Do not log in, buy anything or submit forms.`;
  return runAgent(url, goal);
}

async function findSoftwareGuides(input, problem) {
  const short = problem.slice(0, 140);
  const queries = [
    `${input.brand} ${input.model} ${short} fix troubleshooting`,
    `how to fix ${short} ${input.deviceType.toLowerCase()} software settings driver`
  ];
  const settled = await Promise.allSettled(queries.map((q) => tinyfishSearch(q, input.country)));
  const fulfilled = settled.filter((s) => s.status === "fulfilled");
  if (!fulfilled.length) throw new Error(settled[0]?.reason?.message || "TinyFish software search failed");

  const words = problemWords(problem);
  const seen = new Set();
  const guides = [];
  for (const outcome of fulfilled) {
    const raw = Array.isArray(outcome.value.results) ? outcome.value.results : [];
    for (const entry of raw.slice(0, 10)) {
      const url = safeHttpUrl(entry.url || entry.link);
      if (!url || seen.has(url) || SHOP_PATH.test(url)) continue;
      seen.add(url);
      const title = cleanText(entry.title || entry.name || "Troubleshooting guide", 220);
      const snippet = cleanText(entry.snippet || entry.description || "", 600);
      const text = `${title} ${snippet} ${url}`;
      const kind = guideKind(url);
      const forModel = mentionsModel(text, input.model);
      const hits = words.filter((w) => text.toLowerCase().includes(w)).length;
      const score = (kind === "Official support" ? 30 : kind === "Community" ? 8 : 0) + (forModel ? 20 : 0) + Math.min(hits, 5) * 4;
      guides.push({
        kind: "guide", title, url, snippet,
        source: cleanText(entry.site_name || entry.domain || hostOf(url), 120),
        guideType: kind, forModel,
        tags: [kind, ...(forModel ? ["Mentions your model"] : [])],
        symbol: "⚙", _score: score
      });
    }
  }
  return guides.sort((a, b) => b._score - a._score).slice(0, 8).map(({ _score, ...g }) => g);
}

// ---------- Hardware: device spec profile + per-component listings ----------

async function lookupDeviceSpecs(input) {
  const data = await tinyfishSearch(`${input.brand} ${input.model} specifications RAM type SSD slot M.2 upgrade`, input.country);
  const raw = Array.isArray(data.results) ? data.results : [];
  const { identifiers } = modelProfile(input.model);
  const relevant = raw.slice(0, 8).filter((entry) => {
    const text = `${entry.title || ""} ${entry.snippet || entry.description || ""}`;
    return identifiers.length ? mentionsModel(text, input.model) : false;
  });
  const specs = mergeSpecHints(relevant.map((e) => extractSpecHints(`${e.title || ""} ${e.snippet || e.description || ""}`)));
  if (!specs || (!specs.ramGen && !specs.ssdLength && !specs.ramSoldered && !specs.nvmeOnly)) return null;
  return { ...specs, source: safeHttpUrl(relevant[0]?.url || relevant[0]?.link) };
}

// ---- Where parts are actually sold (used to prefer shops over forums/videos) ----
const RETAILERS = {
  IN: [{ host: "amazon.in", name: "Amazon" }, { host: "flipkart.com", name: "Flipkart" }, { host: "croma.com", name: "Croma" }, { host: "reliancedigital.in", name: "Reliance Digital" }],
  US: [{ host: "amazon.com", name: "Amazon" }, { host: "bestbuy.com", name: "Best Buy" }, { host: "newegg.com", name: "Newegg" }, { host: "ebay.com", name: "eBay" }],
  GB: [{ host: "amazon.co.uk", name: "Amazon" }, { host: "currys.co.uk", name: "Currys" }, { host: "scan.co.uk", name: "Scan" }, { host: "ebay.co.uk", name: "eBay" }],
  CA: [{ host: "amazon.ca", name: "Amazon" }, { host: "bestbuy.ca", name: "Best Buy" }, { host: "newegg.ca", name: "Newegg" }, { host: "canadacomputers.com", name: "Canada Computers" }]
};
const BRAND_STORES = { dell: "dell.com", hp: "hp.com", lenovo: "lenovo.com", asus: "asus.com", acer: "acer.com", apple: "apple.com", samsung: "samsung.com", msi: "msi.com", microsoft: "microsoft.com", xiaomi: "mi.com", sony: "sony.com", oneplus: "oneplus.com", vivo: "vivo.com", oppo: "oppo.com", realme: "realme.com", huawei: "huawei.com" };
// Forums, video, social and Q&A pages are never a place to buy a part.
const NOT_A_SHOP = /(?:reddit|youtube|youtu\.be|quora|facebook|instagram|pinterest|twitter|tiktok|wikipedia|medium|stackexchange|stackoverflow|superuser|tomshardware|notebookcheck|blogspot|wordpress)\.|\/\/(?:x\.com|community\.|forum|answers\.|support\.)|\/(?:forum|community|threads?|questions?|discussion)s?\//i;

function brandStoreHost(brand) {
  const key = Object.keys(BRAND_STORES).find((k) => brand.toLowerCase().includes(k));
  return key ? BRAND_STORES[key] : null;
}

function classifyStore(url, input) {
  const host = hostOf(url);
  const retailer = (RETAILERS[input.country] || []).find((r) => host === r.host || host.endsWith(`.${r.host}`));
  if (retailer) return { storeType: "Retailer", storeName: retailer.name };
  const official = brandStoreHost(input.brand);
  if (official && (host === official || host.endsWith(`.${official}`)) && !NOT_A_SHOP.test(url)) {
    return { storeType: "Official store", storeName: `${input.brand} official` };
  }
  return null;
}

function toPartItem(entry, input, component, specs) {
  const title = cleanText(entry.title || entry.name || "Replacement part listing", 220);
  const snippet = cleanText(entry.snippet || entry.description || "", 800);
  const url = safeHttpUrl(entry.url || entry.link);
  if (!url) return null;
  const text = `${title} ${snippet}`;
  const assessed = applySpecCheck(assessCompatibility(text, input), text, component, specs);
  return {
    kind: "part", component, title, url, snippet,
    source: cleanText(entry.site_name || entry.domain || hostOf(url) || "Web listing", 120),
    price: parsePrice(text), currency: currencyByCountry[input.country] || "INR",
    partNumber: extractPartNumber(text), ...assessed,
    ...(classifyStore(url, input) || {})
  };
}

async function findHardwareForComponent(input, component, specs) {
  const where = input.country === "IN" ? "India" : input.country;
  const core = `${input.brand} ${input.model} ${component} replacement`;
  const retailers = RETAILERS[input.country] || [];
  const brandHost = brandStoreHost(input.brand);
  const queries = [
    `${core} compatible part number price ${where}`,
    retailers.length ? `${core} buy (${retailers.slice(0, 2).map((r) => `site:${r.host}`).join(" OR ")})` : null,
    brandHost ? `${core} price site:${brandHost}` : null
  ].filter(Boolean);

  const settled = await Promise.allSettled(queries.map((q) => tinyfishSearch(q, input.country)));
  const ok = settled.filter((o) => o.status === "fulfilled");
  if (!ok.length) throw settled[0].reason;

  const seen = new Set();
  const items = [];
  for (const outcome of ok) {
    const raw = Array.isArray(outcome.value.results) ? outcome.value.results : [];
    for (const entry of raw.slice(0, 12)) {
      const item = toPartItem(entry, input, component, specs);
      if (!item || seen.has(item.url)) continue;
      seen.add(item.url);
      // Keep real shops (even if the snippet has no price) and any other page that shows a price.
      // Forums, videos and Q&A pages are dropped.
      const isShop = Boolean(item.storeType);
      if (!isShop && (item.price == null || NOT_A_SHOP.test(item.url))) continue;
      items.push(item);
    }
  }
  return { query: queries[0], items };
}

function applyEnrichment(item, data, input, specs) {
  if (typeof data.title === "string" && data.title.trim()) item.title = cleanText(data.title, 220);
  if (Number.isFinite(Number(data.price)) && data.price !== null && Number(data.price) > 0) item.price = Number(data.price);
  if (typeof data.currency === "string" && data.currency.trim()) item.currency = data.currency.trim().slice(0, 8);
  if (typeof data.partNumber === "string" && data.partNumber.trim()) item.partNumber = cleanText(data.partNumber, 60);
  if (typeof data.snippet === "string" && data.snippet.trim()) item.snippet = cleanText(data.snippet, 800);
  if (typeof data.source === "string" && data.source.trim()) item.source = cleanText(data.source, 120);
  if (["Likely", "Unverified", "Mismatch"].includes(data.compatibility)) item.compatibility = data.compatibility;
  if (typeof data.compatibilityEvidence === "string" && data.compatibilityEvidence.trim()) item.compatibilityEvidence = cleanText(data.compatibilityEvidence, 500);
  // Even page-verified data must not contradict the model's known specs.
  const checked = applySpecCheck({ compatibility: item.compatibility, compatibilityEvidence: item.compatibilityEvidence }, `${item.title} ${item.snippet}`, item.component, specs);
  item.compatibility = checked.compatibility;
  item.compatibilityEvidence = checked.compatibilityEvidence;
}

// ---------- Orchestrator ----------

export async function buildSolutions(rawInput) {
  const problem = normalizeProblem(rawInput.problem);
  const input = { ...rawInput, problem };
  const diagnosis = diagnose({ problem, deviceType: input.deviceType, component: input.component });
  const components = diagnosis.hardwareComponents;
  const warnings = [];
  const needsSpecs = components.some((c) => /ram|memory|ssd|storage|drive/i.test(c));

  const [softwareOut, specsOut] = await Promise.allSettled([
    findSoftwareGuides(input, problem),
    needsSpecs ? lookupDeviceSpecs(input) : Promise.resolve(null)
  ]);
  const deviceSpecs = specsOut.status === "fulfilled" ? specsOut.value : null;
  if (specsOut.status === "rejected") warnings.push("Could not look up your model's RAM/SSD specifications, so memory/storage compatibility is based on the listing text only.");

  const hardwareOut = await Promise.allSettled(components.map((c) => findHardwareForComponent(input, c, deviceSpecs)));

  const failedSoftware = softwareOut.status === "rejected";
  const failedHardware = components.length > 0 && hardwareOut.every((o) => o.status === "rejected");
  if (failedSoftware && (components.length === 0 || failedHardware)) {
    throw new Error(softwareOut.reason?.message || "TinyFish search failed");
  }
  if (failedSoftware) warnings.push("Software guide search failed — only hardware results are shown.");
  if (failedHardware) warnings.push("Hardware search failed — only software guides are shown.");

  let software = failedSoftware ? [] : softwareOut.value;

  // Hardware: drop mismatches, rank within each component.
  const queries = [];
  let hardware = [];
  let mismatchCount = 0;
  hardwareOut.forEach((outcome, i) => {
    if (outcome.status !== "fulfilled") { warnings.push(`Search for ${components[i]} failed and was skipped.`); return; }
    queries.push(outcome.value.query);
    const usable = outcome.value.items.filter((item) => item.compatibility !== "Mismatch");
    mismatchCount += outcome.value.items.length - usable.length;
    hardware.push(...usable);
  });

  // Optional Agent enrichment (same switch as /api/search).
  if (process.env.TINYFISH_AGENT_ENRICHMENT === "true") {
    const partCandidates = [...hardware].sort((a, b) => scoreResult(b, { ...input, component: b.component }) - scoreResult(a, { ...input, component: a.component })).slice(0, 3);
    const guideCandidates = software.slice(0, 2);
    const [partRuns, guideRuns] = await Promise.all([
      Promise.allSettled(partCandidates.map((item) => enrichListing(item.url, { ...input, component: item.component }))),
      Promise.allSettled(guideCandidates.map((g) => extractGuideSteps(g.url, input, problem)))
    ]);
    partRuns.forEach((o, i) => { if (o.status === "fulfilled" && o.value) applyEnrichment(partCandidates[i], o.value, input, deviceSpecs); });
    guideRuns.forEach((o, i) => {
      if (o.status !== "fulfilled" || !o.value || !Array.isArray(o.value.steps)) return;
      const steps = o.value.steps.filter((s) => typeof s === "string" && s.trim()).slice(0, 6).map((s) => cleanText(s, 220));
      if (steps.length) guideCandidates[i].steps = steps;
      if (o.value.appliesToModel === true && !guideCandidates[i].tags.includes("Mentions your model")) guideCandidates[i].tags.push("Mentions your model");
      if (typeof o.value.summary === "string" && o.value.summary.trim()) guideCandidates[i].snippet = cleanText(o.value.summary, 400);
    });
    hardware = hardware.filter((item) => item.compatibility !== "Mismatch");
    warnings.push("TinyFish Agent inspected a limited number of pages. Extracted details still need manual verification.");
  }

  const tier = (item) => (item.storeType ? 0 : 1) + (item.price == null ? 2 : 0); // shops with a price first
  hardware = components.flatMap((component) =>
    rankResults(hardware.filter((item) => item.component === component), { ...input, component })
      .map((item) => ({
        ...item, component, kind: "part", symbol: symbolFor(component),
        tags: [...(item.tags || []), ...(item.storeType === "Official store" ? ["Official store"] : item.storeName ? [item.storeName] : [])]
      }))
      .sort((a, b) => Number(b.compatibility === "Likely") - Number(a.compatibility === "Likely") || tier(a) - tier(b))
  );

  if (mismatchCount) warnings.push(`${mismatchCount} listing(s) were hidden because they look incompatible with ${input.model}.`);
  if (hardware.length && !hardware.some((i) => i.compatibility === "Likely")) {
    warnings.push(`No listing explicitly names ${input.model}. The parts below are unverified leads — confirm the exact part number before buying.`);
  }
  if (deviceSpecs?.ramSoldered && components.some((c) => /ram|memory/i.test(c))) {
    warnings.push("Your model's RAM appears to be soldered/onboard, which usually means it can't be upgraded. Check the manufacturer's service manual.");
  }

  return {
    problem, diagnosis,
    software: { results: software },
    hardware: { components, queries, deviceSpecs, results: hardware },
    warnings
  };
}
