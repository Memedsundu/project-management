"use server";

import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { normalizeLocale } from "@/i18n/messages";
import { act, UserError } from "@/server/action";
import { countSubscriptions, publicVapidKey, removeSubscription, saveSubscription, sendPush } from "@/server/notifications/push";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(4).max(100) }),
});

/** The public key a browser needs to subscribe, and how many devices get her reminders. */
export async function pushStatusAction() {
  return act(async () => ({ publicKey: await publicVapidKey(), devices: await countSubscriptions() }), { write: false });
}

export async function subscribePushAction(subscription: unknown) {
  return act(
    async () => {
      const sub = subscriptionSchema.parse(subscription);
      await saveSubscription(sub, (await headers()).get("user-agent"), normalizeLocale(await getLocale()));
      return { devices: await countSubscriptions() };
    },
    { write: false },
  );
}

export async function unsubscribePushAction(endpoint: string) {
  return act(
    async () => {
      await removeSubscription(z.string().max(2000).parse(endpoint));
      return { devices: await countSubscriptions() };
    },
    { write: false },
  );
}

/** A sample notification to every device, even in quiet hours. */
export async function testPushAction() {
  return act(
    async () => {
      const sent = await sendPush(`test:${Date.now()}`, (t) => ({ title: t("testTitle"), body: t("testBody"), url: "/settings#notifications", tag: "test" }), { ignoreQuiet: true });
      if (!sent) throw new UserError("Bildirim gönderilemedi. Bu cihazda bildirimleri kapatıp yeniden açmayı dene.");
      return { sent };
    },
    { write: false },
  );
}
