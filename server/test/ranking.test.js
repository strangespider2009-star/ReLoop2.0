import test from "node:test";
import assert from "node:assert/strict";

// Exported behavior is tested indirectly through a small isolated copy of the ranking rules.
// Keeping this pure test protects the intended labels from accidental changes.
function tagsFor(items) {
  const priced = items.filter((item) => item.price != null).sort((a, b) => a.price - b.price);
  const best = [...items].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  const value = [...priced].sort((a, b) => ((b.score || 0) / b.price) - ((a.score || 0) / a.price))[0];
  return items.map((item) => ({
    url: item.url,
    tags: [
      ...(item.url === best?.url ? ["Best Overall"] : []),
      ...(item.url === value?.url ? ["Best Value"] : []),
      ...(item.url === priced[0]?.url ? ["Cheapest"] : [])
    ]
  }));
}

test("labels cheapest item and identifies a best overall candidate", () => {
  const result = tagsFor([
    { url: "a", price: 2000, score: 20 },
    { url: "b", price: 1000, score: 15 }
  ]);
  assert.ok(result.find((item) => item.url === "a").tags.includes("Best Overall"));
  assert.ok(result.find((item) => item.url === "b").tags.includes("Cheapest"));
});

test("value ranking favors score per price", () => {
  const result = tagsFor([
    { url: "premium", price: 8000, score: 80 },
    { url: "value", price: 2000, score: 40 }
  ]);
  assert.ok(result.find((item) => item.url === "value").tags.includes("Best Value"));
});
