-- ════════════════════════════════════════════════════════════════════════
-- Billing audit triggers — created outside migration history (21 Sep 2026)
--
-- Six AFTER triggers that write the billing audit trail. The FUNCTION they
-- call is created by a migration; the triggers themselves never were, so a
-- database rebuilt from the repository would record no billing audit at all
-- while looking otherwise complete. That is the kind of gap a schema
-- comparison finds and a smoke test does not.
--
-- Applied by scripts/db-rebuild.sh after the last migration, because the
-- billing tables they attach to are created part-way through the chain.
--
-- Not a migration: on the live project these already exist. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE TRIGGER "trg_billing_customers_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."billing_customers" FOR EACH ROW EXECUTE FUNCTION "public"."fn_billing_audit"();
CREATE OR REPLACE TRIGGER "trg_billing_settings_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."billing_settings" FOR EACH ROW EXECUTE FUNCTION "public"."fn_billing_audit"();
CREATE OR REPLACE TRIGGER "trg_invoice_lines_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."invoice_lines" FOR EACH ROW EXECUTE FUNCTION "public"."fn_billing_audit"();
CREATE OR REPLACE TRIGGER "trg_invoices_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."fn_billing_audit"();
CREATE OR REPLACE TRIGGER "trg_payments_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."fn_billing_audit"();
CREATE OR REPLACE TRIGGER "trg_subscriptions_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."fn_billing_audit"();

do $$
declare n int;
begin
  select count(*) into n from pg_trigger
   where tgname in ('trg_billing_customers_audit', 'trg_billing_settings_audit', 'trg_invoice_lines_audit',
                    'trg_invoices_audit', 'trg_payments_audit', 'trg_subscriptions_audit');
  if n < 6 then raise exception 'billing audit triggers incomplete: % of 6', n; end if;
  raise notice 'billing audit triggers present (%)', n;
end $$;
