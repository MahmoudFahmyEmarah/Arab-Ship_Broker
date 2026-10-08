# Turkey PDA tariff extraction (bulk carrier, foreign flag, international voyage, TCDD/state port)

Extracted 7 Oct 2026. Read-only: the ZIP was read in memory with Python `zipfile`; nothing was extracted into the repository.
Text dumps (python-docx, with every table printed cell by cell as `Rn: c1 | c2 | ...`) are in
`(agent scratch folder)

Conventions used below:
- "Location" means the docx table number (`[TABLE n]`, counted in document order) and row (`Rn`), or "para after Table n". Word documents have no fixed pages, so no page numbers are given.
- Every number and quote is copied exactly as printed, including the source's spelling mistakes, typos and decimal separators (Turkish `,` decimal and `.` thousands in most files; `.` decimal in T8). "[sic]" marks a printed typo that is reproduced as is.
- Anything that is not printed is stated as "not printed".

## 0. Source register

Container: `D:\ASB_Projects\Arab Shipborker\Arabshipbroker\tmp\Data\TURKISH PORTS.zip`
SHA-256 (whole zip): `18a55c3a39bd43db70fb87d6a2ecf11f0a32d10e3c7e36e212fe7337ecbd6dcb`

| Cat. | Member path (inside zip) | Bytes | SHA-256 of member bytes |
|---|---|---|---|
| T1 | `TURKISH PORTS/AGENCY SERVICE FEE.docx` | 25327 | `b057513680fb84ad4049eb94343fec25bbd1bbd6ab28576990b4aa37c5141133` |
| T2 | `TURKISH PORTS/LIGHT DUES.docx` | 15685 | `5ff72329609234ebc82306491bdc8bd8a8746d47644f466dfbe0eb552ff04bc4` |
| T6 | `TURKISH PORTS/PORT DUES (For the year 2026).docx` | 13603 | `2c59f6cb11c6499d51f25af11bfe50c805d4a9517a03120315cc9a8b3bb1d87a` |
| T7 | `TURKISH PORTS/SANITARY DUES.docx` | 23467 | `e915f2f478941bfba23fcf338e9c78b183af6003933ec827bcd707f91ae02597` |
| T8 | `TURKISH PORTS/Supervision Services .docx` (note trailing space before `.docx`) | 18587 | `d8047a685ec03d80b4a7241cf8fc478658fd94c9efa7d70cf2090968d5244ce7` |
| T11 | `TURKISH PORTS/TAXES ON FREIGHT AND CONTRIBUTION TO THE CHAMBER OF SHIPPING.docx` | 15434 | `a6af58725caf232abd0680259a42585c7f119fc8e507521bb895c278e2c132ba` |
| T12 | `TURKISH PORTS/TCDD PORT TARIFF.docx` | 61656 | `a2f89a5fede22d8e34fcb3d94ea67d066fefdec6e5629b0d64075601a392c93a` |
| (T5, cross-check) | `TURKISH PORTS/PILOTAGE TARIFF.docx` | 27797 | `04ea08725480d40ebf465c2a854c66f8f04211162793ad48b0f19389da63545f` |
| (T9, cross-check) | `TURKISH PORTS/TARIFF FOR WHARFAGE SERVICES (Occupation  –  Unlawful Occupation).docx` | 31639 | `f811368d6da8e2a289ebc7611186d16528a38ac537ffe0c66742cfcac805f43b` |

Zip member names are UTF-8 decoded from the cp437 names the zip stores.

## 1. Authority map and dating (read this first)

| Charge | Doc / section | Authority as printed | Date as printed | Currency |
|---|---|---|---|---|
| Port dues | T6 | **not printed** (no issuer named) | "For the year 2026" | TL |
| Agency fee, port call | T1 Table 8 | "Tarrif No: 1 Agency Services as per official Gazette No: 32314 dated 19.09.2023" | 19.09.2023 | EURO |
| Protecting agency, port call | T1 Table 9 | "Tarrif No:2 Agency Services as per official Gazette No: 26812 dated 10.03.2008" | 10.03.2008 | EURO |
| Light + salvage dues | T2 | "(Source: Web site of Directorate General of Coastal Safety)" = KEGM | **undated** | US Dollar |
| Sanitary dues | T7 | Gazette "9.5.2008 No: 26871"; exemptions from "Web Site of Türkiye Hudut ve Sahiller Sağlık Genel Müdürlüğü" | 2008 regulation (formula) | USD x daily rate (TL implied) |
| Supervision | T8 | "Tarrif No:5 Supervision Services as per official Gazette No: 26812 dated on 10.03.2008" | 10.03.2008 | EURO |
| Freight tax / Chamber of Shipping | T11 | **not printed** | Chamber share "(For the year 2026)"; freight tax **undated** | % / US Dollars |
| Pilotage/towage/mooring/wharfage, **TCDD** ports | T12 §1, Tables 1-4 | "(Source: TCDD Port Services Tariff)" | **undated** | USD |
| Pilotage/towage/mooring/anchoring, **KEGM** ports (Istanbul, Canakkale, Gelibolu, Izmir, Marmara) | T12 §2, Tables 5-9 | "(Source: Tariff for Pilotage, Towage and Other Services of Kıyı Emniyeti Genel Müdürlüğü)" | **undated** | US Dollar |
| Wharfage, **TDİ** (Istanbul Sarayburnu, Kuruçeşme only) | T12 §3, Table 10 | "(Source: Tariff of Türkiye Denizcilik İşletmeleri A.Ş)" | **undated** | USD (+ TL boat fee) |
| Pilotage/towage/mooring/wharfage/anchoring, **Ministry** (privatised/other ports) | T12 §4, Tables 11-17 | "TARIFF PUBLISHED BY MINISTRY OF TRANSPORT, MARITIME AFFAIRS AND COMMUNICATION" | **undated** | US Dollar, paid in TL |
| Waste | T12 §5, Tables 18-19 | "MINISTRY OF ENVIRONMENT AND URBANIZATION" | "Published on Official Gazette dated 5 June 2009 and no: 27249; valid as of 1.1.2010" | € |

Private terminals: T12 §4 (Ministry tariff) is the only set that is not tied to a named state operator. Its mooring table is titled "(Mersin, İskenderun and İzmit Bay Ports)" and its wharfage table "(For All Ports)". No operator-specific private-terminal tariff (berth hire, cargo handling, ISPS, security) is in the package.

---

## 2. PORT DUES (T6)

- Title: "PORT DUES (For the year 2026)"
- Issuer: not printed. Effective: "For the year 2026". Currency/unit: "TL" per call (flat amount per tonnage band; the band basis is printed as "tonage vessels"; the only basis named is in the footnote, "NT").

Table 1 (exact):

| Band (as printed) | Amount |
|---|---|
| 11-500            tonage vessels | 1.283,90 TL |
| 501-2.000       tonage vessels | 3.424,00 TL |
| 2.001-4.000   tonage vessels | 6.848,10 TL |
| 4.001-8.000   tonage vessels | 10.272,20 TL |
| 8.001-10.000   tonage vessels | 17.120,40 TL |
| 10.001-30.000   tonage vessels | 34.240,90 TL |
| 30.001-50.000   tonage vessels | 51.361,40 TL |
| 50.000 over tonage vessels | 85.602,30 TL |

Condition (para after Table 1): "Vessels up to 10 NT are exemption from Port dues."

Not printed: frequency (per call / per year / per entry), validity period of a payment, holiday/overtime rules, who collects. Band edge at 50.000 appears in both "30.001-50.000" and "50.000 over".

---

## 3. AGENCY SERVICE FEE (T1)

File header: "AGENCY SERVICE FEE" / "(Tarrif No:3 Agency Services as per official Gazette No: 32314 dated on 19.09.2023)" (this header belongs to the Straits-passage table, Table 1).

### 3.1 Tariff No 1, port calls (Table 8) - applies to the bulk carrier call

Heading: "AGENCY SERVICE FEE (Tarrif No: 1 Agency Services as per official Gazette No: 32314 dated 19.09.2023)" / "BASIC FEES FOR THE VESSELS IN THE PORTS AND/OR TERRITORIAL WATERS"

| Vessel's Net Tonnage | Basic fees per each call in EURO |
|---|---|
|        0 –   500 | 600 |
|    501 –  1000 | 1000 |
|  1001 –  2000 | 1500 |
|  2001 –  3000 | 1850 |
|  3001 –  4000 | 2300 |
|  4001 –  5000 | 2750 |
|  5001 –  7500 | 3200 |
|  7501 – 10000 | 4000 |
| 10001 – 20000 in addition per each 1000 NT or fraction thereof | 125 |
| 20001 – 30000 in addition per each 1000 NT or fraction thereof | 100 |
| Over 30001 in addition per each 1000 NT or fraction thereof | 75 |

Conditions (paras after Table 8, verbatim):
- " a) The above basic fees are charged for vessel’s stay in ports and/or territorial waters up to 7 (seven) calendar days (inclusive) irrespective of reason of stay."
- " b) When a vessel’s stay exceeds 7 (seven) days, 20 % (twenty percent) of the basic fees will be added for each period of 5 (five) days or fraction thereof exceeding 7 (seven) days."
- "c) Except for special inspections and services to be requested by the ship owners, 30% (thirty) is added to the basic rates in case of general average ,  collision, grounding, fire, rescue-assistance,"
- "d)A reduction of 40% ( fourty percent) on the basic fees can be applied to passanger vessels only."
- " e) A 50% (fifty) discount can be made for container ships belonging to a line that proves regular voyages."

Not printed: whether the per-1,000 NT increments are cumulative (10001-20000 at 125, then 20001-30000 at 100, ...) or whether the whole tonnage above 10000 takes one rate; no maximum/cap.

### 3.2 Tariff No 2, protecting agency, port calls (Table 9)

Heading: "PROTECTING AGENCY SERVICE (Tarrif No:2 Agency Services as per official Gazette No: 26812 dated 10.03.2008)" / "BASIC FEES FOR THE VESSELS IN THE PORTS AND/OR TERRITORIAL WATERS"

| Vessel's Net Tonnage | Basic fees per each call in EURO |
|---|---|
|        0 –   500 | 300 |
|    501 –  1000 | 500 |
|  1001 –  2000 | 750 |
|  2001 –  3000 | 925 |
|  3001 –  4000 | 1150 |
|  4001 –  5000 | 1375 |
|  5001 –  7500 | 1600 |
|  7501 – 10000 | 2000 |
| 10001 – 20000 in addition per each 1000 NT or fraction thereof | 63 |
| 20001 – 30000 in addition per each 1000 NT or fraction thereof | 50 |
| Over  30001 in addition per each 1000 NT or fraction thereof | 38 |

Conditions (verbatim): "a) ... up to 7 (seven) calendar days (inclusive) irrespective of reason of stay."; "b)      When a vessel’s stay exceeds 7 (seven) days, 20 % (twentyfive percent) of the basic fees will be added for each period of 5 (five) days or fraction thereof exceeding 7 (seven) days." [sic: "20 %" vs "twentyfive"]; "c) ... 30% (thirty) is added to the basic rates in case of general average ,  collision, grounding, fire, rescue-assistance," (text ends there; no d/e printed).
Note: the heading cites the **2008** Gazette 26812, while Tariff 1 cites the 2023 Gazette 32314.

### 3.3 Other T1 content (Straits / other agency services) - only if relevant

- Table 1, Tariff No 3, Straits passage (per passage through one Strait, EURO): "0 –   1000 | 200", "1001 –   2000 | 290", "2001 –   3000 | 340", "3001 –   4000 | 400", "4001 –   5000 | 460", "5001 –   7500 | 560", "7501 –  10000 | 640", "10001 – 20000 per 1000NT or fraction thereof | 30", "20001 – 30000per 1000NT or fraction thereof | 20", "Over 30001additionalper 1000NT or fraction thereof | 10". Notes: "A-These basic fees are for one passage through on of the Straits irrespective of direction."; "C- An additional 30% of the agency fee is charged for ships passing the Turkish Straits with escort, escorted passage and/or towing of ships and marine vessels."
- Table 2, Tariff No 4 protecting agency, Straits: 100 / 146 / 170 / 200 / 230 / 280 / 320, then 15 / 10 / 5 per 1000NT (same bands as Table 1).
- Tariff No 8 "Other Agency Services" (Gazette 32314, 19.09.2023) carries the scope line "(The services under this article are applied to the vessels passing through straits of Bosphorus and /or Dardanelles)". Items as printed: "Bunker supply and slop delivery attendance fee of 250. - Euro is charged in case the      service is rendered to vessel at anchorage."; "5-Cash to Master: 1,5 % (one percent) of the delivery amount, minimum 150" [sic: "1,5 %" vs "(one percent)"]; Spare parts "1.00 Euro ... per kilo ... minimum 150.- Euro and maximum 500.- Euro"; "2) COMMUNICATION:  Minimum 100-200"; "3)  LOCAL PHONE CALLS AND POSTAGE, FISCAL STAMPS ETC 100-200 (per voyage)"; "5) CONTRIBUTION TO THE MARITIME ASSOCIATION OF SHIP OWNERS AND AGENTS:  For the up and down passage 10".

---

## 4. SUPERVISION SERVICES (T8)

- Title: "(Tarrif No:5 Supervision Services as per official Gazette No: 26812 dated on 10.03.2008)" / "FOR VESSELS IN THE PORTS AND/OR TERRITORIAL WATERS:"
- Issuer: the Gazette tariff (agency tariff). Effective: 10.03.2008. Currency/unit: "EURO/Per Metric Ton" (Table 1 R1), per unit where stated.

Table 1 (columns 1-2 are a merged label; amount in column 3). Bulk rows first:

| Location | Row text (exact) | EURO |
|---|---|---|
| R2 | A- CARGO IN BULK: | |
| R3 | a)  Dry Cargo (Ores, minerals, scraps, pig iron, coal, carob, animal feeds, oil cakes, cement, clinger, pumice stones, artificial fertilizers, slag ) | |
| R4 | I-   0 up to 10000 tons | 0.15 |
| R5 | II-   10001 up to 20000 tons | 0.10 |
| R6 | III-   For part over 20000 tons | 0.05 |
| R7 | b) Grains and Seeds (Wheat, barley, oats, rye, rice, corn, sunflower, soya beans, vetches) | |
| R8 | I-   Up to 10000 tons | 0.10 |
| R9 | II-  10001 up to 25000 tons | 0.075 |
| R10 | III-  For part over 25000 tons | 0.045 |
| R11 | c) Pulses (Broad beans, black eyed beans, beans, lentils, chickpeas) | |
| R12 | I-  0 up to 5000 tons | 0.30 |
| R13 | II-  For part over 5000 tons | 0.15 |
| R14-17 | d) Crude oil and petroleum products: I- Up to 15000  tons / II- 15001 up to 35000 tons / III- For part over 35000 tons | 0.040 / 0.030 / 0.015 |
| R18-20 | e)  LPG and LNG gasses: I- 0 up to 15000 tons / II- For part over 15000 tons | 0.15 / 0.05 |
| R21 | f) Chemical products (including petroleum derivates) Wine, olive oil, molasses, edible liquid oil, mineral oil, tallow | 0.15 |
| R22 | B) CARGO NOT IN BULK (The below mentioned) | |
| R23-25 | a)  Grains and flour, artificial fertilizers, sugar, cement, rice, semolina, carob, minerals, marvel blocks.: I- Up to 20000 tons / II- For part over 20000 tons | 0.15 / 0.05 |
| R26 | b)  Fresh fruits and vegetables, citrus, frozen food | 1,00 |
| R27 | c)   Pulses and Seeds | 0.60 |
| R28-31 | d) Paper, iron and steel products and semi-finished products (...): I- 0 up to 5000 tons / II- 5001 up to 10000 tons / III- For part over 10000 tons | 0.25 / 0.15 / 0.10 |
| R32-35 | e) Wood logs and heavy logs: I- 0 up to 3000 tons / II- 3001 up to 5000 tons / III- For part over 5001 tons | 0.50 / 0.35 / 0.10 |
| R36 | C) EMPTY CONTAINERS AND EMPTY TRAILERS (Euro per unit) | 10.00 |
| R37-39 | D) LIVESTOCK ( Euro per unit ): a) Small heads / b) Large heads | 0.05 / 0.15 |
| R40-42 | E) OTHER CARGO, VARIOUS CARGO CARRIED IN THE SAME VESSEL: I-- In case the carrier pays the cost of loading and/or discharging / II- In case the shipper and/or consignee pays ... | 1.00 / 0.60 |
| R43-45 | F)  ALL KIND OF CARGO CARRIED IN CONTAINERS (Including all above): euro / Unıt; transit container | 15.00; 15.00 |
| R46-50 | G) MOTOR CARS ... EURO /Per unit: 0 up to 50 units / 51 up to 300 units / Over  301 units | 5.00 / 3.00 / 1.50 |
| R51-52 | H) MOBILE VEHICLES AND CONSTRUCTION MACHINERY CARRIED BY RO – RO VESSELS, Per linear meter of the vehicle | 3.00 |

Minimum / maximum (Table 1 R53, verbatim): "I) To be calculated according to the above mentioned base rates If the total surveillance fee is less than 300.- (Three hundred) Euro, 300 Euro is charged If the surveillance fee is more than EUR 10.000, the surveillance fee is applied as EUR 10.000."
Other conditions (R45): "• Lines handling over 50.000 full containers per year are exempt from this fee" (containers only).
Marginal wording: bands III read "For part over ..." (marginal); bands I-II read "0 up to" / "10001 up to" without "for part" wording. Note T8 uses `.` as decimal separator except R26 "1,00".

---

## 5. LIGHT DUES + SALVAGE DUES (T2) - Turkish Straits transit

- Title: "LIGHT DUES" / "(Agean / Black Sea and/or vice - versa)"
- Issuer: "(Source: Web site of Directorate General of Coastal Safety)" (KEGM). Effective: undated. Currency/unit: "Per NT" / "US Dollar".

| Band | US Dollar per NT |
|---|---|
| Up to 800 NT | 2,814 |
| Over 800 NT | 1,407 |
| SALVAGE DUES: ( Up and Down Passage) | 0,67 |

Conditions (verbatim):
- "Dues for lighthouses and rescue services mentioned above are for double-passage from the Straits. Nevertheless, if a commercial vessel passes through the straits later than 6 months as from its entry to the straits for one passage, then such vessel shall pay relevant fees and dues for the second time and fully, notwithstanding to any difference thereof."
- "If a commercial vessel declares in its departure passage that it would not return in non-stopover, one half of the dues only shall be paid by such vessel."
- Exemption 1: "Foreign flag vessels with a Net Register Tonnage of up to 30 tons (excluding NT of 30 tons)"
- Exemption 7: "Changes of location within the same port for voyage of entry, or entry-exit circumstances within the same port during loading, unloading of those ships, having already paid up port entry dues."
- Exemption 8 (ends): "... will become exempted from port dues only."
- Exemption 10: "Dues payable for such vessels with a tonnage exceeding tonnage of exemption shall be calculated on basis of their total net tonnage"
- "Such vessels passing through in non-stopover as defined herein, shall pay non-stopover dues in 7 calendar days commencing from the day of their initial passage to the Strait of Çanakkale or the Strait of İstanbul. However, if the payment is due on an official holiday, non-stopover dues shall be fulfilled on the following working day."
- Transit status: "...they allowed to stay 168 hours to provide free pratique that they are authorized by the traffiv Control Center."

Not printed: whether "Up to 800 NT / Over 800 NT" is marginal (first 800 NT at 2,814, rest at 1,407) or whole-tonnage; any **port-call** (non-transit) light dues rate for a vessel calling a Turkish port without transiting the Straits.

---

## 6. SANITARY DUES (T7)

- Title: "SANITARY DUES". Issuer/source: "(Source: Official Gazette: 9.5.2008 No: 26871-Application Regulation of Vessel Sanitary Due)"; exemption list "(Source: Web Site of Türkiye Hudut ve Sahiller Sağlık Genel Müdürlüğü)". Effective: 2008 regulation; amounts depend on the daily USD rate.
- Formula (verbatim, two lines):
  - " 0,5025 ( 1 Gold Franc = 6,70 ABD Doları x 0,075 (montreux convention ) = 0,5025 "
  - "0,5025 x US Dollar daily buying rate x vessel’s NT"
- Unit: per NT; result is in TL by implication of "US Dollar daily buying rate" (the source rate (CBRT or other) is not printed).

Conditions (verbatim):
- " *    If transit nature of a vessel exercising transit return right is changed, then it shall pay full free vessel sanitary due."
- "*    Transit vessel sanitary dues paid by the vessel for which transit nature is changed shall be completed to the amount of free vessel sanitary due."
- "*     If transit vessels returns from the direction they went within six months as transit and submit due receipt or other document during their entry into Turkish straits, transit sanitary due is not collected again. ..."
- " *    Transit sanitary due shall be paid not later than within three working days from the date of passage from straits."
- Exemption 3: "Vessels taking refuge at Turkish Ports for compelling reasons like adverse weather conditions, machine failure, accidents and fires and do not perform any commercial operation at the refuge taking Turkish Ports,"
- Exemption 4: "Vessels which are less than 50 NT (including vessels which are 50 NT ),"

Not printed: separate "free vessel" (port call) vs "transit" rates; the formula is a single line. Frequency per call is not printed.

---

## 7. TCDD PORT TARIFF compendium (T12)

### 7.1 §1 TCDD PORT TARIFF (TCDD ports) - "(Source: TCDD Port Services Tariff)", undated

**A. PILOTAGE SERVICES** - "USD / PER  SERVICE" (Table 1). Column headers print the base+increment structure:

| Vessel's GRT | Transit Cargo, RO/RO, Turist, Car Carrier Vessels "116+46" | Container Vessels "153+65" | Other Cargo Vessels "197+81" |
|---|---|---|---|
| 1-1000 | 116 | 153 | 197 |
| 1001-2000 | 162 | 218 | 278 |
| 2001-3000 | 208 | 283 | 359 |
| 3001-4000 | 254 | 348 | 440 |
| 4001-5000 | 300 | 413 | 521 |
| 5001-6000 | 346 | 478 | 602 |
| 6001-7000 | 392 | 543 | 683 |
| 7001-8000 | 438 | 608 | 764 |
| 8001-9000 | 484 | 673 | 845 |
| 90001-10000 [sic] | 530 | 738 | 926 |

**B. TOWAGE SERVICES** - "USD / PER SERVICE" (Table 2):

| Vessel's GRT | Transit Cargo, RO/RO, Turist, Car Carrier "224+40" | Container "299+56" | Other Cargo Vessels "373+70" |
|---|---|---|---|
|       0 –    1000 | 224 | 299 | 373 |
| 1001 –   2000 | 264 | 355 | 443 |
| 2001 –   3000 | 304 | 411 | 513 |
| 3001 –   4000 | 344 | 467 | 583 |
| 4001 –   5000 | 384 | 523 | 653 |
| 5001 –   6000 | 424 | 579 | 723 |
| 6001 –   7000 | 464 | 635 | 793 |
| 7001 –   8000 | 504 | 691 | 863 |
| 8001 –   9000 | 544 | 747 | 933 |
| 9001 – 10000 | 584 | 803 | 1003 |

Tables stop at 10,000 GT; beyond that only the header "base+increment" is printed (no "per each 1000 GT" sentence in §1).

"APPLICATION PRINCIPLES:" (after Table 2, verbatim):
- "1- Pilotage, to take tugboat obligations of vessels and ratios of exemptions are determined by Port Statutes, Regulations and Instructions."
- "2- Aforementioned fees are charged with 50% addition in New Year day, Religious and National Holidays and 1st of May, Labor and Collaboration day."
- "3- Pilotage and tugboat service fees for tankers carrying fuel and other explosive, inflammable and combustible substances and tankers which did not perform gas-free operation are charged with 30% addition."
- "4- Pilotage and tugboat services during shifting from one wharf to another are charged with 50% discount."
- "5- (Class1) for vessels carring expolosive products pilotage&towage expenses will %100 surcharged."
- "6-Towage service fee for other cargo vessels in haydarpaşa a Port is fixed as 255 USD up to 3000 gt ; radio for each other further 1000 GT  is charged as 48 USD."
- "7- The vessels with active operating bow thruster and stern thruster receive single tugboat. (If compliance certificate is granted by classification institution of the vessel, developed systems such as Azipod Propeller systems are considered as stern thruster.)"
- **"8- For vessels over 80.000 GT, the fees of 80.000 GT are applied."**
- "9- GT’s specified on table are applied as displacement tonnages for war-ships."

**C. MOORING SERVICES** "(USD / Mooring – Unmooring)" (Table 3), header "ALL TYPE OF VESSELS" "(22+11)":
"0 –   1000 | 22", "1001 –  2000 | 33", "2001 –  3000 | 44", "3001 –  4000 | 55", "4001 –  5000 | 66", "5001 –  6000 | 77", "6001 –  7000 | 88", "7001 –  8000 | 99", "8001 –  9000 | 110", "9001 – 10000 | 121".
Notes (verbatim): "1-Aforementioned fees are charged with 50% addition in New Year day, Religious and National Holidays and 1st of May, Labor and Collaboration day."; "2- The fees specified on table are applied for once for mooring and unmooring."; "3- Mooring service fee for tankers carryingfuel and other explosive, inflammable and combustible substances and tankers which did not perform gas-free operation are charged with 30% addition."; "4- (Class 1) for vessels carriyng explosive products pilotage & towage expenses will % 100 surcharged"; **"5-For vessels over 80.000 GT, the fees of 80.000 GT are applied"**; "6-GT’s specified on table are applied as displacement tonnages for war-ships."

**D. WHARFAGE SERVICE** "USD / PER SERVICE" (Table 4). Headers: "Wharfage" "10+10"; "Unlawful Occupation" "1000gt/ hour 20+20":

| Vessel's GRT | Wharfage | Unlawful Occupation |
|---|---|---|
|       0 –  1000 | 10 | 20 |
| 1001 –  2000 | 20 | 40 |
| 2001 –  3000 | 30 | 60 |
| 3001 –  4000 | 40 | 80 |
| 4001 –  5000 | 50 | 100 |
| 5001 –  6000 | 60 | 120 |
| 6001 –  7000 | 70 | 140 |
| 7001 –  8000 | 80 | 160 |
| 8001 –  9000 | 90 | 180 |

Scope text: "This tariff includes harboring services of vessels and lash ships which docks, stern docks to the wharfs and piers, roping the vessels to buoy or breakwatersor anchoring within or approaching to wharfs and piers of others within berths, or roping tobuoys or others within berths of the Establishement (Company)." The per-day basis is **not printed** in §1 (the header says "PER SERVICE"; table stops at 9000).
Cross-check: T9 prints a different TCDD wharfage table "Table for basic fees:(Haydarpasa – Izmir Ports)" with header "OTHER ALL VESSELS (35+35)" / "Unlawful Occupation 3500 GT/Hour(70+70 )", rows "0 –  3500 GRT | 35 | 70", "3500 –  2000 GRT [sic] | 70 | 140", ... "8001 –  9000 GRT | 315 | 630", and T9 says "Fees are charged per day of stay of vessels and lash ships in the locations specified in the scope for each 1000GT and fractions." and "The day of anchorage or roping of vessel or lash ship and day of departure from such locations are considered as full day."

### 7.2 §2 TARIFF OF DIRECTORATE GENERAL OF COASTAL SAFETY (KEGM) - "(Istanbul Port, Canakkale Port, Gelibolu Port, Izmir Port and Marmara Sea Passages)", undated

**A. PILOTAGE** (Table 5, "Table:1"), headers "(US Dollar/Service)": Passenger/Ferries/RO-RO/Car Carriers "116 + 46"; Container "153 + 65"; Other Cargo Vessels "197 + 81". Rows identical to §1 Table 1 except the first band reads "  501 –   1000" (no 0-500 row) and the last reads "9001 – 10000". Other Cargo column: 197, 278, 359, 440, 521, 602, 683, 764, 845, 926.

**B. TOWAGE** (Table 6, "Table:2"), headers Passenger etc. "224 + 40"; Container "299 + 56"; Other Cargo "373 + 70". First band "  501 –   1000". Other Cargo column: 373, 443, 513, 583, 653, 723, 793, 863, 933, 1003. **Container column differs from §1**: 249, 305, 361, 417, 473, 529, 585, 641, 697, 753 (header still says 299 + 56).

"General Principles of Pilotage and Towage Services:" (verbatim):
- "2.   If there is more than one discount for one service, only the highest discount rate is applicable. İf there is more than one discount for one service which are at the same rate, only one discount is applied. However, if there is one add – on fee and one discount available for one service, the difference of these values (+,-) is applied to the basic fee."
- "3.   In case services are given on the days specified in the 2429 numbered Law Related to National Feasts and General Holidays, fees are collected with an additional amount of 50 % of the basic fee exculuding holiday practice appliced as of 13:00 in Saturday at port services."
- "4.   The fees for the pilotage, towage and mooring services to be given for the tankers carriying dengerous goods and the vessels carrying Class 1 and 7 goods as specified in IMDG Code are collected with an additional amount of 30 % of the basic fee while fees for pilotage and towage services to be given fort he tankers carrying dangerous goods or not purified from such dangerous substances which are transshipping goods to the warehouse ship deployed in the open sea for stocking liquid fuel are collected with an additional amount of 50 % of the basic fee."
- "5.   The fees for the pilotage, towage and mooring services to be given for the vessels other than the tankers carrying Class 2-5.1-5.2 and 6.2 goods as specified in IMDG Code are collected with an additional amount of 10% of the basic fee."
- "6.   If the vessel has a Gasfree Certificate issued within 24 hours before start of the service, the basic fees in the tariff are applicable."
- "In Istanbul Port:  ... For other piers, berths and facilities  (excluding Zeyport ) within the boundaries of Istanbul Port, the basic fee is applied with an additional amount of 100 % of the original fee."
- "In Other Ports: for pilotage services given in Inner and Intermadiate Ports, the basic fees specified in table T.1 are applicable while for towage services, fee in table T.2 are applicable. In ourter harbors of these ports, the fees for services are applied with an additional amount of 100 % of the basic fee."
- No 80,000 GT cap sentence and no shifting discount in §2.

Tug hire (Table 7, "BASIC FEE TABLE FOR HIRING SEA VEHICLES", US Dollar, "Fee per hour and fractions" scheduled / non-scheduled):
"Up tı  0 -    9,9 | 620 | 806"; "Up to 10 – 19,9 | 740 | 958"; "Up to 20 – 39,9 | 1475 | 1915"; "Up to 40 – 59,9 | 2100 | 2728"; "Up to 60 – 79,9 | 2810 | 3652"; "Up to 80 – 99,9 | 3850 | 4995"; "Up to 100  and above | 6500 | 8405".

**C. MOORING** (Table 8): "All vessels / All ports / US Dollar / 22 + 11"; rows 0 – 1000 22 ... 9001 – 10000 121 (same as §1 Table 3). Note: "Mooring service fee shall be taken for once while mooring and unmooring. It shall not be taken once again when leaving."

**D. ANCHORING TARIFF** (Table 9, older monthly/annual table): "Gross Ton | Monthly / US Dollar | Annually / US Dollar": 500|25|50; 1000|50|100; 2000|100|200; 3000|150|300; 4000|200|400; 5000|250|500; 6000|300|600; 7000|350|700; 8000|400|800; 9000|450|900; 10000|500|1000; 15000|750|1500; 20000|1000|2000; 25000|1250|2500; 30000|1500|3000; 35000|1750|3500; 40000|2000|4000; 45000|2250|4500; 50000|2500|5000.
Text: "It is received for all Turkish ports upon request once a time monthly and annually for Cargo and passanger vessels whose anchoring time passes 3 days." / "Vessels monthly coefficient is GT X 0,05 US Dollar," / "Annually coefficient is GT X 0,10 US Dollar."
This conflicts with the newer per-day anchoring directive in §4 E (see 7.4).

### 7.3 §3 TARIFF OF TÜRKİYE DENİZCİLİK İŞLETMELERİ A.Ş. (TDİ) - "(For İstanbul Sarayburnu and Kuruçeşme Piers)", undated

Not applicable to a bulk carrier (cruise/military/yacht piers). Table 10 rows as printed: Cruise "Up to 1000 GRT / 1001 and above 1500 $ each GT x 0,25 $  x Day)" "1.500,00 / 0,25"; Military "Up to 500  GT / 501  and above 4.800$ + each GT X1,00 $" "4.800,00 / 1,00"; "SUPERFLUOUS OCCUPATION | It will be applied 1 hour after the time the Port Authority gives the Departure Order. (GT /100x 15,00 $ ) | 15,00"; "AGENT MOTOR- | Daily ... | 300,00"; "TENEZZÜH MOTOR | Daily ... | 720,00"; Yacht "Up to 500 GT  3.125,00 $" / "up to 501 3.125,00 $ + each 100 GT + 145 $".
Text: "Boats (such as agency boats) berthing/unberthing wharfs and piers in order to provide services to the vessels alongside or offshore are charged daily 1750,00 TL fixed fee as groundage fee."; "The day during which vessel is anchored or moored are day of leave are considered as full day."

### 7.4 §4 TARIFF PUBLISHED BY MINISTRY OF TRANSPORT, MARITIME AFFAIRS AND COMMUNICATION (non-TCDD / privatised ports), undated

**A. PILOTAGE SERVICES TARIFF** (Table 11, "Table: 1"): headers "1- Passenger Vessels / 2- Transit Cargo Vessels / 3- RO – RO Vessels / US Dollar / (116+ 46)"; "Container Vessels / US Dollar / (153 + 65)"; "Other Cargo Vessels / US Dollar / (197 + 81)". Rows "1 – 1000" to "9001 – 10000"; Other Cargo: 197, 278, 359, 440, 521, 602, 683, 764, 845, 926 (other columns identical to §1).
Notes (verbatim):
- "1.  Pilotage and tugboat obtaining obligations of vessels and ratios of exemptions are determined by Statute and Regulations of the Port."
- "2.  Aforementioned fees are applied with 30% addition for tankers carrying LNG, LPG, Petroleum and Petroleum byproducts. (Tankers receiving gas-free certificate are subject to normal pilotage services)"
- "3. Aforementioned fees are applied with 50% addition in public holidays including new year, religious and national holidays."
- "4.  Tariffs are applied with 50% discount for vessels requesting to supply fuel or coming to dockyards for repair."
- "5. Pilotage fees are applied with 50% discount for shifting from one wharf to another."
- "6. These fees are USD and calculated for single entry."
- "7. All fees are paid to service provider in Turkish Lira calculated with the purchase exchange rate of Central Bank for valid in the last day of service."

**B. TOWAGE SERVICES TARIFF** (Table 12, "Table:4"): headers "(224 + 40)", "(299+ 56)", "(373 + 70)"; rows "0  –  1000" to "9001 – 10000"; Other Cargo: 373, 443, 513, 583, 653, 723, 793, 863, 933, 1003; Container: 299, 355, 411, 467, 523, 579, 635, 691, 747, 803.
Notes (verbatim):
- "2. Towage for other cargo vessels are fixed as 283 USD up to 3000 GT, the rate for each following 1000GT is 53 USD."
- "3.Aforementioned fees are applied with 30% addition for tankers carrying LNG, LPG, Petroleum and Petroleum byproducts. (Tankers receiving gas-free certificate are subject to normal towage services)"
- "4.  Aforementioned fees are applied with 50% addition in public holidays including new year, religious and national holidays."
- "5.The vessels with active operating bow thruster and stern thruster receive single tugboat. If tugboat accompanies the vessel, fees are charged with 50%discount, if employed than service fee is paid in full. (...)"
- "6. If only bow thruster is available on the vessel and such thruster is operating actively, it should take at least one tugboat. Discount specified in the instructions of undersecretary (of the period) are applied based on GT of vessel."
- "7.  Tariffs are applied with 50% discount for vessels requesting to supply fuel or coming to dockyards for repair."
- "8. Towage service fees are applied with 50% discount for shifting from one wharf to another."
- "9. These fees are USD and calculated for single entry."
- "10. All fees are paid to service provider in Turkish Lira calculated with the purchase exchange rate of Central Bank for valid in the last day of service."

**C. MOORING SERVICES TARIFF** "(Mooring + Unmooring)" "(Mersin, İskenderun and İzmit Bay Ports)" (Table 13, "Table: 6"), "All Type of Vessels / US Dollar / (22 +11)":

| Vessel's GT | USD |
|---|---|
|      0 –   1000 | 22 |
| 1001 –  2000 | 33 |
| 2001 –  3000 | 44 |
| 3001 –  4000 | 55 |
| 4001 –  5000 | 66 |
| 5001 –  6000 | 77 |
| 6001 –  7000 | 88 |
| 7001 –  8000 | 99 |
| 8001 –  9000 | 110 |
|  9001 – 10000 | 121 |
| 14001 – 15000 | 132 |
| 19001 – 20000 | 143 |
| 24001 – 25000 | 154 |
| 29001 – 30000 | 165 |
| 34001 – 35000 | 176 |
| 39001 – 40000 | 187 |
| 44001 – 45000 | 198 |
| 49001 – 50000 | 209 |

Notes: "1.  Mooring service fee shall be taken for once while mooring and unmooring. It shall not be taken once again when leaving."; "2.Aforementioned fees are applied with 30% addition for tankers carrying LNG, LPG, Petroleum and Petroleum byproducts."; "3.  Aforementioned fees are applied with 50% addition in public holidays including new year, religious and national holidays."; "4. All fees are paid to service provider in Turkish Lira calculated with the purchase exchange rate of Central Bank for valid in the last day of service."
Inconsistency: rows from 14001 – 15000 rise by 11 per 5,000-GT step, which does not match "(22 +11)" per 1,000 GT. Reproduced as printed; do not infer.

**D. PORT TARIFF (WHARFAGE)** "(For All Ports)" (Table 14, "Table: 8"), "All Type of Vessels / US Dollar":
"0 –    1000 | 10"; "1001 –   2000 | 20"; "2001 –   3000 | 30"; "3001 –   4000 | 40"; "4001 –   5000 | 50"; "5001 –   6000 | 60"; "6001 –   7000 | 70"; "7001 –   8000 | 80"; "8001 –   9000 | 90"; "9001 – 10000 | 100"; "14001 – 15000 | 150"; "19001 – 20000 | 200"; "24001 – 25000 | 250"; "29001 – 30000 | 300"; "34001 – 35000 | 350"; "39001 – 40000 | 400"; "44001 – 45000 | 450"; "49001 – 50000 | 500".
Notes (verbatim): "1. It is paid 0,010 USD by vessels arriving to port per each gross tonnage of vessel for each day which they stayed in the port."; "2.  Fees are paid to service provider in Turkish Lira calculated with the purchase exchange rate of Central Bank for valid in the last day of service."; "3. Commercial cargo and passenger vessels mooring to coasts out of port facilities pay this fee in weekly periods to the bank account determined by Ministry of Transport, Maritime Affairs and Communications."

**E. ANCHORING SERVICES TARIFF** "ANCHORING TARIFF FOR ALL PORTS" (paras after Table 14; same text repeated in T5). Verbatim:
- "a) All vessels within the scope of this Directive whose total anchoring time exceeds 72 hours are charged on a daily basis according to subparagraph (e) of this paragraph from the anchoring time."
- "b) In cases where the anchorage time exceeds 168 hours, the incremental coefficients specified in subparagraph (e) of this paragraph are applied for the days exceeding 168 hours."
- "c) Daily duration is valid until the end of the current calendar day. A recalculation is made for the next day."
- "ç) Vessels can pay at their wish 25 (twenty-five) times of the daily fee for a monthly and 6 (six) times the monthly fee for a yearly anchorage fees ..."
- "1) Anchoring fee for mooring areas outside the scope of TBDTDY, a) USD 0,002 per GT for Turkish flagged ships and USD 0,004 per GT for foreign flagged ships with an anchorage period up to 168 hours, b) 0,003 USD per GT for Turkish flagged vessels and 0,006 USD per GT for foreign flagged vessels for anchorage periods over  168 hours ."
- "2) Anchoring fees for the Anchoring areas in Annex-2 of TBDTDY, a) USD 0,004 per GT for Turkish flagged ships and USD 0,008 per GT for foreign flagged   ships with an anchorage period up to 168 hours, b) The fee is calculated as 0,006 USD per GT for Turkish flagged and 0,012 USD per GT for anchorage periods over 168 hrs ." [sic: the foreign-flag word is missing before 0,012]
- "(3) The larger GT value shall be taken as basis in the fee accrual of the GT values in the Tonnage Certificates of the ships, ..."
- "(6) ... paid by the ship owners by converting the amount into Turkish Lira at the US Dollar foreign exchange buying rate of the Central Bank of the Republic of Türkiye on the day of payment. ..."
- "(7) It is essential that the fees are paid on the day the ship leaves the anchorage  and this period cannot exceed 72 hours from the day of departure under any circumstances."
- "(8) Daily, monthly and annual fees are applied in accordance with the provisions of this Directive and with a 50% discount in cases of out of service waiting at anchor."
- "ARTICLE 7 - (2) In case the anchoring time of ships that interrupt their non-stop passage ... and anchor in the anchorage areas in Annex-2 of TBDTDY exceeds 72 hours, an anchoring fee is charged as of the anchoring time."

Table 15 "Sample Calculation Table for Mooring Fees" [sic, anchoring], USD per day, Foreign Flagged columns (Excluding TBDTDY / TBDTDY, up to 168 h; then after 168 h):
"500 | 2 | 4 | 3 | 6"; "1.000 | 4 | 8 | 6 | 12"; "5.000 | 20 | 40 | 30 | 60"; "10.000 | 40 | 80 | 60 | 120"; "20.000 | 80 | 160 | 120 | 240"; "50.000 | 200 | 400 | 300 | 600"; "100.000 | 400 | 800 | 600 | 1200".
Table 17 example (verbatim): "A 10.000 GT foreign flagged vessel with 5 days anchoring time, excluding TBDTDY; Daily fee : 10.000 tons x 0,004 $/ton = 40 $ / Fee to be paid on a daily basis   : 5 days x 40 $ = 200 $ / Monthly fee if requested : 40 $ x 25 = 1.000 $ / Annual fee if requested : 1.000 $ x 6 = 6.000 $".
Note: the example charges all 5 days although (a) says only stays exceeding 72 hours are charged "from the anchoring time"; this reads as "once over 72 h, charge from hour 0".

No 80,000 GT cap is printed in §4.

### 7.5 §5 WASTE COLLECTION (Ministry of Environment and Urbanization) - Gazette 5 June 2009 No 27249, valid 1.1.2010

Table 18 "ANNEX-1" (recovered in full by cell-by-cell extraction; the catalogue said it was lost). Currency €.

| GRT | 1. Part Fixed Fee (€ ) | Allowed in fixed fee (m3): MARPOL ANNEX-I (Bilge water, waste oil, sludge) | ANNEX-IV | ANNEX-V | 2. Part Waste Fee (€/m3): ANNEX-I Slop, dirty ballast | ANNEX-I Bilge water, sludge, waste oil, | ANNEX-IV | ANNEX-V |
|---|---|---|---|---|---|---|---|---|
| 0-1000 | 80 | 1 | 2 | 1 | 1,5 | 35 | 15 | 25 |
| 1001-5000 | 140 | 3 | 2 | 1 | 1,5 | 35 | 15 | 25 |
| 5001-10000 | 210 | 4 | 3 | 2 | 1,5 | 35 | 15 | 25 |
| 10001-15000 | 250 | 5 | 4 | 2 | 1,5 | 35 | 15 | 25 |
| 15001-20000 | 300 | 6 | 5 | 2 | 1,5 | 35 | 15 | 25 |
| 20001-25000 | 350 | 7 | 5 | 3 | 1,5 | 35 | 15 | 25 |
| 25001-35000 | 400 | 8 | 6 | 3 | 1,5 | 35 | 15 | 25 |
| 35001-60000 | 540 | 10 | 10 | 4 | 1,5 | 35 | 15 | 25 |
| Over 60000 | 720 | 13 | 15 | 5 | 1,5 | 35 | 15 | 25 |

Conditions (verbatim):
- "Note: If the amount of delivered waste is with decimals, it is rounded to upper whole number."
- "2 – All vessels provide necessary contribution for the sustainability of provided services by port waste collection facilities. For this purpose, it is mandatory to pay fix fees in the rates specified in Part one of Annex-1."
- "3 – Vessels paying fixed fees can deliver the wastes in types and amounts specified in Part one of Annex-1. For wastes other than specified types and amounts of wastes in part one, fee per m3 is charged as specified in second part of Annex-1."
- "6 – If a vessel arriving ports of our country wants to deliver waste in another port after payment of fixed fee in the initial port, then Fixed Fee Tariff specified in part one of Annex-1 is not applied. ..."
- "8 – If wastes are collected offshore, the fees of wastes other than slop and dirty ballast are applied by increasing for 30%. The fee of offshore collection of slop and dirty ballast is 5 €/m3."
- "10 – Working hours are between 08:00 - 17:00 o’clock from Monday to Saturday."
- "11 – Tariffs other than fixed fees are applied with 25% increase beyond working hours, during weekends and public holidays."
- "12 - If the duration of waste collection service exceeds below mentioned periods due to failure of waste delivering ship or port operator, faulty party pays additional 40€ per each additional hour to the other. ..." (Table 19: Slop 10 hours; Dirty Ballast 10 hours; Bilge water 4 hours; Sludge 4 hours; Waste oil 2 hours; Poisonous fluid waste 4 hours; Dirty water 4 hours; Garbage 1 hours)
- "13 – All fees specified in this tariff are upper limits; no other fee can be collected under any name whatsoever in addition to the tariff. Except fixed fees, maximum 40% deduction can be made from other fees specified in this tariff."
- "16 – Ports obtaining exception certificates and not collecting wastes collect fixed fees and transfer to the contracted port."

### 7.6 Cross-check: KEGM figures printed elsewhere in the package (T9, T5) differ from T12

T9 "PILOTAGE AND TOWAGE SERVICES: (Ports of Istanbul, Canakkale, Gelibolu, Izmir and Marmara Sea Passages)", "(Source: Tariff for Pilotage, Towage and Other Services of Kiyi Emniyeti Genel Müdürlügü)":
- Pilotage (Table 3, "US Dollar / GT"): Other Cargo "0-1000 | 202,27", "+1000 | 83,17" (Passenger etc. 119,10 / 47,23; Container 157,10 / 66,74). "Guide Waiting Fee: 250 USD for each hour and fraction, the above fees include the guide service boat."
- Towage (Table 4): Other Cargo "0-3000 | 382,99", "+1000 | 71,87" (Passenger etc. 230 / 41,07; Container 307,01 / 57,50).
- Mooring KEGM (Table 6): "ALL VESSELS" "0 – 1000 | 22,58", "+1000 | 11,29".
- Mooring TCDD (Table 7) "22+11", notes: "1-   Above basic fees are applied 50% increase in Sundays and Official Holidays."; "3-   Above basic fees are applied 30% increase when a vessel carries dangerous Cargo."; **"4-  Above basic fees are applied up to 80.000 GT,  tariff for bigger vessels will be the same with 80.000 GRT."**
- Dangerous goods in ports: "a) The basic fees of tankers carrying dangerous goods in IMDG code class are charged with an additional 30%," ; "c) The basic fees of other vessels (except IMDG codes 1 and 7) other than tankers ... are collected with an additional 20%."
- Attendance: "Attandance fee is not collected forthe waiting up to one hour. Attandance feefor the total waiting time is collected for the waiting exceeding one hour."
T5 (Straits pilotage): "Pilot waiting fee is USD 150 per hour and fractions." T9 and T5 are undated; T9's figures look like an indexed (later) edition of the T12 §2 figures, but neither states a year.

---

## 8. TAXES ON FREIGHT AND CONTRIBUTION TO THE CHAMBER OF SHIPPING (T11)

- Title: "TAXES ON FREIGHT AND CONTRIBUTION TO THE CHAMBER OF SHIPPING:". Issuer: not printed.

a) Freight tax (undated), verbatim: "Only on export cargo freight and passanger maney earning for owner’s account at loading (Countries having bilateral exemption agreements are excluded * ... % 5,44" / "(*)  The list of countries having bilateralexemption egreements " (list not included in the file).

b) Chamber of Shipping. "2. Dry Cargo, Liquid Cargo and Bulk Cargo Ships: (For the year 2026)" verbatim: "The Chamber’s Share Fee from the Freight revenue is collected from the foreign flagged Ships which take Cargo from or bring Cargo to the Turkish ports ... over all Freight revenue individually that they acquire from loadind and unloading according to the below listed rates, provided that it would not exceed 5 per thousand. (0,05%)" [sic: 5 per thousand printed as 0,05%].

Table 1:

| Range of Carried Cargo in Ton (MT) | Maximum amount to be paid (US Dollars ) |
|---|---|
|           0 –    20000 | 580 |
|   20001 –   40000 | 870 |
|   40001 –   60000 | 1130 |
|   60001 – 100000 | 1400 |
| 100001 and over | 200 |

Table 2 (load and discharge by the same agent, same port, same voyage):

| Range of Carried Cargo in Ton (MT) | Maximum Amount to be Paid | Maximum Amount to be Paid in Discount (US Dollar) |
|---|---|---|
|           0 –    20000 | (580 + 580) | 870 |
|   20001 –   40000 | (870 + 870) | 1305 |
|   40001 –   60000 | (1130 + 1130) | 1695 |
|   60001 – 100000 | (1400 + 1400) | 2100 |
| 100001 and over | (1780 + 1780) | 2670 |

Verbatim: "In the event that the tonnage of loading and unloading of the same ship are different by the same agent in the same port and same voyage, the discount rate shall be applicable considering the higher tonnage range."
Inconsistency: Table 1 "100001 and over | 200" vs Table 2 "(1780 + 1780)" for the same band.
Container/RO-RO (not bulk): "It would not exceed 5 per thousand (0,05%)", "It would not exceed 700 US Dollars in the emport and export cargoes," "... instead of 1050 US Dollars on condition that it would not exceed it."

---

## 9. Bulk-carrier applicability summary (no calculation, only which printed table applies)

| Charge | TCDD port | Private / non-TCDD port | Basis printed |
|---|---|---|---|
| Port dues | T6 | T6 | "tonage" band (NT per footnote), TL |
| Pilotage | T12 §1 Table 1 "Other Cargo Vessels 197+81" | T12 §4 Table 11 "(197 + 81)" (or KEGM §2 / T9 at KEGM ports) | GRT/GT, USD per service |
| Towage | T12 §1 Table 2 "373+70" | T12 §4 Table 12 "(373 + 70)" but note 2 "283 USD up to 3000 GT ... 53 USD" | GRT/GT, USD per service |
| Mooring | T12 §1 Table 3 "(22+11)" | T12 §4 Table 13 "(22 +11)" (Mersin, İskenderun, İzmit Bay) | once for mooring + unmooring |
| Wharfage | T12 §1 Table 4 "10+10" (basis "PER SERVICE") | T12 §4 Table 14 + "0,010 USD ... per each gross tonnage ... for each day" | GT x day |
| Anchoring | T12 §4 E (per GT per day after 72 h; foreign 0,004 / 0,006) | same | GT, USD/day |
| Waste fixed fee | T12 §5 Table 18 | same | GRT band, € |
| Light dues | T2 (Straits transit only) | same | NT, USD |
| Sanitary | T7 formula | same | NT |
| Agency | T1 Table 8 | same | NT, EURO per call |
| Supervision | T8 A a) dry cargo / b) grains | same | cargo t, EURO |
| Chamber of Shipping | T11 Table 1/2 | same | cargo MT, USD max |
| Freight tax | T11 "% 5,44" on export freight | same | % |

80,000 GT cap: printed only for **TCDD** (T12 §1 principle 8 for pilotage/towage; mooring note 5; T9 TCDD mooring note 4). Not printed for KEGM §2 or Ministry §4.

---

## 10. Open questions for the package author

1. T6 port dues: who issues/collects (Harbour Master / Ministry?), and is it per call, per entry, or annual? The "tonage" basis is NT only by the footnote; confirm. Which band does exactly 50.000 fall in ("30.001-50.000" vs "50.000 over")?
2. T1 Tariff 1: are the per-1,000 NT increments cumulative by layer (125 to 20000, 100 to 30000, 75 above) on top of 4000 €? Is there a newer gazette than 32314 (19.09.2023) for 2025/2026?
3. T1 Tariff 2 (protecting agency) cites 2008 Gazette 26812 and says "20 % (twentyfive percent)": which is right, and is a 2023 version available?
4. T2 light dues: the file covers only Straits transits. What is the light-dues rule for a port call without Straits transit (e.g. Iskenderun, Mersin)? Is "Up to 800 NT / Over 800 NT" marginal or whole-tonnage? Year of the rates?
5. T7 sanitary dues: is "0,5025 x US Dollar daily buying rate x vessel’s NT" the port-call ("free vessel") rate, the transit rate, or both? Which bank's buying rate (CBRT)? Charged once per call?
6. T8 supervision: confirm bands I-II are also marginal (only III says "For part over"); confirm the 300 € minimum / 10.000 € maximum applies per call per cargo operation.
7. T12 §1 TCDD tables stop at 10,000 GT (wharfage at 9,000); confirm that above that the header increment (+81 pilotage, +70 towage, +11 mooring, +10 wharfage per 1,000 GT or fraction) continues up to the 80.000 GT cap. Is the increment per started 1,000 GT?
8. T12 §1 wharfage is printed "USD / PER SERVICE"; T9 says per day per 1000GT. Which applies, and which TCDD wharfage table is current: "10+10" (T12) or "35+35" per 3500 GT (T9 Haydarpasa-Izmir)?
9. KEGM pilotage/towage/mooring: T12 §2 (197+81 / 373+70 / 22+11) vs T9 (202,27+83,17 / 382,99+71,87 for 0-3000 / 22,58+11,29). Which edition is current and what year?
10. Ministry towage (§4 Table 12) prints 373+70 per 1,000 GT but note 2 says "283 USD up to 3000 GT ... 53 USD"; TCDD note 6 says Haydarpaşa "255 USD up to 3000 gt ... 48 USD". Which rate governs a bulk carrier at a private port?
11. Ministry mooring Table 13 rows above 10,000 GT (132 at 14001-15000 ... 209 at 49001-50000) contradict "(22 +11)" per 1,000 GT. Which is correct?
12. Does the 80.000 GT cap apply to KEGM and Ministry (private-port) pilotage/towage/mooring? It is printed only for TCDD.
13. KEGM §2 container towage column (249...753) differs from the 299 + 56 header and from §1/§4; typo?
14. Anchoring: §2 Table 9 (monthly GT x 0,05, annual GT x 0,10, after 3 days) vs §4 E directive (daily 0,004/0,006 per GT for foreign flag after 72 h). Confirm §4 E supersedes Table 9.
15. Ministry tariff name ("Transport, Maritime Affairs and Communication") pre-dates 2018; is there a current Ministry of Transport and Infrastructure / KEGM tariff year for §4?
16. Waste (2009/2010 tariff in €): still current? Does the fixed fee apply at every Turkish port call or only once per voyage (note 6)?
17. T11: Chamber of Shipping "100001 and over" maximum is 200 in Table 1 but (1780 + 1780) in Table 2; which is right? "5 per thousand" vs "(0,05%)": which? Freight-tax year and the bilateral exemption country list?
18. Private terminals: berth hire, cargo handling, ISPS, security, harbour master clearance and VTS fees are not in the package. Are operator tariffs (e.g. Iskenderun, Mersin, Gemlik, Tekirdağ, Aliağa) to be added?
