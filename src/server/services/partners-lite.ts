import "server-only";
import { asc, isNull, eq, and } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { contacts, organisations } from "@/server/db/schema";

export type OrgLite = { id: string; name: string; shortName: string | null; kind: string };
export type ContactLite = { id: string; name: string; organisationId: string | null; role: string | null };

/** Partners and other organisations for pickers and the quick-add parser. */
export async function listOrganisationsLite(): Promise<OrgLite[]> {
  const db = await getDb();
  return db
    .select({ id: organisations.id, name: organisations.name, shortName: organisations.shortName, kind: organisations.kind })
    .from(organisations)
    .where(isNull(organisations.deletedAt))
    .orderBy(asc(organisations.kind), asc(organisations.name));
}

export async function listContactsLite(orgId?: string): Promise<ContactLite[]> {
  const db = await getDb();
  return db
    .select({ id: contacts.id, name: contacts.name, organisationId: contacts.organisationId, role: contacts.role })
    .from(contacts)
    .where(and(isNull(contacts.deletedAt), orgId ? eq(contacts.organisationId, orgId) : undefined))
    .orderBy(asc(contacts.name));
}
