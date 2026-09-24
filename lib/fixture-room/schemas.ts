// Fixture Room · command input schemas (Zod). The server actions validate
// with these before calling the RPCs; the database validates again.
import { z } from "zod";

const uuid = z.string().uuid();
const idempotencyKey = z.string().min(1).max(200);
const expectedVersion = z.number().int().min(0);

export const commandBaseSchema = z.object({
  roomId: uuid,
  expectedVersion,
  idempotencyKey,
  asPartyId: uuid.nullable().optional(),
  onBehalfOfPartyId: uuid.nullable().optional(),
});
export type CommandBaseInput = z.infer<typeof commandBaseSchema>;

export const valueKindSchema = z.enum(["text", "number", "money_per_mt", "rate_pair", "date_range", "port_pair"]);

export const fixtureValueSchema = z.union([
  z.object({ text: z.string().min(1).max(500) }).strict(),
  z.object({ num: z.number().finite(), currency: z.string().regex(/^[A-Z]{3}$/).optional() }).strict(),
  z.object({ load: z.number().positive(), disch: z.number().positive() }).strict(),
  z.object({ spot: z.literal(true) }).strict(),
  z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({
    load: z.string().min(1).max(12), disch: z.string().min(1).max(12),
    load_name: z.string().max(120).nullable().optional(), disch_name: z.string().max(120).nullable().optional(),
  }).strict(),
]);

export const termDefinitionSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  label: z.string().min(1).max(80),
  category: z.string().max(40).optional(),
  sortOrder: z.number().int().min(1).max(999),
  valueKind: valueKindSchema,
  unit: z.string().max(20).optional(),
  required: z.boolean(),
  hint: z.string().max(300).optional(),
});

export const createRoomSchema = z.object({
  cargoListingId: uuid,
  vesselAvailabilityId: uuid,
  terms: z.array(termDefinitionSchema).min(1).max(40),
  idempotencyKey,
});

export const invitePartySchema = commandBaseSchema.extend({
  side: z.enum(["cargo", "vessel"]),
  capacity: z.enum(["principal", "broker", "viewer"]),
  orgId: uuid.nullable().optional(),
  userId: uuid.nullable().optional(),
}).refine((v) => !!v.orgId !== !!v.userId, { message: "Name exactly one of an organisation or a member." });

export const respondInvitationSchema = z.object({ roomId: uuid, accept: z.boolean(), expectedVersion, idempotencyKey });

export const submitProposalSchema = commandBaseSchema.extend({
  termId: uuid,
  value: fixtureValueSchema,
  comment: z.string().max(1000).nullable().optional(),
  isFinal: z.boolean().optional(),
  expiresInMinutes: z.number().int().min(1).max(10080).nullable().optional(),
});

export const proposalRefSchema = commandBaseSchema.extend({ proposalId: uuid });

export const reopenTermSchema = commandBaseSchema.extend({ termId: uuid, reason: z.string().max(500).nullable().optional() });

export const termFlagSchema = commandBaseSchema.extend({
  termId: uuid,
  flag: z.enum(["hold", "resume", "refer", "clear_referral"]),
  note: z.string().max(500).nullable().optional(),
});

export const addSubjectSchema = commandBaseSchema.extend({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  responsibleSide: z.enum(["cargo", "vessel", "mediator"]).nullable().optional(),
  deadlineAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const subjectRefSchema = commandBaseSchema.extend({ subjectId: uuid });
export const failSubjectSchema = subjectRefSchema.extend({ reason: z.string().max(500).nullable().optional() });
export const extendSubjectSchema = subjectRefSchema.extend({ deadlineAt: z.string().datetime({ offset: true }) });

export const recapRefSchema = commandBaseSchema.extend({ recapVersionId: uuid });

export const postMessageSchema = commandBaseSchema.extend({
  body: z.string().min(1).max(4000),
  kind: z.enum(["note", "nudge", "ack"]).optional(),
  visibility: z.enum(["room", "side", "mediator"]).optional(),
  termId: uuid.nullable().optional(),
});

export const closeRoomSchema = commandBaseSchema.extend({
  reason: z.enum(["withdrawn", "failed", "expired"]),
  note: z.string().max(500).nullable().optional(),
});

export const redactMessageSchema = z.object({ roomId: uuid, messageId: uuid, reason: z.string().min(4).max(500), expectedVersion, idempotencyKey });

export const listRoomsSchema = z.object({
  statuses: z.array(z.enum(["draft", "invited", "negotiating", "on_subjects", "fixed", "withdrawn", "failed", "expired"])).nullable().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
