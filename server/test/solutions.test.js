import test from "node:test";
import assert from "node:assert/strict";

process.env.TINYFISH_API_KEY = "test-key";
const { buildSolutions } = await import("../src/solutions.js");

// Mock TinyFish Search so the whole pipeline runs offline.
globalThis.fetch = async (url) => {
  const q = new URL(url).searchParams.get("query");
  const r = (title, snippet, u) => ({ title, snippet, url: u });
  let results = [];
  if (/specifications/.test(q)) results = [r("Dell XPS 13 9310 specs", "XPS 13 9310 uses LPDDR4x soldered memory and one M.2 2280 NVMe slot", "https://www.dell.com/specs")];
  else if (/fix troubleshooting|how to fix/.test(q)) results = [
    r("Fix slow performance on Dell XPS 13 9310", "Update BIOS and drivers on your XPS 13 9310 if it is slow", "https://www.dell.com/support/kbdoc/1"),
    r("Laptop slow? reddit thread", "tips for slow laptops", "https://www.reddit.com/r/laptops/1"),
    r("Buy a laptop", "great deals", "https://shop.example.com/product/123")
  ];
  else if (/ SSD /.test(q)) results = [
    r("Dell XPS 13 9310 SSD M.2 2280 NVMe 512GB ₹4,999", "Fits Dell XPS 13 9310. Part number: SN530-512", "https://shop.example.com/ssd-2280"),
    r("SSD M.2 2230 for Dell XPS 13 9310 ₹5,499", "Compact 2230 drive for XPS 13 9310", "https://shop.example.com/ssd-2230"),
    r("Generic SSD", "Any laptop", "https://shop.example.com/ssd-generic")
  ];
  else if (/ RAM /.test(q)) results = [
    r("16GB DDR5 RAM for Dell XPS 13 9310 ₹6,000", "DDR5 memory, XPS 13 9310", "https://shop.example.com/ram-ddr5")
  ];
  return { ok: true, json: async () => ({ results }) };
};

test("full pipeline: software guides + spec-checked hardware", async () => {
  const out = await buildSolutions({ deviceType: "Laptop", brand: "Dell", model: "Dell XPS 13 9310", component: "", problem: "my laptop is very slow", country: "IN", budget: null });

  assert.deepEqual(out.hardware.components, ["SSD", "RAM"]);
  assert.equal(out.hardware.deviceSpecs.ssdLength, "2280");

  const guides = out.software.results;
  assert.equal(guides[0].guideType, "Official support");
  assert.ok(!guides.some((g) => g.url.includes("/product/")), "shop pages are excluded");

  const hw = out.hardware.results;
  const urls = hw.map((i) => i.url);
  assert.ok(urls.includes("https://shop.example.com/ssd-2280"));
  assert.ok(!urls.includes("https://shop.example.com/ssd-2230"), "wrong M.2 length is removed");
  assert.ok(!urls.includes("https://shop.example.com/ram-ddr5"), "wrong RAM generation is removed");
  assert.ok(hw.find((i) => i.url.endsWith("ssd-2280")).compatibility === "Likely");
  assert.ok(out.warnings.some((w) => /soldered/i.test(w)));
  assert.ok(out.warnings.some((w) => /hidden/i.test(w)));
});

test("software-only problem makes no hardware searches", async () => {
  const out = await buildSolutions({ deviceType: "Laptop", brand: "Dell", model: "Dell XPS 13 9310", component: "", problem: "wifi keeps disconnecting", country: "IN", budget: null });
  assert.deepEqual(out.hardware.results, []);
  assert.equal(out.diagnosis.softwareOnly, true);
});

test("forums are dropped; Amazon, Flipkart and the official store are kept and ranked first", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const q = new URL(url).searchParams.get("query");
    const r = (title, snippet, u) => ({ title, snippet, url: u });
    let results = [];
    if (/ Battery /.test(q)) results = [
      r("How to replace Acer Aspire 5 A515-56 battery", "Please give your exact model number", "https://community.acer.com/en/discussion/123"),
      r("Acer Aspire 5 A515-56 battery help", "reddit thread", "https://www.reddit.com/r/acer/comments/1"),
      r("Acer Aspire 5 A515-56 battery AP18E7M", "Battery for Acer Aspire 5 A515-56", "https://www.amazon.in/dp/B0AAA"),
      r("Acer Aspire 5 A515-56 battery ₹3,499", "Fits Acer Aspire 5 A515-56", "https://www.flipkart.com/battery/p/itm1"),
      r("Acer Aspire 5 A515-56 battery", "Official Acer battery for A515-56", "https://store.acer.com/en-in/battery"),
      r("Random shop battery ₹2,999", "Acer Aspire 5 A515-56 battery", "https://smallshop.example.com/b1")
    ];
    return { ok: true, json: async () => ({ results }) };
  };
  try {
    const out = await buildSolutions({ deviceType: "Laptop", brand: "Acer", model: "Acer Aspire 5 A515-56", component: "Battery", problem: "battery drains fast", country: "IN", budget: null });
    const urls = out.hardware.results.map((i) => i.url);
    assert.ok(!urls.some((u) => /community\.acer|reddit/.test(u)), "forums removed");
    assert.ok(urls.includes("https://www.amazon.in/dp/B0AAA"), "Amazon kept without a price");
    assert.ok(urls.includes("https://www.flipkart.com/battery/p/itm1"));
    assert.ok(urls.includes("https://store.acer.com/en-in/battery"), "official store kept");
    assert.ok(urls.includes("https://smallshop.example.com/b1"), "priced unknown shop kept");
    const official = out.hardware.results.find((i) => i.url.includes("store.acer.com"));
    assert.equal(official.storeType, "Official store");
    assert.ok(official.tags.includes("Official store"));
    assert.ok(out.hardware.results.every((i) => !i.tags.includes("Best Overall") || i.tags.length >= 1));
  } finally { globalThis.fetch = realFetch; }
});
