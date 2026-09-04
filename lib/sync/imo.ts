// IMO number validation — shared by the review drawer (client) and the sync
// server actions. The 7th digit is a check digit: Σ(d1..d6 × 7..2) mod 10.
// Mirrors public.fn_imo_check_digit() in the database.
export function isValidImo(s: string | null | undefined): boolean {
  if (!s || !/^\d{7}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Number(s[i]) * (7 - i);
  return sum % 10 === Number(s[6]);
}
