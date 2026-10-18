import { useEffect, useMemo, useState } from "react";

// Empty in local dev (Vite proxies /api). Set VITE_API_URL to the hosted backend in production.
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

const deviceOptions = {
  Laptop: {
    brands: ["Dell", "HP", "Lenovo", "ASUS", "Acer", "Apple", "Other"],
    components: ["Battery", "Display / Screen", "SSD", "RAM", "Keyboard", "Charger", "Cooling fan"]
  },
  Smartphone: {
    brands: ["Apple", "Samsung", "Google", "OnePlus", "Xiaomi", "Vivo", "OPPO", "Other"],
    components: ["Battery", "Display / Screen", "Charging port", "Back cover", "Camera module", "Charger"]
  },
  Tablet: {
    brands: ["Apple", "Samsung", "Lenovo", "Xiaomi", "Other"],
    components: ["Battery", "Display / Screen", "Charging port", "Charger"]
  },
  "Desktop PC": {
    brands: ["Custom build", "Dell", "HP", "Lenovo", "Other"],
    components: ["SSD", "RAM", "Power supply", "GPU", "CPU cooler", "Motherboard"]
  },
  "Gaming console": {
    brands: ["Sony", "Microsoft", "Nintendo", "Other"],
    components: ["Storage", "Controller", "Power supply", "Cooling fan", "HDMI port"]
  }
};

const money = (value, currency = "INR") => {
  if (value == null || !Number.isFinite(Number(value))) return "Price not found";
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `₹${Math.round(value)}`; }
};

function App() {
  const [deviceType, setDeviceType] = useState("Laptop");
  const [brand, setBrand] = useState("Dell");
  const [model, setModel] = useState("");
  const [component, setComponent] = useState("");
  const [problem, setProblem] = useState("");
  const [country, setCountry] = useState("IN");
  const [budget, setBudget] = useState("");
  const [softwareResults, setSoftwareResults] = useState([]);
  const [hardwareResults, setHardwareResults] = useState([]);
  const [diagnosis, setDiagnosis] = useState(null);
  const [deviceSpecs, setDeviceSpecs] = useState(null);
  const [tab, setTab] = useState("software");
  const [partFilter, setPartFilter] = useState("All");
  const [onlyCompatible, setOnlyCompatible] = useState(true);
  const [mode, setMode] = useState("");
  const [query, setQuery] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All");
  const [sort, setSort] = useState("recommended");
  const [shortlist, setShortlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem("reloop-shortlist") || "[]"); } catch { return []; }
  });
  const [showShortlist, setShowShortlist] = useState(false);
  const choices = deviceOptions[deviceType];

  // Free hosts put the API to sleep when idle; ping it on page load so it is awake by the time the user searches.
  useEffect(() => { if (API_BASE) fetch(`${API_BASE}/api/health`).catch(() => {}); }, []);

  const hasLikely = hardwareResults.some((item) => item.compatibility === "Likely");
  const strictCompat = onlyCompatible && hasLikely;
  const hardwareComponents = useMemo(() => [...new Set(hardwareResults.map((item) => item.component).filter(Boolean))], [hardwareResults]);

  const visibleHardware = useMemo(() => {
    let list = hardwareResults.filter((item) => filter === "All" || (item.tags || []).includes(filter));
    if (partFilter !== "All") list = list.filter((item) => item.component === partFilter);
    if (strictCompat) list = list.filter((item) => item.compatibility === "Likely");
    if (budget !== "" && Number(budget) >= 0) list = list.filter((item) => item.price == null || item.price <= Number(budget));
    if (sort === "price-low") list = [...list].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    if (sort === "compatibility") list = [...list].sort((a, b) => Number(b.compatibility === "Likely") - Number(a.compatibility === "Likely"));
    return list;
  }, [hardwareResults, filter, partFilter, strictCompat, sort, budget]);

  function updateDeviceType(value) {
    setDeviceType(value);
    setBrand(deviceOptions[value].brands[0]);
    setComponent("");
  }

  async function searchParts(event) {
    event.preventDefault();
    setError("");
    setWarnings([]);
    setSoftwareResults([]);
    setHardwareResults([]);
    setDiagnosis(null);
    setDeviceSpecs(null);
    if (!model.trim()) { setError("Enter the exact model name or model number so hardware can be matched to your device."); return; }
    if (problem.trim().length < 5) { setError("Describe what is going wrong (for example: \"battery drains in 30 minutes\" or \"laptop is slow and freezes\")."); return; }
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceType, brand, model: model.trim(), component, problem: problem.trim(), country, budget: budget === "" ? null : Number(budget) })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Search failed. Please try again.");
      const software = payload.software?.results || [];
      const hardware = payload.hardware?.results || [];
      setSoftwareResults(software);
      setHardwareResults(hardware);
      setDiagnosis(payload.diagnosis || null);
      setDeviceSpecs(payload.hardware?.deviceSpecs || null);
      setMode(payload.mode || "live");
      setQuery(payload.hardware?.queries?.[0] || "");
      setWarnings(payload.warnings || []);
      setTab(software.length || !hardware.length ? "software" : "hardware");
      setFilter("All");
      setPartFilter("All");
      setShowShortlist(false);
      if (!software.length && !hardware.length) setError("No solutions were found. Try the full model number or describe the problem in more detail.");
    } catch (err) {
      setError(err.message || "Could not connect to ReLoop API.");
    } finally {
      setLoading(false);
    }
  }

  function toggleShortlist(item) {
    const exists = shortlist.some((entry) => entry.url === item.url);
    const next = exists ? shortlist.filter((entry) => entry.url !== item.url) : [...shortlist, item];
    setShortlist(next);
    localStorage.setItem("reloop-shortlist", JSON.stringify(next));
  }

  const hasResults = softwareResults.length > 0 || hardwareResults.length > 0 || Boolean(diagnosis?.hardwareComponents?.length);
  const saved = (item) => shortlist.some((entry) => entry.url === item.url);
  const currencyFor = (item) => item.currency || (country === "IN" ? "INR" : country === "US" ? "USD" : country === "GB" ? "GBP" : "CAD");
  const SaveButton = ({ item }) => <button className={`save-button ${saved(item) ? "saved" : ""}`} title="Save to shortlist" onClick={() => toggleShortlist(item)}>{saved(item) ? "♥" : "♡"}</button>;

  const renderGuide = (item, index) => <article className="product-card" key={item.url || `${item.title}-${index}`}>
    <div className="product-card-top"><span className={`compat-badge ${item.guideType === "Official support" ? "likely" : ""}`}>{item.guideType || "Web guide"}</span><SaveButton item={item} /></div>
    <div className="product-symbol">{item.symbol || "⚙"}</div>
    <h3>{item.title}</h3><p className="product-source">{item.source || "Web guide"}</p>
    <p className="product-snippet">{item.snippet || "Open the guide for the full steps."}</p>
    {item.steps?.length > 0 && <ol className="steps-list">{item.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>}
    <div className="tag-row">{(item.tags || []).map((tag) => <span key={tag}>{tag}</span>)}</div>
    <a className="source-link" href={item.url} target="_blank" rel="noreferrer">Open guide <span>↗</span></a>
  </article>;

  const renderPart = (item, index) => <article className="product-card" key={item.url || `${item.title}-${index}`}>
    <div className="product-card-top"><span className={`compat-badge ${item.compatibility === "Likely" ? "likely" : item.compatibility === "Mismatch" ? "mismatch" : ""}`}>{item.compatibility || "Unverified"} match</span><SaveButton item={item} /></div>
    <div className="product-symbol">{item.symbol || "◈"}</div>
    <h3>{item.title}</h3><p className="product-source">{item.source || "Web listing"}{item.component ? ` · ${item.component}` : ""}</p>
    {item.price != null ? <div className="product-price">{money(item.price, currencyFor(item))}</div> : <div className="product-price"><span className="price-missing">Check price on {item.storeName || "the site"}</span></div>}
    {item.partNumber && <p className="part-number">Part no. <b>{item.partNumber}</b></p>}
    <p className="product-snippet">{item.snippet || "Open the source listing to verify the exact specifications."}</p>
    <div className="tag-row">{(item.tags || []).map((tag) => <span key={tag}>{tag}</span>)}</div>
    {item.compatibilityEvidence && <p className="evidence"><b>Evidence:</b> {item.compatibilityEvidence}</p>}
    <a className="source-link" href={item.url} target="_blank" rel="noreferrer">Check listing <span>↗</span></a>
  </article>;

  const renderItem = (item, index) => item.kind === "guide" ? renderGuide(item, index) : renderPart(item, index);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brandmark" href="#" aria-label="ReLoop home"><span className="brand-icon">↻</span><span>reloop<span className="brand-dot">.</span></span></a>
        <nav><a href="#how-it-works">How it works</a><button className="nav-shortlist" onClick={() => setShowShortlist(!showShortlist)}>Shortlist <span>{shortlist.length}</span></button></nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="live-dot"></span> THE REPAIR-FIRST DECISION AGENT</div>
            <h1>Don't replace it.<br /><span>ReLoop it.</span></h1>
            <p>Describe what's wrong. ReLoop researches software fixes first, then finds replacement parts that fit your exact model — so you can make a smarter repair decision.</p>
            <div className="hero-proof"><span>✳ Compatibility-first</span><span>↗ Multi-source search</span><span>♻ Less e-waste</span></div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one"></div><div className="orbit orbit-two"></div>
            <div className="device device-laptop"><div className="laptop-screen"><span>↻</span></div><div className="laptop-base"></div></div>
            <div className="part part-chip">SSD <b>↗</b></div><div className="part part-battery">▰ <small>BATTERY</small></div>
            <div className="floating-leaf">♻</div>
          </div>
        </section>

        <section className="search-panel" id="search">
          <div className="section-heading"><div><span className="step-label">01 / YOUR DEVICE</span><h2>What needs fixing?</h2></div><span className="secure-label">✦ Powered by TinyFish</span></div>
          <form onSubmit={searchParts}>
            <div className="form-grid">
              <label>Device type
                <select value={deviceType} onChange={(e) => updateDeviceType(e.target.value)}>{Object.keys(deviceOptions).map((item) => <option key={item}>{item}</option>)}</select>
              </label>
              <label>Brand
                <select value={brand} onChange={(e) => setBrand(e.target.value)}>{choices.brands.map((item) => <option key={item}>{item}</option>)}</select>
              </label>
              <label className="model-field">Exact model
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. Dell XPS 13 9310" required />
              </label>
              <label>Component (optional)
                <select value={component} onChange={(e) => setComponent(e.target.value)}><option value="">Auto-detect from problem</option>{choices.components.map((item) => <option key={item}>{item}</option>)}</select>
              </label>
              <label>Market
                <select value={country} onChange={(e) => setCountry(e.target.value)}><option value="IN">India (INR)</option><option value="US">United States (USD)</option><option value="GB">United Kingdom (GBP)</option><option value="CA">Canada (CAD)</option></select>
              </label>
              <label>Budget (optional)
                <div className="budget-input"><span>{country === "IN" ? "₹" : country === "US" ? "$" : country === "GB" ? "£" : "C$"}</span><input type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No limit" /></div>
              </label>
              <label className="problem-field">What's wrong with your device?
                <textarea value={problem} onChange={(e) => setProblem(e.target.value)} maxLength={600} rows={3} placeholder="e.g. Battery drains in 30 minutes and the laptop gets very hot while charging" required />
              </label>
            </div>
            <button className="search-button" type="submit" disabled={loading}>{loading ? <><span className="spinner"></span> Diagnosing &amp; searching the web…</> : <>Diagnose &amp; find fixes <span>↗</span></>}</button>
            <p className="form-footnote">Use the full model number so hardware can be matched to your exact device. ReLoop does not guarantee compatibility until the exact part number is verified.</p>
          </form>
        </section>

        {(hasResults || showShortlist) && <section className="results-section" id="results">
          <div className="results-header"><div><span className="step-label">02 / YOUR OPTIONS</span><h2>{showShortlist ? "Your shortlist" : "Compare before you repair."}</h2><p>{showShortlist ? `${shortlist.length} saved item(s)` : `${softwareResults.length} software fix(es) · ${hardwareResults.length} hardware part(s) · ${mode === "demo" ? "Demo data — not live offers" : "Live web research"}`}</p></div>
            {!showShortlist && tab === "hardware" && <label className="sort-control">Sort by<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="recommended">Recommended</option><option value="price-low">Price: low to high</option><option value="compatibility">Compatibility evidence</option></select></label>}
          </div>
          {!showShortlist && diagnosis?.note && <div className="notice">ⓘ {diagnosis.note}{diagnosis.matched?.length > 0 && <> Detected: {diagnosis.matched.map((item) => item.label).join(", ")}.</>}</div>}
          {!showShortlist && <div className="filter-row">
            <button className={`filter-chip ${tab === "software" ? "active" : ""}`} onClick={() => setTab("software")}>⚙ Software fixes ({softwareResults.length})</button>
            <button className={`filter-chip ${tab === "hardware" ? "active" : ""}`} onClick={() => setTab("hardware")}>▰ Hardware parts ({hardwareResults.length})</button>
          </div>}
          {!showShortlist && tab === "hardware" && hardwareResults.length > 0 && <>
            <div className="filter-row">
              <button className={`filter-chip ${strictCompat ? "active" : ""}`} onClick={() => setOnlyCompatible(!onlyCompatible)} disabled={!hasLikely} title={hasLikely ? "Show only listings that name your exact model" : "No listing names your exact model"}>✓ Compatible with my model only</button>
              {hardwareComponents.length > 1 && ["All", ...hardwareComponents].map((item) => <button key={item} className={`filter-chip ${partFilter === item ? "active" : ""}`} onClick={() => setPartFilter(item)}>{item === "All" ? "All parts" : item}</button>)}
            </div>
            <div className="filter-row">{["All", "Best Overall", "Best Value", "Cheapest", "Premium"].map((item) => <button key={item} className={`filter-chip ${filter === item ? "active" : ""}`} onClick={() => setFilter(item)}>{item}</button>)}</div>
          </>}
          {warnings.map((warning, i) => <div className="notice" key={i}>ⓘ {warning}</div>)}
          {!showShortlist && tab === "hardware" && deviceSpecs && <div className="notice">ⓘ Detected for your model: {[deviceSpecs.ramGen && `${deviceSpecs.ramGen} memory`, deviceSpecs.ramSoldered && "soldered RAM", deviceSpecs.ssdLength && `M.2 ${deviceSpecs.ssdLength} SSD slot`, deviceSpecs.nvmeOnly && "NVMe"].filter(Boolean).join(", ")}. Listings that contradict this are hidden.{deviceSpecs.source && <> <a href={deviceSpecs.source} target="_blank" rel="noreferrer">Source ↗</a></>}</div>}
          {query && !showShortlist && tab === "hardware" && <p className="query-note">Search query: <code>{query}</code></p>}

          <div className="product-grid">
            {showShortlist && shortlist.map(renderItem)}
            {!showShortlist && tab === "software" && softwareResults.map(renderGuide)}
            {!showShortlist && tab === "hardware" && visibleHardware.map(renderPart)}
          </div>
          {showShortlist && shortlist.length === 0 && <div className="empty-state"><span>♡</span><h3>Nothing saved yet</h3><p>Save guides and listings with the heart icon to compare them here.</p></div>}
          {!showShortlist && tab === "software" && softwareResults.length === 0 && <div className="empty-state"><span>⚙</span><h3>No software guides found</h3><p>Try describing the symptoms in more detail or include any error message.</p></div>}
          {!showShortlist && tab === "hardware" && visibleHardware.length === 0 && <div className="empty-state"><span>▰</span><h3>{diagnosis?.hardwareComponents?.length ? "No matching parts in this filter" : "No hardware replacement suggested"}</h3><p>{diagnosis?.hardwareComponents?.length ? "Try another part or remove your budget limit." : "Your description looks software-related. Try the software fixes, or pick a component above to search for parts anyway."}</p></div>}
          <p className="disclaimer">Prices, availability, seller claims and compatibility can change. Software steps from the web may not match your exact setup — back up your data first. Confirm the exact OEM/FRU/part number, connector, dimensions, warranty and return policy before ordering.</p>
        </section>}

        {error && <div className="error-banner" role="alert">{error}</div>}

        <section className="how-section" id="how-it-works"><div className="section-heading"><div><span className="step-label">THE RELOOP METHOD</span><h2>Repair smarter. Waste less.</h2></div></div>
          <div className="how-grid"><div><span>01</span><h3>Tell us what's wrong</h3><p>Pick your device and exact model, then describe the problem in your own words.</p></div><div><span>02</span><h3>Let the web agent research</h3><p>TinyFish searches public web sources for software fixes and for parts, and can inspect pages for evidence.</p></div><div><span>03</span><h3>Choose with confidence</h3><p>Try software fixes first. If hardware is needed, compare parts matched to your model, then verify with the seller.</p></div></div>
        </section>
      </main>
      <footer><a className="brandmark" href="#"><span className="brand-icon">↻</span><span>reloop<span className="brand-dot">.</span></span></a><p>Repair first. Replace smarter. <span>Built for a more circular tech economy.</span></p><span className="footer-status"><span className="live-dot"></span> TinyFish integration</span></footer>
    </div>
  );
}

export default App;
