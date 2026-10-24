"use client";

import { BellRing, Check, Download, Share, SquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { saveNotificationsAction } from "@/app/(app)/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { platform, promptInstall, useCanInstall, type Platform } from "@/lib/client/offline";
import { runAction } from "@/lib/client/run-action";
import type { SettingsData } from "@/server/views/settings";
import { Row, SettingsSection } from "./parts";
import { usePush } from "./use-push";

type Kinds = "taskReminders" | "meetingReminders" | "briefReady" | "lateReports";

/** Bildirimler: push on this device, quiet hours, and which reminders come (Things, Todoist). */
export function NotificationsSection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.notifications");
  const push = usePush();
  const [prefs, setPrefs] = useState(data.notifications);

  // Switches save at once and say nothing; the switch is the answer (Linear).
  const save = async (patch: Partial<typeof prefs>) => {
    const before = prefs;
    setPrefs({ ...prefs, ...patch });
    const res = await runAction(saveNotificationsAction(patch));
    if (res === undefined) setPrefs(before);
  };

  const status =
    push.state === "on"
      ? t("stateOn")
      : push.state === "blocked"
        ? t("stateBlocked")
        : push.state === "install"
          ? t("stateInstall")
          : push.state === "unsupported"
            ? t("stateUnsupported")
            : push.state === "loading"
              ? "…"
              : t("stateOff");

  return (
    <SettingsSection id="notifications" title={t("title")} hint={t("hint")}>
      <Row inline label={t("thisDevice")} hint={status} htmlFor="s-push">
        {push.state === "on" ? (
          <Button variant="outline" size="sm" onClick={push.test} disabled={push.busy} data-testid="s-push-test">
            <BellRing size={15} />
            {t("test")}
          </Button>
        ) : null}
        <Switch
          id="s-push"
          checked={push.state === "on"}
          disabled={push.busy || !(push.state === "on" || push.state === "off")}
          onCheckedChange={(v) => (v ? push.enable() : push.disable())}
          data-testid="s-push"
        />
      </Row>
      <Row inline label={t("devices")} hint={t("devicesHint")}>
        <span className="text-[14px] text-muted" data-testid="s-push-devices">
          {t("deviceCount", { count: push.state === "loading" ? data.devices : push.devices })}
        </span>
      </Row>
      <Row label={t("quiet")} hint={t("quietHint")}>
        <span className="flex items-center gap-2">
          <Input
            type="time"
            value={prefs.quietStart}
            onChange={(e) => e.target.value && setPrefs({ ...prefs, quietStart: e.target.value })}
            onBlur={() => prefs.quietStart !== data.notifications.quietStart && save({ quietStart: prefs.quietStart })}
            className="w-[140px]"
            aria-label={t("quietStart")}
            data-testid="s-quiet-start"
          />
          <span className="text-muted">–</span>
          <Input
            type="time"
            value={prefs.quietEnd}
            onChange={(e) => e.target.value && setPrefs({ ...prefs, quietEnd: e.target.value })}
            onBlur={() => prefs.quietEnd !== data.notifications.quietEnd && save({ quietEnd: prefs.quietEnd })}
            className="w-[140px]"
            aria-label={t("quietEnd")}
          />
        </span>
      </Row>
      {(["taskReminders", "meetingReminders", "briefReady", "lateReports"] as Kinds[]).map((k) => (
        <Row inline key={k} label={t(`kinds.${k}`)} hint={t(`kindHints.${k}`)} htmlFor={`s-n-${k}`}>
          <Switch id={`s-n-${k}`} checked={prefs[k]} onCheckedChange={(v) => save({ [k]: v })} />
        </Row>
      ))}
    </SettingsSection>
  );
}

/** Telefona yükle: how to put the app on the home screen, for the browser she is in. */
export function InstallSection() {
  const t = useTranslations("settings.install");
  const canInstall = useCanInstall();
  const [p, setP] = useState<Platform | null>(null);
  useEffect(() => {
    const handle = window.setTimeout(() => setP(platform()), 0);
    return () => window.clearTimeout(handle);
  }, []);

  return (
    <SettingsSection id="install" title={t("title")} hint={t("hint")}>
      {p?.standalone ? (
        <Row label={t("installed")} hint={t("installedHint")}>
          <Badge variant="outline">
            <Check size={12} />
            {t("installedBadge")}
          </Badge>
        </Row>
      ) : (
        <>
          {canInstall ? (
            <Row label={t("thisBrowser")} hint={t("oneClick")}>
              <Button size="sm" onClick={() => void promptInstall()} data-testid="s-install">
                <Download size={15} />
                {t("install")}
              </Button>
            </Row>
          ) : null}
          <Row label={t("iphone")} hint={p?.ios ? t("iphoneHere") : undefined} stack>
            <ol className="flex flex-col gap-1.5 text-[14px] text-ink-2">
              <li className="flex items-center gap-2">
                <span className="w-4 text-right text-faint">1.</span>
                {t("iphone1")}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-4 text-right text-faint">2.</span>
                <Share size={15} className="text-muted" aria-hidden />
                {t("iphone2")}
              </li>
              <li className="flex items-center gap-2">
                <span className="w-4 text-right text-faint">3.</span>
                <SquarePlus size={15} className="text-muted" aria-hidden />
                {t("iphone3")}
              </li>
            </ol>
          </Row>
          <Row label={t("android")} hint={p?.android && !canInstall ? t("androidHere") : undefined} stack>
            <p className="text-[14px] text-ink-2">{t("androidSteps")}</p>
          </Row>
          <Row label={t("laptop")} stack>
            <p className="text-[14px] text-ink-2">{t("laptopSteps")}</p>
          </Row>
        </>
      )}
    </SettingsSection>
  );
}
