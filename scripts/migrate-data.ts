// Data migration: loads CargoMap Excel into Supabase
// Run: npm install xlsx @supabase/supabase-js dotenv tsx
//      tsx scripts/migrate-data.ts <path-to-xlsx>

import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config()

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env')
  console.error('SUPABASE_SERVICE_KEY needs the service_role key for bulk insert (not anon key)')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const filePath = process.argv[2]
if (!filePath || !fs.existsSync(filePath)) {
  console.error('Usage: tsx scripts/migrate-data.ts <path-to-xlsx>')
  process.exit(1)
}

// ── Helper: Excel serial date → ISO date ─────────────────────
const excelDateToISO = (serial: any): string | null => {
  if (!serial || serial === '' || serial === 'SPOT') return null
  const n = typeof serial === 'number' ? serial : parseFloat(serial)
  if (isNaN(n)) return null
  const date = new Date((n - 25569) * 86400 * 1000)
  return date.toISOString().split('T')[0]
}

// ── Helper: parse zone string from various formats ────────────
const normalizeZone = (z: string): string | null => {
  if (!z) return null
  const clean = z.trim().toUpperCase().replace(/\s+/g, '')
  const valid = ['B.SEA','E.MED','W.MED','C.MED','ADRIATIC','R.SEA','AG','A.SEA','WCAF','ECAF','NCONT','CARIB','F.EAST','ECI']
  const found = valid.find(v => v === clean || v.replace('.','') === clean.replace('.',''))
  return found ?? 'Unknown'
}

// ── Helper: detect WOG in notes ───────────────────────────────
const detectWog = (notes?: string): boolean => /\bWOG\b/i.test(notes || '')

// ── Helper: detect for_circulation from notes ─────────────────
const detectCirculation = (notes?: string): boolean => {
  if (!notes) return true // default ON unless marked OFF
  return !/OFF\s+MARKET|DO\s+NOT\s+CIRCULATE/i.test(notes)
}

// ── Helper: parse laytime qualifier from rate string ──────────
const parseLaytimeQualifier = (rate?: string): string | null => {
  if (!rate) return null
  const m = rate.match(/\b(SSHEX|SHEX|SHINC|SSHINC|FSHEX|FHEX|BENDS|EIU|PWWD|SHEX|FHINC)\b/gi)
  return m ? Array.from(new Set(m.map(s => s.toUpperCase()))).join(' ') : null
}

// ── Helper: clean rate (strip qualifiers) ─────────────────────
const cleanRate = (rate?: string): string | null => {
  if (!rate) return null
  return rate.replace(/\b(SSHEX|SHEX|SHINC|SSHINC|FSHEX|FHEX|BENDS|EIU|PWWD|FHINC)\b/gi, '').trim().replace(/\s+/g, ' ')
}

// ── Helper: locode cleanup ────────────────────────────────────
const cleanLocode = (l?: string): string | null => {
  if (!l) return null
  const c = l.trim().toUpperCase().replace(/\s+/g, '')
  if (c.length !== 5) return null
  return c
}

// ── PORTS ─────────────────────────────────────────────────────
async function migratePorts(workbook: XLSX.WorkBook) {
  const sheet = workbook.Sheets['PORT_CODES']
  if (!sheet) { console.warn('No PORT_CODES sheet'); return }

  const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' })
  console.log(`PORTS: parsing ${rows.length} rows`)

  const records = rows
    .map(r => {
      const locode = cleanLocode(r.LOCODE || r.Locode || r['LOCODE_CODE'])
      if (!locode) return null
      return {
        locode,
        trade_name: r.TRADE_NAME || r.PORT_NAME || r.Port_Name || locode,
        country: r.COUNTRY || r.Country || '',
        zone: normalizeZone(r.ZONE || r.Zone || 'Unknown'),
        port_type: 'Sea Port',
        latitude: r.LATITUDE || r.LAT || null,
        longitude: r.LONGITUDE || r.LNG || r.LON || null,
        is_active: true,
        is_verified: true,
      }
    })
    .filter(Boolean)

  // Upsert in chunks of 100
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100)
    const { error } = await supabase.from('ports').upsert(chunk as any, { onConflict: 'locode' })
    if (error) console.error('Port chunk error:', error.message)
  }
  console.log(`PORTS: ${records.length} records upserted`)
}

// ── CARGO ─────────────────────────────────────────────────────
async function migrateCargo(workbook: XLSX.WorkBook) {
  const sheet = workbook.Sheets['CARGO_LOG']
  if (!sheet) { console.warn('No CARGO_LOG sheet'); return }

  // Skip first row (subtitle), use second row as headers
  const range = XLSX.utils.decode_range(sheet['!ref']!)
  range.s.r = 1 // start from row 2 (header)
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { range, defval: '' })
  console.log(`CARGO: parsing ${rows.length} rows`)

  let inserted = 0, skipped = 0

  for (const r of rows) {
    if (!r.REF || !r.COMMODITY) { skipped++; continue }

    const loadLocode = cleanLocode(r.LOAD_LOCODE)
    const dischLocode = cleanLocode(r.DISCH_LOCODE)
    const isSpot = (r.LAYCAN_FROM === 'SPOT' || r.LAYCAN_FROM === '' || !r.LAYCAN_FROM)

    const record: any = {
      ref: r.REF,
      batch_id: r.BATCH,
      batch_date: excelDateToISO(r.BATCH_DATE),
      status: (r.STATUS || 'IN').toUpperCase(),
      cargo_type: r.CARGO_TYPE === 'Break Bulk' ? 'Break Bulk' : 'Dry Bulk',
      commodity_name: r.COMMODITY,
      commodity_category: r.COMMODITY_CATEGORY,
      is_grain_cargo: r.COMMODITY_CATEGORY === 'Grains & Oilseeds',
      is_wog: detectWog(r.NOTES),
      for_circulation: detectCirculation(r.NOTES),
      qty_min_mt: parseInt(r.QTY_MIN_MT) || 0,
      qty_max_mt: parseInt(r.QTY_MAX_MT) || parseInt(r.QTY_MIN_MT) || 0,
      load_port_locode: loadLocode,
      load_port_name: r.LOAD_PORT,
      load_country: r.LOAD_COUNTRY,
      load_zone: normalizeZone(r.LOAD_ZONE),
      disch_port_locode: dischLocode,
      disch_port_name: r.DISCH_PORT,
      disch_country: r.DISCH_COUNTRY,
      disch_zone: normalizeZone(r.DISCH_ZONE),
      laycan_from: isSpot ? null : excelDateToISO(r.LAYCAN_FROM),
      laycan_to: isSpot ? null : excelDateToISO(r.LAYCAN_TO),
      is_spot: isSpot,
      load_rate: cleanRate(r.LOAD_RATE),
      disch_rate: cleanRate(r.DISCH_RATE),
      laytime_qualifier: parseLaytimeQualifier(r.LOAD_RATE) || parseLaytimeQualifier(r.DISCH_RATE),
      commission_pct: parseFloat(r.COMMISSION_PCT) || null,
      priority: r.PRIORITY,
      broker: r.BROKER,
      notes: r.NOTES,
      review_status: 'APPROVED',  // existing operational records, approved
      goes_live_at: new Date().toISOString(),
      // Multi-port columns
      load_port_2_locode: cleanLocode(r.LOAD_LOCODE_2),
      load_port_2_name: r.LOAD_PORT_2,
      load_port_3_locode: cleanLocode(r.LOAD_LOCODE_3),
      load_port_3_name: r.LOAD_PORT_3,
      load_port_4_locode: cleanLocode(r.LOAD_LOCODE_4),
      load_port_4_name: r.LOAD_PORT_4,
      disch_port_2_locode: cleanLocode(r.DISCH_LOCODE_2),
      disch_port_2_name: r.DISCH_PORT_2,
      disch_port_3_locode: cleanLocode(r.DISCH_LOCODE_3),
      disch_port_3_name: r.DISCH_PORT_3,
      disch_port_4_locode: cleanLocode(r.DISCH_LOCODE_4),
      disch_port_4_name: r.DISCH_PORT_4,
    }

    // Strip nulls and undefined
    Object.keys(record).forEach(k => (record[k] === null || record[k] === '' || record[k] === undefined) && delete record[k])

    const { error } = await supabase.from('cargo_listings').upsert(record, { onConflict: 'ref' })
    if (error) {
      console.error(`CARGO ${r.REF}:`, error.message)
      skipped++
    } else {
      inserted++
    }
  }
  console.log(`CARGO: ${inserted} inserted, ${skipped} skipped`)
}

// ── VESSELS ───────────────────────────────────────────────────
async function migrateVessels(workbook: XLSX.WorkBook) {
  const sheet = workbook.Sheets['VESSEL_LOG']
  if (!sheet) { console.warn('No VESSEL_LOG sheet'); return }

  const range = XLSX.utils.decode_range(sheet['!ref']!)
  range.s.r = 1
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { range, defval: '' })
  console.log(`VESSELS: parsing ${rows.length} rows`)

  let inserted = 0, skipped = 0

  for (const r of rows) {
    if (!r.VESSEL_NAME) { skipped++; continue }

    // 1. Upsert vessel record
    const vesselType = r.TYPE?.includes('Bulk') ? 'Bulk Carrier' : 'General Cargo'
    const isGeared = r.GEAR ? !/gearless|sid \(gearless\)/i.test(r.GEAR) : null

    const vesselRecord: any = {
      vessel_name: r.VESSEL_NAME,
      vessel_type: vesselType,
      dwt_grain: parseInt(r.DWT) || null,
      dwcc: parseInt(r.DWCC) || null,
      build_year: parseInt(r.BUILT) || null,
      flag: r.FLAG,
      scope: 'In Scope',
      max_loa_m: parseFloat(r.LOA_M) || null,
      max_draft_m: parseFloat(r.DRAFT_M) || null,
      is_geared: isGeared,
      grain_cbm: parseGrainCBM(r.GRAIN_CBM),
      is_sanctioned: false,
    }
    Object.keys(vesselRecord).forEach(k => (vesselRecord[k] === null || vesselRecord[k] === '') && delete vesselRecord[k])

    const { data: vessel, error: vError } = await supabase
      .from('vessels')
      .upsert(vesselRecord, { onConflict: 'vessel_name' })
      .select('id')
      .single()

    if (vError) {
      console.error(`VESSEL ${r.VESSEL_NAME}:`, vError.message)
      skipped++
      continue
    }

    // 2. Insert vessel availability
    const openLocode = cleanLocode(r.OPEN_LOCODE)
    const openFrom = r.OPEN_FROM === 'SPOT' ? null : excelDateToISO(r.OPEN_FROM)

    const availRecord: any = {
      vessel_id: vessel.id,
      open_port_locode: openLocode,
      open_port_name: r.OPEN_PORT,
      open_zone: normalizeZone(r.OPEN_ZONE),
      open_date: openFrom,
      status: (r.STATUS || 'OPEN').toUpperCase().replace('OUT OF ZONE', 'OPEN'),
      review_status: 'APPROVED',
      goes_live_at: new Date().toISOString(),
      broker: r.BROKER,
      commission_pct: parseFloat(r.COMMISSION_PCT) || null,
      notes: r.NOTES,
      for_circulation: detectCirculation(r.NOTES),
    }
    Object.keys(availRecord).forEach(k => (availRecord[k] === null || availRecord[k] === '') && delete availRecord[k])

    const { error: aError } = await supabase.from('vessel_availability').insert(availRecord)
    if (aError && !aError.message.includes('duplicate')) {
      console.error(`AVAIL ${r.VESSEL_NAME}:`, aError.message)
    }
    inserted++
  }
  console.log(`VESSELS: ${inserted} inserted, ${skipped} skipped`)
}

const parseGrainCBM = (raw: any): number | null => {
  if (!raw) return null
  const m = String(raw).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = parseFloat(m[1])
  // If value looks like cubic feet (>30000), convert to cubic metres
  if (String(raw).toLowerCase().includes('cbft') || String(raw).toLowerCase().includes('cuft')) {
    return Math.round(n * 0.0283168 * 100) / 100
  }
  return n
}

// ── RUN ───────────────────────────────────────────────────────
async function main() {
  console.log('Loading workbook from:', filePath)
  const workbook = XLSX.readFile(filePath)
  console.log('Sheets:', workbook.SheetNames.join(', '))

  console.log('\n=== Step 1: Ports ===')
  await migratePorts(workbook)

  console.log('\n=== Step 2: Cargo ===')
  await migrateCargo(workbook)

  console.log('\n=== Step 3: Vessels ===')
  await migrateVessels(workbook)

  console.log('\n✓ Migration complete')
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
