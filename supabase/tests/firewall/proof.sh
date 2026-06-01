#!/usr/bin/env bash
PGBIN=/usr/lib/postgresql/16/bin; SOCK=/tmp/fwpg/sock; PORT=55432
ADMIN=11111111-1111-1111-1111-111111111111
MEMBER=22222222-2222-2222-2222-222222222222
OWNER=33333333-3333-3333-3333-333333333333
PASS=0; FAIL=0
q() { # role_uid  sql   -> echoes result, runs as authenticated with that uid
  "$PGBIN/psql" -h "$SOCK" -p $PORT -U postgres -d postgres -tA -c \
    "BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{\"sub\":\"$1\"}'; $2; COMMIT;" 2>&1
}
check() { # label  expectation(PASS condition desc)  actual  predicate
  if eval "$4"; then echo "  ✅ PASS  $1"; PASS=$((PASS+1)); else echo "  ❌ FAIL  $1  -> got: [$3]"; FAIL=$((FAIL+1)); fi
}

echo "──────────────────────────────────────────────────────────────"
echo "VESSEL FIREWALL  (counterparty PII must be admin/owner only)"
echo "──────────────────────────────────────────────────────────────"

# A. Member hits the RAW table for PII -> must be DENIED at the API layer
R=$(q "$MEMBER" "SELECT owner_company FROM public.vessels")
check "Member raw API: vessels.owner_company  => DENIED" "" "$R" '[[ "$R" == *"permission denied"* ]]'
R=$(q "$MEMBER" "SELECT commercial_manager_email FROM public.vessels")
check "Member raw API: vessels.commercial_manager_email => DENIED" "" "$R" '[[ "$R" == *"permission denied"* ]]'
R=$(q "$MEMBER" "SELECT pic_name FROM public.vessels")
check "Member raw API: vessels.pic_name => DENIED" "" "$R" '[[ "$R" == *"permission denied"* ]]'
R=$(q "$MEMBER" "SELECT tc_charterer_name FROM public.vessels")
check "Member raw API: vessels.tc_charterer_name => DENIED" "" "$R" '[[ "$R" == *"permission denied"* ]]'

# B. Member CAN read specs from the raw table (firewall didn't break the market)
R=$(q "$MEMBER" "SELECT vessel_name||'|'||dwt_grain FROM public.vessels")
check "Member raw API: specs (vessel_name,dwt_grain) => visible" "" "$R" '[[ "$R" == *"MV FIREWALL TEST|8200"* ]]'

# C. Member via masked view -> PII NULL, specs present
R=$(q "$MEMBER" "SELECT coalesce(owner_company,'<NULL>')||'/'||coalesce(commercial_manager_email,'<NULL>')||'/'||coalesce(pic_name,'<NULL>')||'/'||coalesce(tc_charterer_name,'<NULL>') FROM public.v_vessel_detail")
check "Member view v_vessel_detail: all PII => NULL" "" "$R" '[[ "$R" == *"<NULL>/<NULL>/<NULL>/<NULL>"* && "$R" != *"Poseidon"* && "$R" != *"poseidon.example"* && "$R" != *"Cargill"* ]]'
R=$(q "$MEMBER" "SELECT vessel_name FROM public.v_vessel_detail")
check "Member view v_vessel_detail: specs => visible" "" "$R" '[[ "$R" == *"MV FIREWALL TEST"* ]]'

# D. Owner via masked view -> own PII visible
R=$(q "$OWNER" "SELECT owner_company||'/'||commercial_manager_email||'/'||pic_name FROM public.v_vessel_detail")
check "Owner view v_vessel_detail: own PII => visible" "" "$R" '[[ "$R" == *"Poseidon Shipping Ltd/ceo@poseidon.example/Capt. Nikos"* ]]'

# E. Admin via masked view -> PII visible
R=$(q "$ADMIN" "SELECT owner_company||'/'||commercial_manager_phone FROM public.v_vessel_detail")
check "Admin view v_vessel_detail: PII => visible" "" "$R" '[[ "$R" == *"Poseidon Shipping Ltd/+30 555 0001"* ]]'

echo ""
echo "──────────────────────────────────────────────────────────────"
echo "CARGO CONTACT FIREWALL  (own contact yes; counterparty no)"
echo "──────────────────────────────────────────────────────────────"

# F. Member sees their OWN cargo's contact
R=$(q "$MEMBER" "SELECT contact_email FROM public.cargos_access_view WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'")
check "Member: OWN cargo contact => visible" "" "$R" '[[ "$R" == *"me@member.test"* ]]'

# G. Member must NOT see a COUNTERPARTY cargo's contact
R=$(q "$MEMBER" "SELECT coalesce(contact_email,'<NULL>') FROM public.cargos_access_view WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc'")
check "Member: counterparty cargo contact => NULL" "" "$R" '[[ "$R" == *"<NULL>"* && "$R" != *"secret@owner.test"* ]]'

# H. Admin sees counterparty cargo contact
R=$(q "$ADMIN" "SELECT contact_email FROM public.cargos_access_view WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc'")
check "Admin: counterparty cargo contact => visible" "" "$R" '[[ "$R" == *"secret@owner.test"* ]]'

echo ""
echo "──────────────────────────────────────────────────────────────"
echo "RESULT:  $PASS passed, $FAIL failed"
echo "──────────────────────────────────────────────────────────────"
exit $FAIL
