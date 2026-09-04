-- resolve_vessel_review now inserts into vessel_availability, whose
-- fn_submission_route trigger references enum types unqualified. With the
-- RPC pinned to search_path '' that trigger fails to compile
-- ("type trust_tier_enum does not exist"). Run the RPC with search_path =
-- public like its sibling sync_vessel_positions / create_vessel_position;
-- every reference inside it is schema-qualified anyway.
alter function public.resolve_vessel_review(uuid, text, uuid) set search_path = public;
