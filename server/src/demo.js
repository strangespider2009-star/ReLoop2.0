import { diagnose, symptomChecks, normalizeProblem } from "./diagnose.js";

export function demoResults(input) {
  const sample = [
    { title: `${input.brand} ${input.model} ${input.component} — compatible replacement listing`, source: "Example Parts Store", price: 2499, partNumber: null, compatibility: "Unverified", snippet: "Illustrative sample result. No live seller or stock verification has been performed.", url: "https://example.com/parts", compatibilityEvidence: "Demo data only; verify the exact part number with the manufacturer." },
    { title: `OEM / FRU ${input.component} search for ${input.model}`, source: "Manufacturer support search", price: 3899, partNumber: null, compatibility: "Unverified", snippet: "Use the manufacturer's parts lookup to confirm the exact part number for your model.", url: "https://www.google.com/search?q=" + encodeURIComponent(`${input.brand} ${input.model} official parts ${input.component}`), compatibilityEvidence: "This is a search link, not a verified component listing." },
    { title: `Budget ${input.component} option for ${input.brand} devices`, source: "Example Marketplace", price: 1499, partNumber: null, compatibility: "Unverified", snippet: "Illustrative low-price option. Similar device names do not prove compatibility.", url: "https://example.org/replacement-parts", compatibilityEvidence: "Demo data only; check connector, dimensions, voltage, and part number." }
  ];
  return sample.map((item, index) => ({
    ...item,
    currency: ({ IN: "INR", US: "USD", GB: "GBP", CA: "CAD" })[input.country] || "INR",
    tags: index === 0 ? ["Best Overall"] : index === 1 ? ["Premium"] : ["Cheapest", "Best Value"],
    symbol: /battery/i.test(input.component) ? "▰" : /screen|display/i.test(input.component) ? "▣" : "◈"
  }));
}

// Demo mode for POST /api/diagnose (no TINYFISH_API_KEY). Everything is clearly labelled as sample data.
export function demoSolutions(input) {
  const problem = normalizeProblem(input.problem);
  const diagnosis = diagnose({ problem, deviceType: input.deviceType, component: input.component });
  const symptoms = diagnosis.matched.length ? diagnosis.matched.slice(0, 3) : [{ id: "generic", label: "General troubleshooting" }];
  const software = symptoms.map((symptom) => ({
    kind: "guide",
    title: `${symptom.label}: built-in checklist for ${input.brand} ${input.model}`,
    source: "ReLoop built-in checklist",
    guideType: "Demo",
    forModel: false,
    snippet: "Sample checklist shown because no TinyFish key is configured. Live mode shows scraped guides from official and community sources.",
    steps: symptomChecks(symptom.id),
    url: "https://www.google.com/search?q=" + encodeURIComponent(`${input.brand} ${input.model} ${problem} fix`),
    tags: ["Demo"],
    symbol: "⚙"
  }));
  const hardware = diagnosis.hardwareComponents.flatMap((component) =>
    demoResults({ ...input, component }).map((item) => ({ ...item, kind: "part", component }))
  );
  return {
    problem, diagnosis,
    software: { results: software },
    hardware: { components: diagnosis.hardwareComponents, queries: [], deviceSpecs: null, results: hardware },
    warnings: ["Demo mode: add TINYFISH_API_KEY to .env to search the live web. Sample guides, listings and prices are illustrative, not current offers."]
  };
}
