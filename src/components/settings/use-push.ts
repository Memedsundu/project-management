"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { pushStatusAction, subscribePushAction, testPushAction, unsubscribePushAction } from "@/app/actions/push";
import { platform } from "@/lib/client/offline";
import { runAction } from "@/lib/client/run-action";

/** loading · on · off · blocked (she said no) · install (iPhone: add to home screen first) · unsupported */
export type PushState = "loading" | "on" | "off" | "blocked" | "install" | "unsupported";

function keyBytes(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function subscribe(publicKey: string) {
  const reg = await navigator.serviceWorker.ready;
  const options = { userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) };
  try {
    return await reg.pushManager.subscribe(options);
  } catch {
    // An old subscription made with another key blocks a new one.
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    return reg.pushManager.subscribe(options);
  }
}

/** Push reminders on this device (Web Push through the service worker). */
export function usePush() {
  const t = useTranslations("settings.notifications");
  const [state, setState] = useState<PushState>("loading");
  const [devices, setDevices] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const check = async () => {
      const status = await runAction(pushStatusAction(), { silent: true });
      const p = platform();
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      let next: PushState;
      if (!supported) next = p.ios && !p.standalone ? "install" : "unsupported";
      else if (Notification.permission === "denied") next = "blocked";
      else {
        const reg = await navigator.serviceWorker.getRegistration();
        next = !reg ? "unsupported" : (await reg.pushManager.getSubscription()) ? "on" : "off";
      }
      if (!live) return;
      if (status) setDevices(status.devices);
      setState(next);
    };
    void check();
    return () => {
      live = false;
    };
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const status = await runAction(pushStatusAction());
      if (!status) return;
      const sub = await subscribe(status.publicKey);
      const res = await runAction(subscribePushAction(sub.toJSON()), { success: t("enabled") });
      if (res) {
        setDevices(res.devices);
        setState("on");
      }
    } catch {
      toast.error(t("enableFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (sub) {
        const res = await runAction(unsubscribePushAction(sub.endpoint), { success: t("disabled") });
        await sub.unsubscribe();
        if (res) setDevices(res.devices);
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    await runAction(testPushAction(), { success: t("testSent") });
    setBusy(false);
  }

  return { state, devices, busy, enable, disable, test };
}
