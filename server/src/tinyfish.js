import { assessCompatibility } from "./compat.js";

const SEARCH_ENDPOINT = "https://api.search.tinyfish.ai";
const AGENT_ENDPOINT = "https://agent.tinyfish.ai/v1/automation/run";

export const currencyByCountry = { IN: "INR", US: "USD", GB: "GBP", CA: "CAD" };

export function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function cleanText(value, max = 700) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function parsePrice(text) {
  if (!text) return null;
  const patterns = [
    /(?:₹|INR\s?)([\d,]+(?:\.\d{1,2})?)/i,
    /(?:US\$|USD\s?|\$)([\d,]+(?:\.\d{1,2})?)/i,
    /(?:£|GBP\s?)([\d,]+(?:\.\d{1,2})?)/i,
    /(?:C\$|CAD\s?)([\d,]+(?:\.\d{1,2})?)/i,
    /(?:price|cost|from)\s*[:\-]?\s*([\d,]+(?:\.\d{1,2})?)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0 && value < 100_000_000) return value;
    }
  }
  return null;
}

export function extractPartNumber(text) {
  const match = text.match(/\b(?:part\s*(?:no\.?|number)|p\/n|sku|fru)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9._/-]{3,})/i);
  return match ? match[1].slice(0, 60) : null;
}

const compatibilityAssessment = (text, input) => assessCompatibility(text, input);

export function symbolFor(component = "") {
  if (/battery/i.test(component)) return "▰";
  if (/screen|display/i.test(component)) return "▣";
  if (/ssd|storage/i.test(component)) return "◈";
  if (/ram|memory/i.test(component)) return "▤";
  if (/fan|cooler/i.test(component)) return "✺";
  if (/keyboard/i.test(component)) return "⌨";
  if (/charger|power|port/i.test(component)) return "⌁";
  return "⌘";
}

export function scoreResult(item, input) {
  let score = item.compatibility === "Likely" ? 50 : 0;
  if (item.price != null) score += 10;
  if (item.partNumber) score += 10;
  const combined = `${item.title} ${item.snippet} ${item.url}`.toLowerCase();
  if (combined.includes(input.brand.toLowerCase())) score += 8;
  if (combined.includes(input.component.toLowerCase())) score += 8;
  if (/official|manufacturer|authorized|genuine|oem/.test(combined)) score += 5;
  return score;
}

export function rankResults(items, input) {
  const priced = items.filter((item) => item.price != null).sort((a, b) => a.price - b.price);
  const cheapestUrl = priced[0]?.url;
  const withScores = items.map((item) => ({ ...item, _score: scoreResult(item, input) }));
  const best = [...withScores].sort((a, b) => b._score - a._score)[0];
  const value = [...priced].sort((a, b) => {
    const aScore = a._score / Math.max(a.price, 1);
    const bScore = b._score / Math.max(b.price, 1);
    return bScore - aScore;
  })[0];
  return withScores.map((item) => {
    const tags = [];
    if (item.url === best?.url) tags.push("Best Overall");
    if (item.url === value?.url) tags.push("Best Value");
    if (item.url === cheapestUrl) tags.push("Cheapest");
    if (/premium|genuine|oem|official|authorized/i.test(`${item.title} ${item.snippet}`)) tags.push("Premium");
    return { ...item, tags, symbol: symbolFor(input.component) };
  }).sort((a, b) => b._score - a._score).map(({ _score, ...item }) => item);
}

export async function tinyfishSearch(query, country) {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("location", country);
  url.searchParams.set("language", "en");
  const response = await fetch(url, {
    headers: { "X-API-Key": process.env.TINYFISH_API_KEY, "Accept": "application/json" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`TinyFish Search returned HTTP ${response.status}`);
  return response.json();
}

export async function enrichListing(url, input) {
  const goal = `Inspect this product or parts listing for the replacement component request below.
Device type: ${input.deviceType}
Brand: ${input.brand}
Exact device model: ${input.model}
Component: ${input.component}
Market: ${input.country}

Extract only information visible on this page. Do not guess or invent a price, stock status, part number, or compatibility.
Return a JSON object with keys: title (string), price (number or null), currency (string or null), partNumber (string or null), compatibility (one of "Likely", "Unverified", "Mismatch"), compatibilityEvidence (short string), snippet (short string), source (seller/site name).
If the page does not explicitly support compatibility with the exact model, use "Unverified". If the page explicitly says incompatible, use "Mismatch". If price is unclear, return null. Do not make a purchase.`;
  const response = await fetch(AGENT_ENDPOINT, {
    method: "POST",
    headers: { "X-API-Key": process.env.TINYFISH_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ url, goal, browser_profile: "lite" }),
    signal: AbortSignal.timeout(75_000)
  });
  if (!response.ok) throw new Error(`TinyFish Agent returned HTTP ${response.status}`);
  const data = await response.json();
  const result = data.result ?? data.result_json ?? data.resultJson ?? {};
  if (typeof result === "string") {
    try { return JSON.parse(result); } catch { return null; }
  }
  return result && typeof result === "object" ? result : null;
}

export async function searchReplacementParts(input) {
  const query = `${input.brand} ${input.model} ${input.component} replacement compatible part number price ${input.country === "IN" ? "India" : input.country}`;
  const searchData = await tinyfishSearch(query, input.country);
  const rawResults = Array.isArray(searchData.results) ? searchData.results : [];
  const results = rawResults.slice(0, 12).map((entry) => {
    const title = cleanText(entry.title || entry.name || "Replacement part listing", 220);
    const snippet = cleanText(entry.snippet || entry.description || "", 800);
    const url = safeHttpUrl(entry.url || entry.link);
    const text = `${title} ${snippet}`;
    const assessed = compatibilityAssessment(text, input);
    return {
      title, url, snippet, source: cleanText(entry.site_name || entry.domain || (url ? new URL(url).hostname : "Web listing"), 120),
      price: parsePrice(text), currency: currencyByCountry[input.country] || "INR",
      partNumber: extractPartNumber(text), ...assessed
    };
  }).filter((item) => item.url);

  const warnings = [];
  if (process.env.TINYFISH_AGENT_ENRICHMENT === "true" && results.length) {
    const candidates = results.slice(0, 3);
    const enriched = await Promise.allSettled(candidates.map((item) => enrichListing(item.url, input)));
    enriched.forEach((outcome, index) => {
      if (outcome.status !== "fulfilled" || !outcome.value) return;
      const data = outcome.value;
      const current = results.find((item) => item.url === candidates[index].url);
      if (!current) return;
      if (typeof data.title === "string" && data.title.trim()) current.title = cleanText(data.title, 220);
      if (Number.isFinite(Number(data.price)) && data.price !== null && Number(data.price) > 0) current.price = Number(data.price);
      if (typeof data.currency === "string" && data.currency.trim()) current.currency = data.currency.trim().slice(0, 8);
      if (typeof data.partNumber === "string" && data.partNumber.trim()) current.partNumber = cleanText(data.partNumber, 60);
      if (typeof data.snippet === "string" && data.snippet.trim()) current.snippet = cleanText(data.snippet, 800);
      if (typeof data.source === "string" && data.source.trim()) current.source = cleanText(data.source, 120);
      if (["Likely", "Unverified", "Mismatch"].includes(data.compatibility)) current.compatibility = data.compatibility;
      if (typeof data.compatibilityEvidence === "string" && data.compatibilityEvidence.trim()) current.compatibilityEvidence = cleanText(data.compatibilityEvidence, 500);
    });
    warnings.push("TinyFish Agent inspected a limited number of listing pages. Extracted details still require manual verification.");
  }
  if (!results.length) warnings.push("TinyFish Search returned no usable product URLs. Try another model spelling or component name.");
  const ranked = rankResults(results, input);
  return { query, results: ranked, warnings };
}
