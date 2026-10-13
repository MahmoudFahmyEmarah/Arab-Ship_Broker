// E2E target binding (C2O-078 P0): one target for seeding and teardown; every mismatch is refused before any write.
// Pure: no network, no database. Run: npx tsx scripts/e2e/target-check.ts
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import ts from "typescript";
import { assertBoundTestUserTarget } from "../../e2e/e2e-auth";
import { isForeignSupabaseRequest, isHostedTarget, resolveLocalAppOrigin, resolveLocalTarget, resolveTarget } from "../../e2e/e2e-db";

let n = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); n++; console.log(`  ok   ${m}`); };
const refused = (env: Record<string, string | undefined>, re: RegExp, m: string) => {
  let msg = "";
  try { resolveTarget(env); } catch (e) { msg = (e as Error).message; }
  ok(re.test(msg), `${m} (${msg || "accepted!"})`);
};
const REF = "sidcsytgqalqacsgyguz";
const jwt = (p: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(p)).toString("base64url")}.y`;
const hosted = { E2E_SUPABASE_URL: `https://${REF}.supabase.co`, E2E_ALLOW_REMOTE: REF, E2E_DB_URL: `postgresql://postgres.${REF}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres` };

ok(resolveTarget({}).kind === "local", "no environment = the local stack");
ok(resolveTarget({ E2E_SUPABASE_URL: "http://localhost:54321" }).kind === "local", "exact localhost is local");
ok(resolveLocalTarget({ E2E_SUPABASE_URL: "http://127.0.0.1:54321/" }).apiUrl === "http://127.0.0.1:54321", "the local-only resolver returns the normalized repository stack origin");
refused({ E2E_SUPABASE_URL: "http://localhost.example:54321" }, /only an exact https:\/\/<ref>\.supabase\.co/, "localhost.example is remote and refused");
refused({ E2E_SUPABASE_URL: "http://127.0.0.1.nip.io:54321" }, /only an exact https/, "a host that merely starts with 127.0.0.1 is refused");
for (const crafted of [
  "ftp://localhost:54321",
  "http://localhost:56021",
  "https://localhost:54321",
  "http://seed:secret@localhost:54321",
  "http://localhost:54321/rest/v1/users",
  "http://localhost:54321/?target=production",
  "http://localhost:54321/#production",
]) refused({ E2E_SUPABASE_URL: crafted }, /exact default Supabase loopback origin/, `a non-repository loopback-looking URL is refused: ${crafted}`);
ok(resolveLocalAppOrigin("http://localhost:3000/") === "http://localhost:3000", "the browser app resolver returns one exact local origin");
for (const remoteApp of [
  "https://arabshipbroker.com",
  "http://localhost.example:3000",
  "http://localhost:3000/auth/login",
  "http://user:secret@localhost:3000",
  "https://localhost:3000",
]) {
  let message = "";
  try { resolveLocalAppOrigin(remoteApp); } catch (error) { message = (error as Error).message; }
  ok(/exact local http app origin/.test(message), `a remote or non-origin browser target is refused: ${remoteApp}`);
}
refused({ E2E_DB_URL: hosted.E2E_DB_URL }, /local API with a hosted database URL/, "a local API with a hosted database URL is refused");
const t = resolveTarget(hosted);
ok(t.kind === "hosted" && t.ref === REF && t.dbUrl === hosted.E2E_DB_URL, "a staging API with its own pooler URL and allowlist binds one hosted target");
ok(resolveTarget({ ...hosted, E2E_DB_URL: `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres` }).kind === "hosted", "the direct db.<ref>.supabase.co host is accepted");
refused({ ...hosted, E2E_DB_URL: undefined }, /needs its matching database URL/, "a hosted API without its database URL is refused");
refused({ ...hosted, E2E_DB_URL: "postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" }, /does not belong to the API's project/, "a database URL of another project is refused");
refused({ ...hosted, E2E_DB_URL: `postgresql://postgres.${REF}:pw@evil.example.com:5432/postgres` }, /does not belong/, "the right user on a foreign host is refused");
refused({ ...hosted, E2E_ALLOW_REMOTE: undefined }, /E2E_ALLOW_REMOTE must name exactly/, "a hosted API without the allowlist is refused");
refused({ ...hosted, E2E_ALLOW_REMOTE: `${REF}x` }, /E2E_ALLOW_REMOTE must name exactly/, "an allowlist that only contains the ref is refused");
refused({ ...hosted, E2E_SUPABASE_URL: `https://api.${REF}.example.com` }, /only an exact https/, "a custom API host is refused");
refused({ ...hosted, E2E_SUPABASE_URL: `http://${REF}.supabase.co` }, /only an exact https/, "plain http to a hosted API is refused");
refused({ ...hosted, E2E_SUPABASE_URL: "https://rezfejaxbmdzkslrrefr.supabase.co", E2E_ALLOW_REMOTE: "rezfejaxbmdzkslrrefr" }, /production project/, "the production API is refused");
refused({ ...hosted, E2E_DB_URL: "postgresql://postgres.rezfejaxbmdzkslrrefr:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" }, /production project/, "a production database URL is refused even with a staging API");
refused({ ...hosted, E2E_SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: "abcdefghijklmnopqrst", role: "service_role" }) }, /not issued for this project/, "a service key issued for another project is refused");
refused({ ...hosted, E2E_SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF, role: "anon" }) }, /as service_role/, "an anon key passed as the service key is refused");
ok(resolveTarget({ ...hosted, E2E_SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF, role: "service_role" }) }).kind === "hosted", "a service key issued for this project is accepted");
let localOnlyMessage = "";
try { resolveLocalTarget(hosted); } catch (error) { localOnlyMessage = (error as Error).message; }
ok(/may seed only the exact local loopback stack/.test(localOnlyMessage), "a local-only harness refuses even the approved hosted staging target");
ok(isHostedTarget({ E2E_SUPABASE_URL: "http://localhost.example" }) && !isHostedTarget({}), "an unresolvable environment counts as hosted (random password, strict teardown)");
// C2O-084 P0: the browser is bound to the same target — a Supabase call to any other origin is foreign
const api = `https://${REF}.supabase.co`;
ok(!isForeignSupabaseRequest(`${api}/auth/v1/token?grant_type=password`, api) && !isForeignSupabaseRequest(`${api}/rest/v1/users?select=id`, api), "the bound project's Auth and REST calls pass");
ok(isForeignSupabaseRequest("https://rezfejaxbmdzkslrrefr.supabase.co/auth/v1/token", api) && isForeignSupabaseRequest("https://abcdefghijklmnopqrst.supabase.co/rest/v1/x", api), "an app built against another project (production included) is caught at its first Auth/REST call");
ok(["storage/v1/object/x", "functions/v1/f", "graphql/v1", "realtime/v1/websocket"].every((pth) => isForeignSupabaseRequest(`https://abcdefghijklmnopqrst.supabase.co/${pth}`, api)), "Storage, Functions, GraphQL and Realtime paths are guarded too");
ok(isForeignSupabaseRequest("wss://abcdefghijklmnopqrst.supabase.co/realtime/v1/websocket", api) && !isForeignSupabaseRequest(`wss://${REF}.supabase.co/realtime/v1/websocket`, api), "a WebSocket is compared as its https origin");
ok(!isForeignSupabaseRequest("http://127.0.0.1:3100/dashboard", api) && !isForeignSupabaseRequest("https://fonts.googleapis.com/css2", api), "app pages and other hosts are not Supabase calls");
ok(isForeignSupabaseRequest("http://localhost:54321/auth/v1/token", "http://127.0.0.1:54321"), "even localhost vs 127.0.0.1 is a different origin (the app must call exactly the bound API)");
const testClient = (apiUrl: string) => ({ supabaseUrl: apiUrl }) as unknown as SupabaseClient;
assertBoundTestUserTarget(testClient("http://127.0.0.1:54321"), { apiUrl: "http://127.0.0.1:54321" });
ok(true, "the Auth creator accepts a client bound to the exact loopback target");
const authBoundaryRefused = (clientUrl: string, targetUrl: string, expected: RegExp, label: string) => {
  let message = "";
  try { assertBoundTestUserTarget(testClient(clientUrl), { apiUrl: targetUrl }); } catch (error) { message = (error as Error).message; }
  ok(expected.test(message), `${label} (${message || "accepted!"})`);
};
authBoundaryRefused("http://127.0.0.1:54321", "http://localhost:54321", /not bound/, "the Auth creator refuses a client/target origin mismatch");
authBoundaryRefused("https://rezfejaxbmdzkslrrefr.supabase.co", "https://rezfejaxbmdzkslrrefr.supabase.co", /only on loopback or the approved staging/, "the Auth creator independently refuses production");
authBoundaryRefused("https://abcdefghijklmnopqrst.supabase.co", "https://abcdefghijklmnopqrst.supabase.co", /only on loopback or the approved staging/, "the Auth creator refuses an arbitrary hosted project");
authBoundaryRefused("http://127.0.0.1:54321", "http://127.0.0.1:54321/rest/v1", /invalid API origin/, "the Auth creator refuses a target URL that is not an origin");

// C2O-098: every service-role Auth creator is deliberately inventoried. Test
// code may call only the central target-bound wrapper. Only that wrapper and
// the production signup adapter may reach auth.admin.createUser directly.
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const extensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const ignoredDirectories = new Set([".git", ".next", ".turbo", "coverage", "node_modules", "test-results", "tmp"]);
const sourceFiles = (relativeDirectory = ""): string[] => {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : sourceFiles(relative);
    return entry.isFile() && extensions.has(path.extname(entry.name)) ? [relative] : [];
  });
};
const accessName = (node: ts.Node): string | null => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
};
const declaredName = (node: ts.Node | undefined): string | null => {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return accessName(node);
};
const unwrap = (input: ts.Expression): ts.Expression => {
  let node = input;
  while (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node)
    || ts.isSatisfiesExpression(node)
  ) node = node.expression;
  return node;
};
const isAuthAdminAccess = (input: ts.Expression): boolean => {
  const node = unwrap(input);
  if ((!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) || accessName(node) !== "admin") return false;
  const auth = unwrap(node.expression);
  return (ts.isPropertyAccessExpression(auth) || ts.isElementAccessExpression(auth)) && accessName(auth) === "auth";
};
const enclosingCall = (input: ts.Expression): ts.CallExpression | null => {
  let node: ts.Node = input;
  while (
    node.parent
    && (ts.isParenthesizedExpression(node.parent)
      || ts.isAsExpression(node.parent)
      || ts.isTypeAssertionExpression(node.parent)
      || ts.isNonNullExpression(node.parent)
      || ts.isSatisfiesExpression(node.parent))
  ) node = node.parent;
  return node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node ? node.parent : null;
};
const rawCreatorCalls: { file: string; offset: number }[] = [];
const boundCreatorCalls: { file: string; offset: number }[] = [];
const unsafeCreatorAccesses: string[] = [];
const parsed = new Map<string, ts.SourceFile>();
const inspectCreatorSource = (file: string, source: string) => {
  const unsafe: string[] = [];
  const raw: { file: string; offset: number }[] = [];
  const bound: { file: string; offset: number }[] = [];
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const at = (node: ts.Node, message: string) => {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    unsafe.push(`${file}:${pos.line + 1}: ${message}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isBindingElement(node) && declaredName(node.propertyName ?? node.name) === "createUser") {
      at(node, "createUser is destructured or aliased");
    }
    if (
      ts.isElementAccessExpression(node)
      && accessName(node) === null
      && isAuthAdminAccess(node.expression)
    ) {
      at(node, "an Auth admin method is selected dynamically");
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && accessName(node) === "createUser") {
      const call = enclosingCall(node);
      if (!call) at(node, "createUser is referenced without an immediate call");
      else if (!isAuthAdminAccess(node.expression)) at(node, "createUser is called through an aliased or ungoverned receiver");
      else raw.push({ file, offset: call.getStart(sourceFile) });
    }
    if (ts.isIdentifier(node) && node.text === "createBoundTestUser") {
      const allowedDeclaration = ts.isImportSpecifier(node.parent)
        || (ts.isFunctionDeclaration(node.parent) && node.parent.name === node);
      if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
        bound.push({ file, offset: node.parent.getStart(sourceFile) });
      } else if (!allowedDeclaration) {
        at(node, "createBoundTestUser is aliased instead of called directly");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { sourceFile, unsafe, raw, bound };
};
for (const file of sourceFiles()) {
  const inspected = inspectCreatorSource(file, readFileSync(path.join(repositoryRoot, file), "utf8"));
  parsed.set(file, inspected.sourceFile);
  unsafeCreatorAccesses.push(...inspected.unsafe);
  rawCreatorCalls.push(...inspected.raw);
  boundCreatorCalls.push(...inspected.bound);
}
ok(unsafeCreatorAccesses.length === 0, `Auth creators have no alias, destructuring or dynamic-access escape hatch${unsafeCreatorAccesses.length ? `: ${unsafeCreatorAccesses.join("; ")}` : ""}`);
const evasions = inspectCreatorSource("<creator-evasion-fixture>.tsx", `
  const { createUser: renamed } = client.auth.admin;
  const indirect = client.auth.admin.createUser;
  client.auth.admin["create" + "User"]({});
  const authAdmin = client.auth.admin;
  authAdmin.createUser({});
  const wrapped = createBoundTestUser;
`);
ok(evasions.unsafe.length === 5 && evasions.raw.length === 0 && evasions.bound.length === 0, "the AST inventory rejects destructured, referenced, dynamic, receiver-aliased and wrapper-aliased creator forms");
const rawContracts = { "e2e/e2e-auth.ts": 1, "sdk/auth.ts": 1 } as const;
const rawFiles = [...new Set(rawCreatorCalls.map((call) => call.file))].sort();
ok(JSON.stringify(rawFiles) === JSON.stringify(Object.keys(rawContracts).sort()), `only the central test wrapper and production signup adapter call auth.admin.createUser (${rawFiles.length})`);
for (const [file, count] of Object.entries(rawContracts)) {
  ok(rawCreatorCalls.filter((call) => call.file === file).length === count, `${file} retains exactly ${count} direct Auth creator call`);
}
const boundContracts = [
  "e2e/bunker.spec.ts",
  "e2e/fixture-room.helpers.ts",
  "e2e/global-setup.ts",
  "e2e/market-tbn-privacy.spec.ts",
  "e2e/pda-estimator-alignment.spec.ts",
  "e2e/rules-governance.spec.ts",
  "scripts/e2e/real-auth-check.ts",
  "scripts/fixture-room-integration-check.ts",
].sort();
const boundFiles = [...new Set(boundCreatorCalls.map((call) => call.file))].sort();
ok(JSON.stringify(boundFiles) === JSON.stringify(boundContracts), `every test Auth creator goes through the target-bound wrapper (${boundFiles.length})`);
for (const file of boundContracts) {
  ok(boundCreatorCalls.filter((call) => call.file === file).length === 1, `${file} has exactly one governed test Auth creator site`);
}
const productionAuth = readFileSync(path.join(repositoryRoot, "sdk/auth.ts"), "utf8");
ok(/email_confirm:\s*false/.test(productionAuth) && /auth\.admin\.deleteUser/.test(productionAuth), "the production signup adapter retains confirmation-first creation and compensating deletion");

const namedFunction = (file: string, name: string): ts.FunctionLikeDeclaration => {
  const sourceFile = parsed.get(file);
  assert.ok(sourceFile, `${file} was parsed`);
  let found: ts.FunctionLikeDeclaration | undefined;
  const find = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, find);
  };
  find(sourceFile);
  assert.ok(found, `${name} exists in ${file}`);
  return found;
};
const callsNamed = (root: ts.Node, name: string): ts.CallExpression[] => {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = unwrap(node.expression);
      const called = ts.isIdentifier(expression) ? expression.text : accessName(expression);
      if (called === name) calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return calls;
};
const browserBinder = namedFunction("e2e/global-setup.ts", "bindBrowserToTarget");
ok(callsNamed(browserBinder, "route").length === 1 && callsNamed(browserBinder, "routeWebSocket").length === 1 && callsNamed(browserBinder, "isForeignSupabaseRequest").length === 2, "global setup guards HTTP and WebSocket Supabase traffic on the selected API origin");
const globalSetup = namedFunction("e2e/global-setup.ts", "globalSetup");
const bindCalls = callsNamed(globalSetup, "bindBrowserToTarget");
const pageCalls = callsNamed(globalSetup, "newPage");
ok(bindCalls.length === 1 && pageCalls.length === 1 && bindCalls[0].getStart() < pageCalls[0].getStart(), "global setup installs the browser target guard before creating a page");
ok(callsNamed(globalSetup, "assertClean").length >= 3, "global setup checks the target guard after page load, login failure and successful authentication");
const helperSignIn = namedFunction("e2e/fixture-room.helpers.ts", "signInAs");
const helperBind = callsNamed(helperSignIn, "bindSupabaseOrigin");
const helperPage = callsNamed(helperSignIn, "newPage");
ok(helperBind.length === 1 && helperPage.length === 1 && helperBind[0].getStart() < helperPage[0].getStart() && callsNamed(helperSignIn, "failForeign").length >= 3, "Fixture sign-in binds and checks the browser target before credentials are entered");
for (const file of ["e2e/market-tbn-privacy.spec.ts", "scripts/fixture-room-integration-check.ts"]) {
  const source = readFileSync(path.join(repositoryRoot, file), "utf8");
  ok(
    /psql[^"\n]* -1 -v ON_ERROR_STOP=1/.test(source) && /raise exception '[^']*cleanup left governed seed rows'/i.test(source),
    `${file} cleanup is a fail-fast single transaction with a zero-residue assertion`,
  );
}
console.log(`E2E TARGET CHECK: ${n} passed`);
