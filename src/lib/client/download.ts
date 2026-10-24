/**
 * Starts a download from one of the app's own routes, which answer with
 * Content-Disposition: attachment, so the page stays where it is.
 */
export function downloadFrom(url: string) {
  const a = document.createElement("a");
  a.href = url;
  document.body.append(a);
  a.click();
  a.remove();
}
