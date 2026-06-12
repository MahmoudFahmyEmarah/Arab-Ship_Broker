// Port geometry: [lat, lon] optionally followed by the seaward bearing
// (degrees, 0=N) loaded from ports.seaward_bearing — drives land/sea marker
// anchoring (09 §7). Fallback entries carry coords only.
export type PortGeo = [number, number] | [number, number, number];

// Static fallback port coordinates keyed by UN/LOCODE (5-char, no space) -> [lat, lon].
// Live coordinates come from the `ports` table via loadPortCoords; this keeps the
// maps fully populated and click-responsive even before that DB backfill is applied.
//
// Coordinates are sourced from the upply-seaports UN/LOCODE reference (real
// lat/lon); a small number of non-standard market locodes not in that reference
// keep a display-grade city centroid (tagged "(centroid)"). Plain module (no
// Leaflet) so it is safe to import from server components too.
export const FALLBACK_PORTS: Record<string, PortGeo> = {
  AEDXB: [25.25, 55.2667, 315], // Jebel Ali
  AEFUJ: [25.16, 56.34, 90], // Fujairah  (centroid)
  AEJEA: [25.0, 55.05, 315], // Port of Jebel Ali
  AEKFK: [25.34, 56.36], // Khor Fakkan  (centroid)
  AERWP: [24.1, 52.7167], // Ruwais
  ALDRZ: [41.3246, 19.4565], // Durres
  ALDUR: [41.31, 19.45], // Durres  (centroid)
  AOLAD: [-8.8147, 13.2302], // Luanda
  ARSLO: [-27.9167, -64.4833], // San Lorenzo
  BDCGP: [22.3333, 91.8333], // Chattogram
  BGBAL: [43.4167, 28.1667], // Balchik
  BGBOJ: [42.5385, 27.2482], // Bourgas
  BGVAR: [43.2034, 27.8867], // Varna
  BGVAZ: [43.2173, 27.8641], // Varna West
  BHBAH: [26.2, 50.61], // Bahrain  (centroid)
  BJCOO: [6.3703, 2.3912], // Cotonou
  CIABJ: [5.3333, -4.0167], // Abidjan
  CMDLA: [4.0511, 9.7679], // Douala
  CNFCG: [21.61, 108.35], // Fangcheng  (centroid)
  CNRIZ: [35.39, 119.54], // Rizhao  (centroid)
  CNTGS: [39.6, 118.1833], // Jingtang
  CNZJG: [31.8667, 120.5333], // Zhangjiagang
  CYFAM: [35.12, 33.95], // Famagusta  (centroid)
  CYLCA: [34.9167, 33.6167], // Larnaca
  DJJIB: [11.6, 43.14], // Djibouti  (centroid)
  DJTAD: [11.79, 42.88], // Tadjurah  (centroid)
  DZAAE: [36.9265, 7.7525], // Annaba
  DZALG: [36.75, 3.05], // Algiers
  DZBJA: [36.7509, 5.0567], // Bejaia
  DZDJN: [36.89, 5.88], // Djen Djen  (centroid)
  DZMOS: [36.0131, 0.1401], // Mostaganem
  DZORN: [35.6971, -0.6308], // Oran
  DZSKI: [36.8715, 6.9102], // Skikda
  DZTEN: [36.5167, 1.3167], // Tenes
  DZTNS: [36.52, 1.31], // Tenes  (centroid)
  EGAAC: [31.13, 33.8], // El Arish  (centroid)
  EGABQ: [31.32, 30.07], // Abu Qir  (centroid)
  EGADB: [29.87, 32.48], // Adabiya  (centroid)
  EGALY: [31.1833, 29.9167, 0], // Alexandria
  EGDAM: [31.4167, 31.8167, 0], // Damietta
  EGDKH: [31.15, 29.81], // El Dekheila  (centroid)
  EGHAM: [26.2086, 34.0375], // Hamrawein
  EGPSD: [31.2653, 32.3019, 0], // Port Said
  EGPSE: [31.2167, 32.35, 0], // Port Said East
  EGSFW: [26.73, 33.94], // Safaga  (centroid)
  EGSGA: [26.73, 33.94], // Safaga  (centroid)
  EGSOK: [29.65, 32.35], // Ain Sokhna
  EHLAY: [27.1, -13.42], // Laayoune  (centroid)
  ERMSA: [15.61, 39.47], // Massawa  (centroid)
  ESAGP: [36.7167, -4.4167], // Malaga
  ESALI: [38.33, -0.49], // Alicante  (centroid)
  ESAVI: [43.57, -5.93], // Aviles  (centroid)
  ESBCN: [41.3333, 2.1667], // Barcelona
  ESCAD: [36.5271, -6.2886], // Cadiz
  ESCAS: [39.9833, -0.0333], // Castellon
  ESCRB: [36.99, -1.9], // Carboneras  (centroid)
  ESFRO: [43.4833, -8.25], // Ferrol
  ESGIJ: [43.5333, -5.6667], // Gijon
  ESLCG: [43.3667, -8.3833], // La Coruna
  ESMAL: [36.69, -4.41], // Malaga  (centroid)
  ESROT: [36.62, -6.35], // Rota  (centroid)
  ESSAG: [39.6833, -0.2667], // Sagunto
  ESSAN: [43.46, -3.8], // Santander  (centroid)
  ESSGN: [39.63, -0.21], // Sagunto  (centroid)
  ESSVQ: [37.35, -6.0], // Seville
  ESVGO: [42.2406, -8.7207], // Vigo
  FRBAY: [43.5, -1.4833], // Bayonne
  FRLRH: [46.1667, -1.15], // La Rochelle
  FRSET: [43.4, 3.7], // Sete
  FRURO: [49.45, 1.1], // Rouen
  GALIB: [0.39, 9.45], // Libreville  (centroid)
  GBGAR: [57.7, -5.6667], // Garston
  GBGRI: [53.57, -0.07], // Grimsby  (centroid)
  GBSOU: [50.9, -1.4], // Southampton
  GEBUS: [41.6168, 41.6367], // Batumi
  GEPTI: [42.1583, 41.6714], // Poti
  GHTEM: [5.6297, 0.0103], // Tema
  GNCKY: [9.6412, -13.5784], // Conakry
  GNKAM: [10.65, -14.61], // Kamsar  (centroid)
  GRAPL: [39.1667, 22.8833], // Amaliapolis
  GRATH: [37.9833, 23.7333, 200], // Athens / Piraeus
  GRAXD: [40.85, 25.8667], // Alexandroupolis
  GRFLS: [38.0333, 23.5333], // Eleusis
  GRGPA: [38.2333, 21.7167], // Patras
  GRKLM: [37.9167, 23.0167], // Kalamaki
  GRKRS: [37.95, 23.62], // Keratsini  (centroid)
  GRKVA: [40.9333, 24.4], // Kavala
  GRLAV: [37.7167, 24.0667], // Lavrion
  GRLRY: [38.5667, 23.2833], // Larymna
  GRNKV: [40.9667, 24.5167], // Nea Karvali
  GRNMD: [40.24, 23.28], // Nea Moudhania  (centroid)
  GRPIG: [38.25, 22.08], // Aigion / WC Greece  (centroid)
  GRPIR: [37.9333, 23.6167, 200], // Piraeus
  GRRET: [35.3667, 24.4667], // Rethymno
  GRSKG: [40.6333, 22.95], // Thessaloniki
  GRSKH: [40.63, 22.93], // Thessaloniki  (centroid)
  GRSNC: [40.95, 24.5], // Nea Karvali / Kavala  (centroid)
  GRTGI: [39.15, 22.85], // Tsingeli  (centroid)
  GRTHI: [38.3, 23.1], // Thisvi  (centroid)
  GRTHS: [40.63, 22.93], // Thessaloniki  (centroid)
  GRTSI: [39.1667, 22.85], // Tsingeli
  GRVOL: [39.3667, 22.95], // Volos
  GWOXB: [11.85, -15.5833], // Bissau
  HNSLO: [13.4326, -87.4554], // Puerto Cortes
  HRPLO: [43.05, 17.43], // Ploce  (centroid)
  HRPUL: [44.87, 13.84], // Pula  (centroid)
  HRZAD: [44.1167, 15.2333], // Zadar
  IDBEL: [3.79, 98.69], // Belawan  (centroid)
  IDDUM: [1.6833, 101.45], // Dumai
  IDGRK: [-7.15, 112.65], // Gresik  (centroid)
  IDJKT: [-6.1333, 106.8333], // Jakarta
  INBOM: [18.9667, 72.8167, 250], // Mumbai
  INCCU: [22.5667, 88.35], // Kolkata
  INIXE: [12.9141, 74.856], // New Mangalore
  INIXY: [23.0333, 70.2167], // Kandla
  INKAN: [23.02, 70.22], // Kandla  (centroid)
  INMAA: [13.0833, 80.2833], // Chennai
  INMED: [22.74, 69.7], // Mundra  (centroid)
  INTUT: [8.7833, 78.1333], // Tuticorin
  INVTZ: [17.7, 83.3], // Visakhapatnam
  IRBIK: [30.4167, 49.0667], // Bandar Imam Khomeini
  ITANX: [43.62, 13.51], // Ancona  (centroid)
  ITBAR: [41.32, 16.28], // Barletta  (centroid)
  ITBDS: [40.6333, 17.9333], // Brindisi
  ITBLT: [41.3167, 16.2833], // Barletta
  ITBRI: [41.1333, 16.85], // Bari
  ITCAA: [44.03, 10.04], // Marina Di Carrara  (centroid)
  ITCAR: [44.03, 10.04], // Marina Di Carrara  (centroid)
  ITCHI: [45.2333, 12.2833], // Chioggia
  ITCIV: [42.1, 11.79], // Civitavecchia  (centroid)
  ITCTA: [37.5, 15.1], // Catania/Sicily
  ITGHE: [45.45, 12.28], // Porto Marghera  (centroid)
  ITMFR: [41.6333, 15.9167], // Manfredonia
  ITMNF: [45.805, 13.5332], // Monfalcone
  ITMOL: [41.2, 16.6], // Molfetta  (centroid)
  ITMON: [40.95, 17.3], // Monopoli  (centroid)
  ITNAP: [40.8333, 14.25], // Naples
  ITOLB: [40.9167, 9.5167], // Olbia
  ITORI: [39.9, 8.5], // Oristano (Sardinia)  (centroid)
  ITORT: [42.35, 14.4], // Ortona  (centroid)
  ITOTN: [42.3522, 14.4028], // Ortona
  ITPMA: [45.45, 12.2167], // Marghera
  ITPNG: [45.7558, 13.2286], // Porto Nogaro
  ITPZL: [36.7167, 14.85], // Pozzallo
  ITQOS: [39.9, 8.5], // Oristano  (centroid)
  ITRAN: [44.4184, 12.2035], // Ravenna
  ITSAL: [40.6824, 14.7681], // Salerno
  ITSVN: [44.2833, 8.5], // Savona
  ITTER: [37.98, 13.7], // Termini Imerese  (centroid)
  ITTMI: [37.98, 13.7], // Termini Imerese  (centroid)
  JOAQB: [29.5167, 35.0, 180], // 'Aqaba
  JOAQJ: [29.5333, 35.0, 180], // Aqaba
  KWSWK: [29.35, 47.9333], // Shuwaikh
  LBBCH: [5.88, -10.05], // Buchanan  (centroid)
  LBBEY: [33.8333, 35.4833, 270], // Beirut
  LBJIE: [33.66, 35.42], // Jieh  (centroid)
  LBKYE: [34.4346, 35.8362], // Tripoli LB
  LBSAI: [33.56, 35.37], // Saida  (centroid)
  LYBGN: [32.07, 20.03], // Benghazi  (centroid)
  LYLMQ: [30.41, 19.57], // Marsa El Brega
  LYMHR: [32.07, 24.0], // Marsa El Hariga  (centroid)
  LYMIS: [32.37, 15.22], // Misurata  (centroid)
  LYTIP: [32.8872, 13.1913], // Tripoli LY
  LYTOB: [32.0682, 23.9418], // Tobruk
  LYTRP: [32.9, 13.18], // Tripoli LY  (centroid)
  MAAGA: [30.4278, -9.5981], // Agadir
  MACAS: [33.5833, -7.6], // Casablanca
  MAJLF: [33.11, -8.62], // Jorf Lasfar  (centroid)
  MANDR: [35.1686, -2.9276], // Nador
  MASFI: [32.3, -9.24], // Safi  (centroid)
  MDGIU: [45.4667, 28.1833], // Giurgiulesti
  MEBAR: [42.0833, 19.0833], // Bar
  MTMLA: [35.8833, 14.5], // Valletta
  MZBEW: [-19.8316, 34.837], // Beira
  NGLOS: [6.5244, 3.3792], // Lagos
  NGPHC: [4.8156, 7.0498], // Port Harcourt
  NLRTM: [51.9167, 4.5], // Rotterdam
  NLTNZ: [51.4667, 3.8167], // Terneuzen
  OMMCT: [23.6, 58.5833], // Muscat
  OMSLL: [17.0507, 54.1066], // Salalah
  OMSOH: [24.3461, 56.7075, 45], // Sohar
  PKKHI: [24.8167, 66.9833], // Karachi
  PLGDN: [54.35, 18.65], // Gdansk
  PLGDY: [54.5, 18.55], // Gdynia
  PLSZZ: [53.4285, 14.5528], // Szczecin
  PTLIS: [38.7167, -9.1333], // Lisbon
  ROBRA: [45.27, 27.97], // Braila  (centroid)
  ROCND: [44.1833, 28.65, 110], // Constanta
  ROGAL: [45.4333, 28.05], // Galati
  ROMID: [44.3333, 28.6167], // Midia
  ROSUL: [45.15, 29.6667], // Sulina
  ROTLN: [45.18, 28.8], // Tulcea  (centroid)
  RUKVZ: [45.33, 36.66], // Kavkaz  (centroid)
  RUNOI: [44.72, 37.79, 225], // Novorossiysk  (centroid)
  RUNVS: [44.7167, 37.7667, 225], // Novorossiysk
  RUROV: [47.22, 39.72], // Rostov-on-Don  (centroid)
  RUTAG: [47.2167, 38.9167], // Taganrog
  RUTMK: [45.3, 37.39], // Temryuk  (centroid)
  RUTUA: [44.1065, 39.0806], // Tuapse
  SAJAZ: [16.89, 42.55], // Jazan  (centroid)
  SAJED: [21.5333, 39.1667, 270], // Jeddah
  SAJIZ: [16.89, 42.55], // Jizan  (centroid)
  SAJUB: [27.017, 49.667], // Jubail
  SAKAC: [22.4, 39.083], // King Abdullah Port
  SAYAN: [24.09, 38.06, 250], // Yanbu  (centroid)
  SDPZU: [19.5903, 37.1902], // Port Sudan
  SIKOP: [46.1919, 13.7798], // Koper
  SLFNA: [8.4657, -13.2317], // Freetown
  SNDKR: [14.7167, -17.4677], // Dakar
  SOBER: [10.43, 45.01], // Berbera  (centroid)
  SYBAN: [35.1833, 35.95], // Baniyas
  SYLTK: [35.5167, 35.7833], // Lattakia
  SYTAR: [34.89, 35.87], // Tartous  (centroid)
  SYTTS: [34.9, 35.9], // Tartous (old code)
  TNBIZ: [37.2768, 9.8642], // Bizerte
  TNGAE: [33.8833, 10.1167], // Gabes
  TNSFA: [34.7398, 10.76], // Sfax
  TNSUS: [35.8245, 10.6346], // Sousse
  TNTUN: [36.8065, 10.1815], // Tunis
  TRALI: [38.7996, 26.9707], // Aliaga
  TRANT: [36.83, 30.61], // Antalya  (centroid)
  TRAYT: [36.8333, 30.6], // Antalya
  TRBAR: [41.63, 32.34], // Bartin  (centroid)
  TRBDM: [40.35, 27.9667], // Bandirma
  TRDIK: [39.0667, 26.8833], // Dikili
  TRDIL: [40.7768, 29.5263], // Diliskelesi
  TRDRC: [40.75, 29.8333], // Derince
  TREGS: [41.28, 31.42], // Eregli / Zonguldak  (centroid)
  TRERE: [41.2833, 31.4], // Eregli (Kdz)
  TRFAT: [41.03, 37.5], // Fatsa  (centroid)
  TRGEB: [40.7833, 29.4167], // Izmit / Igsas
  TRGEM: [40.4167, 29.15], // Gemlik
  TRGLE: [40.43, 29.15], // Gemlik  (centroid)
  TRGUL: [37.2333, 27.6], // Gulluk
  TRHER: [40.7938, 29.626], // Hereke
  TRISK: [36.5833, 36.1667, 225], // Iskenderun
  TRIST: [41.0167, 28.9667, 180], // Istanbul
  TRIZM: [38.4167, 27.15, 270], // Izmir
  TRIZT: [40.7833, 29.95], // Izmit
  TRKOC: [40.77, 29.92], // Kocaeli  (centroid)
  TRKRS: [41.0667, 30.7833], // Karasu
  TRMAR: [40.97, 27.96], // Marmara Ereglisi  (centroid)
  TRMER: [36.7167, 34.6333, 180], // Mersin
  TRMRA: [40.5833, 27.55], // Marmara Adasi (old code)
  TRMRM: [36.85, 28.2667], // Marmara Adasi
  TRNEM: [38.7833, 26.9166], // Nemrut Bay
  TRROT: [38.44, 27.14], // Rota  (centroid)
  TRSRL: [40.667, 27.667], // Saraylar
  TRSSX: [41.2833, 36.3333], // Samsun
  TRTEK: [40.9667, 27.5167], // Tekirdag
  TRTRC: [41.0, 39.72], // Trabzon  (centroid)
  TRTUZ: [40.8333, 29.25], // Tuzla
  TRTZX: [41.0, 39.7333], // Trabzon
  TRUNY: [41.1333, 37.2833], // Unye
  TRZMT: [40.77, 29.92], // Izmit (Kocaeli)  (centroid)
  TZDAR: [-6.8, 39.2833, 90], // Dar Es Salaam
  TZTAN: [-5.07, 39.1], // Tanga  (centroid)
  UAILK: [46.3167, 30.6667], // Chornomorsk
  UAIZM: [45.3167, 28.85], // Izmail
  UAKER: [45.36, 36.47], // Kerch  (centroid)
  UAKHE: [46.6167, 32.6167], // Kherson
  UAODS: [46.5, 30.75, 135], // Odessa
  UAPOC: [46.49, 30.74], // Port of Call Ukraine  (centroid)
  UAREN: [45.46, 28.28], // Reni  (centroid)
  UASEV: [44.62, 33.53], // Sevastopol  (centroid)
  UAYUZ: [46.6, 31.0167], // Pivdennyi
  USEWR: [40.7333, -74.1667], // Newark
  USNOR: [29.95, -90.07], // New Orleans  (centroid)
  USTPA: [27.9506, -82.4572], // Tampa
  USWIL: [39.73, -75.5], // Wilmington DE  (centroid)
  VEGUT: [10.2344, -64.5918], // Guanta
  VEJOT: [10.1, -64.85], // Jose Terminal
  VEPJO: [10.07, -64.83], // Jose  (centroid)
  VNQNH: [17.4, 106.633], // Quang Ninh
  VNSGN: [10.7667, 106.6667], // Ho Chi Minh City
  YEADE: [12.7855, 45.0187], // Aden
  YEHOD: [14.8333, 42.9], // Hodeidah
  YEMKX: [14.5404, 49.1272], // Mukalla
};

export function resolveCoord(
  locode: string | null | undefined,
  portCoords?: Record<string, PortGeo>,
): PortGeo | null {
  if (!locode) return null;
  const key = locode.trim().toUpperCase().replace(/\s+/g, "");
  return portCoords?.[locode] ?? portCoords?.[key] ?? FALLBACK_PORTS[key] ?? null;
}
