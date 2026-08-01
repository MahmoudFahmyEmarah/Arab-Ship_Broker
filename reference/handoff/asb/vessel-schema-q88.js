// asb/vessel-schema-q88.js
// Canonical vessel data model aligned to BIMCO Baltic 99 / Q88 (Dry cargo, Long Form).
// BACKEND / DATABASE CONTRACT: every ship conforms to this same structure, all fields nullable.
// The frontend Vessel step writes only a subset (the "minimum capture set"); Bosun / Q88 import
// fills the rest, and "verified" flips true when the Q88 is complete.
// `legacy` maps each canonical field to the current registry/frontend key so existing records
// keep working while the database adopts Q88 canonical column names.
// Exposed on window.PP2Schema. Loaded as plain JS after pp2-data.js.
(function(){
  var MAX_HOLDS = 9;   // maximum number of holds per ship
  var MAX_CRANES = 4;  // maximum number of cranes / derricks
  var MAX_GRABS = 5;   // maximum number of grabs

  // Repeating shape for one hold (index 1..MAX_HOLDS).
  var HOLD_SHAPE = [
    { key:"grainCapacity", label:"Grain capacity", type:"number", unit:"m3" },
    { key:"baleCapacity", label:"Bale capacity", type:"number", unit:"m3" },
    { key:"tanktopGrabDischarge", label:"Tanktop suitable for grab discharge", type:"yesno" },
    { key:"co2Fitted", label:"CO2 fitted", type:"yesno" },
    { key:"smokeDetection", label:"Smoke detection", type:"yesno" },
    { key:"hoppered", label:"Hoppered", type:"object", of:[
      { key:"side", label:"Side", type:"yesno" },
      { key:"fwd", label:"Forward bulkhead", type:"yesno" },
      { key:"aft", label:"Aft bulkhead", type:"yesno" }
    ]},
    { key:"grainFitSolasVI", label:"Grain fit per SOLAS ch. VI (no bagging)", type:"yesno" },
    { key:"a60Bulkhead", label:"A60 steel bulkhead", type:"yesno" }
  ];

  // Field: { key (Q88 canonical), label (Q88 term), type, unit?, enumKey?, legacy?, min?, max?, of? }
  var SECTIONS = [
    { id:"identity", title:"Identity and registration", fields:[
      { key:"imo", label:"IMO number", type:"string", legacy:"imo" },
      { key:"vesselName", label:"Name of vessel", type:"string", legacy:"name" },
      { key:"previousNames", label:"Previous name(s) and date of change", type:"list" },
      { key:"vesselType", label:"Type of vessel", type:"enum", enumKey:"vesselType", legacy:"type" },
      { key:"hullType", label:"Type of hull", type:"enum", enumKey:"hullType" },
      { key:"flag", label:"Flag", type:"string", legacy:"flag" },
      { key:"portOfRegistry", label:"Port of registry", type:"string" },
      { key:"callSign", label:"Call sign", type:"string" },
      { key:"mmsi", label:"MMSI", type:"string" }
    ]},
    { id:"ownership", title:"Ownership and operation chain", fields:[
      { key:"registeredOwner", label:"Registered owner (full style)", type:"string", legacy:"regOwner" },
      { key:"parentGroup", label:"Parent company / group", type:"string" },
      { key:"technicalOperator", label:"Technical operator / ISM manager", type:"string", legacy:"ismManager" },
      { key:"commercialOperator", label:"Commercial operator / Manager", type:"string", legacy:"manager" },
      { key:"disponentOwner", label:"Disponent owner (TC / BB)", type:"string" }
    ]},
    { id:"build", title:"Build and classification", fields:[
      { key:"dateDelivered", label:"Date delivered (built)", type:"date", legacy:"built" },
      { key:"builder", label:"Builder (where built) / yard number", type:"string" },
      { key:"classSociety", label:"Classification society", type:"string", legacy:"classSociety" },
      { key:"classNotation", label:"Class notation", type:"string" },
      { key:"lastDryDock", label:"Last dry dock", type:"date" },
      { key:"nextDryDock", label:"Next dry dock due", type:"date" },
      { key:"specialSurvey", label:"Next special survey", type:"date" }
    ]},
    { id:"dimensions", title:"Dimensions", fields:[
      { key:"loa", label:"Length overall (LOA)", type:"number", unit:"m", legacy:"loa" },
      { key:"lbp", label:"Length between perpendiculars (LBP)", type:"number", unit:"m" },
      { key:"beam", label:"Extreme breadth (beam)", type:"number", unit:"m", legacy:"beam" },
      { key:"mouldedDepth", label:"Moulded depth", type:"number", unit:"m" },
      { key:"ktm", label:"Keel to masthead (air draft)", type:"number", unit:"m" }
    ]},
    { id:"tonnage", title:"Tonnage and deadweight", fields:[
      { key:"gt", label:"Gross tonnage (GT)", type:"number", legacy:"grt" },
      { key:"nrt", label:"Net registered tonnage (NRT)", type:"number" },
      { key:"suezGt", label:"Suez gross tonnage (SCGT)", type:"number" },
      { key:"suezNt", label:"Suez net tonnage (SCNT)", type:"number" },
      { key:"panamaNt", label:"Panama net tonnage (PCNT)", type:"number" },
      { key:"summerDwt", label:"Summer deadweight (SDWT)", type:"number", unit:"MT", legacy:"dwt" },
      { key:"dwcc", label:"Deadweight cargo capacity (DWCC)", type:"number", unit:"MT", legacy:"dwcc" },
      { key:"grainCapacity", label:"Grain capacity (total)", type:"number", unit:"m3", legacy:"grainCbm" },
      { key:"baleCapacity", label:"Bale capacity (total)", type:"number", unit:"m3", legacy:"dwtBale" }
    ]},
    { id:"loadline", title:"Loadline, draft and TPC", fields:[
      { key:"summerDraft", label:"Summer draft (SW)", type:"number", unit:"m", legacy:"draft" },
      { key:"winterDraft", label:"Winter draft", type:"number", unit:"m" },
      { key:"tropicalDraft", label:"Tropical draft", type:"number", unit:"m" },
      { key:"freshDraft", label:"Fresh water draft", type:"number", unit:"m" },
      { key:"tpc", label:"Tonnes per cm (TPC)", type:"number" },
      { key:"fwa", label:"Fresh water allowance (FWA)", type:"number", unit:"mm" },
      { key:"lightship", label:"Lightship", type:"number", unit:"MT" }
    ]},
    { id:"holds", title:"Holds and hatches", fields:[
      { key:"numHolds", label:"Number of holds", type:"number", legacy:"numHolds", min:1, max:MAX_HOLDS },
      { key:"numHatches", label:"Number of hatches", type:"number", legacy:"numHatches", min:1, max:MAX_HOLDS },
      { key:"boxShaped", label:"Holds box-shaped", type:"yesno", legacy:"boxShaped" },
      { key:"hatchType", label:"Make and type of hatch covers", type:"enum", enumKey:"hatchType", legacy:"hatchType" },
      { key:"strengthenedHeavy", label:"Strengthened for heavy cargoes", type:"yesno", legacy:"strengthenedHeavy" },
      { key:"holdsMayBeEmpty", label:"Which holds may be left empty", type:"string", legacy:"holdsMayBeEmpty" },
      { key:"logsFitted", label:"Fitted for logs", type:"yesno", legacy:"logFitted" },
      { key:"holds", label:"Per-hold detail (1..9)", type:"array", max:MAX_HOLDS, of:HOLD_SHAPE }
    ]},
    { id:"gear", title:"Cargo gear", fields:[
      { key:"geared", label:"Vessel geared", type:"yesno", legacy:"isGeared" },
      { key:"craneCount", label:"Number of cranes / derricks", type:"number", legacy:"craneCount", min:0, max:MAX_CRANES },
      { key:"craneSwl", label:"Max SWL per crane", type:"number", unit:"MT", legacy:"craneSwl" },
      { key:"craneMakeType", label:"Make and type of cranes", type:"string" },
      { key:"numGrabs", label:"Number of grabs", type:"number", legacy:"numGrabs", min:0, max:MAX_GRABS },
      { key:"grabCapacity", label:"Grab capacity", type:"number", unit:"m3", legacy:"grabCapacity" },
      { key:"kickPlate", label:"Kick-plate fitted", type:"yesno", legacy:"kickPlate" }
    ]},
    { id:"machinery", title:"Machinery and consumption", fields:[
      { key:"engineMake", label:"Main engine make / model", type:"string" },
      { key:"bhpMcr", label:"BHP at MCR", type:"number" },
      { key:"serviceSpeed", label:"Service speed", type:"number", unit:"kn", legacy:"serviceSpeed" },
      { key:"meConsSea", label:"ME consumption at sea", type:"number", unit:"MT/d", legacy:"meConsSea" },
      { key:"meConsPort", label:"ME consumption in port", type:"number", unit:"MT/d", legacy:"meConsPort" },
      { key:"auxConsPort", label:"Aux consumption in port", type:"number", unit:"MT/d", legacy:"auxConsPort" },
      { key:"fuelType", label:"Fuel type / grade", type:"string", legacy:"fuelType" },
      { key:"bunkersRob", label:"Bunkers remaining on board (ROB)", type:"number", unit:"MT", legacy:"brob" }
    ]},
    { id:"commercial", title:"Commercial position", fields:[
      { key:"charterType", label:"Charter type", type:"enum", enumKey:"charterType", legacy:"charterType" },
      { key:"status", label:"Status", type:"enum", enumKey:"status", legacy:"status" },
      { key:"openPort", label:"Open port", type:"string", legacy:"openPort" },
      { key:"openLocode", label:"Open port UN/LOCODE", type:"string", legacy:"openLocode" },
      { key:"openFrom", label:"Open from", type:"date", legacy:"openFrom" },
      { key:"openTo", label:"Open to", type:"date", legacy:"openTo" },
      { key:"direction", label:"Next direction", type:"string", legacy:"direction" },
      { key:"tradingZone", label:"Trading zone", type:"string", legacy:"tradingZone" }
    ]},
    { id:"contact", title:"Communications and contact", fields:[
      { key:"contactAddress", label:"Contact address", type:"string", legacy:"contactAddress" },
      { key:"phone", label:"Phone", type:"string", legacy:"phone" },
      { key:"email", label:"Email", type:"string", legacy:"email" },
      { key:"charteringEmail", label:"Chartering email", type:"string", legacy:"charteringEmail" },
      { key:"website", label:"Website", type:"string", legacy:"website" }
    ]},
    { id:"insurance", title:"Insurance", fields:[
      { key:"piClub", label:"P&I club (full style)", type:"string" },
      { key:"piCoverage", label:"P&I coverage", type:"string" },
      { key:"hmPlacedWhere", label:"H&M placed where", type:"string" },
      { key:"hmInsuredValue", label:"H&M insured value", type:"number" }
    ]},
    { id:"inspections", title:"Inspections and history", fields:[
      { key:"rightShipApproved", label:"RightShip approved", type:"yesno" },
      { key:"lastRightShip", label:"Last RightShip inspection", type:"date" },
      { key:"lastPsc", label:"Last PSC inspection", type:"date" },
      { key:"pscDetained12m", label:"Detained by PSC (12 months)", type:"yesno" },
      { key:"amsaDetentions", label:"AMSA detentions / deficiencies", type:"string" },
      { key:"casualty12m", label:"Casualty / pollution history (12 months)", type:"string" },
      { key:"ispsLevel", label:"ISPS security level", type:"string" }
    ]},
    { id:"meta", title:"Registry meta", fields:[
      { key:"verified", label:"Q88 verified", type:"yesno", legacy:"verified" },
      { key:"source", label:"Data source", type:"string", legacy:"source" },
      { key:"riskNotes", label:"Risk notes", type:"string", legacy:"riskNotes" }
    ]}
  ];

  // legacy registry key -> canonical Q88 key
  var LEGACY = {};
  SECTIONS.forEach(function(sec){ sec.fields.forEach(function(f){ if(f.legacy) LEGACY[f.legacy] = f.key; }); });

  function blankFromShape(shape){
    var o = {};
    shape.forEach(function(f){
      if(f.type === "object") o[f.key] = blankFromShape(f.of);
      else if(f.type === "array") o[f.key] = [];
      else if(f.type === "list") o[f.key] = [];
      else o[f.key] = null;
    });
    return o;
  }

  // Every ship gets the same typical structure, all fields nullable.
  function blankVessel(){
    var o = {};
    SECTIONS.forEach(function(sec){
      sec.fields.forEach(function(f){
        if(f.type === "array"){
          o[f.key] = [];
          for(var i = 0; i < (f.max || 0); i++) o[f.key].push(blankFromShape(f.of || []));
        } else if(f.type === "object"){
          o[f.key] = blankFromShape(f.of || []);
        } else if(f.type === "list"){
          o[f.key] = [];
        } else {
          o[f.key] = null;
        }
      });
    });
    return o;
  }

  // Conform a sparse registry record to the full Q88 structure (legacy keys mapped to canonical).
  function normalizeVessel(rec){
    rec = rec || {};
    var v = blankVessel();
    Object.keys(rec).forEach(function(k){
      var canon = LEGACY[k] || (v.hasOwnProperty(k) ? k : null);
      if(canon && rec[k] != null && rec[k] !== "") v[canon] = rec[k];
    });
    // terminology normalisation: legacy "Cargo Ship" maps to canonical "General Cargo"
    if(v.vesselType === "Cargo Ship") v.vesselType = "General Cargo";
    return v;
  }

  function canonicalFromLegacy(k){ return LEGACY[k] || null; }

  window.PP2Schema = {
    SECTIONS: SECTIONS,
    HOLD_SHAPE: HOLD_SHAPE,
    MAX_HOLDS: MAX_HOLDS,
    MAX_CRANES: MAX_CRANES,
    MAX_GRABS: MAX_GRABS,
    LEGACY: LEGACY,
    blankVessel: blankVessel,
    normalizeVessel: normalizeVessel,
    canonicalFromLegacy: canonicalFromLegacy
  };
})();
