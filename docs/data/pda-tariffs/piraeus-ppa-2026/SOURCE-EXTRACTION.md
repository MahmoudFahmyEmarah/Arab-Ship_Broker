# Greece / Piraeus (PPA port zone): PDA tariff extraction for a dry-bulk carrier

Extracted 7 Oct 2026. The work was read-only: the ZIP was read in memory with Python `zipfile`, and nothing was extracted to disk in the repository.
Text extraction used **PyMuPDF 1.27.1** (`fitz`). It was already installed. `page.get_text()` gave the running text. `page.find_tables()` and block coordinates were used to confirm which cell sits in which column of every table quoted below.
The per-document text is in `scratchpad/greece/G5.txt`, `G6.txt`, `G7.txt` and `G8.txt` (pages are marked `===== PAGE n =====`). `G8_tables.txt` holds the reconstructed tug tables.
Page numbers below are PDF page indices, which match the printed page numbers in every document.
Quotes are verbatim, including typos and the original decimal separators. `[...]` marks an elision, and `|` marks a cell boundary in a quoted table.

## 0. Sources and hashes

Container: `D:\ASB_Projects\Arab Shipborker\Arabshipbroker\tmp\Data\GREEK PORTS.zip`
SHA-256 of the ZIP: `e25cc22ac8ebec687308e1d9d1af256f21b431dfa42e28381d4fa336a5f2b2bb`

| Row | Member path (zip :: member) | Bytes | Pages | SHA-256 of member bytes |
|---|---|---|---|---|
| G5 | `GREEK PORTS.zip :: GREEK PORTS/REGULATIONS_AND_TARIFFS_at_PPA_PORT_ZONE_EN_JUNE_2026.pdf` | 343390 | 15 | `032499a3a04a6f0069f7fe2f941497d765d56e381a49dae41dde3fe3315ea7aa` |
| G6 | `GREEK PORTS.zip :: GREEK PORTS/SYSTEM FOR COVERING THE COSTS OF PROVIDING LIQUID WASTE RECEPTION FACILITIES FOR SHIPS  CARGO RESIDUES PPA SA_ 2026.pdf` (two spaces before CARGO) | 464736 | 22 | `7c1614f986fbd525f79c8d05ec5774420ede1e3ce4714a0d0981a5c7753d2988` |
| G7 | `GREEK PORTS.zip :: GREEK PORTS/SYSTEM FOR COVERING THE COSTS OF PROVIDING SOLID WASTE RECEPTION FACILITIES FOR SHIPS  CARGO RESIDUES_2026.pdf` (two spaces before CARGO) | 369844 | 16 | `2bf9546862fdf782797f954a600c9435feba11e7189bee06a1441c3f47a16c26` |
| G8 | `GREEK PORTS.zip :: GREEK PORTS/Tugboats_Regulation_EN.pdf` | 485034 | 20 | `ff717b6cc61de64fbb52f814a7f8d4eafc25cc46770837dc75aea01178a03566` |

PDF metadata (not printed in the documents, for provenance only): G5 was created 2026-06-25, G6 2026-04-30, G7 2026-01-15 and G8 2026-04-30.

---

## 1. G5: "REGULATION AND TARIFFS at P.P.A Port Zone" (Piraeus, June 2026)

- p1: "This translation to English is unofficial and for reference only. The Greek original supersedes in case of controversy or dispute." and "PIRAEUS | June 2026".
- Currency: € throughout. There is no VAT statement anywhere in the document.
- Scope, p4, Art. 1: "This Regulation and Tariff regulates issues of port entry, berthing, stern berthing and harbouring of active ships / floating crafts in the legally specified port area [...] with the exception of the Ship Repair Zone."
- p4, Art. 3 A: "Vessels / floating crafts that land or dock or remain arbitrary in the legal PPA port area, except for the Ship Repair Zone, are subject to the following charges:"

### 1.1 Use of the Port Charges (Art. 3 A.1, p4–5): applies to a bulk carrier
p4: "1. Use of the Port Charges | The charge is calculated for each arrival, based on the total capacity (GRT or G.T.), as follows:"

Table header (p4): "Category of Ship/Floating Building | Charge in €". The table splits across pages 4 and 5. Each category row has its own date sub-header:

| Category (verbatim) | Date columns | Rate |
|---|---|---|
| 1.1. Passenger vessels in general | From 1/4/2012 | 0,028 |
| 1.2. Cruise ships, yachts and other recreational craft | From 1/1/2025 / From 1/1/2027 | 0,207 / 0,232 |
| **1.3. Cargo ships and other vessels, including RoPax of foreign origin** (p5) | **From 1/1/2019 / From 1/4/2024** | **0,053 / 0,061** |

- Unit as printed: the header reads "Charge in €" only. "per GT" comes from the lead-in "for each arrival, based on the total capacity (GRT or G.T.)". The words "€/GT" are not printed.
- Currently applicable to a bulk carrier: **0,061**, from 1/4/2024. 0,053 is the superseded value from 1/1/2019.

### 1.2 Berthing Charges (Art. 3 A.2, p5): applies to a bulk carrier
p5: "Vessels / floating crafts that berth to the quays and, in general, to port installations for cargo handling or for passenger (dis)embarkation and baggage handling, are charged for each metre - based on their length overall (LOA) - and for each day of stay as follows:"

Header: "Category of Ship/Floating Building | Charge in € / current measure"

| Category (verbatim) | Date columns | Rate |
|---|---|---|
| 2.1. Passenger vessels in general | From 1/4/2012 | 0,871 |
| 2.2. Cruise ships, yachts and other recreational craft | From 1/1/2025 / From 1/1/2027 | 2,300 / 2,576 |
| **2.3. Cargo ships and other vessels, including RoPax of foreign origin** | **From 1/1/2019 / From 1/4/2024** | **0,898 / 1,033** |

- Unit as printed: "€ / current measure". This is almost certainly a mistranslation of "running metre" (τρέχον μέτρο); see Inconsistencies. The lead-in gives "for each metre [...] (LOA) [...] and for each day of stay".
- Currently applicable: **1,033**, from 1/4/2024.

### 1.3 Stern berthing (Art. 3 A.3, p5)
"3. Stern berthing Charges | Calculated as 35% of the corresponding berthing charges."

### 1.4 Harbour Dues (Art. 3 A.4, p5–6): not for a calling bulk carrier
p5: "The special construction or destination ships / floating crafts which remain in the PPA port area to carry out various ancillary works or are routed to ferry services, shall be charged with the following harbouring charges per month indivisible". The rows are 4.1–4.10 (ferries, floating cranes, barges, tugs per metre and so on). All are monthly. Examples: "4.7 Towing vehicles and lifeguards per meter of length. | 5,50 | 7,00". They are listed only for completeness and are not relevant to a dry-bulk call.

### 1.5 Mooring (Art. 3 A.5, p6–7): applies to a bulk carrier, conditionally
p6: "5. Mooring | In case the mooring is not provided by the pilotage service, it will be provided exclusively by PPA, for the following categories of ships / floating crafts, as follows:"

Header: "Ship Category* / floating craft | Calculation Unit | Charge (€) | Charge (€)"

| Ship category (verbatim) | Calculation Unit (verbatim) | Charge (€) | Charge (€) |
|---|---|---|---|
| Cruise ships, yachts and other recreational crafts | Per work step (lashing or unlashing) | As from 1/1/2020 150,00 | As from 1/4/2024 600,00 |
| **Cargo ships and other floating crafts including RoPax of foreign origin** (p7) | **Per work step (lashing or unlashing** [closing parenthesis missing in source] | **As from 1/1/2019 150,00** | **As from 1/4/2024 600,00** |
| Ferry coastal ships of length up to 180 meters | Per ship monthly | 675,00 | |
| Ferry coastal ships of length over 180 meters | Per ship monthly | 950,00 | |
| High speed crafts (high season) 2 arrivals per day | Per ship monthly | 400,00 | |
| High speed crafts (low season) up to 1 arrival per day | Per ship monthly | 200,00 | |
| Exceptional service provision (lashing and unlashing) | Per work | 48,00 | |

- Footnote (p7): "* the mooring service is excluded and not provided to hydrofoil and passenger ships up to 150 GRT."
- Currently applicable to a bulk carrier: **600,00** per work step, from 1/4/2024. "lashing or unlashing" means making fast or letting go. The document does not say how many steps a call has.
- "Exceptional service provision (lashing and unlashing) | Per work | 48,00" has no ship category and no explanation of what "exceptional" means.

### 1.6 Successive approach PPA / PCT (Art. 3 A.6, p7)
"In the case of ships calling and approaching successively the PPA SA and PCT SA (Pier II, III) installations and vice versa, the port entry and the parable and berthing charges of ships, for their common day of stay, will be shared amicably by half (50%) by both companies."

### 1.7 Exemptions (Art. 3 B, p7–8): only those that could touch a commercial bulk carrier
- p7, B.6: "Ships / floating crafts that enter and anchor for the receipt of various fast services (supplies, crew change etc.), provided their stay does not exceed 48 hours"
- p8, B.8: "Other ship categories that enter the PPA port area provided they carry merchandises or other things belonging to International Organizations - Humanitarian, Environmental Organizations - Institutions, etc., and are intended to provide assistance to affected areas. The exemption or limitation of fees and rights will be subject to the approval of the competent Ministry, at the request of the interested parties."
- The other exemptions (B.1–5, 7 and 9) cover heads of state, navy, war or state ships, PPA subcontractors, fishing vessels of 150 G.T. and under, state security craft, and ships for sale under Law 2881/2001.
- B is headed "The following ships / floating crafts are exempt from the above charges:"

### 1.8 Special charges (Art. 4, p8–9)
**4.1 Central Port quays (p8).** "Ships / floating crafts, -which, at their request-and following aproval by the competent authority, beth to Central Port quays shall be charged with the following special charges:"

| Stay Duration (Days) | Charge in € / meter / day |
|---|---|
| 1-5 | The corresponding charge of paragraphs 2.1. - 2.3. of the article 3. |
| 6-10 | 8,00 |
| 11th and over | 15,00 |

"The above charge applies at the following cases: • On passenger ships that interrupt, for any reason, their itineraries or cruises. • On ships for the period until the start of their itineraries. • For the duration of the ships' stay until or after the designation of "temporary repair positions». The stern berthed ships are charged at 35% of the above charges."
This is not normally applicable to a working bulk carrier.

**4.2 Anchorage (p8): applies to a bulk carrier at anchor.** "Ships / floating crafts anchored at the PPA port area between Salamina and Perama, away from the channels and other installations and the within the Ampelakia bay, will be charged € 0,397, calculated per G.T. and undividable 15 days. | In this case are also included those that are under arrest or seized or detained."
- Unit as printed: "€ 0,397, calculated per G.T. and undividable 15 days".
- No effective date is printed for this rate.
- The geographic scope is limited to "between Salamina and Perama [...] and the within the Ampelakia bay". Definition 2 (p2) uses "between Salamis and Perama [...] bay of Ambelakia".

**4.3 Arbitrary stay (p8).** "Ships / floating crafts which remain arbitrary, for any reason, at quays or technical works or in any port area shall be charged according to Articles 3 and 4, plus 150%."

**4.4 RoRo / RoPax overrun (p9).** This applies to RoRo and RoPax only: "within 32 hours" for loading and discharge, then "1-2 | 20,00" and "3rd and over | 40,00" € / meter / day. "Stern berthed ships pay 35% of the above charges. Stay is not considered arbitrary when there is PPA liability." It does not apply to bulk carriers.

### 1.9 Shipwreck charges (Art. 5, p9)
"Charge in € / GT or GRT / day": "1-90 | 0,014", "91-180 | 0,033", "181 until their lifting | 0,064". These do not apply to a normal call.

### 1.10 Method of calculation and day-counting (Art. 6, p10–11): verbatim
- 6.1 (p10): "Where the term "day" is used in this Tariff, it is understood that refers to the period from 00.01 to 24.00. Fraction of a day is calculated as a whole day."
- Definition 4 (p2): "Undividable Day: An undividable day is the period from 00.01 to 24.00 or fraction of the day."
- 6.2: "If the ship / floating craft berthing or stern berthing lasts for up to six (6) hours and this period falls within two days, the charge is imposed for one (1) day."
- 6.3: "Ships / floating crafts that berth or stern berth more than once in a day shall be charged for one day according to the highest foreseen charge."
- 6.4: "The port entry charges of ships / floating crafts are calculated for each entrance at PPA Port Zone, based on the whole capacity of the ship/floating craft. On ships of double capacity, the charges are calculated according to the highest, on the basis of the original measurement certificates or the legally validated photocopies."
- 6.5: "Ships that carry out international voyages, their whole capacity is calculated on the basis of the ships' size in GT (GROSS TONNAGE), as measured in accordance with the International Tonnage Certificate 1969 and listed in the official Measurement Certificates of the ships. Excluded are ships up to 1300 G.T. the capacity of which derives from their measurement on basis of the national legislation [...]"
- 6.6 (SBT tankers, for reference): "[...] in each case reduced by at least 17% of the corresponding charges which are imposed on tankers of equal capacity without segregated ballast tanks." This does not apply to dry bulk.
- 6.7 (p10–11): "The charges of berthing or stern berthing of ship/floating crafts are calculated on their maximum length overall in meters (L.O.A). On ships / floating crafts that berth alongside another ship/floating craft or their berthing occupies pier length shorter or equal to its half-length, it is granted 50% discount at berthing charges."
- 6.8 (p11): "The data concerning the capacity and length of the ships shall be attested either by the official shipping documents that the ship's representative submits or by the LLOYD'S REGISTER OF SHIPPING International Code."
- No minimum charge and no maximum charge are printed for port use, berthing, mooring or anchorage.

### 1.11 Payment (Art. 7–8, p11–12)
- 7.1: "The port entry, berthing and stern berthing charges of ships/floating crafts, shall be paid within thirty (30) days from the date of issue of the Invoice."
- 7.3: "The port entry, berthing and stern berthing charges of foreign ships shall be paid within thirty (30) days from the date of issue of the Invoice."
- 8.1 (p12): "[...] the ship-owner, the disponent owner, the manager, the shipping agent at the time of the creation of the charge claim or the legal representative of the craft, which are each jointly and fully responsible."
- 8.2: "Exceptionally, the charges of crafts whose ship owners or disponent owners live abroad shall be confirmed in the name of the shipping agents or their legal representatives."

### 1.12 Penalties (Art. 10, p13)
10.2: "[...] impose a penalty equal to the amount of the financial penalty provided for in paragraph 1 .c. of the second article of Law 2688/1999 [...]". No amount is printed.

Art. 11 (cruise cancellation, p14) is not relevant.

---

## 2. G6: "SYSTEM FOR COVERING THE COSTS OF PROVIDING LIQUID WASTE RECEPTION FACILITIES FOR SHIPS & CARGO RESIDUES" (2026)

- Effective date (p2): "SHIP LIQUID WASTE AND CARGO RESIDUES RECEPTION FACILITIES FEES & CHARGES ADJUSTMENT WITH IMPLEMENTATION FROM 1-5-2026"
- Ship classes (p2): "Ships are divided into ships non-regular ship voyages (cargo ships, tankers, cruise liners, ships being repaired) and ships regular ship voyages (passenger ships, cruise liners, port auxiliary ships, etc.)." A tramp bulk carrier is therefore unscheduled (§3.1).

### 2.1 Prepaid-fee and refund rule (p2)
"Ships sailing unscheduled routes pay pre-paid fees which: a) if waste is delivered, shall be returned after 20% has been withheld to cover administrative costs and to develop - operate and maintain a computer application [...] The remainder of the pre-paid fee is returned once the ship's agent submits all the waste delivery documentation and pays for the services received and after the departure of the ship. In case of waste categories that are not under pre-paid fees (Annex I, Waste Lubricants Oils (WLO)), they are excluded from the pre-paid fee return process. | b) Where no waste is delivered, the entire amount of the pre-paid fee shall be withheld."
- p2: "These fees shall be paid directly to the sub-concessionaire [...]"

### 2.2 Liquid (oily) waste fee: unscheduled ships (§3.1, p3–4)
p3: "Any ship calling at the PPA S.A. port zone and the anchorage (cargo ships, tankers, passenger ships, cruise liners, ships being repaired) shall pay a liquid waste management fee. This fee is calculated using the following formula: **Τ = σΤ x σΜ** Where: Τ = Fee | σΤ = liquid waste management fixed coefficient = **384** | σΜ = a factor depending on the size of the ship (GRT)"

σΜ table (p4), verbatim:

| Ship size | σm |
|---|---|
| GRT= 0-1,000 | 1 |
| GRT= 1,001-5,000 | 2 |
| GRT= 5,001-10,000 | 3 |
| GRT=10,001-25,000 | 5 |
| GRT=25,001-50,000 | 8 |
| GRT= > 50,000 | 10 |

"Consequently: Fee = 384 x σΜ". The fee table (p4), verbatim:

| SHIP SIZE | PRODUCT | FEE IN € |
|---|---|---|
| Ships ≤ 1.000 GRT | 384x1 | 384 |
| Ships from 1,001 up to 5,000 GRT | 384x2 | 768 |
| Ships from 5,001 up to 10,000 GRT | 384x3 | 1.152 |
| Ships from 10,001 up to 25,000 GRT | 384x5 | 1.920 |
| Ships from 25,001 up to 50,000 GRT | 384x8 | 3.072 |
| Ships ≥ 50,001 GRT | 384x10 | 3.840 |

Anchorage and transit (p4): "The above fee calculation table is also applicable to ships at anchorage that remain in this period for more than 48 hours. For ships passing through the anchorage (In transit with a stay of less than 48h) the above fees have a 70% discount and are structured as follows:"

| SHIP SIZE | PRODUCT | FEE IN € 30% (<48h) | FEE IN € 100% (>48h) |
|---|---|---|---|
| Ships ≤ 1.000 GRT | 384 x1 | 115,20 | 384 |
| Ships from 1,001 up to 5,000 GRT | 384 x2 | 230,40 | 768 |
| Ships from 5,001 up to 10,000 GRT | 384 x3 | 345,60 | 1.152 |
| Ships from 10,001 up to 25,000 GRT | 384 x5 | 576,00 | 1.920 |
| Ships from 25,001 up to 50,000 GRT | 384 x8 | 921,60 | 3.072 |
| Ships ≥ 50,001 GRT | 384 x10 | 1.152,00 | 3.840 |

### 2.3 Sewage (Annex IV) fee: unscheduled ships (§3.1 continued, p5)
"For waste category ANNEX IV-Sewage Waste **στ=169** and the coefficient σm is given by the table below:"

σm table (p5): identical bands to §2.2 ("GRT= 0-1,000 | 1" … "GRT= > 50,000 | 10"). "Fee = 169 x σμ"

| SHIP SIZE | PRODUCT | FEE IN € |
|---|---|---|
| Ships ≤ 1.000 GRT | 169 Χ 1 | 169,00€ |
| Ships from 1,001 up to 5,000 GRT | 169 Χ 2 | 338,00€ |
| Ships from 5,001 up to 10,000 GRT | 169 Χ 3 | 507,00€ |
| Ships from 10,001 up to 25,000 GRT | 169 Χ 5 | 845,00€ |
| Ships from 25,001 up to 50,000 GRT | 169 Χ 8 | 1.352,00€ |
| Ships ≥ 50,001 GRT | 169 Χ 10 | 1.690,00€ |

p5: "The above fee calculation table also applies to ships at anchorage that remain there for a period of time greater than 48h. For ships passing through the anchorage (In Transit with a stay time of less than 48h) the above fees have a 70% discount and are structured as follows: | Ships in transit at the sea anchorage:"

| SHIP SIZE | PRODUCT | FEE IN € 30% (< 48h) | FEE IN € 100% (> 48h) |
|---|---|---|---|
| Ships ≤ 1.000 GRT | 169 Χ 1 | 50,70€ | 169,00€ |
| Ships from 1,001 up to 5,000 GRT | 169 Χ 2 | 101,40€ | 338,00€ |
| Ships from 5,001 up to 10,000 GRT | 169 Χ 3 | 152,10€ | 507,00€ |
| Ships from 10,001 up to 25,000 GRT | 169 Χ 5 | 253,50€ | 845,00€ |
| Ships from 25,001 up to 50,000 GRT | 169 Χ 8 | 405,60€ | 1.352,00€ |
| Ships ≥ 50,001 GRT | 169 Χ 10 | 507,00€ | 1.690,00€ |

(The "Χ" in the PRODUCT column is a Greek capital chi in the source.)

### 2.4 Which ships pay which coefficient
- σΤ = 384 (oily) and στ = 169 (sewage) are the only unscheduled-route coefficients. They apply to "Any ship calling [...] (cargo ships, tankers, passenger ships, cruise liners, ships being repaired)" (p3). G6 has no separate repair coefficient, unlike G7.
- Small cargo ships under 2,000 GRT on frequent calls fall under the scheduled-route scheme (§3.2 item 4, p7–8): "Six and seventy two (6,72) € / day" plus "Sewage reception facility fee: [...] (157.80€)/month". This does not apply to a tramp bulk carrier.

### 2.5 What counts as one call or fee event (G6)
- No explicit "per call" definition is printed. The trigger is "Any ship calling at the PPA S.A. port zone and the anchorage [...] shall pay" (p3).
- Ships under repair (§5.2, p14): "Where the ship leaves the repair location and returns to the port within 10 days, provided that it has retained the repair location for that period, it shall not be charged a new fee for the provision of ship waste reception facilities. ▪ If the ship leaves and does not retain its repair location then it will not be charged until it returns to the port within 5 days. If it returns from day 6 onwards, the relevant fee shall be applied in accordance with the PPA S.A. price list."

### 2.6 Other G6 charges a bulk carrier may meet (only on actual delivery)
- Customs (p13, §4 c): "All liquid waste deliveries require that customs authorisation be obtained. This costs € 115.30. It shall be issued by the sub-concessionaire, and the cost shall be borne by the ship served." §4 is headed "relate to all fees under paragraph 3.2", which is the scheduled-route scheme, so its application to unscheduled ships is unclear.
- Unscheduled delivery price list (§8.2, p17–19), for example 8.2.1.2 A "For passenger - cargo ships | Lump-sum price for up to 3 hours and for a quantity of up to 200ΜΤ : 1.230,43 € | Charge for each additional hour (over 3 hours) : 553,69 €/h | Charge for each additional ΜΤ (πέραν των 200) : 3,07 €/ΜΤ". These are quantity-driven and are not fixed PDA items.
- Surcharges (p20–21): "10.1 The prices in paragraphs 8.2.1.2 and 8.2.2.3 augmented with a 40% surcharge shall apply to the collection of liquid waste from port anchorages." "Surcharge for charge outside of normal working hours: 40%". "Surcharge for weekends and other official holidays: 60%". "Environmental Surcharge | For the collection of liquid waste from the port anchorages, an additional charge of fifteen euros per cubic meter (€15.00/m³) shall apply on the quantity collected."
- Waste oils (p21): "11.1. Where ships deliver quantities of lubricating oils separated from other liquid waste, there is no charge for collecting and managing the waste."
- Exemptions (p14, §7): "These charging systems allow for exceptions specified in the Plan and the Joint Ministerial Decision JMD No. 3122.3-15/71164/2021 (Government Gazette 4790/Β/18-10-2021).in accordance with the procedure specified in the relevant PPA S.A. liquid waste management regulations." No exemption criteria are printed.
- Indexation (p22, §12.1): "Fees and charges are valid for one year periods and shall be adjusted on 1 January each year in line with annual inflation [...] Τ = To x (0.20 + CPI/CPIο x 0.80)". The footnote reads "(*) : The relevant adjustment will be implemented upon approval by Ministry of Maritime Affairs and Insular Policy".

---

## 3. G7: "SYSTEM FOR COVERING THE COSTS OF PROVIDING SOLID WASTE RECEPTION FACILITIES FOR SHIPS & CARGO RESIDUES" (header "Rev_2026_01")

- Effective date: **none printed.** Each page header carries "Rev_2026_01". The file name says "_2026".
- p1: "For passing vessels (in transit) a 70 % reduction on solid waste fees is applied."

### 3.1 Prepaid-fee and refund rule (p1)
"Ships with non-regular traffic and non scheduled calls are obliged to pay in advance fees which: a) if waste is delivered, 80% of prepaid fee will be returned after a 20% withholding due to administrative costs (15%) and development - operation and maintenance of the Electronic Platform for the delivery and management of ship-generated waste (5%) [...] The 80% of the prepaid fee is returned once the ship's agent submits all the waste delivery documentation and pays for the services received. Returns are excluded for the categories of edible oils and fats (solid waste), animal by-products and recyclables. b) Where no waste is delivered, the entire amount of the prepaid fee will be withheld [...]. These fees will be collected directly by PPA/ Ship Waste Reception Facilities Office."
- p2: "The ship shall pay the sub-concessionaire's invoice no later than fifteen (15) calendar days from its issuance."

### 3.2 Solid waste fee: non-regular calls (§3.1, p3)
"Any ship calling at the PPA SA port zone and PPA anchorage will pay a solid waste management fee. This fee is calculated with the G.R.T for cargo ships, tankers and ships being repaired and based on the number of crew & passengers for passenger ships and cruise ships, as follows:"

"A) CARGO SHIPS (RO-RO, GENERAL CARGO, CONTAINER VESSELS etc), TANKERS AND SHIPS BEING REPAIRED | This fee is calculated using the following formula: **Τ = σΤ x σΜ** Where: Τ = Fee , σΤ = the fixed solid waste management coefficient = **174,75 for cargo ships and tankers** and = **262,12 for ships being repaired** and σΜ = a factor depending on the size of the ship (GRT)"

"Fee = 174,75 x σΜ & 262,12 x σΜ"

σΜ table (p3), verbatim:

| SHIP SIZE | σΜ |
|---|---|
| GRT = 1 - 1.000 | 1 |
| GRT = 1.001 - 5.000 | 2 |
| GRT = 5.001 - 10.000 | 3 |
| GRT = 10.001 - 25.000 | 5 |
| GRT = 25.001 - 50.000 | 8 |
| GRT = > 50.001 | 10 |

"a1. CARGO SHIPS AND TANKERS" (p3):

| SHIP SIZE | MATHEMATICAL PRODUCT | FEE IN € |
|---|---|---|
| 1 - 1.000 GRT | 174,75 x1 | 174,75 |
| 1.001 - 5.000 GRT | 174,75 x2 | 349,50 |
| 5.001 - 10.000 GRT | 174,75 x3 | 524,25 |
| 10.001 - 25.000 GRT | 174,75 x5 | 873,75 |
| 25.001 - 50.000 GRT | 174,75 x8 | 1.398,00 |
| >50.001 GRT | 174,75 x10 | 1.747,50 |

"a2. SHIPS AT SHIP REPAIR AREAS" (p4). The table position was confirmed by layout:

| SHIP SIZE | MATHEMATICAL PRODUCT | FEE IN € |
|---|---|---|
| 1 - 1.000 GRT | 262,12 x1 | 262,12 |
| 1.001 - 5.000 GRT | 262,12 x2 | 524,24 |
| 5.001 - 10.000 GRT | 262,12 x3 | 786,36 |
| 10.001 - 25.000 GRT | 262,12 x5 | 1.310,60 |
| 25.001 - 50.000 GRT | 262,12 x8 | 2.096,96 |
| >50.001 GRT | 262,12 x10 | 2.621,20 |

"b) CRUISE - PASSENGER SHIPS" (p4) is per person. It runs from "Up to 250 people | 436,88" to "Over 3001 people | 5.242,44" and is not relevant to bulk carriers.

"c) PASSING SHIPS (IN TRANSIT) AT PIRAEUS ANCHORAGE" (p4):

| SHIP SIZE | MATHEMATICAL PRODUCT | FEE IN € 30% (<48h) | FEE IN € 100% (>48h) |
|---|---|---|---|
| 1 - 1.000 GRT | 174,75x1 | 52,43 | 174,75 |
| 1.001 - 5.000 GRT | 174,75x2 | 104,85 | 349,50 |
| 5.001 - 10.000 GRT | 174,75x3 | 157,28 | 524,25 |
| 10.001 - 25.000 GRT | 174,75x5 | 262,13 | 873,75 |
| 25.001 - 50.000 GRT | 174,75x8 | 419,40 | 1.398,00 |
| >50.001 GRT | 174,75x10 | 524,25 | 1.747,50 |

Status change (p4): "If the vessel has initially declared an in-transit passage and subsequently its status changes with a stay at the anchorage exceeding 48 hours and/or arrival at the port, the corresponding fees shall be applied according to the vessel's category, with a supplementary charge in addition to those initially applied"

### 3.3 Category for a dry-bulk carrier
- "Bulk carrier" is not named. Heading A lists "CARGO SHIPS (RO-RO, GENERAL CARGO, CONTAINER VESSELS etc), TANKERS AND SHIPS BEING REPAIRED". A dry-bulk carrier falls under "etc" and so takes σΤ = 174,75 (a1). It takes 262,12 (a2) only when at a ship repair area.
- Small cargo ships under 2.000 GRT with frequent calls are under the fixed scheme (§3.2 item 9, p8): "Two hundred twenty seven € and seventeen cents (227,17)€ / month". This is not relevant to a tramp call.

### 3.4 What counts as one call (G7)
- p3: "Any ship calling at the PPA SA port zone and PPA anchorage will pay a solid waste management fee." No further per-call definition is given.
- Repair returns (§5.2, p10): "In case the ship departs from the repair site and returns within 10 days to the port. if it has kept the repair position for the above period. It will not be charged again with a fee for the provision of ship waste reception facilities. ▪ If the ship departs and does not hold the repair position. Then it will not be charged again until it returns to port within 5 days. For a return from the sixth day onwards. The corresponding fee will be charged according to PPA SA Invoice."
- Temporary repair positions (§5.1 B, p10): "For ships occupying temporary repair positions designated by PPA SA in the Central Port of Piraeus. they will not be charged with fees for the time they remain in these positions."

### 3.5 Reductions, exemptions and surcharges (G7)
- The in-transit 70 % reduction is quoted in 3.2 above. The doc says "70 % reduction" on p1 and the table header says "30% (<48h)".
- Recyclables discount (p15): "12% for delivery of clean recyclable streams • 8% for delivery of mixed recyclable streams". This applies to delivered recyclable quantities only.
- Exemptions (p11, §7): "From the above billing systems. the possibility of exemptions provided by the Ship Generated Waste Μanagement Plan and article 9 of the J.M.D. 8111.1/41/09 as it has been superseded and is in force with the Official Gazette 3122.3-15/71164/2021 (Government Gazette 4790/Β/18-10-2021). [...]" No criteria are printed.
- Delivery prices for "8.2.2. OTHER SHIPS" (p13) apply on actual delivery: "Lump-sum price for a quantity of up to 3 m3 | 241,25€ | Unit price for quantities of waste over 3 m3 | 72,38€". Surcharges: "8.2.7 [...] for the anchorage services | 40%", and 8.2.8 "Weekdays | 60% | Sundays & official holidays | 85%".
- Cancellation (p15, §9.1): "In case of cancellation of the waste delivery request within six (6) hours before the scheduled start of the service. an additional lump-sum price of five hundred euros (500 €) will be applied."
- Adjustment (p16, §10): "The validity of the fees and tariffs of invoices will be annual and may be adjusted. by decision of PPA SA. on January 1st of each year according to the General Consumer Price Index of the previous year and the general economic situation."

---

## 4. G8: "REGULATION OF THE PORT OF PIRAEUS AUTHORITY SA FOR THE SAFE MOORING AND UNMOORING OF SHIPS SUBJECT TO TOWING"

- **No rates. G8 contains no prices or currency anywhere.** It sets the minimum number of tugs and the total bollard pull only.
- p1: "This translation for the Greek original is provided for ease of use and the Greek original supersedes in case of discrepancy"
- Effective date (p20, Art. VIII 8.1): "Τhe application of the present Regulation shall enter into force upon the notification of the Port Authority." No date is printed.
- Minimum tug (p3, Art. V.3): "Each tugboat operating in the port facilities under the jurisdiction of PPA S.A. must have a towing capacity greater than twenty-five (25) tons."
- Master's discretion (p3, Art. V.8): "If, in the judgment of the master of the ship, exceptional conditions exist that may endanger the ship and its passengers, the master may determine the number of tugs used and their towing power, in addition to those provided for in article 6."
- Thrusters (p4, 6.4): "Important note: If auxiliary thruster/s are present, the basic requirement is that the auxiliary thruster/s are operational and can support the mooring and unmooring process. Otherwise, the ship is considered not to have auxiliary thruster/s."
- **Category unit:** the categories are printed only as "I. (0-100)" and so on. The tables never print "LOA" or "m". The only length definition is p2: "Length Overall (LOA): The length between the outermost points of the bow and stern. [...]"

### 4.1 "a) Commercial/tourist port towage | Α. Bulk Carriers/ General Cargo" (p5–6)
Each cell is "Minimum number of tugs / Total required bollard pull". The cells were confirmed by both the row-wise text and the column-wise table extraction.

**Ι. WITHOUT BOW THRUSTERS: Mooring (p5)**

| Category | 4 Bft | 5 Bft | 6 Bft |
|---|---|---|---|
| I. (0-100) | 1 / 25 tons | 1 / 25 tons | 1 / 25 tons |
| II. (101-150) | 1 / 30 tons | 2 / 50 tons | 2 / 50 tons |
| III. (151-200) | 2 / 50 tons | 3 / 75 tons | 3 / 90 tons |
| IV. (201-250) | 2 / 55 tons | 3 / 75 tons | 3 / 120 tons |

**Ι. WITHOUT BOW THRUSTERS: Unmooring (p5)**

| Category | 4 Bft | 5 Bft | 6 Bft |
|---|---|---|---|
| I. (0-100) | 1 / 25 tons | 1 / 25 tons | 1 / 25 tons |
| II. (101-150) | 1 / 25 tons | 1 / 25 tons | 1 / 25 tons |
| III. (151-200) | 2 / 50 tons | 2 / 50 tons | 2 / 60 tons |
| IV. (201-250) | 2 / 50 tons | 2 / 50 tons | 3 / 100 tons |

**ΙΙ. WITH BOW THRUSTERS: Mooring (p6)**

| Category | 4 Bft | 5 Bft | 6 Bft |
|---|---|---|---|
| I. (0-100) | 1 / 25 tons | 1 / 25 tons | 1 / 25 tons |
| II. (101-150) | 1 / 25 tons | 1 / 25 tons | 1 / 25 tons |
| III. (151-200) | 1 / 25 tons | 1 / 25 tons | 2 / 50 tons |

**ΙΙ. WITH BOW THRUSTERS: Unmooring (p6)**

| Category | 4 Bft | 5 Bft | 6 Bft |
|---|---|---|---|
| I. (0-100) | 1 / 25 tons | 1 / 25 tons | 1 / 25 tons |
| II. (101-150) | 1 / 25 tons | 1 / 25 tons | 1 / 25 tons |
| III. (151-200) | 1 / 25 tons | 1 / 25 tons | 2 / 50 tons |

p6: "* There are no data available for ship categories with longer lengths that have bow thrusters. In the case of such a ship the calculation should be based on the tables without side thrusters and on the available power of the ship's side thrusters under the responsibility of the master or pilot."

- Ship Repair Zone (p17): "Towage operations in the repair area for all categories of ships except container ships have the same requirements in terms of pulling power and minimum number of tugs as those in the commercial port."
- Drydocking (p20): "[...] the same requirements in terms of tugboat pulling power, as those of the commercial port, with the requirement that there are always at least two (2) tugboats for safety reasons."

---

## 5. Inconsistencies and garbled text (verbatim)

1. **G5 berthing unit.** "Charge in € / current measure" (p5) is most likely a mistranslation of "running metre". The lead-in says "for each metre - based on their length overall (LOA) - and for each day of stay".
2. **G5 port-use table.** The header "Charge in € / From 1/4/2012" spans the whole table, but rows 1.2 and 1.3 carry their own sub-headers ("From 1/1/2025 / From 1/1/2027", "From 1/1/2019 / From 1/4/2024"). The same layout appears in the berthing table. The column mapping was confirmed by table extraction: row 1.3 = 0,053 (from 1/1/2019) and 0,061 (from 1/4/2024).
3. **G5 Art. 3 A.6 (p7).** "the port entry and the parable and berthing charges" ("parable" is garbled, probably "stern-berthing" or "harbouring").
4. **G5 Art. 4.1 (p8).** "-which, at their request-and following aproval by the competent authority, beth to Central Port quays" (typos "aproval" and "beth").
5. **G5 mooring row (p7).** "Per work step (lashing or unlashing" has no closing parenthesis. "lashing/unlashing" is used for making fast and letting go.
6. **G5 place names.** "Salamis"/"Ambelakia" (p2) and "Salamina"/"Ampelakia" (p8) refer to the same places.
7. **G5 capacity basis.** Port use says "total capacity (GRT or G.T.)" (p4). Anchorage says "per G.T." (p8). Art. 6.5 says GT under ITC 1969 for international voyages.
8. **G6 vs G7 GRT bands.** G6 σΜ table has "GRT= 0-1,000" and "GRT= > 50,000", while the G6 fee table has "Ships ≥ 50,001 GRT". G7 has "GRT = 1 - 1.000" and "GRT = > 50.001". G7 leaves exactly 50.001 GRT ambiguous between band 8 (upper edge 50.000) and "> 50.001". G6 mixes "1.000" (dot) with "1,001" (comma) as the thousands separator in the same table (p4).
9. **G6 transit wording.** "the above fees have a 70% discount" sits above the header "FEE IN € 30% (<48h)". These are consistent, since the ship pays 30 %. G7 has "a 70 % reduction" (p1) and the header "FEE IN € 30% (<48h)".
10. **G7 rounding.** "174,75x5" → "262,13" and "174,75x3" → "157,28". 0,3 × 873,75 = 262,125 and 0,3 × 524,25 = 157,275, so these are rounded half-up as printed. "174,75x1" → "52,43" (0,3 × 174,75 = 52,425).
11. **G6 typos and number formats.** "Six and nighty two (6,92) € / day" (p10). "8.202.87 €" (p16, §8.1.1.4) against "8.202,87 €" (p18, §8.2.1.4). In 8.1.1.2 B (tankers, "up to 400ΜΤ") the next line reads "Charge for each additional ΜΤ (over 200)". In 8.1.1.3 "Lump-sum price for 2 hours up to 15ΜΤ" is followed by "Charge for each additional hour (over 3 hours)" and "Charge for each additional ΜΤ (over 200)". In 8.2.1.2 Greek text is left in place: "(πέραν των 200)". On p6 "within that 4 calendar-month period" appears where the fee covers "a delivery per calendar quarter".
12. **G6 sewage.** §3.1 uses lower-case "στ=169" and "Fee = 169 x σμ", where the oily section uses "σΤ"/"σΜ".
13. **G6 §4 (customs € 115.30).** It is placed under comments that "relate to all fees under paragraph 3.2" (scheduled routes), yet it says "All liquid waste deliveries".
14. **G7 typos.** "Montlhy" (p5). "fixed feeσ" (p10). "Eighty seven € and thirty eight cents (87,37)€ /semester" (p9): the words say ,38 and the figure says 87,37. "Seventy one € and twenty four cents (71,24)€ /arrival" is headed "Daily solid waste reception facilities fixed fee" (p6). "Fifty two € and forty two cents (52,42)€ /day" is headed "fixed fee per arrival" (p7). Container rental is "CONTAINER 20 m3 | 52,43€" and "35 m3 | 61,16€" in 8.1.9 but "52,42€" and "61,15€" in 8.2.9. Full stops replace commas throughout (e.g. "SHIPS with non scheduled traffic \-non regular calls").
15. **G7 effective date.** Only "Rev_2026_01" is printed, with no date. G6 states "IMPLEMENTATION FROM 1-5-2026".
16. **G8 numbering.** It jumps 6.1, 6.2 to "6.4" with no 6.3 (p4). It contains "11. 11. The general institutional framework" (p2), "Law 4404/2016 (Government Gazette A 126/8-7-201)" with the year truncated (p1), "TRHUSTERS" (p11, p13) and "≤21000 TUEs" (p14). Art. V.8 refers to "article 6" while the article is numbered "ARTICLE VΙ".
17. **G8 categories.** The length categories carry no unit. The bulk-carrier tables stop at "IV. (201-250)", and the bow-thruster tables stop at "III. (151-200)".

---

## 6. Open questions for the package author

1. **Mooring steps per call.** Is the charge two work steps per call (one for making fast, one for letting go, i.e. 2 × 600,00), and also per shift? The text says "Per work step (lashing or unlashing)" without a count.
2. **When does PPA mooring apply?** It applies "In case the mooring is not provided by the pilotage service". At Piraeus cargo berths, does pilotage normally provide mooring, so that the 600,00 is not charged in most bulk calls? Is a source available?
3. **What is "Exceptional service provision (lashing and unlashing) | Per work | 48,00"**, and does it apply to cargo ships?
4. **Berthing basis.** Confirm that "current measure" means a running metre of LOA, so the formula is 1,033 × LOA (m) × days. Confirm how 6.2 (≤ 6 h spanning two days = 1 day) combines with the 00.01–24.00 calendar-day rule for a multi-day call.
5. **Anchorage 0,397.** There is no effective date. Is it current? Is it "per G.T. per undividable 15-day block", with a 15-day block started on day 1? Does exemption B.6 (anchoring ≤ 48 h for supplies or crew change) waive both the anchorage charge and port use?
6. **Port use on anchorage only.** Is "Use of the Port" (0,061/GT, "for each arrival") also due for a ship that only anchors and does not berth? Art. 3 A says "land or dock or remain arbitrary".
7. **Tonnage basis.** G5 uses GT (ITC 1969). G6 and G7 band on "GRT". For the waste fees, should the engine use GT as the GRT proxy?
8. **The 50.001 GRT band edge.** For a ship of exactly 50.001 GRT (or 50,000 in G6), which σΜ applies? Our assumption is σΜ = 10 for ≥ 50.001, following the G6 fee table "Ships ≥ 50,001 GRT".
9. **G7 effective date.** Does "Rev_2026_01" mean 1 Jan 2026? Has the 1 January CPI adjustment (G6 §12, G7 §10) already been applied to these printed figures, or should the engine index them?
10. **Prepaid waste fees.** In the PDA, should the full prepaid fee (liquid 384×σΜ + sewage 169×σΜ + solid 174,75×σΜ) be shown with an 80 % refund note when waste is delivered, or should the net 20 % be shown?
11. **Customs authorisation € 115.30.** Is it due on every liquid-waste delivery by an unscheduled ship? Is it a PDA item?
12. **Tugs.** G8 has no rates. Which private tug operator tariff is used? G8 categories are presumably LOA in metres, but no unit is printed. Which Beaufort column should the PDA assume (4 Bft?), and should it count mooring and unmooring separately? How are bulk carriers over 250 m handled, given that the G8 bulk table ends at "IV. (201-250)"?
13. **Successive PPA/PCT approach.** Is the 50 % share relevant for any bulk berth? PCT (Piers II/III) is container-only.
14. **Out of scope of this pack.** Pilotage, light dues, agency fee, health, launch and VAT treatment are not present in G5–G8. The VAT status of PPA charges is not stated anywhere.
