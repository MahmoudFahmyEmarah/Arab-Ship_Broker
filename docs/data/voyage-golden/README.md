# Golden voyage-estimate cases (owner's 2022 answer key)

`answer-key-2022.json` holds the four worked cases of
`tmp/Data/Voyage_Estimation_Spreadsheet1-_answer_(1).xlsx` (SHA-256
`ab5bddf6026fdf4ba39d7f08205dafc1cfd8a776f906db0a3e916fdff854fb25`): Handymax
New Orleans–Yokohama, Panamax Norfolk–Rotterdam, Panamax with backhaul, product
tanker Houston–Shanghai (Worldscale).

`node --import tsx scripts/voyage-golden-fixtures.ts` re-computes every case
from its inputs with the workbook's own formulas and asserts each recorded
value (days, FO/DO, bunkers on board, intake, bunker cost, expenses, freight,
commission, surplus, gross/net daily, T/C equivalent) to 1e-6. Regenerate with
`--write`. Where the sheet typed the T/C value (Handymax, Panamax) it is an
input, not a result: the script proves it is not derivable and never compares
it with itself.

**Reference evidence, not a release check** (audit C2B-007 #5). The script does
not call the current Voyage engine (`estimateVoyage`, Stream S, not on this
branch). To use the cases as a gate, add an adapter on the composed branch that
maps each case's inputs to the engine, runs it, and asserts the shared outputs.

For the Voyage engine (Stream S): compare the fields your model shares (sea
days from miles and speed, fuel by block, bunker cost, freight and commission,
surplus, daily result). Each case lists its `quirks` (typed T/C values, a typed
20-day leg, reserve days outside the duration, ROB priced as a cost, the
tanker's auxiliary FO in the "DO" column); those are known differences, not
behaviour to copy. Course-workbook prices (2012-era bunkers) are illustrative,
not market data.
