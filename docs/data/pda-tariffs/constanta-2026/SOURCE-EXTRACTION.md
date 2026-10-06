# Constanta (CN APM) port tariffs: PDA extraction for a bulk carrier

Source: PyMuPDF text of the official portofconstantza.com tariff pages, "valid as from 15.09.2026", printed 9/13/26.
Folder: PyMuPDF text of each PDF inside `tmp/Data/ROMANIA PORTS.zip` (re-extracted one by one; the shared catalogue index for these files is broken, see catalogue C).
Everything in quotes is verbatim. Numbers are copied as printed, including the decimal separator. Nothing is rounded or inferred.

**Duplicate check:** `1_10.Port_of_Constanta.txt` and `1_10.0Port_of_Constanta.txt` (the file name has no dot after "0") are identical except for the eight page-footer print timestamps (`9/13/26, 8:54 AM` in one, `9/13/26, 8:55 AM` in the other). `diff` shows nothing else. The tariff content is identical.

---

## Index (root_Port_of_Constanta.txt), 3 lines
1. "Tariff conditions for the services provided by C.N. A.P.M. S.A. Constanța ... in the ports it manages, on behalf of vessels flying the Romanian and foreign flags - valid as from 15.09.2026" (1/3).
2. Chapter 1 lists 1.1 Access, 1.2 Key, 1.3 Basin, 1.4 Unique tariffs for the use of port infrastructure, 1.5 Special, 1.6 Utilities/services, 1.7 Superstructure, 1.8 Anti-pollution dams, 1.9 Waste from ships, 1.10 Pilotage (1/3).
3. Chapters 2 to 5 cover rents, EU 352/2017 ancillary tariffs, public-domain rentals and telecoms. "Towage tariffs" is a separate link (3/3). 1.4, 1.6, 1.7 and 1.8 exist in the folder but were outside this brief.

## Towage (root_TOWAGE_Port_of_Constanta.txt), 3 lines
1. Since 1 Aug 2012, CN APM provides towage "through specialized and authorised operators, under the contracts concluded between our company and these operators" (1/1).
2. Operators: HARBOUR TOWAGE S.R.L. CONSTANTA, COMPANIA DE REMORCARE MARITIMA COREMAR S.A, SANTIERUL NAVAL MIDIA S.A. (shipyard vessels only) and S.C. BLACK SEA SERVICES S.R.L. CONSTANTA (1/1).
3. **No towage rates are on this page.** It only links to each operator's own tariff ("Tariffs Harbour Towage S.R.L. Constanta", etc.), and those tariffs were not extracted.

---

## 1.1 Access tariff (1_1.Port_of_Constanta.txt, 9 pages)

- **Title (1/9):** "CHAPTER III - BASIC PORT TARIFFS" / "1. The access price in the port of Constanta ..."
- **Unit as printed:** `€/UTB` on every row. The prose says "EURO/UGT" (4/9). **Currency:** EUR.
- **Basis (1/9):** "is applied to the ship's GT, for each entry of the ship into the port, except for the situations provided for in Chapter I, point 8, depending on the type of ship and differentiated by GT groups, according to the table below:"

### Table 1: standard access (pages 1/9 to 3/9). The decimal separator is a **point**.
| Nr | Vessel type | U/M | 0-5000 | 5001-10000 | 10001-20000 | 20001-45000 | 45001- 70000 | >70000 |
|---|---|---|---|---|---|---|---|---|
| **1** | **Bulk carrier ← APPLIES** | €/UTB | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 |
| 2 | Tank / LPG | €/UTB | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 |
| 3 | Cargo | €/UTB | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 |
| 4 | Container | €/UTB | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 |
| 5 | RoRo / Ferryboat | €/UTB | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 |
| 6 | Passenger | €/UTB | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 |
| 7 | Military | €/UTB | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 | 0.155 |

The band edge "45001- 70000" has a space after the hyphen, as printed.

### Table 1.1: liners / liner service with at least 4 ships (3/9 to 4/9). The decimal separator is a **comma**. No bulk carrier row.
| Nr | Vessel type | U/M | 0-5000 | 5001-10000 | 10001-20000 | 20001-45000 | 45001- 70000 | >70000 |
|---|---|---|---|---|---|---|---|---|
| 1 | Cargo | €/UTB | 0,078 | 0,078 | 0,078 | 0,078 | 0,078 | 0,078 |
| 2 | Container | €/UTB | 0,078 | 0,078 | 0,078 | 0,078 | 0,078 | 0,078 |
| 3 | RoRo/Ferryboat | €/UTB | 0,078 | 0,078 | 0,078 | 0,078 | 0,078 | 0,078 |
| 4 | Passenger | €/UTB | 0,078 | 0,078 | 0,078 | 0,078 | 0,078 | 0,078 |

Qualifier (2/9): "1.1 For liners (which meet the conditions set out in Chapter II, point 1.1), for ships in liner service (which meet the conditions set out in Chapter II, point 1.2 and belong to ship- owners/charterers who operate this service with a minimum of 4 ships - monthly calls), the access price is applied as follows:"

### Table 1.2: liner service with 2-3 ships (4/9 to 5/9). Comma separator. No bulk carrier row.
| Nr | Vessel type | U/M | 0-5000 | 5001-10000 | 10001-20000 | 20001-45000 | 45001- 70000 | >70000 |
|---|---|---|---|---|---|---|---|---|
| 1 | Cargo | €/UTB | 0,109 | 0,109 | 0,109 | 0,109 | 0,109 | 0,109 |
| 2 | Container | €/UTB | 0,109 | 0,109 | 0,109 | 0,109 | 0,109 | 0,109 |
| 3 | RoRo/Ferryboat | €/UTB | 0,109 | 0,109 | 0,109 | 0,109 | 0,109 | 0,109 |
| 4 | Passenger | €/UTB | 0,109 | 0,109 | 0,109 | 0,109 | 0,109 | 0,109 |

### Table 1.3: liner service with a single ship (5/9 to 6/9). Comma separator. No bulk carrier row.
| Nr | Vessel type | U/M | 0-5000 | 5001-10000 | 10001-20000 | 20001-45000 | 45001- 70000 | >70000 |
|---|---|---|---|---|---|---|---|---|
| 1 | Cargo | €/UTB | 0,124 | 0,124 | 0,124 | 0,124 | 0,124 | 0,124 |
| 2 | Container | €/UTB | 0,124 | 0,124 | 0,124 | 0,124 | 0,124 | 0,124 |
| 3 | RoRo/Ferryboat | €/UTB | 0,124 | 0,124 | 0,124 | 0,124 | 0,124 | 0,124 |
| 4 | Passenger | €/UTB | 0,124 | 0,124 | 0,124 | 0,124 | 0,124 | 0,124 |

### Table 1.4: new call within 30 days, or leaving and returning (6/9 to 9/9). Comma separator.
| Nr | Vessel type | U/M | 0-5000 | 5001-10000 | 10001-20000 | 20001-45000 | 45001- 70000 | >70000 |
|---|---|---|---|---|---|---|---|---|
| **1** | **Bulk carrier ← APPLIES (re-call ≤30 days)** | €/UTB | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 |
| 2 | Tank / LPG | €/UTB | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 |
| 3 | Cargo | €/UTB | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 |
| 4 | Container | €/UTB | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 |
| 5 | RoRo / Ferryboat | €/UTB | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 |
| 6 | Passenger ship | €/UTB | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 |
| 7 | Military | €/UTB | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 | 0,132 |

### Conditions (verbatim)
- (6/9) "1.4 For ships that make a new port call within 30 days of the previous one (taking the departure date as a reference), for ships that leave the harbor and return to the port to continue operations (loading, unloading, repairs, etc.), the access price is applied as follows:"
- (4/9) "The same rate of 0.078 EURO/UGT applies to ships that call only for bunkering operations, crew change and disembarkation of sick persons, for ships that enter and exit the harbor directly to/from shipyards for repairs or delivery to the beneficiary (without having started the call in the port where the shipyard is located, for any reason other than entering the shipyard and/or without having continued the call in the port where the respective shipyard is located, for any reason after leaving the shipyard), as well as for ships that leave the shipyard for sea trials, following which they will return directly to the shipyard immediately after their completion. If the ships stay a maximum of 24 hours in the inner harbor of the port for operations other than commercial ones (i.e. bunkering, crew change, formalities) after which they enter directly into the shipyard exclusively for repair works, the access price will also be in the amount of 0.078EURO/UGT."
- (4/9) "The tariff also applies to inland navigation (river) passenger ships whose port call does not exceed 48 hours."
- (4/9) "The same tariff also applies to Ro-Ro ships regardless of the GT, in line service and which make at least 4 calls / month in ports managed by NC MPA."
- No minimum, maximum or cap is printed for access.

### Inconsistencies (1.1)
- The unit is printed "€/UTB" in the tables but "EURO/UGT" in the prose (4/9). UTB/UGT are the Romanian abbreviations for GT, so these are probably the same unit.
- Table 1 uses a point ("0.155"). Tables 1.1 to 1.4 use a comma ("0,078", "0,132").
- The six GT bands carry the same rate in every table, so the banding has no effect on access.

---

## 1.2 Key / dockage tariff (1_2.Port_of_Constanta.txt, 6 pages)

- **Title (1/6):** "Basic port tariffs - Key tariff". Prose: "2. The dockage fee in the port of Constanta ..."
- **Unit as printed:** `€/m-day`. **Currency:** EUR.
- **Basis (1/6), verbatim:** "applies to the maximum length of the ship (LOA) and the number of days of call in the port, depending on the type of ship and the TB group in which the ship falls, as follows:"

### Non-bulk tables (1/6 to 3/6). Comma separator.
| Nr | Vessel type | U/M | 0-5000 | 5001-10000 | 10001-20000 | 20001-45000 | 45001- 70000 | >70000 |
|---|---|---|---|---|---|---|---|---|
| 2.1 | Tank ***** / LPG | €/m-day | 8,094 | 15,565 | 17,806 | 23,527 | 33,122 | 35,115 |
| 2.2 | Port container* | €/m-day | 7,469 | 8,472 | 8,749 | 8,963 | 9,496 | 10,030 |
| 2.3 | RoRo / Ferryboat**** | €/m-day | 5,852 | 7,223 | 7,720 | 8,468 | 8,717 | 9,339 |
| 2.4 | Sea passenger** | €/m-day | 10,585 | 10,585 | 10,585 | 10,585 | 10,585 | 10,585 |
| 2.5 | Inland navigation passenger*** | €/m-day | 6,349 | 6,349 | 6,349 | 6,349 | 6,349 | 6,349 |
| 2.6 | Military | €/m-day | 11,830 | 11,830 | 11,830 | 11,830 | 11,830 | 11,830 |

### 2.7 Bulk carriers (3/6 to 4/6) ← APPLIES
Lead-in (3/6): "2.7 Bulk carriers will be charged as follows:"

**(a) Listed bulk cargoes.** The cargo class, verbatim (3/6): "- when operating the following bulk cargoes: coal and derivatives, phosphates, apatite, iron ore, bauxite (or other derivatives), including when berthing at the quay and not carrying out commercial operations (e.g. barn cleaning), the following dockage fees apply:"

| Vessel type (as printed) | U/M | 0-5000 | 5001-10000 | 10001-20000 | 20001-45000 | 45001- 70000 | >70000 |
|---|---|---|---|---|---|---|---|
| **Bulk cargo** | €/m-day | 3,735 | 5,852 | 9,960 | 11,204 | 18,673 | 26,142 |

**(b) Other cargoes.** Verbatim (4/6): "- when operating other cargoes than those mentioned in the previous paragraph, the following dockage fees apply:"

| Vessel type (as printed) | U/M | 0-5000 | 5001-10000 | 10001-20000 | 20001-45000 | 45001- 70000 | >70000 |
|---|---|---|---|---|---|---|---|
| **Bulk carrier** | €/m-day | 1,867 | 2,927 | 4,981 | 5,602 | 9,336 | 13,071 |

(c) Ukrainian storage, verbatim (4/6): "- when storing goods originating from Ukraine and staying in the port for at least 30 days, a dockage fee of 3.174 Euro/m - day is applied."

The (b) rates are about half of (a) (for example 3,735 → 1,867). That is an observation only, not a printed rule.

### 2.8 Cargo ships (4/6 to 5/6)
- Listed cargoes, verbatim (4/6): "- when operating the following bulk cargoes: coal and derivatives, phosphates, apatite, iron ore, bauxite, the following dockage fees apply:" Note that "(or other derivatives)" and the idle-berthing clause are **absent** here.

| Vessel type | U/M | 0-5000 | 5001-10000 | 10001-20000 | 20001-45000 | 45001- 70000 | >70000 |
|---|---|---|---|---|---|---|---|
| Cargo (listed bulk) | €/m-day | 3,921 | 4,673 | 6,914 | 7,090 | 7,282 | 7,522 |
| Cargo (other) | €/m-day | 2,614 | 3,116 | 4,609 | 4,727 | 4,855 | 5,015 |

- Other-cargo lead-in, verbatim (5/6): "- when operating any other type of cargo (other than those provided for in the previous paragraph), including when berthing at the quay and not carrying out commercial operations, the dockage fees apply as follows:"

### Footnotes and conditions (verbatim)
- (3/6) "*for container ships, regardless of the GT, whose port call does not exceed 12 hours, a dockage fee of 5.292 EURO/m is applied."
- (3/6) "**for passenger ships, regardless of the GT, whose port call does not exceed 12 hours, a dockage fee of 5.292 EURO/m is applied."
- (3/6) "***for passenger ships of inland navigation (river) whose port call does not exceed 48 hours, a dockage fee of 3.174 EURO/m - day is applied."
- (3/6) "****for Ro-Ro ships, regardless of the GT, in liner service and making 4 or more calls/month in the administered seaports, a dockage fee of 3.174 EURO/m - day is applied."
- (3/6) "***** for tankers used for the storage of edible crude sunflower oil through direct transshipment (loading) operations of cargo originating from Ukraine, a dockage fee of 3.174 euros/ml - day is applied."
- Mixed cargo (5/6): "A ship of any type that during the loading or unloading operation handles several types of cargo during the same call, the dockage fee is applied depending on the type of ship and the type of cargo that has the highest quantitative weight during loading or unloading."
- Repair / idle / 2nd line (5/6 to 6/6): "For ships in one of the following situations: - ships that call at the port only for repair work carried out at the quay (outside the Shipyard), based on a repair permit issued by the Harbour Master; - ships that during a call carry out repair work in addition to commercial operations, but only during the period when they do not carry out loading/unloading operations in parallel; - seagoing ships that are stationed (not carrying out commercial operations) in the 2nd and following lines;" ... "For the period (days) in which the vessels are in the above-mentioned situations, the dockage fee is applied as follows:"
  - **TRUNCATED:** the page 6/6 text ends right after "as follows:". No rate or table follows in the extraction. The rate for these situations is missing.
- **How the charge is computed:** the only computation text is the basis sentence above: "applies to the maximum length of the ship (LOA) and the number of days of call in the port". The unit is "€/m-day". **Nothing printed** says whether a started day counts as a full day, and **no minimum charge or minimum days** is printed in 1.2.

### Inconsistencies (1.2)
- The basis sentence says "the TB group in which the ship falls". Every other section says "GT group". The tables use GT-style bands.
- The 2.7 tables label the vessel type "Bulk cargo" for (a) and "Bulk carrier" for (b), even though both belong to the bulk carrier section.
- The prose footnotes use a point ("5.292", "3.174") while the tables use a comma. The container/passenger 12-hour fee is "EURO/m" with no "- day". The tanker footnote says "euros/ml - day", where "ml" probably means linear metre.
- The numbering starts at "Nr: 2.1". There is no "2.7" row label inside the table; 2.7 is a prose heading.

---

## 1.3 Basin tariff (1_3.Port_of_Constanta.txt, 4 pages)

- **Title (1/4):** "Basic port tariffs - Basin tariff". Prose: "3. The dock tariff in the port of Constanta ..."
- **Unit as printed:** `€/UTB`. **Currency:** EUR.
- **Basis (1/4), verbatim:** "is applied to the maximum length of the ship (LOA) and the number of days of call in the port, depending on the type of ship and the GT group in which the ship falls, as follows:"

| Nr | Vessel type (as printed) | U/M | 0-5000 | 5001-10000 | 10001-20000 | 20001-45000 | 45001- 70000 | >70000 |
|---|---|---|---|---|---|---|---|---|
| **1** | **Bulk carrier*** ← APPLIES** | €/UTB | 0,651 | 0,576 | 0,534 | 0,501 | 0,480 | 0,448 |
| 2 | Tank**** / LPG | €/UTB | 0,790 | 0,747 | 0,683 | 0,651 | 0,640 | 0,619 |
| 3 | Cargou | €/UTB | 0,459 | 0,320 | 0,267 | 0,224 | 0,213 | 0,203 |
| 4 | Cargo | €/UTB | 0,427 | 0,309 | 0,256 | 0,224 | 0,213 | 0,203 |
| 5 | RoRo / Ferryboat** | €/UTB | 0,373 | 0,309 | 0,224 | 0,203 | 0,181 | 0,171 |
| 6 | Passenger* | €/UTB | 0,534 | 0,534 | 0,534 | 0,534 | 0,534 | 0,534 |
| 7 | Military | €/UTB | 0,534 | 0,534 | 0,534 | 0,534 | 0,534 | 0,534 |

### Footnotes (verbatim)
- (3/4) "*for passenger ships whose port call does not exceed 12 hours, a dock tariff of 0.267 EURO/m - day is applied."
- (3/4) "*for inland navigation passenger ships (river) whose port call does not exceed 48 hours, a dock tariff of 0.267 EURO/m - day is applied."
- (4/4) "**for Ro-Ro ships, regardless of GT, in liner service and making 4 or more calls/month in ports managed by NC MPA, a dock tariff of 0.267 Euro/m - day is applied."
- (4/4) "*** for bulk carriers that store goods originating from Ukraine and stay in port for at least 30 days, a dock tariff of 0.267 Euro/m - day is applied."
- (4/4) "**** for tankers used for the storage of edible crude sunflower oil through direct transshipment (loading) operations of cargo originating from Ukraine, a pool tariff of 0.267 euro/ml - day is applied."
- No minimum, cap, or per-entry versus per-day rule is printed beyond the basis sentence.

### Inconsistencies (1.3), the key issue
- The unit is **"€/UTB"** (per GT) on every row, but the basis sentence says **"is applied to the maximum length of the ship (LOA) and the number of days of call in the port"** (1/4), and the footnotes give **"EURO/m - day"**. The unit and the computation basis contradict each other. The same LOA × days sentence appears in 1.2, so it may have been copied over from there.
- Row 3 is labelled "Cargou" (Romanian spelling) and has rates that differ from row 4 "Cargo". What row 3 is meant to cover is not stated. It may be a mislabelled general-cargo or bulk-on-cargo row.
- The prose calls it "dock tariff" and also "pool tariff" (4/4), while the page title says "Basin tariff".

---

## 1.5 Special tariffs: safety and security (1_5.Port_of_Constanta.txt, 1 page)

- **Title (1/1):** "Special tariffs". **Currency:** EUR.
- Item 1, verbatim (1/1): "1. Tariff for safety and security during the operation of ships in the port of Constanta (Constanta area, Midia area, Mangalia area and partially Basarabi area) - applies to each ship that performs loading/unloading operations in the port berths belonging to the Administration, including those operating in the Ferry – Boat berth (berth 120) and for each call of the ship in a port, as follows:"

| Category (verbatim) | Rate as printed | Unit as printed | Minimum |
|---|---|---|---|
| **for seagoing vessels ← APPLIES** | 0.080 | EURO/UGT | "(but not less than 215 EURO/ship)" |
| for inland navigation vessels for cargo transport | 0.355 | EURO/100TC | — |
| for seagoing/river passenger vessels | 0.128 | EURO/UGT | — |
| for inland navigation (river) passenger vessels, whose call in the port does not exceed 48 hours | 0.064 | EURO/UGT | — |
| for Ro-Ro ships in liner service and making 4 or more calls/month in ports managed by NC MPA | 0.064 | EURO/UGT | — |

- Verbatim bulk line (1/1): "- for seagoing vessels = 0.080 EURO/UGT (but not less than 215 EURO/ship);"
- The charge applies **per call** and **only when the ship loads or discharges at Administration berths** ("applies to each ship that performs loading/unloading operations in the port berths belonging to the Administration"). Whether a bulk carrier at a private or concession terminal is liable is not stated.
- Item 2, the passenger terminal (5.000 EURO/passenger sea, 2.500 river, 1.250 river ≤48 h), and item 3, the scanner fee ("2.00 euros/container"), do not apply to a bulk carrier.

---

## 1.9 Ship-generated waste reception (1_9.Port_of_Constanta.txt, 7 pages)

- **Title (1/7):** "SHIP WASTE RECEPTION TARIFFS". **Currency:** EUR.
- Scope, verbatim (1/7): "1. The indirect ship waste reception tariff applies to all seagoing vessels, regardless of the flag they fly, calling at or operating in one of the Romanian ports, ... a cost paid for the provision of services related to port reception facilities, regardless of whether or not they deliver waste to a port reception facility, with the exception of the following categories of vessels:"
- **Exempt (1/7):** "- vessels engaged in port services within the meaning of art. 1 paragraph (2) of Regulation (EU) 2017/352 ..." and "- military ships, auxiliary military ships or other ships owned or operated by the state and which are used exclusively for non-commercial governmental purposes."
- Excluded waste (1/7): "The indirect tariff does not include waste from exhaust gas purification systems, the costs of which are covered based on the types and quantities of waste delivered, according to art. 8 letter f) of GO no. 9/2022."
- Components (1/7): "- Fixed component applied per call," / "- Variable component applied to the GRT of the ship (maximized at 35,000 GRT)."

### Table no. 1: indirect tariff (1/7), as printed
| | INDIRECT TARIFF | VALUE | LIMIT |
|---|---|---|---|
| A | Fixed component | 191 EUR/call | n.a. |
| B | Variable component | 0.027 EUR/GRT | maximum 35.000 GRT |
| A + B | Indirect tariff | 191 EUR + 0.027 EUR/GRT | maximum 1.136 EUR |

The GRT cap is printed "35,000" in the prose and "35.000" in the table. The maximum "1.136 EUR" uses a point as the thousands separator; it equals 191 + 0.027 × 35000 = 1136. Read it as one thousand one hundred thirty-six euros, not 1.136.

### Reductions (verbatim)
- (2/7) "1.1. 50% reduction of the total indirect tariff (fixed component + variable component) for maritime vessels that meet the following criteria (Table no. 2):" Table no. 2 lists green criteria: MEPC.295(71) sorting, sustainable procurement, alternative fuels/shore power, "White Box" < 5 ppm, OWS < 5 ppm, OWS < 5 ppm + alarm for ships < 10,000GT, all bilge to PRF, MEPC.227(64) sewage treatment, no sewage discharge, reuse/recycling on board. Evidence named includes Green Award, ISO 21070, ISO 14001, CSI, Green Marine and Blue Angel (2/7 to 4/7).
- (4/7) "1.2. 75% reduction of the fixed component of the indirect tariff, in the amount of 47.75 euros/call for ships sailing on a regular or scheduled service, based on a regular schedule announced in advance."

### Direct delivery fees (verbatim)
- (4/7) "2. The direct tariff for receiving waste from ships applies to all ships, regardless of the flag they fly, that call at or operate in one of the Romanian ports and deliver waste from ships."
- (5/7) "... the port administration does not charge any direct tariff for this waste, in order to ensure a right of delivery without additional tariffs based on the volume of waste delivered, except in the case where the volume of waste delivered exceeds the maximum storage capacity provided for in the form in Annex no. 2, for which the direct tariff of 25 euros/m3 will be applied; passively fished waste falls under this regime, including the right of delivery."
- (5/7) "For these categories of ships, NC MPA SA charges a collector ship rental of 335 euros/hour, respectively, the direct tariff for receiving waste from ships, of 25 euros/m3." Here "these categories" means "Ships that do not fall within the scope of GO no. 9/2022 (technical, river, military vessels)".
- (6/7) "4. The minimum waste transfer rate must be 5 m3 / hour;"
- (6/7) "A - Duration of the service x collector ship rental (335 euros/hour)" / "B - Quantity of waste x direct tariff for taking over waste from ships (25 euros/m3)" / "Total: A + B"
- (6/7) "2. For transfer rates of waste less than 5 m3/hour (point 5 of the organizational and technical conditions) a 50% increase in the direct tariff is charged;"
- (6/7) "3. For interventions in accidental pollution of the dock, a 100% increase in the rent for the service vessel is charged."
- (5/7) "1. Liquid waste collection services are provided, upon notification issued by the agent/ship-owner, once per call for maritime vessels falling within the scope of GO No. 9/2022 ..."
- (6/7) "1. Waste collection services from seagoing vessels are provided every 2 days during the period June - September and 4 days during the period October - May;"
- (6/7) "4. Normal working hours are on weekdays between 08:00 and 16:00; on Saturdays, Sundays and non-working days, between the same hours, only from vessels leaving the port on these days;"
- (6/7 to 7/7) "1. For the volume of waste delivered that exceeds the maximum storage capacity of the ship, provided for in the form in Annex 2 to GO no. 94/2022 ... the tariff of 25 euro/m  will be applied, for each m  of waste delivered."
- (7/7) "• The quantity of waste invoiced will be at least 2 m /service." This minimum is stated for port, technical and river ships.
- (7/7) "5. For services requested and performed outside of office hours, a 100% increase in the cost of the service is charged (tariff applied to the quantity of waste collected)."

### Garbled or inconsistent text (1.9)
- The superscript "3" became detached: "25 euro/m  will be applied, for each m  of waste delivered." followed by stray lines "3" / "3" (6/7), and "at least 2 m /service" with stray "3" lines (7/7). These read as m³.
- "GO no. 94/2022" (6/7) should be "GO no. 9/2022", which the rest of the page cites.
- "point 5 of the organizational and technical conditions" (6/7), but the SNTP list has only points 1 to 4. The 5 m3/hour rule is point 4.
- "75% reduction ... in the amount of 47.75 euros/call" (4/7): 47.75 is 25 % of 191, so it is the **amount payable after** the reduction, not the reduction itself. The wording is ambiguous.

---

## 1.10 Pilotage (1_10.Port_of_Constanta.txt, 8 pages)

- **Title (1/8):** "MARITIME VESSEL PILOTAGE TARIFFS". "The rates for the pilotage of maritime and river-maritime vessels are as follows:"
- **Unit as printed:** the header reads "Base tariff for the pilotage of maritime vessels (euro/piloted UGT)" and the M/u column reads "euros /UTB/maneuver". **Currency:** EUR. Comma separator.

| Tariff name | M/u | 0 - 5000 (*) | 5001 - 10000 | 10001 - 20000 | 20001 - 45000 | 45001 - 70000 | > 7000 [sic] |
|---|---|---|---|---|---|---|---|
| Base tariff for the pilotage of maritime vessels (euro/piloted UGT) | euros /UTB/maneuver | 0,102(*) | 0,067 | 0,047 | 0,041 | 0,037 | 0,037 |

This is the only table, and it applies to all vessel types including bulk carriers. **Garbled:** the last band edge is extracted as ">" / "7000", meaning "> 7000". It is almost certainly ">70000", but it is printed as "7000". The table header is also split across lines ("10001" / "-" / "20000").

### What counts as a manoeuvre/service (verbatim)
- (1/8) "(*) In the 0-5000 group, the minimum payment for the pilotage service is 114 euro/ship/service of entry, exit or movement from one berth to another."
- (1/8) "The tariffs apply for each arrival/departure/movement maneuver of ships in the port."
- Operations table, read as from / to / classification:
  1. "Outer dock" → "Inner dock": "Port entry maneuver" (1/8)
  2. "Inner dock" → "Outer dock": "Port exit maneuver" (1/8)
  3. "Outer dock" → "Mooring at the port berth": "Port entry" (1/8)
  4. "Berth inside the port" → "Outer dock": "Port exit maneuver" (2/8)
  5. "Km 0 – CDMN" → "Port berth": "Port entry maneuver" (2/8)
  6. "Port berth" → "Km 0 – CDMN": "Port exit maneuver" (2/8)
  7. "Outer dock" → "Km 0 – PAMN- MN channel": "Port entry maneuver" (2/8)
  8. "Km 0 – PAMN- MN channel" → "Outer dock": "Port exit maneuver" (2/8)
  9. "Inner dock" → "Port berth": "Port entry maneuver" (2/8)
  10. "Port berth" → "Inner dock": "Port exit maneuver" (2/8)

  Rows 11 to 16 cover foreign tugs, barge convoys, shipyard manoeuvres, oil platforms and technical vessels. Row 14 (3/8): "It is charged as long as the pilotage service is provided to a vessel that crosses the port waters to the border of the shipyards and vice versa."
- **Minimum:** only the 0-5000 group has one: "114 euro/ship/service". No minimum is printed for larger bands.

### Surcharges (verbatim, 7/8)
- "The following increases to the pilotage tariffs apply:"
- "• 30% for maneuvers performed on Saturdays, Sundays and public holidays"
- "• 10% for maneuvers performed at night between 10:00 PM and 06:00 AM"
- "• 15% for maneuvers on ships transporting dangerous and radioactive goods, except for maneuvers on ships specialized for the transport of flammable gases and liquids in bulk"
- "• 100% for maneuvers on ships without the main engine running, except for cases of pulling ropes from one berth to another - increased difficulty in performing the maneuver"
- Row 19 (6/8): "The reference base for calculating the service will be considered the start time of the maneuver, and the night period is considered between 10.00 PM-06.00 AM (inclusive)."

### Return discount (verbatim)
- (7/8) "The following discounts apply:" / "• 10% for ships returning to the port of Constanta and its areas in less than 30 days"
- Row 17 (5/8): "10% reduction from the basic tariff" / "It is also taken into account for moving maneuvers from one berth to another, including the departure maneuver, if these maneuvers are carried out within 30 days of the last entry into the port, in case the entry benefits from the 10% reduction. When applying the 10% reduction, the time of completion of the departure maneuver related to the call and the time of completion of the berthing maneuver related to the next call are considered as the calculation basis."

### Cancellation (verbatim)
- (1/8) "When canceling the pilotage service (when the pilot is already on the ship) half (50%) of the tariff will be charged."
- Row 20 (7/8): "... a tariff equivalent to 50% of the pilotage tariff will be applied, except for the group 0-5000 where a tariff of 50% of the minimum payment value for the pilotage service will be applied."

### Exemptions (verbatim, 7/8)
- "- Romanian and foreign military ships;" / "- ships used for a public service, maintenance or navigation control and surveillance, as well as those used in cases of danger and flooding;" / "- school, hospital and sports ships."

### Other
- Row 18 (6/8) gives a GT formula for hulls without documents: "GT = (0.2 + 0.021og10V) x V". This is **garbled**: it should be "0.02 log10V", the standard Tonnage-69 formula. Then "V = L x B x D x 0.9".

### Inconsistencies (1.10)
- The unit appears as both "euro/piloted UGT" and "euros /UTB/maneuver".
- The band edge "> 7000" (see above).
- The page does not state whether surcharges stack (for example weekend 30 % plus night 10 %), or whether the 114 € minimum is applied before or after surcharges.

---

## Open questions for the package author
1. **Basin tariff 1.3 unit:** the rows say "€/UTB" (per GT), but the text says LOA × days and the footnotes say "EURO/m - day". Should it be GT × rate per call, or something else? Check against the 1.3 PDF or the Romanian original. Also, what is row 3 "Cargou" versus row 4 "Cargo"?
2. **Dockage 1.2:** how are days counted (calendar day, started day, 24 h block), and is there a minimum? Nothing is printed. The rate for repair, idle and 2nd-line ships is cut off at page 6/6.
3. **Dockage cargo class:** for a bulk carrier on grain or another non-listed cargo, use 2.7(b) "Bulk carrier" (1,867…13,071). For coal, phosphates, apatite, iron ore or bauxite "(or other derivatives)", use 2.7(a) "Bulk cargo". Decide whether "derivatives" covers coke, pet-coke, pellets or alumina.
4. **Pilotage:** confirm the last band is ">70000" (printed "> 7000"). Confirm whether a standard bulk call is two manoeuvres (entry and exit) or more (outer dock → inner dock → berth). The operations list allows split legs (rows 1 + 9, 10 + 2). Confirm whether surcharges stack and how they interact with the 114 € minimum.
5. **Safety and security 1.5:** it applies only at "port berths belonging to the Administration". Does it apply at private or concession bulk terminals (for example Comvex)? The 215 € minimum is per ship per call.
6. **Waste 1.9:** read "maximum 1.136 EUR" as 1,136 EUR. The 47.75 €/call figure is the residual fixed component after the 75 % reduction. The "GO 94/2022" and "point 5" references are typos.
7. **Access:** check whether "Chapter I, point 8" exclusions (General Principles, not extracted) and the 1.4 Unique tariffs page (in the folder, not extracted) override access, dockage or basin charges for some calls.
8. **Towage** has no CN APM tariff. Operator tariff sheets (Harbour Towage, Coremar, Black Sea Services) must be obtained separately.
9. **Separators are mixed:** in the tables, "0.155" uses a point and "0,132" uses a comma for decimals, while in prose "1.136 EUR" and "35.000 GRT" use a point as a thousands separator. Parse each value by context, not with a single rule.
