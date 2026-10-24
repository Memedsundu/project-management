"use server";

import { z } from "zod";
import { act, UserError } from "@/server/action";
import {
  contactInputSchema,
  createContact,
  createOrganisation,
  markPartnerReport,
  orgInputSchema,
  updateContact,
  updateOrganisation,
} from "@/server/services/partners";

const uuid = z.string().uuid();

/** "Yeni kurum": a partner or a lighter stakeholder page (donor, ministry, UN agency). */
export async function createOrganisationAction(input: z.input<typeof orgInputSchema>) {
  return act(async () => {
    const row = await createOrganisation(orgInputSchema.parse(input));
    return { id: row.id };
  });
}

export async function updateOrganisationAction(id: string, patch: Partial<z.input<typeof orgInputSchema>>) {
  return act(async () => {
    const row = await updateOrganisation(uuid.parse(id), orgInputSchema.partial().parse(patch));
    if (!row) throw new UserError("Kurum bulunamadı.");
    return null;
  });
}

/** Work contacts of adults only: name, role, email and phone. */
export async function createContactAction(input: z.input<typeof contactInputSchema> & { focal?: boolean }) {
  return act(async () => {
    const { focal, ...rest } = input;
    const row = await createContact(contactInputSchema.parse(rest));
    if (focal && row.organisationId) await updateOrganisation(row.organisationId, { focalContactId: row.id });
    return { id: row.id };
  });
}

export async function updateContactAction(id: string, patch: Partial<z.input<typeof contactInputSchema>>) {
  return act(async () => {
    const row = await updateContact(uuid.parse(id), contactInputSchema.partial().parse(patch));
    if (!row) throw new UserError("Kişi bulunamadı.");
    return null;
  });
}

export async function setFocalContactAction(orgId: string, contactId: string | null) {
  return act(async () => {
    await updateOrganisation(uuid.parse(orgId), { focalContactId: contactId ? uuid.parse(contactId) : null });
    return null;
  });
}

/** "Rapor olarak işaretle": a file becomes the partner's report for a period. */
export async function markPartnerReportAction(orgId: string, documentId: string, periodLabel: string) {
  return act(async () => {
    const doc = await markPartnerReport(uuid.parse(orgId), uuid.parse(documentId), z.string().trim().min(1).max(40).parse(periodLabel));
    if (!doc) throw new UserError("Belge bulunamadı.");
    return { id: doc.id };
  });
}

export async function partnerBriefAction(orgId: string, language: "tr" | "en") {
  return act(
    async () => {
      const { writePartnerBrief } = await import("@/server/ai/partners");
      return { text: await writePartnerBrief(uuid.parse(orgId), z.enum(["tr", "en"]).parse(language)) };
    },
    { write: false },
  );
}
