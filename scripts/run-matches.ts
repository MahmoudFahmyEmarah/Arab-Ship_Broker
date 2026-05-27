// ============================================================
// MATCH ENGINE — backfill script
// Runs the scoring engine across all live cargo × all open vessels
// and populates the matches table.
// ============================================================
// Usage: tsx scripts/run-matches.ts
// ============================================================

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { scoreMatch } from '../src/lib/matching'

dotenv.config()

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

async function main() {
  console.log('Loading live cargo and open vessels...')

  const { data: cargo, error: cErr } = await supabase
    .from('cargo_listings')
    .select('*')
    .eq('review_status', 'APPROVED')
    .in('status', ['IN', 'PARTIAL'])

  if (cErr) { console.error(cErr); process.exit(1) }

  const { data: vessels, error: vErr } = await supabase
    .from('vessel_availability')
    .select('*, vessel:vessels(*)')
    .eq('review_status', 'APPROVED')
    .eq('status', 'OPEN')

  if (vErr) { console.error(vErr); process.exit(1) }

  console.log(`Cargo: ${cargo!.length} live`)
  console.log(`Vessels: ${vessels!.length} open`)
  console.log(`Total pairs to score: ${cargo!.length * vessels!.length}`)

  // Clear existing matches before recomputing
  console.log('\nClearing old matches...')
  await supabase.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  const allMatches: any[] = []
  const counters = { Strong: 0, Good: 0, Possible: 0, Weak: 0, BLOCKED: 0 }

  for (const c of cargo!) {
    for (const v of vessels!) {
      const result = scoreMatch(c as any, v as any)
      counters[result.label]++
      if (result.label !== 'BLOCKED') {
        allMatches.push({
          cargo_id: c.id,
          vessel_avail_id: v.id,
          score_label: result.label,
        })
      }
    }
  }

  console.log('\nMatch distribution:')
  console.log(`  Strong:   ${counters.Strong}`)
  console.log(`  Good:     ${counters.Good}`)
  console.log(`  Possible: ${counters.Possible}`)
  console.log(`  Weak:     ${counters.Weak}`)
  console.log(`  Blocked:  ${counters.BLOCKED} (filtered out)`)
  console.log(`  Total to insert: ${allMatches.length}`)

  // Bulk insert in chunks
  console.log('\nWriting matches...')
  for (let i = 0; i < allMatches.length; i += 500) {
    const chunk = allMatches.slice(i, i + 500)
    const { error } = await supabase.from('matches').insert(chunk)
    if (error) {
      console.error(`Chunk ${i}: ${error.message}`)
    }
  }

  console.log('\n✓ Match engine complete')
}

main().catch(e => { console.error(e); process.exit(1) })
