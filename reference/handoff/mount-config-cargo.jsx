
  window.mountBrokerLedger({
    rootId: "led-root",
    registryKey: "PC2Steps",
    bosunKey: "PC2Bosun",
    exToPatchKey: "PC2exToPatch",
    storageKey: "asb.led.cargo.v1",
    eyebrow: "Post Cargo",
    title: "Post a cargo",
    subtitle: "The minimum to match and estimate. The platform classifies the cargo and fills in the rest.",
    icon: "Cargo",
    submitLabel: "Post cargo",
    submitToast: "Cargo posted for matching",
    tierSwitch: true,
    initialState: () => ({}),
    draftLabel: (s) => {
      const c = s.commodity, p = s.ports;
      if (c && c.name) return c.name + (p && p.pol ? " · " + p.pol.name + (p.pod ? " → " + p.pod.name : "") : "");
      return "Untitled cargo";
    },
    steps: [
      { id: "commodity", title: "Commodity", hint: "Name + dry/break-bulk.",
        mand: [ (s) => !!(s.commodity && s.commodity.name), (s) => !!(s.commodity && s.commodity.form) ],
        opt: [ (s) => !!(s.commodity && s.commodity.packaging), (s) => !!(s.commodity && s.commodity.marketName) ] },
      { id: "quantity", title: "Quantity", hint: "Weight/volume + tolerance.",
        mand: [ (s) => !!(s.quantity && s.quantity.qtyMt), (s) => !!(s.quantity && s.quantity.unit) ],
        opt: [ (s) => !!(s.quantity && s.quantity.molooPct), (s) => !!(s.quantity && s.quantity.optionHolder) ] },
      { id: "ports", title: "Load & Discharge", hint: "POL, POD, rates.",
        mand: [ (s) => !!(s.ports && s.ports.pol && s.ports.pol.name), (s) => !!(s.ports && s.ports.pod && s.ports.pod.name) ],
        opt: [ (s) => !!(s.ports && s.ports.loadRate), (s) => !!(s.ports && s.ports.dischRate), (s) => !!(s.ports && s.ports.rateMechanism) ] },
      { id: "terms", title: "Laycan & Terms", hint: "Laycan, NOR, freight.",
        mand: [ (s) => !!(s.terms && s.terms.laycanFrom) ],
        opt: [ (s) => !!(s.terms && s.terms.norClause), (s) => !!(s.terms && s.terms.freight), (s) => !!(s.terms && s.terms.commissionPct) ] },
      { id: "review", title: "Review", hint: "Confirm and post." },
    ],
    templates: [
      { name: "Bagged sugar (break-bulk)", sub: "50 kg bags", patch: { commodity: { name: "Sugar", form: "break-bulk", packaging: "Bagged (50 kg)" } } },
      { name: "Grain bulk stem", sub: "MOLOO 10%", patch: {
        commodity: { name: "Wheat", form: "dry-bulk", packaging: "" },
        quantity: { qtyMt: 25000, unit: "CbM", molooPct: "10", optionHolder: "MOLOO" },
      } },
    ],
    recents: [
      { label: "MOLOO 10%", patch: (s) => ({ quantity: { ...(s.quantity || {}), molooPct: "10", optionHolder: "MOLOO" } }) },
      { label: "Freight basis: Per MT", patch: (s) => ({ terms: { ...(s.terms || {}), freightBasis: "Per MT" } }) },
      { label: "Commission 3.75%", patch: (s) => ({ terms: { ...(s.terms || {}), commissionPct: "3.75" } }) },
    ],
    reposts: [
      { label: "Bagged sugar — Santos → Lagos", patch: {
        commodity: { name: "Sugar", form: "break-bulk", packaging: "Bagged (50 kg)" },
        quantity: { qtyMt: 12500, unit: "CbM", molooPct: "10", optionHolder: "MOLOO" },
        terms: { freight: "45", freightBasis: "Per MT", commissionPct: "3.75" },
      } },
    ],
  });
