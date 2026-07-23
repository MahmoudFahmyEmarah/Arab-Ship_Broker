
  const PP2 = window.PP2 || {};
  const alto = PP2.findVesselByIMO ? PP2.findVesselByIMO("9145786") : null;

  window.mountBrokerLedger({
    rootId: "led-root",
    registryKey: "PP2Steps",
    bosunKey: "PP2Bosun",
    exToPatchKey: "PP2exToPatch",
    storageKey: "asb.led.vessel.v1",
    eyebrow: "Post Position",
    title: "List a vessel's open position",
    subtitle: "The minimum a charterer needs to match and estimate. The platform and Bosun AI fill in the rest.",
    icon: "Vessel",
    submitLabel: "Post position",
    submitToast: "Position posted for matching",
    initialState: () => ({ entryMode: null, vesselImo: null, vessel: null }),
    draftLabel: (s) => {
      const v = s.vessel;
      if (v && (v.name || v.imo)) return (v.name || "Vessel") + (v.imo ? " (" + v.imo + ")" : "");
      return "Untitled position";
    },
    steps: [
      { id: "vessel", title: "Vessel", hint: "Identity, tonnage, ownership.",
        mand: [ (s) => s.entryMode === "tbn" ? !!(s.tbn && s.tbn.type) : !!(s.vessel && (s.vessel.name || s.vessel.imo)), (s) => s.entryMode === "tbn" ? !!(s.tbn && s.tbn.dwt) : !!(s.vessel && s.vessel.dwt), (s) => s.entryMode === "tbn" ? !!(s.tbn && s.tbn.type) : !!(s.vessel && s.vessel.type), (s) => s.entryMode === "tbn" ? !!(s.tbn && s.tbn.flag) : !!(s.vessel && s.vessel.flag) ],
        opt: [ (s) => !!(s.vessel && s.vessel.built), (s) => !!(s.vessel && s.vessel.classSociety), (s) => !!(s.vessel && s.vessel.verified), (s) => !!(s.ownership && s.ownership.registeredOwner) ] },
      { id: "arrangement", title: "Arrangement", hint: "Holds, hatches, configuration.",
        mand: [ (s) => !!(s.arrangement && s.arrangement.numHolds), (s) => !!(s.arrangement && s.arrangement.boxShaped), (s) => !!(s.arrangement && s.arrangement.hatchType), (s) => !!(s.arrangement && s.arrangement.strengthenedHeavy), (s) => !!(s.arrangement && s.arrangement.logFitted) ],
        opt: [ (s) => !!(s.arrangement && s.arrangement.config), (s) => !!(s.arrangement && s.arrangement.numHatches) ] },
      { id: "availability", title: "Availability", hint: "Status, open port, dates, zone.",
        mand: [ (s) => !!(s.availability && s.availability.status), (s) => !!(s.availability && s.availability.openPort && s.availability.openPort.locode), (s) => !!(s.availability && s.availability.openFrom) ],
        opt: [ (s) => !!(s.availability && s.availability.charterType), (s) => !!(s.availability && s.availability.wog), (s) => !!(s.availability && s.availability.nextDirection) ] },
      { id: "performance", title: "Performance", hint: "Fuel, consumption, speed.",
        mand: [],
        opt: [ (s) => !!(s.performance && s.performance.fuelType), (s) => !!(s.performance && s.performance.serviceSpeed), (s) => !!(s.performance && s.performance.meConsSea), (s) => !!(s.performance && s.performance.meConsPort), (s) => !!(s.performance && s.performance.auxPort), (s) => !!(s.performance && s.performance.brob) ] },
      { id: "gear", title: "Gear", hint: "Cranes, grabs.",
        mand: [ (s) => !!(s.gear && s.gear.geared != null), (s) => (s.gear && s.gear.geared) ? !!s.gear.craneCount : null, (s) => (s.gear && s.gear.geared) ? !!s.gear.craneSwl : null ],
        opt: [ (s) => (s.gear && s.gear.geared) ? !!s.gear.grabs : null, (s) => (s.gear && s.gear.geared) ? !!s.gear.numGrabs : null, (s) => (s.gear && s.gear.geared) ? !!s.gear.kickPlate : null ] },
      { id: "review", title: "Review", hint: "Confirm and post." },
    ],
    templates: [
      alto ? { name: "Reuse ALTO SUMMER profile", sub: "Handysize, geared, R.Sea", patch: { vessel: { ...alto }, vesselImo: alto.imo, entryMode: "fleet" } } : null,
      { name: "Standard geared Handysize (TBN)", sub: "28,000 DWT · 4 holds · 2×30t", patch: {
        vessel: { name: "", type: "Bulk Carrier", dwt: 28000, built: "", flag: "", verified: false, source: "Template" },
        arrangement: { config: "Geared Bulk Carrier", numHolds: 4, numHatches: 4, boxShaped: "Y", hatchType: "folding", strengthenedHeavy: "Y", logFitted: "N", _source: "user" },
        gear: { geared: true, craneCount: 2, craneSwl: 30, grabs: true, numGrabs: 2, grabCapacity: 8, _source: "user" },
      } },
    ].filter(Boolean),
    recents: [
      { label: "VLSFO", patch: (s) => ({ performance: { ...(s.performance || {}), fuelType: "VLSFO", _source: "user" } }) },
      { label: "Status: Open", patch: (s) => ({ availability: { ...(s.availability || {}), status: "Open" } }) },
      { label: "Zone: Red Sea North", patch: (s) => ({ availability: { ...(s.availability || {}), openZone: "Red Sea North" } }) },
      { label: "Charter: TCT", patch: (s) => ({ availability: { ...(s.availability || {}), charterType: "TCT" } }) },
    ],
    reposts: alto ? [
      { label: "ALTO SUMMER — Hodeidah, last week", patch: { vessel: { ...alto }, vesselImo: alto.imo, entryMode: "fleet", availability: { status: "Open", openZone: "Red Sea North", wog: true } } },
    ] : [],
  });
