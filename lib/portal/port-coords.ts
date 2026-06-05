// Static fallback port coordinates keyed by UN/LOCODE (5-char, no space) -> [lat, lon].
// Live coordinates come from the `ports` table (latitude/longitude) via
// loadPortCoords; this table keeps the maps fully populated and click-responsive
// even before that DB backfill is applied (or when the DB isn't reachable).
//
// Display-grade port-city / terminal centroids (NOT WGS84 berth-precise). Sourced
// from the UNIFIED workbook's 04_PORTS sheet (278 locodes), so the keys match
// the locodes the cargo/vessel records actually use. Plain module (no Leaflet) so
// it is safe to import from server components too.
export const FALLBACK_PORTS: Record<string, [number, number]> = {
  AEDXB: [25.01, 55.06], // Jebel Ali
  AEFUJ: [25.16, 56.34], // Fujairah
  AEJEA: [25.01, 55.06],
  AEKFK: [25.34, 56.36], // Khor Fakkan
  AERWP: [24.11, 52.73], // Ruwais
  ALDRZ: [41.31, 19.45], // Durres
  ALDUR: [41.31, 19.45], // Durres
  AOLAD: [-8.78, 13.23], // Luanda
  ARSLO: [-32.75, -60.73], // San Lorenzo
  BDCGP: [22.31, 91.8], // Chattogram
  BGBAL: [43.42, 28.16], // Balchik
  BGBOJ: [42.49, 27.47], // Bourgas
  BGVAR: [43.2, 27.92], // Varna
  BGVAZ: [43.19, 27.69], // Varna West
  BHBAH: [26.2, 50.61], // Bahrain
  BJCOO: [6.35, 2.43], // Cotonou
  CIABJ: [5.28, -4.01], // Abidjan
  CMDLA: [4.05, 9.69], // Douala
  CNFCG: [21.61, 108.35], // Fangcheng
  CNRIZ: [35.39, 119.54], // Rizhao
  CNTGS: [39.21, 119.02], // Jingtang
  CNZJG: [31.98, 120.42], // Zhangjiagang
  CYFAM: [35.12, 33.95], // Famagusta
  CYLCA: [34.91, 33.64], // Larnaca
  DJJIB: [11.6, 43.14], // Djibouti
  DJTAD: [11.79, 42.88], // Tadjurah
  DZAAE: [36.9, 7.77], // Annaba
  DZALG: [36.77, 3.06], // Algiers
  DZBJA: [36.75, 5.1], // Bejaia
  DZDJN: [36.89, 5.88], // Djen Djen
  DZMOS: [35.93, 0.09], // Mostaganem
  DZORN: [35.71, -0.64], // Oran
  DZSKI: [36.88, 6.91], // Skikda
  DZTEN: [36.52, 1.31], // Tenes
  DZTNS: [36.52, 1.31], // Tenes
  EGAAC: [31.13, 33.8], // El Arish
  EGABQ: [31.32, 30.07], // Abu Qir
  EGADB: [29.87, 32.48], // Adabiya
  EGALY: [31.2, 29.87], // Alexandria
  EGDAM: [31.42, 31.82], // Damietta
  EGDKH: [31.15, 29.81], // El Dekheila
  EGHAM: [26.26, 34.2], // Hamrawein
  EGPSD: [31.26, 32.3], // Port Said
  EGPSE: [31.25, 32.35], // Port Said East
  EGSFW: [26.73, 33.94], // Safaga
  EGSGA: [26.73, 33.94], // Safaga
  EGSOK: [29.6, 32.34], // Ain Sokhna
  EHLAY: [27.1, -13.42], // Laayoune
  ERMSA: [15.61, 39.47], // Massawa
  ESAGP: [36.69, -4.41], // Malaga
  ESALI: [38.33, -0.49], // Alicante
  ESAVI: [43.57, -5.93], // Aviles
  ESBCN: [41.34, 2.16], // Barcelona
  ESCAD: [36.53, -6.28], // Cadiz
  ESCAS: [39.96, -0.02], // Castellon
  ESCRB: [36.99, -1.9], // Carboneras
  ESFRO: [43.49, -8.24], // Ferrol
  ESGIJ: [43.56, -5.7], // Gijon
  ESLCG: [43.36, -8.39], // La Coruna
  ESMAL: [36.69, -4.41], // Malaga
  ESROT: [36.62, -6.35], // Rota
  ESSAG: [39.63, -0.21], // Sagunto
  ESSAN: [43.46, -3.8], // Santander
  ESSGN: [39.63, -0.21], // Sagunto
  ESSVQ: [37.33, -6.01], // Seville
  ESVGO: [42.24, -8.73], // Vigo
  FRBAY: [43.5, -1.47], // Bayonne
  FRLRH: [46.16, -1.22], // La Rochelle
  FRSET: [43.4, 3.7], // Sete
  FRURO: [49.44, 1.1], // Rouen
  GALIB: [0.39, 9.45], // Libreville
  GBGAR: [53.35, -2.9], // Garston
  GBGRI: [53.57, -0.07], // Grimsby
  GBSOU: [50.9, -1.4], // Southampton
  GEBUS: [41.65, 41.64], // Batumi
  GEPTI: [42.15, 41.67], // Poti
  GHTEM: [5.62, 0.01], // Tema
  GNCKY: [9.51, -13.71], // Conakry
  GNKAM: [10.65, -14.61], // Kamsar
  GRAPL: [39.16, 22.91], // Amaliapolis
  GRATH: [37.94, 23.64], // Athens / Piraeus
  GRAXD: [40.85, 25.87], // Alexandroupolis
  GRFLS: [38.04, 23.54], // Eleusis
  GRGPA: [38.24, 21.73], // Patras
  GRKLM: [37.91, 23.7], // Kalamaki
  GRKRS: [37.95, 23.62], // Keratsini
  GRKVA: [40.93, 24.41], // Kavala
  GRLAV: [37.71, 24.06], // Lavrion
  GRLRY: [38.57, 23.28], // Larymna
  GRNKV: [40.95, 24.5], // Nea Karvali
  GRNMD: [40.24, 23.28], // Nea Moudhania
  GRPIG: [38.25, 22.08], // Aigion / WC Greece
  GRPIR: [37.94, 23.64], // Piraeus
  GRRET: [35.37, 24.47], // Rethymno
  GRSKG: [40.63, 22.93], // Thessaloniki
  GRSKH: [40.63, 22.93], // Thessaloniki
  GRSNC: [40.95, 24.5], // Nea Karvali / Kavala
  GRTGI: [39.15, 22.85], // Tsingeli
  GRTHI: [38.3, 23.1], // Thisvi
  GRTHS: [40.63, 22.93], // Thessaloniki
  GRTSI: [39.15, 22.85], // Tsingeli
  GRVOL: [39.36, 22.94], // Volos
  GWOXB: [11.86, -15.59], // Bissau
  HNSLO: [15.84, -87.95], // Puerto Cortes
  HRPLO: [43.05, 17.43], // Ploce
  HRPUL: [44.87, 13.84], // Pula
  HRZAD: [44.12, 15.23], // Zadar
  IDBEL: [3.79, 98.69], // Belawan
  IDDUM: [1.67, 101.45], // Dumai
  IDGRK: [-7.15, 112.65], // Gresik
  IDJKT: [-6.1, 106.88], // Jakarta
  INBOM: [18.95, 72.84], // Mumbai
  INCCU: [22.55, 88.31], // Kolkata
  INIXE: [12.92, 74.81], // New Mangalore
  INIXY: [23.02, 70.22], // Kandla
  INKAN: [23.02, 70.22], // Kandla
  INMAA: [13.1, 80.29], // Chennai
  INMED: [22.74, 69.7], // Mundra
  INTUT: [8.76, 78.18], // Tuticorin
  INVTZ: [17.69, 83.28], // Visakhapatnam
  IRBIK: [30.42, 49.08], // Bandar Imam Khomeini
  ITANX: [43.62, 13.51], // Ancona
  ITBAR: [41.32, 16.28], // Barletta
  ITBDS: [40.65, 17.96], // Brindisi
  ITBLT: [41.32, 16.28], // Barletta
  ITBRI: [41.14, 16.87], // Bari
  ITCAA: [44.03, 10.04], // Marina Di Carrara
  ITCAR: [44.03, 10.04], // Marina Di Carrara
  ITCHI: [45.22, 12.28], // Chioggia
  ITCIV: [42.1, 11.79], // Civitavecchia
  ITCTA: [37.49, 15.09], // Catania/Sicily
  ITGHE: [45.45, 12.28], // Porto Marghera
  ITMFR: [41.63, 15.92], // Manfredonia
  ITMNF: [45.79, 13.54], // Monfalcone
  ITMOL: [41.2, 16.6], // Molfetta
  ITMON: [40.95, 17.3], // Monopoli
  ITNAP: [40.84, 14.26], // Naples
  ITOLB: [40.92, 9.52], // Olbia
  ITORI: [39.9, 8.5], // Oristano (Sardinia)
  ITORT: [42.35, 14.4], // Ortona
  ITOTN: [42.35, 14.4], // Ortona
  ITPMA: [45.45, 12.28], // Marghera
  ITPNG: [45.78, 13.2], // Porto Nogaro
  ITPZL: [36.73, 14.85], // Pozzallo
  ITQOS: [39.9, 8.5], // Oristano
  ITRAN: [44.49, 12.28], // Ravenna
  ITSAL: [40.67, 14.75], // Salerno
  ITSVN: [44.31, 8.49], // Savona
  ITTER: [37.98, 13.7], // Termini Imerese
  ITTMI: [37.98, 13.7], // Termini Imerese
  JOAQB: [29.52, 35.0],
  JOAQJ: [29.52, 35.0], // Aqaba
  KWSWK: [29.35, 47.93], // Shuwaikh
  LBBCH: [5.88, -10.05], // Buchanan
  LBBEY: [33.9, 35.52], // Beirut
  LBJIE: [33.66, 35.42], // Jieh
  LBKYE: [34.45, 35.82], // Tripoli LB
  LBSAI: [33.56, 35.37], // Saida
  LYBGN: [32.07, 20.03], // Benghazi
  LYLMQ: [30.42, 19.58], // Marsa El Brega
  LYMHR: [32.07, 24.0], // Marsa El Hariga
  LYMIS: [32.37, 15.22], // Misurata
  LYTIP: [32.9, 13.18], // Tripoli LY
  LYTOB: [32.07, 23.96], // Tobruk
  LYTRP: [32.9, 13.18], // Tripoli LY
  MAAGA: [30.42, -9.63], // Agadir
  MACAS: [33.6, -7.62], // Casablanca
  MAJLF: [33.11, -8.62], // Jorf Lasfar
  MANDR: [35.28, -2.93], // Nador
  MASFI: [32.3, -9.24], // Safi
  MDGIU: [45.47, 28.21], // Giurgiulesti
  MEBAR: [42.09, 19.09], // Bar
  MTMLA: [35.89, 14.51], // Valletta
  MZBEW: [-19.83, 34.84], // Beira
  NGLOS: [6.44, 3.4], // Lagos
  NGPHC: [4.78, 7.01], // Port Harcourt
  NLRTM: [51.95, 4.14], // Rotterdam
  NLTNZ: [51.34, 3.83], // Terneuzen
  OMMCT: [23.62, 58.57], // Muscat
  OMSLL: [16.95, 54.01], // Salalah
  OMSOH: [24.51, 56.63], // Sohar
  PKKHI: [24.81, 66.98], // Karachi
  PLGDN: [54.4, 18.68], // Gdansk
  PLGDY: [54.53, 18.55], // Gdynia
  PLSZZ: [53.43, 14.57], // Szczecin
  PTLIS: [38.7, -9.15], // Lisbon
  ROBRA: [45.27, 27.97], // Braila
  ROCND: [44.17, 28.66], // Constanta
  ROGAL: [45.43, 28.05], // Galati
  ROMID: [44.34, 28.68], // Midia
  ROSUL: [45.16, 29.65], // Sulina
  ROTLN: [45.18, 28.8], // Tulcea
  RUKVZ: [45.33, 36.66], // Kavkaz
  RUNOI: [44.72, 37.79], // Novorossiysk
  RUNVS: [44.72, 37.79],
  RUROV: [47.22, 39.72], // Rostov-on-Don
  RUTAG: [47.21, 38.93], // Taganrog
  RUTMK: [45.3, 37.39], // Temryuk
  RUTUA: [44.1, 39.07], // Tuapse
  SAJAZ: [16.89, 42.55], // Jazan
  SAJED: [21.48, 39.18], // Jeddah
  SAJIZ: [16.89, 42.55], // Jizan
  SAJUB: [27.0, 49.66], // Jubail
  SAKAC: [22.5, 39.1], // King Abdullah Port
  SAYAN: [24.09, 38.06], // Yanbu
  SDPZU: [19.62, 37.22], // Port Sudan
  SIKOP: [45.55, 13.73], // Koper
  SLFNA: [8.49, -13.24], // Freetown
  SNDKR: [14.68, -17.42], // Dakar
  SOBER: [10.43, 45.01], // Berbera
  SYBAN: [35.18, 35.94], // Baniyas
  SYLTK: [35.52, 35.78], // Lattakia
  SYTAR: [34.89, 35.87], // Tartous
  SYTTS: [34.89, 35.87], // Tartous (old code)
  TNBIZ: [37.27, 9.88], // Bizerte
  TNGAE: [33.89, 10.1], // Gabes
  TNSFA: [34.73, 10.77], // Sfax
  TNSUS: [35.83, 10.64], // Sousse
  TNTUN: [36.81, 10.31], // Tunis
  TRALI: [38.8, 26.97], // Aliaga
  TRANT: [36.83, 30.61], // Antalya
  TRAYT: [36.83, 30.61], // Antalya
  TRBAR: [41.63, 32.34], // Bartin
  TRBDM: [40.35, 27.97], // Bandirma
  TRDIK: [39.07, 26.89], // Dikili
  TRDIL: [40.77, 29.53], // Diliskelesi
  TRDRC: [40.76, 29.83], // Derince
  TREGS: [41.28, 31.42], // Eregli / Zonguldak
  TRERE: [41.28, 31.42], // Eregli (Kdz)
  TRFAT: [41.03, 37.5], // Fatsa
  TRGEB: [40.77, 29.75], // Izmit / Igsas
  TRGEM: [40.43, 29.15], // Gemlik
  TRGLE: [40.43, 29.15], // Gemlik
  TRGUL: [37.24, 27.6], // Gulluk
  TRHER: [40.79, 29.61], // Hereke
  TRISK: [36.58, 36.17], // Iskenderun
  TRIST: [41.01, 28.97], // Istanbul
  TRIZM: [38.44, 27.14], // Izmir
  TRIZT: [40.77, 29.92], // Izmit
  TRKOC: [40.77, 29.92], // Kocaeli
  TRKRS: [41.11, 30.69], // Karasu
  TRMAR: [40.97, 27.96], // Marmara Ereglisi
  TRMER: [36.8, 34.63], // Mersin
  TRMRA: [40.61, 27.55], // Marmara Adasi (old code)
  TRMRM: [40.61, 27.55], // Marmara Adasi
  TRNEM: [38.77, 26.92], // Nemrut Bay
  TRROT: [38.44, 27.14], // Rota
  TRSRL: [40.62, 27.4], // Saraylar
  TRSSX: [41.29, 36.33], // Samsun
  TRTEK: [40.97, 27.51], // Tekirdag
  TRTRC: [41.0, 39.72], // Trabzon
  TRTUZ: [40.82, 29.3], // Tuzla
  TRTZX: [41.0, 39.72], // Trabzon
  TRUNY: [41.13, 37.28], // Unye
  TRZMT: [40.77, 29.92], // Izmit (Kocaeli)
  TZDAR: [-6.82, 39.3], // Dar Es Salaam
  TZTAN: [-5.07, 39.1], // Tanga
  UAILK: [46.3, 30.66], // Chornomorsk
  UAIZM: [45.35, 28.84], // Izmail
  UAKER: [45.36, 36.47], // Kerch
  UAKHE: [46.63, 32.62], // Kherson
  UAODS: [46.49, 30.74], // Odessa
  UAPOC: [46.49, 30.74], // Port of Call Ukraine
  UAREN: [45.46, 28.28], // Reni
  UASEV: [44.62, 33.53], // Sevastopol
  UAYUZ: [46.62, 31.0], // Pivdennyi
  USEWR: [40.69, -74.15], // Newark
  USNOR: [29.95, -90.07], // New Orleans
  USTPA: [27.92, -82.45], // Tampa
  USWIL: [39.73, -75.5], // Wilmington DE
  VEGUT: [10.24, -64.59], // Guanta
  VEJOT: [10.07, -64.83], // Jose Terminal
  VEPJO: [10.07, -64.83], // Jose
  VNQNH: [20.97, 107.08], // Quang Ninh
  VNSGN: [10.76, 106.71], // Ho Chi Minh City
  YEADE: [12.79, 44.97], // Aden
  YEHOD: [14.8, 42.95], // Hodeidah
  YEMKX: [14.52, 49.13], // Mukalla
};

export function resolveCoord(
  locode: string | null | undefined,
  portCoords?: Record<string, [number, number]>,
): [number, number] | null {
  if (!locode) return null;
  const key = locode.trim().toUpperCase().replace(/\s+/g, "");
  return portCoords?.[locode] ?? portCoords?.[key] ?? FALLBACK_PORTS[key] ?? null;
}
