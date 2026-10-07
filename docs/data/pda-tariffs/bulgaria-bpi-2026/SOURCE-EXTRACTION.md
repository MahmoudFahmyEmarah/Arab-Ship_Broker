# Bulgaria (Varna / Burgas) PDA tariff extraction: foreign-flag dry bulk carrier, international call

Extracted 7 Oct 2026 from `D:\ASB_Projects\Arab Shipborker\Arabshipbroker\tmp\Data\BULGARIAN PORTS.zip` (read in memory; members copied to `scratchpad\bulgaria\` only for rendering). Issuer of all four: ДП „Пристанищна инфраструктура“ (State Enterprise Port Infrastructure, BPI). Law abbreviation used throughout: ЗМПВВППРБ (Law on Maritime Spaces, Inland Waterways and Ports of the Republic of Bulgaria).

All quoted Bulgarian text was transcribed from page images (B13, B15, B7 are scans with no text layer) or from the PDF text layer (B16). Rates are copied character for character, comma decimals kept.

## 0. Sources

| Ref | Zip member path (inside `BULGARIAN PORTS.zip`) | Bytes | SHA-256 of member bytes | Pages | Text layer |
|---|---|---|---|---|---|
| B13 Burgas | `BULGARIAN PORTS/Tariff for port fees collected by Bulgarian Ports Infrastructure Company in a port within the meaning of Art. 106a of the Law on Maritime Spaces, Inland Waterways and Ports of thebourgas_15112023_tariffa.pdf` | 229754 | `41d802dd5a992617d2a2496f52e09ea4acd767c0b973781d864cb91edd5791aa` | 7 | none (scan) |
| B15 Varna | `BULGARIAN PORTS/Tariff for port fees collected by State Enterprise Port Infrastructure in a port within the meaning of Art. 106a of the Law on Maritime Spaces, Inland Waterways and Ports of the Repvarna_15112023_tariffa.pdf` | 228395 | `071271508457ca0ed516fc01e34f186ae9e299b20d950395edd5ff598501aad6` | 7 | none (scan) |
| B16 Waste | `BULGARIAN PORTS/Tariff for port fees for reception and handling of waste collected by Bulgarian Ports Infrastructure Companytarifa-otpadaczi-dppi_05032026.pdf` | 161135 | `597ea501fdc6eee56874a402a1055bd1df4ff080a66e2e20dc49914b9c1e2feb` | 4 | yes |
| B16 duplicate (B17) | `BULGARIAN PORTS/Tariff for Port Fees for Reception and Processing of Ship-generated Waste Collected by BPICtarifa-otpadaczi-dppi_05032026.pdf` | 161135 | `597ea501…1e2feb` (identical) | – | – |
| B7 Price list | `BULGARIAN PORTS/Price list of services offered by Bulgarian Ports Infrastrczenorazpis-rd-09-24.pdf` | 947356 | `a2499b8c857f2fdb661e2a799476bea03678e79f6a7ea566844c08900e9fbf23` | 4 | none (scan) |

Legibility: every page of B13 (7/7), B15 (7/7), B16 (4/4) and B7 pp. 1 and 4 was read. All typed text is clean and legible. Only the handwritten fill-ins (protocol / order numbers and dates) need care; see section 8.

Structure note: B13 and B15 are word-for-word identical except the port name, the district longitude, the list of roads in Art. 2(4)/(5), the word „с търговска цел“ in Art. 2(14) (Varna only), and four ITD cells in District II (see section 1).

---

## 1. ITD: Infrastructure access fee (Инфраструктурна такса за достъп, ИТД)

### 1.1 Headings and unit (identical in B13 and B15, Art. 2(1)–(2), p. 1–2)

> Чл. 2. (1) За всяко посещение на кораб в пристанище за обществен транспорт [Бургас / Варна] по смисъла на чл. 106а от ЗМПВВППРБ (чл.103в, ал.1 т.1 от ЗМПВВППРБ) или в пристанище по чл. 107 – 109 от ЗМПВВППРБ, в случай на чл.109а, ал.3 от ЗМПВВППРБ, се събира пристанищна такса за ползване на пристанищна инфраструктура, която се формира от три компонента: Инфраструктурна Такса за Достъп (ИТД), Светлинна Инфраструктурна Такса (СИТ) и Оперативна Инфраструктурна Такса (ОИТ).

EN: For every call of a ship at the public-transport port [Burgas / Varna] … a port fee for use of port infrastructure is collected, made of three components: Infrastructure Access Fee (ITD), Light Infrastructure Fee (SIT) and Operational Infrastructure Fee (OIT).

> (2) За обезпечаване на достъпа до съответното пристанище, включително за покриване на разходите за изграждане и поддържане на инфраструктурата за достъп и другата обща техническа инфраструктура на пристанището, се събира инфраструктурна такса за достъп (ИТД), в евро за един бруто тон, по тип кораб, за съответния район, както следва:

EN: … an infrastructure access fee (ITD) is collected, **in euro per one gross ton, by ship type, for the respective district**, as follows:

**Unit: EUR per GT, per call** ("за всяко посещение на кораб", Art. 2(1)). Column header: „Инфраструктурна такса за достъп (ИТД)“ split into „Район I“ / „Район II“; row header „Типове кораби“.

### 1.2 Districts (Art. 1(1), p. 1)

| Port | Район I (District I) | Район II (District II) |
|---|---|---|
| Burgas (B13) | „район I - на изток от: 27° 29' 00" E“ (east of 27°29'00"E) | „район II - на запад от: 27° 29' 00" E“ (west of 27°29'00"E) |
| Varna (B15) | „район I - на изток от: 27° 45' 54" E“ (east of 27°45'54"E) | „район II - на запад от: 27° 45' 54" E“ (west of 27°45'54"E) |

**Terminals are NOT named anywhere in either tariff.** Districts are defined only by the meridian. Additional provision 19 says: if a terminal's territory/water area straddles two districts, it belongs to the district containing the predominant part. Any terminal-to-district mapping (e.g. Varna-East vs Varna-West/Devnya, Burgas-East vs Burgas-West) is outside these documents; see Open questions. My geographic inference, **not printed, [uncertain]**: Varna-East (city harbour) would be District I and Varna-West (Devnya lakes) District II; for Burgas I cannot place terminals on 27°29'00"E with confidence.

### 1.3 Table: Burgas (B13, p. 2), EUR/GT

| Типове кораби (ship type) | Район I | Район II |
|---|---|---|
| Кораби за генерални/насипни товари (general/bulk cargo ships) **← BULK CARRIER** | **0,59** | **0,60** |
| Нефтен танкер, Нефтен химикаловоз, LPG танкер | 0,54 | 0,57 |
| Танкер/Химикаловоз | 0,59 | 0,60 |
| Хладилни кораби и контейнеровози | 0,34 | 0,38 |
| Пътнически кораби | 0,24 | 0,25 |
| Кораби за спорт/развлечение с нетърговска цел | 0,14 | 0,17 |
| Чуждестранни военни кораби | 0,29 | 0,32 |
| Кораби, посещаващи пристанища по чл. 107 – 109, (чл.109а, ал.3 от ЗМПВВППРБ) | 0,09 | 0,12 |
| Други типове кораби | 0,59 | 0,60 |

### 1.4 Table: Varna (B15, p. 2), EUR/GT

| Типове кораби (ship type) | Район I | Район II |
|---|---|---|
| Кораби за генерални/насипни товари **← BULK CARRIER** | **0,59** | **0,60** |
| Нефтен танкер, Нефтен химикаловоз, LPG танкер | 0,54 | **0,63** (Burgas 0,57) |
| Танкер/Химикаловоз | 0,59 | 0,60 |
| Хладилни кораби и контейнеровози | 0,34 | 0,38 |
| Пътнически кораби | 0,24 | 0,25 |
| Кораби за спорт/развлечение с нетърговска цел | 0,14 | **0,23** (Burgas 0,17) |
| Чуждестранни военни кораби | 0,29 | **0,38** (Burgas 0,32) |
| Кораби, посещаващи пристанища по чл. 107 – 109, (чл.109а, ал.3 от ЗМПВВППРБ) | 0,09 | 0,12 |
| Други типове кораби | 0,59 | 0,60 |

Both tables were re-checked on 300-dpi crops; all digits are sharp.

### 1.5 Bulk-carrier classification

The row is „Кораби за генерални/насипни товари“ (no separate "сухотоварни" row). Additional provisions (B13 p. 5 / B15 p. 5), item 7:
> 7. „Кораб за насипни товари“ е всеки кораб, който превозва сухи неопаковани товари.
EN: "Bulk cargo ship" is any ship carrying dry unpacked goods.

Preamble of the additional provisions: ships carrying live animals, combined cargo, or more than one type of cargo „се считат като кораби за генерални товари“ (are treated as general cargo ships), which sits in the same row anyway.

**Applicable cell for a dry bulk carrier: 0,59 €/GT (District I) or 0,60 €/GT (District II), at both Varna and Burgas.**

---

## 2. SIT: Light infrastructure fee (Светлинна инфраструктурна такса, СИТ)

Identical in B13 and B15, Art. 2(12), p. 3:

> (12) За посещение в пристанище за обществен транспорт [Бургас / Варна] по смисъла на чл. 106а от ЗМПВВППРБ или в пристанище по чл. 107 – 109 от ЗМПВВППРБ, в случай на чл.109а, ал.3 от ЗМПВВППРБ, и за плаване между терминали за навигационно осигуряване и поддържане на корабоплаването се събира светлинна инфраструктурна такса (СИТ), както следва:
> 1. за кораби с големина до 40 БТ включително - годишна такса за посещенията в пристанище:
> а) за кораби с големина до 10 БТ - 5 евро;
> б) за кораби с големина от 11 до 40 БТ - 10 евро;
> 2. за кораби с големина над 40 БТ - при всяко посещение в пристанище:
> а) за кораби с големина от 41 до 500 БТ - 15 евро;
> б) за кораби с големина от 501 до 1000 БТ - 40 евро;
> в) за кораби с големина от 1001 до 5000 БТ - 70 евро;
> г) за кораби с големина от 5001 до 10 000 БТ - 110 евро;
> д) за кораби с големина над 10 000 БТ - 150 евро.

| GT band | Rate | Unit |
|---|---|---|
| до 10 БТ | 5 евро | annual (годишна такса) |
| 11 – 40 БТ | 10 евро | annual |
| 41 – 500 БТ | 15 евро | per call (при всяко посещение) |
| 501 – 1000 БТ | 40 евро | per call |
| 1001 – 5000 БТ | 70 евро | per call |
| 5001 – 10 000 БТ | 110 евро | per call |
| над 10 000 БТ | **150 евро** | per call |

EN: Light fee is charged for a call at the port *and for passage between terminals* for navigational support. Conditions: (13) passenger ships ×0,5; (14) foreign warships 0,15 €/started tonne full displacement, max 150 €/ship (Varna adds „с търговска цел“, "with commercial purpose"). No reduction for bulk carriers. **Typical bulk carrier (>10 000 GT): 150 € per call.**

Ambiguity [uncertain]: "и за плаване между терминали" could mean a shift between terminals within the port triggers another SIT. The text does not say whether a shift is a separate charge or part of the same call.

---

## 3. OIT: Operational infrastructure fee (Оперативна инфраструктурна такса, ОИТ)

Identical in B13 and B15, Art. 2(15)–(18), p. 4:

> (15) За всяко конкретно посещение на кораб в пристанище за обществен транспорт [Бургас / Варна] по смисъла на чл. 106а от ЗМПВВППРБ или в пристанище по чл. 107 – 109 от ЗМПВВППРБ, в случай на чл.109а, ал.3 от ЗМПВВППРБ, при преминаване на кораб през пристанищната инфраструктура за достъп по море и вътрешни водни пътища, включващи подходните канали, зони за подхождане и зони за маневриране на корабите, рейдове и котвени стоянки, както и за поддържане на проектните дълбочини в акваторията на пристанището се събира оперативна инфраструктурна такса (ОИТ) в размер 0,10 евро за всеки започнат линеен метър от максималната дължина на кораба, обявена в корабните документи.

EN: For each call … an OIT of **0,10 euro for every started linear metre of the ship's maximum length (LOA) as declared in the ship's documents** is collected.

> (16) Таксата по ал. 15 се събира за периода от действителното време на пристигане на кораба до действителното време на напускане на пристанище за обществен транспорт [Бургас / Варна] по смисъла на чл. 106а от ЗМПВВППРБ, с изключение на времето за престой на рейд, измерен в часове и закръглен към следващия пълен час.

EN: The fee under (15) is collected **for the period from actual arrival to actual departure, excluding time waiting at the roads, measured in hours and rounded up to the next full hour.**

> (17) [ports under Art. 107–109 using Art. 106a access infrastructure:] … таксата по ал. 15 се събира за периода от действителното време на пристигане … до швартоването му и периодът от отшвартоването му до действителното време на напускане … с изключение на времето за престой на рейд, измерен в часове и закръглен към следващия пълен час.

EN: For private ports (Art. 107–109) reached via the public access infrastructure: only arrival→mooring plus unmooring→departure, excluding roads, in hours rounded up.

> (18) Чуждестранни военни кораби … заплащат оперативна инфраструктурна такса в размер 0,5 евро за всеки започнат линеен метър … за всяко започнато денонощие.

**Formula (my reading): OIT = 0,10 € × ceil(LOA m) × ceil(hours from arrival to departure, roads excluded).**
- **Important wording point [uncertain]:** paragraph (15) does **not** literally say „на час“ (per hour). The per-hour reading comes only from (16) ("collected for the period … measured in hours and rounded up to the next full hour"). Compare (18) for warships, which states the time unit explicitly („за всяко започнато денонощие“, per started day). Per started metre per started hour is the natural reading, and it matches the catalogue, but the text never says so in one sentence.
- LOA rounding: additional provision 20 ends „Дължината на кораба се закръгля към по-голямото цяло число.“ (LOA is rounded up to the next whole number). "Hour" (provision 21) is an astronomical hour, minute to same minute.
- **Minimum / maximum: none printed.** **Free time: none printed.** Who pays: every ship on every call (para 15); warships under (18). Ferries and Ro-Ro are covered by the flat 815 € under Art. 3 (see section 4).
- Roads time is excluded from the OIT; roads use is charged separately under Art. 2(4)/(5).

---

## 4. Multipliers, reductions, special regimes (verbatim)

Page numbers are the same in B13 and B15 unless noted.

**4.1 4th and later call, ITD only: Art. 2(3), p. 2**
> (3) За четвърто и всяко следващо посещение на кораб в пристанище за обществен транспорт [Бургас / Варна] по смисъла на чл. 106а от ЗМПВВППРБ в рамките на една календарна година, инфраструктурната такса за достъп (ИТД) се редуцира с коефициент:
> 1. за кораби за генерални/насипни товари, нефтени танкери, нефтени химикаловози, LPG танкери и танкер/химикаловоз – 0,72;
> 2. за хладилни кораби и контейнеровози – 0,95.

EN: For the 4th and every subsequent call of a ship at the port [Burgas / Varna] within one calendar year, the ITD is reduced by a coefficient of 0,72 for general/bulk ships, oil tankers, oil chemical tankers, LPG tankers and tanker/chemical tankers; 0,95 for reefers and container ships. (Counted per port, it seems: "в пристанище … Бургас" / "Варна". Not counted across both ports. [uncertain])

**4.2 Roads/anchorage use for supplies, no cargo work: Art. 2(4), p. 2**
- Burgas: > (4) За всички кораби, ползващи котвена стоянка на Рейд Бургас и Рейд Несебър, за снабдяване с гориво, вода и провизии, необходими за техните собствени нужди, за наемане и освобождаване на екипаж, за получаване и доставяне на поща или за ремонт се заплаща пристанищна такса за ползване на пристанищна инфраструктура в размер на 0,02 евро на бруто тон, за всеки започнати 48 часа, по предоставени данни от СПД „РКТ – Черно море“.
- Varna: identical, but the roads are „Рейд Варна, Рейд Балчик и Варна рейд Езерово“.

EN: All ships using the anchorage at Burgas Roads and Nesebar Roads (Varna: Varna Roads, Balchik Roads and Varna Ezerovo Roads) for fuel, water and provisions for their own needs, crew change, mail, or repair pay **0,02 euro per GT for every started 48 hours**, based on data from VTS "RKT – Black Sea".

**4.3 Cargo transfer at anchor: Art. 2(5), p. 2**
> (5) За всички кораби, ползващи котвена стоянка на Рейд Бургас и Рейд Несебър [Varna: Рейд Варна, Рейд Балчик и Варна рейд Езерово], за претоварни процеси или разтоварване на пътници без посещение на пристанищен терминал, се заплаща такса в размер на 0,20 евро на един бруто тон.

EN: Ships using the anchorage for transhipment or landing passengers without calling at a port terminal pay 0,20 euro per GT. (No time unit is given; presumably per operation/call. [uncertain])

**4.4 Calls without cargo operations: Art. 2(6), p. 2**
> (6) За кораби, посещаващи пристанище за обществен транспорт [Бургас / Варна] по смисъла на чл. 106а от ЗМПВВППРБ за снабдяване с гориво, вода и провизии, необходими за техните собствени нужди, за наемане и освобождаване на екипаж, за получаване и доставяне на поща, както и за кораби, извършващи докуване и ремонт, без да извършват товарно-разтоварна дейност, таксата по чл.2 ал.2 се редуцира с коефициент 0,70.

EN: For ships calling at the port for fuel, water, provisions, crew change, mail, or docking and repair, **without cargo operations**, the fee under Art. 2(2) [= the ITD] is reduced by coefficient 0,70.

**4.5 Segregated-ballast tankers: Art. 2(7)**: reduced GT from the 1969 tonnage certificate (not relevant to bulk).

**4.6 Special, auxiliary and construction craft: Art. 2(8)–(9)**: 0,50 per started month, no unit printed (presumably €/GT [uncertain]); these ships do not pay under 2(4)/(5). Not relevant to bulk.

**4.7 Art. 2(10)**: container ships, reefers, passenger and ro-ro/ferry ships handled other than as their certificate states, or carrying general cargo, or staying longer than usual, pay the general-cargo rates.

**4.8 Ferries / Ro-Ro flat: Art. 3, p. 4**
> Чл. 3. Фериботните кораби и ро-ро корабите заплащат пристанищни такси общо в размер 815 евро за всяко посещение.
EN: Ferries and ro-ro ships pay port fees totalling 815 euro per call.

**4.9 Cabotage: Art. 4, p. 4**
> Чл. 4. При плаване между български пристанища и/или пристанищни терминали на български пристанища инфраструктурната такса за достъп (ИТД) по чл.2, ал.2 се редуцира с коефициент:
> 1. за кораби за генерални/насипни товари, нефтени танкери, нефтени химикаловози, LPG танкери и танкер/химикаловоз – 0,20;
> 2. за хладилни кораби и контейнеровози – 0,25.
EN: For voyages between Bulgarian ports and/or terminals of Bulgarian ports, the ITD is reduced by coefficient 0,20 (general/bulk, tankers) or 0,25 (reefers, containers). Does not apply to an international call.

**4.10 Only one reduction: Art. 5, p. 4**
> Чл. 5. Когато за един кораб се полагат две и повече намаления съгласно Тарифата, се прилага само едно, което е по-благоприятно.
EN: When a ship qualifies for two or more reductions under the Tariff, only one applies, the more favourable.

**4.11 Rounding, payment, currency: Art. 6, p. 4**
> Чл. 6. (1) Дължимите суми по тарифата се закръгляват към цяло евро.
> (2) Таксите по тарифата се заплащат преди отплаването на кораба, посетил съответното пристанище за обществен транспорт и периодично, за корабите, които оперират в пристанище.
> (3) Дължимите пристанищни такси се заплащат в евро или в левовата равностойност по централния курс на Българската народна банка в деня на издаване на фактурата.
EN: (1) Amounts due are rounded to whole euros. (2) Paid before sailing (periodically for ships operating in port). (3) Paid in EUR or the BGN equivalent at the BNB central rate on the invoice date.

Not specified: whether rounding applies per component or to the total [uncertain].

**4.12 Final provision: individually negotiated differentiation (p. 7)**
> ДП „Пристанищна инфраструктура“, в качеството си на управителен орган на пристанищата по смисъла на чл.106а от ЗМПВВППРБ е допустимо да приложи диференциране в таксите, което е резултат от индивидуални преговори и не е длъжно да го оповестява.
EN: BPI may apply fee differentiation resulting from individual negotiations and is not obliged to disclose it.

---

## 5. B16: Waste reception fees (Тарифа за пристанищните такси за приемане и обработване на отпадъци от кораби)

Title (p. 1): „ТАРИФА за пристанищните такси за приемане и обработване на отпадъци от кораби, събирани от Държавно предприятие „Пристанищна инфраструктура““.

Who pays: Art. 1 and Art. 3, p. 1:
> Чл. 3. Всички кораби, които имат престой или оперират във всяко пристанище за обществен транспорт, по смисъла на чл. 106а от ЗМПВВППРБ, независимо от това дали ползват пристанищни приемни съоръжения или не, заплащат пристанищни такси за приемане и обработване на отпадъци от кораби, определена в евро, както следва:
> 1. корабите във всяко пристанище за обществен транспорт, включително чуждестранните военни кораби, когато се използват с търговска цел, заплащат следните пристанищни такси, определени в зависимост от бруто тонажа, съответно от водоизместването – за военните кораби, както следва:

EN: All ships staying or operating at any Art. 106a public port pay, **whether or not they use reception facilities**, the following fees in EUR by GT (displacement for warships). Art. 1 excludes military ports ("с изключение на военните").

Table (p. 2). Column headings verbatim:
- col 0 „Бруто тон / водоизместване (само за чуждестранни военни кораби)“
- A „Такса отпадъци от нефтопродукти (Анекс I на МАРПОЛ 73/78)“
- Б „Обичайни количества отпадъци, (Анекс I на МАРПОЛ 73/78), м3“
- A1 „Такса битово - отпадни води (Анекс IV на МАРПОЛ 73/78)“
- Б1 „Обичайни количества отпадъци, Анекс IV на МАРПОЛ 73/78), м3“
- A2 „Такса твърди отпадъци (Анекс V на МАРПОЛ 73/78)“
- Б2 „Обичайни количества отпадъци, Анекс V на МАРПОЛ 73/78), м3“

| GT | A: Annex I fee € | Б: Annex I free m³ | A1: Annex IV fee € | Б1: Annex IV free m³ | A2: Annex V fee € | Б2: Annex V free m³ |
|---|---|---|---|---|---|---|
| 0 - 2 000 | 45,00 | 7,0288 | 15,00 | 7,0288 | 45,00 | 0,4252 |
| 2 001 - 3 000 | 110,00 | 8,5568 | 20,00 | 8,5568 | 70,00 | 0,4535 |
| 3 001 - 6 000 | 140,00 | 8,5568 | 25,00 | 8,5568 | 85,00 | 0,5102 |
| 6 001 - 10 000 | 210,00 | 12,2239 | 30,00 | 12,2239 | 105,00 | 0,9354 |
| 10 001 - 20 000 | 230,00 | 15,8911 | 35,00 | 15,8911 | 140,00 | 1,0488 |
| 20 001 - 30 000 | 260,00 | 17,1135 | 40,00 | 17,1135 | 200,00 | 1,2755 |
| 30 001 - 40 000 | 460,00 | 22,0031 | 45,00 | 22,0031 | 270,00 | 1,9842 |
| 40 001 - 50 000 | 710,00 | 23,2255 | 50,00 | 23,2255 | 420,00 | 2,8345 |
| > 50 001 | 910,00 | 24,4479 | 60,00 | 24,4479 | 570,00 | 4,2518 |

Text layer and page image agree on every cell. Oddities, printed as is: Б and Б1 carry identical m³ figures in every row; bands 2 001–3 000 and 3 001–6 000 share 8,5568; the top band reads "> 50 001", so 50 001 GT exactly falls in no band [uncertain edge].

Explanatory notes („Пояснения“, p. 2–3), key items verbatim:
> 1. В колони А, А1 и А2 е посочен размерът на непреките такси, в евро за съответния вид отпадъци. …
> 2. В колони Б, Б1 и Б2 е посочено обичайното количество отпадъци, изразено в кубически метри (м3), до което корабът може да предаде отпадъци от съответния вид, без да заплаща допълнително. …
> 3. При предаване на отпадъци над обявеното обичайно количество в колони Б, Б1 и Б2, корабът заплаща пряка такса на съответните оператори на отпадъци, съгласно определена от тях тарифа.
> 4. Всеки кораб, който оперира в пристанище за обществен транспорт, по смисъла на чл.106а от ЗМПВВППРБ заплаща непряка такса, определена в съответствие с таблицата по т.1, за всеки започнат месец и има право на едно предаване на отпадъци в месеца.
> 5. В случай, че корабът в рамките на едно посещение на съответното пристанище предава повторно отпадъци се заплаща на съответните пристанищни оператори на отпадъци, съгласно определена от тях тарифа.
> 7. Непряката такса, включва и разходите за престой на мобилното приемно съоръжение до 3 часа от започването на операцията по предаване на отпадъци. След изтичане на трите часа корабът заплаща разходите за престоя на мобилното приемно съоръжение на оператора на отпадъци, съгласно определена от него тарифа.
> 8. Размерът на обичайните количества отпадъци по Анекс V … за ро-ро и фериботни кораби … се увеличава с 50 % …
> 9. … не попадат в обхвата на таксуване по т. 1 … Анекс II … Анекс VI … остатъци от товари … миячни води, баластни води, твърди остатъци от товари, материали за укрепване на товара …

EN summary:
- A/A1/A2 are **indirect fees** (непряка такса, defined in § 2 as payable whether or not waste is landed), in EUR per waste type.
- Б/Б1/Б2 are the "usual quantities": m³ the ship may land without extra charge.
- **Excess over the free m³: the ship pays a direct fee to the waste operators at their own tariff. No € per m³ figure is printed in B16.**
- Ships *operating* in port pay the indirect fee per started month (one landing per month).
- A second landing within one call is paid to the operators at their tariff.
- The mobile facility's first 3 h are included; time beyond that is paid to the operator.
- Annex II, Annex VI and cargo residues/washings/ballast/dunnage are outside the fee and paid to operators.

**Exemptions (Art. 7, p. 3–4):**
> Чл. 7. Генералният директор … на основание чл. 103д, ал. 3 и 4 от ЗМПВВППРБ може да освободи от заплащане на такса … корабопритежател на кораб, който по реда на наредбата по чл. 371 от Кодекса на търговското корабоплаване е освободен от задължение за предаване на отпадъци от кораби, когато са изпълнени следните условия: 1. корабът извършва редовни превози, свързани с чести и редовни посещения на български морски пристанища; 2. корабопритежателят има сключено споразумение за предаване на отпадъците и плащане на съответните такси в пристанище по маршрута на кораба.

EN: The Director General *may* exempt an owner whose ship is exempt from waste delivery under the Merchant Shipping Code ordinance, if the ship is on a scheduled service with frequent regular Bulgarian calls and the owner has an agreement to deliver waste and pay fees at a port on the route. This is discretionary and in practice not applicable to a tramp bulk carrier. Also excluded: military ports (Art. 1). River terminals pay a flat 10 € (Art. 4), not relevant.

Payment: Art. 5: before sailing (periodically for operating ships); „(3). Дължимите пристанищни такси се заплащат в евро.“ (EUR only).

**Unit for a visiting bulk carrier:** per call (Art. 3 "имат престой", read with § 5 "Посещение на кораб"). The per-started-month rule (note 4) is stated only for ships *operating* in port. Whether a long-staying tramp ship (> 1 month) is billed again is not explicit [uncertain].

---

## 6. B7: Departure clearance certificate

Document heading (p. 1): „ЦЕНОРАЗПИС за таксите, събирани от ДП „Пристанищна инфраструктура“ при предоставяне на услуги и информация на физически и юридически лица“. Section „I. Издаване на свидетелства, справки, удостоверения, писмени извлечения, протоколи от регистри на информационните системи в ДП „Пристанищна инфраструктура““.

> 1. За издаване на свидетелство за отплаване по чл. 22 от Наредбата за организацията за осъществяване на граничен паспортен, митнически, здравен, ветеринарномедицински и фитосанитарен контрол, както и контрол на транспортните средства в пристанищата на Република България, обслужващи кораби от международно плаване – 70,00 (седемдесет) евро.

EN: For issuing a departure certificate under Art. 22 of the Ordinance on border passport, customs, health, veterinary and phytosanitary control and control of vehicles in Bulgarian ports serving ships on international voyages: **70,00 (seventy) euro.** No BGN figure is printed on this line (other lines show "евро / лева").

p. 4: „Посочените цени са без включен данък добавена стойност.“ = **prices exclude VAT.** Per certificate, i.e. per departure (the "per departure" part is implied, not stated).

---

## 7. Effective dates and approving acts

| Doc | Printed approval | Effective date |
|---|---|---|
| B13 Burgas | p. 7: „Структурата и размерите на пристанищните такси са определени на заседание на Управителния съвет на ДП „Пристанищна инфраструктура“, с протокол №…188/ 15.11.….2023 г.“ ("188/ 15.11." handwritten) | No separate "in force from" date is printed. 15.11.2023 = protocol date (also in the filename). Legal basis: ЗМПВВППРБ and Reg. (EU) 2017/352. |
| B15 Varna | p. 7: same wording, protocol №…188/ 15.11.….2023 г. (handwritten) | Same as B13. |
| B16 Waste | p. 4: „Структурата и размерите на пристанищните такси са определени на заседание на Управителния съвет на ДП „Пристанищна инфраструктура“, с Протокол № 203/ 14.10.2024 г. и Протокол 224/23.01.2026 г.“ (typed). Basis: чл. 103в, ал. 1, т. 2 и ал. 2, т. 1 и чл. 115м, ал. 1, т. 6 ЗМПВВППРБ. | **No effective date printed in the document.** 05.03.2026 appears only in the filename. |
| B7 Price list | p. 4: „Ценоразписът е утвърден със Заповед № РД09-24/24.02.2026 г. на генералния директор на ДП „Пристанищна инфраструктура“ и влиза в сила от …01.0?….2026 год.“ (order number and dates handwritten) | Handwritten "01.03" (best reading) or "01.02" [uncertain]; see section 8. |

---

## 8. Garbled, illegible or ambiguous items

1. **B7 effective date [uncertain]:** handwritten „01.0?“. On a 400-dpi crop the second group looks more like **"03"** than "02". The order is dated 24.02.2026, so 01.03.2026 is also the logical reading (an order would not usually take effect before its own date). The catalogue records "01.02.2026"; I believe that is a misreading. **Best reading: in force from 01.03.2026 [uncertain].**
2. **B7 order number [uncertain, minor]:** handwritten „РД09-24/24.02.2026 г.“. The filename "rd-09-24" corroborates "РД-09-24". The date "24.02.2026" is a clear-ish reading.
3. **B13/B15 protocol [minor uncertainty]:** handwritten „188/ 15.11.“ on the dotted line before the printed "2023 г.". Clear in both files. 15.11 matches the filenames.
4. **OIT time unit [uncertain]:** see section 3. "Per started hour" is inferred from para 16; para 15 gives only "0,10 евро за всеки започнат линеен метър".
5. **Art. 2(5), 0,20 €/GT at anchor:** no time or count unit is printed [uncertain].
6. **Art. 2(8), "в размер на 0,50":** no currency or unit is printed. Not relevant to bulk.
7. **Terminal → district mapping:** not printed in either tariff.
8. **B16 "> 50 001":** 50 001 GT is not covered by any band (gap between 50 000 and > 50 001). Typographic; treat as ≥ 50 001 [uncertain].
9. **B16 effective date:** not printed. Only the protocols (14.10.2024, 23.01.2026) and the filename (05.03.2026) give dates.
10. B13/B15 numbering glitch (p. 6 / p. 5–6): two items numbered "11" („Танк за изолиран баласт“ is run into item 10). This is cosmetic.
11. No page was unreadable.

---

## 9. Worked frame (not a quote): foreign-flag dry bulk carrier, international call, 1st–3rd call of the year, with cargo

- ITD = GT × 0,59 (District I) or 0,60 (District II), at Varna and Burgas alike.
- SIT = 150 € if > 10 000 GT.
- OIT = 0,10 × ceil(LOA) × ceil(hours arrival→departure excluding roads).
- Waste = A + A1 + A2 for the GT band (e.g. 30 001–40 000 GT: 460,00 + 45,00 + 270,00 = 775,00 €), plus operator direct fees above the free m³.
- Clearance certificate = 70,00 € + VAT treatment per B7 (prices excl. VAT).
- Rounding: Art. 6(1), whole euros.

Modifiers: 4th+ call ×0,72 on the ITD; no-cargo call ×0,70; only the single most favourable reduction applies (Art. 5).

---

## Open questions for the package author

1. Which terminals fall in District I vs District II at Varna (27°45'54"E) and Burgas (27°29'00"E)? Neither tariff names terminals. A BPI terminal list or chart is needed before the District II cell (0,60) can be selected confidently.
2. OIT: do you accept "0,10 € × started LOA metre × started hour (arrival→departure, roads excluded)"? Para 15 alone does not state "per hour". Is there a BPI invoice example to confirm?
3. Does the 0,70 no-cargo reduction (Art. 2(6)) apply to the ITD only ("таксата по чл.2 ал.2" = ITD), not SIT/OIT? The text points to ITD only.
4. Is the 4th-call count per port (Varna and Burgas separately) and per calendar year, per the wording? Who certifies the count?
5. Does the SIT apply again on a shift between terminals ("и за плаване между терминали")?
6. Does Art. 6(1) whole-euro rounding apply per component or on the total?
7. B7 effective date: confirm 01.03.2026 (my reading) vs 01.02.2026 (catalogue). Is VAT chargeable on the 70,00 € for a foreign-flag international call?
8. B16: what is its effective date (the filename says 05.03.2026; the document prints only protocols 203/14.10.2024 and 224/23.01.2026)? For a call longer than one month, is the indirect fee charged again (note 4 speaks only of ships "operating" in port)?
9. B16 excess m³: the operator direct-fee tariffs (Annex I/IV/V per m³) are not in the pack. Are they needed for the PDA, or should excess be a manual line?
10. Is the 15.11.2023 port-fee tariff (B13/B15) still the current one in 2026 after euro adoption? No later version is in the pack.
