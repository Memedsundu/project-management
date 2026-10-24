import "server-only";

/** Passages of a trashed file stay in place (search hides them); embeddings are kept for a restore. */
export async function removeDocumentPassagesFromSearch(documentId: string) {
  void documentId;
}

/** Purging a file deletes its stored bytes for every version. Rows go with the document (cascade). */
export async function purgeDocumentFiles(documentId: string) {
  const { purgeDocumentBytes } = await import("./documents");
  await purgeDocumentBytes(documentId);
}
