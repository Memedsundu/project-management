"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { createInboxNoteAction } from "@/app/(app)/notes/actions";
import { createTaskAction, createTasksAction } from "@/app/(app)/tasks/actions";
import type { ActionResult } from "@/server/action";
import type { TaskInput } from "@/server/services/tasks";
import { runAction } from "./run-action";

/**
 * Offline support on the page side: what she adds without signal waits in
 * this browser and is sent when the connection is back (Todoist, Things),
 * and the pages she opened are listed on the offline page.
 */

/** Same name as in public/sw.js. */
export const PAGES_CACHE = "pages-v1";
const QUEUE = "offline.queue";
const RECENT = "offline.recent";

type CaptureBody =
  | { kind: "task"; input: TaskInput }
  | { kind: "tasks"; inputs: TaskInput[] }
  | { kind: "note"; text: string; link: { type: string; id: string } | null };
export type Capture = CaptureBody & { id: string; at: string; title: string };
export type RecentPage = { url: string; title: string; at: number };

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: nothing more to do here.
  }
  notify();
}

export function pendingCaptures(): Capture[] {
  return read<Capture[]>(QUEUE, []);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** How many captures wait for a connection. */
export function usePendingCount() {
  return useSyncExternalStore(subscribe, () => pendingCaptures().length, () => 0);
}

export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

function queue(body: CaptureBody, title: string) {
  write(QUEUE, [...pendingCaptures(), { ...body, title: title.slice(0, 200), id: crypto.randomUUID(), at: new Date().toISOString() }]);
}

function send(c: Capture): Promise<ActionResult<unknown>> {
  if (c.kind === "task") return createTaskAction(c.input);
  if (c.kind === "tasks") return createTasksAction(c.inputs);
  return createInboxNoteAction(c.text, c.link);
}

/**
 * Save now, or keep it for later when there is no connection. Returns
 * "queued", the action's data, or undefined after an error toast.
 */
export async function saveOrQueue<T>(body: CaptureBody, title: string, run: () => Promise<ActionResult<T>>): Promise<T | "queued" | undefined> {
  if (navigator.onLine) {
    const attempt = run();
    const reached = await attempt.then(
      () => true,
      () => false,
    );
    if (reached) return runAction(attempt);
  }
  queue(body, title);
  return "queued";
}

let flushing = false;

/**
 * Send what waited, oldest first. Stops at the first network error; a capture
 * the server refuses leaves the queue with a toast naming it.
 */
export async function flushCaptures(messages: { saved: (count: number) => string; refused: (title: string, error: string) => string }) {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let saved = 0;
  try {
    for (const c of pendingCaptures()) {
      let res: ActionResult<unknown>;
      try {
        res = await send(c);
      } catch {
        break;
      }
      if (!res.ok && res.code === "unauthorized") break;
      write(
        QUEUE,
        pendingCaptures().filter((x) => x.id !== c.id),
      );
      if (res.ok) saved += c.kind === "tasks" ? c.inputs.length : 1;
      else toast.error(messages.refused(c.title, res.error), { duration: 12000 });
    }
  } finally {
    flushing = false;
  }
  if (saved) toast(messages.saved(saved));
  return saved;
}

export function rememberPage(url: string, title: string) {
  const list = read<RecentPage[]>(RECENT, []).filter((r) => r.url !== url);
  list.unshift({ url, title: title.slice(0, 200), at: Date.now() });
  write(RECENT, list.slice(0, 60));
}

/** Pages she opened that the service worker kept, newest first. */
export async function keptPages(): Promise<RecentPage[]> {
  const recent = read<RecentPage[]>(RECENT, []);
  if (!("caches" in window)) return [];
  try {
    const cache = await caches.open(PAGES_CACHE);
    const kept = new Set((await cache.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search));
    return recent.filter((r) => kept.has(r.url));
  } catch {
    return [];
  }
}

/** On sign-out: send what waits if possible, then drop every saved page and list. */
export async function forgetOfflineCopies() {
  try {
    localStorage.removeItem(RECENT);
    localStorage.removeItem(QUEUE);
  } catch {
    // Nothing stored.
  }
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "forget" });
    if ("caches" in window) await caches.delete(PAGES_CACHE);
  } catch {
    // No service worker here.
  }
}

/** Ask the service worker to keep this page for offline reading. */
export function keepPage(url: string) {
  navigator.serviceWorker?.controller?.postMessage({ type: "keep", url });
}

/* ------------------------------ Install prompt ------------------------------ */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let installEvent: InstallEvent | null = null;
const installListeners = new Set<() => void>();

if (typeof window !== "undefined") {
  // Chrome and Edge offer installing through this event; the button lives in Ayarlar.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as InstallEvent;
    installListeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    installListeners.forEach((l) => l());
  });
}

export function useCanInstall() {
  return useSyncExternalStore(
    (l) => {
      installListeners.add(l);
      return () => installListeners.delete(l);
    },
    () => installEvent !== null,
    () => false,
  );
}

export async function promptInstall() {
  if (!installEvent) return false;
  const e = installEvent;
  installEvent = null;
  installListeners.forEach((l) => l());
  await e.prompt();
  return (await e.userChoice).outcome === "accepted";
}

export type Platform = { standalone: boolean; ios: boolean; android: boolean };

export function platform(): Platform {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return { standalone, ios, android: /android/i.test(ua) };
}
