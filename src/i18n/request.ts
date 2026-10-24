import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, loadMessages, normalizeLocale } from "./messages";

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = normalizeLocale(store.get(LOCALE_COOKIE)?.value);
  return {
    locale,
    timeZone: "Europe/Istanbul",
    messages: await loadMessages(locale),
  };
});
