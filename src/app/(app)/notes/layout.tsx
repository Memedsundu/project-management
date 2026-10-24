import { NotesShell } from "@/components/notes/notes-shell";
import { getMemoryNote, listInboxNotes, listNotesTree } from "@/server/services/notes";
import { listTemplates } from "@/server/services/templates";

export default async function NotesLayout({ children }: { children: React.ReactNode }) {
  const [tree, inbox, memory, templates] = await Promise.all([listNotesTree(), listInboxNotes(), getMemoryNote(), listTemplates("note")]);
  return (
    <NotesShell
      tree={tree.filter((n) => !n.inbox).map((n) => ({ id: n.id, title: n.title, icon: n.icon, parentId: n.parentId, pinned: n.pinned }))}
      inboxCount={inbox.length}
      memoryId={memory?.id ?? null}
      templates={templates.map((x) => ({ id: x.id, name: x.name, description: x.description, builtin: x.builtin }))}
    >
      {children}
    </NotesShell>
  );
}
