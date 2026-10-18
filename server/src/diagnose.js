// Rule-based symptom diagnosis. Maps a free-text problem description to
// (a) the hardware components that could plausibly be at fault and
// (b) a short built-in checklist used as a fallback / demo for software fixes.
// Live software guides and hardware listings come from TinyFish (see solutions.js).

// Keep in sync with deviceOptions in client/src/App.jsx
export const DEVICE_COMPONENTS = {
  Laptop: ["Battery", "Display / Screen", "SSD", "RAM", "Keyboard", "Charger", "Cooling fan"],
  Smartphone: ["Battery", "Display / Screen", "Charging port", "Back cover", "Camera module", "Charger"],
  Tablet: ["Battery", "Display / Screen", "Charging port", "Charger"],
  "Desktop PC": ["SSD", "RAM", "Power supply", "GPU", "CPU cooler", "Motherboard"],
  "Gaming console": ["Storage", "Controller", "Power supply", "Cooling fan", "HDMI port"]
};

const SYMPTOMS = [
  {
    id: "charging", label: "Not charging / won't power on",
    test: /not charg|n'?t charg|no charg|won'?t (?:charge|turn on|power|boot|start)|doesn'?t (?:charge|turn on|power|boot|start)|stopped charging|charger|adapter|no power|plugged in/i,
    components: ["Charger", "Battery", "Charging port", "Power supply"],
    checks: ["Try a different wall socket and check the charger cable for kinks or a loose tip.", "Unplug the charger, hold the power button for 30 seconds, then plug in and retry.", "Check the charging light and the battery/charging icon; note any blink pattern.", "Update BIOS/firmware and power-management drivers, then test again."]
  },
  {
    id: "battery", label: "Battery drain / short backup",
    test: /battery|drain|dies? (?:fast|quickly|soon)|doesn'?t (?:hold|last)|short backup|swollen|bloat|runs? out/i,
    components: ["Battery"],
    checks: ["Open the battery report (Windows: powercfg /batteryreport) and compare design vs. full-charge capacity.", "Check Task Manager > Startup/Processes for apps using high CPU in the background.", "Switch to a balanced/battery-saver power plan and lower screen brightness.", "If the battery looks swollen, stop using it and replace it immediately."]
  },
  {
    id: "performance", label: "Slow / freezing",
    test: /slow|lag|freez|frozen|hang|stutter|sluggish|takes (?:too )?long|boot(?:ing)? (?:time|slow)|not responding|high (?:disk|memory|ram)/i,
    components: ["SSD", "RAM"],
    checks: ["Open Task Manager and see whether Disk, Memory or CPU sits near 100%.", "Disable unneeded startup apps and run a malware scan.", "Free up at least 15–20% of the system drive and run Disk Cleanup.", "Update Windows, BIOS and storage/chipset drivers."]
  },
  {
    id: "heat", label: "Overheating / fan noise",
    test: /overheat|heat|hot\b|fan|noisy|loud|thermal|throttl|burning/i,
    components: ["Cooling fan", "CPU cooler"],
    checks: ["Use the laptop on a hard, flat surface so the vents are not blocked.", "Clean dust from vents with compressed air (device powered off).", "Check Task Manager for runaway processes keeping the CPU busy.", "Update BIOS/firmware; many vendors ship fan-curve fixes."]
  },
  {
    id: "display", label: "Display problems",
    test: /screen|display|flicker|lines on|black screen|cracked|dead pixel|backlight|\bdim\b|brightness|blank/i,
    components: ["Display / Screen"],
    checks: ["Connect an external monitor. If it looks fine there, the panel or cable is the likely fault.", "Update or roll back the graphics driver.", "Reset brightness/refresh-rate settings and test in safe mode.", "Look for physical damage (cracks, pressure marks) — those need a panel replacement."]
  },
  {
    id: "keyboard", label: "Keyboard problems",
    test: /keyboard|keys? (?:not|stuck|don|doesn|are|is)|typing|stuck key/i,
    components: ["Keyboard"],
    checks: ["Test the keys in an online keyboard tester to see which ones fail.", "Uninstall the keyboard device in Device Manager and reboot.", "Clean around the keys (device off) and check for liquid residue.", "Try an external USB keyboard to rule out software remapping."]
  },
  {
    id: "storage", label: "Storage / disk errors",
    test: /storage|disk|hard drive|hdd|ssd|bad sector|out of space|drive not detected|clicking noise|corrupt/i,
    components: ["SSD", "Storage"],
    checks: ["Back up your data first.", "Run chkdsk /f and the vendor's drive health tool (SMART status).", "Check if the drive is detected in BIOS/UEFI.", "Clear large temp files and move media off the system drive."]
  },
  {
    id: "memory", label: "Memory (RAM) problems",
    test: /\bram\b|out of memory|low memory|memory (?:error|issue|leak)/i,
    components: ["RAM"],
    checks: ["Run Windows Memory Diagnostic (mdsched.exe) or MemTest86.", "Reseat the RAM module if your model has a user-accessible slot.", "Check Task Manager for a memory leak in a specific app.", "Update BIOS; some models need it for stable memory timings."]
  },
  {
    id: "crash", label: "Crashes / random restarts",
    test: /blue screen|bsod|crash|restart(?:s|ing)? (?:randomly|by itself)|reboot|random(?:ly)? shut/i,
    components: ["RAM", "SSD"],
    checks: ["Note the BSOD stop code and look it up for your model.", "Boot into safe mode; if stable, uninstall recent drivers/updates.", "Run sfc /scannow and DISM /Online /Cleanup-Image /RestoreHealth.", "Run memory and disk diagnostics to rule out hardware."]
  },
  {
    id: "network", label: "Wi-Fi / network / Bluetooth",
    test: /wi-?fi|internet|network|bluetooth|ethernet|no connection/i,
    components: [],
    checks: ["Forget and rejoin the network; restart the router.", "Run the Windows network troubleshooter and reset the network stack (netsh winsock reset).", "Update or reinstall the Wi-Fi/Bluetooth driver from the vendor.", "Turn off airplane mode and any VPN, then test again."]
  },
  {
    id: "sound", label: "Sound / audio",
    test: /sound|audio|speaker|microphone|\bmic\b|no volume/i,
    components: [],
    checks: ["Check the selected output device and volume mixer.", "Run the audio troubleshooter and restart the Windows Audio service.", "Reinstall the audio driver from the vendor.", "Disable audio enhancements and test again."]
  },
  {
    id: "malware", label: "Malware / pop-ups",
    test: /virus|malware|pop-?ups?|\bads\b|hacked|ransom/i,
    components: [],
    checks: ["Run a full scan with Microsoft Defender and a second-opinion scanner.", "Remove unknown browser extensions and reset browser settings.", "Check startup apps and scheduled tasks for anything unfamiliar.", "Change important passwords from a clean device."]
  },
  {
    id: "update", label: "Updates / drivers / boot",
    test: /update|driver|boot loop|windows update|login|password|activation/i,
    components: [],
    checks: ["Run Windows Update troubleshooter and restart.", "Install the latest drivers from the manufacturer's support page for your exact model.", "Use System Restore to go back to a working point.", "As a last resort, back up and reset the PC."]
  }
];

const GENERIC_CHECKS = [
  "Restart fully (Shut down, wait 30 seconds, power on).",
  "Install pending system, BIOS and driver updates from the manufacturer's support page.",
  "Boot in safe mode to see whether the problem is caused by software.",
  "Back up your data before any repair or reset."
];

export function symptomChecks(id) {
  return SYMPTOMS.find((s) => s.id === id)?.checks || GENERIC_CHECKS;
}

export function normalizeProblem(text) {
  return String(text || "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

/**
 * @returns {{matched:{id:string,label:string}[], hardwareComponents:string[], softwareOnly:boolean, note:string}}
 */
export function diagnose({ problem, deviceType, component }) {
  const text = normalizeProblem(problem);
  const allowed = new Set(DEVICE_COMPONENTS[deviceType] || []);
  const matchedSymptoms = SYMPTOMS.filter((s) => s.test.test(text));
  const matched = matchedSymptoms.map(({ id, label }) => ({ id, label }));

  let hardwareComponents;
  if (component) {
    // The user told us which part they suspect — trust that.
    hardwareComponents = [component];
  } else {
    const derived = [];
    for (const s of matchedSymptoms) {
      for (const c of s.components) if (allowed.has(c) && !derived.includes(c)) derived.push(c);
    }
    hardwareComponents = derived.slice(0, 3);
  }

  const softwareOnly = !component && matched.length > 0 && hardwareComponents.length === 0;
  let note = "";
  if (softwareOnly) note = "This looks software-related, so a hardware replacement is unlikely to be needed. Try the software fixes first.";
  else if (!component && matched.length === 0) note = "We couldn't map your description to a specific part. Showing general software fixes — pick a component above to also search for hardware parts.";
  else if (!component && hardwareComponents.length) note = `Based on your description we checked: ${hardwareComponents.join(", ")}. Try the software fixes first — they cost nothing.`;
  else if (component) note = `Searching hardware for the component you selected: ${component}.`;

  return { matched, hardwareComponents, softwareOnly, note };
}
