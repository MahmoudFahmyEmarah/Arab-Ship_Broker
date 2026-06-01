-- Ensure Cat_C dry bulk cargos (including Grain/Wheat) have a required safety field.
-- This keeps Safety step gating testable in fresh environments.
UPDATE public.safety_questions
SET is_required = TRUE
WHERE question_key = 'grain_cert'
  AND is_required IS DISTINCT FROM TRUE;
