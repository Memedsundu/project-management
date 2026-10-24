"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { Copy, Download, Fingerprint, LogOut, Pencil, Smartphone, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { browserErrorCode } from "@/app/(auth)/passkey-errors";
import {
  deletePasskeyAction,
  finishAddPasskeyAction,
  newRecoveryCodesAction,
  pairingCodeAction,
  renamePasskeyAction,
  signOutOtherSessionsAction,
  signOutSessionAction,
  startAddPasskeyAction,
} from "@/app/(app)/settings/actions";
import { SignOutButton } from "@/components/shell/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { formatDateTime, formatTime } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import type { SettingsData } from "@/server/views/settings";
import { Row, SettingsSection } from "./parts";

/**
 * Hesap: her passkeys, adding a new device with a short code (Apple, Google
 * sign-in), recovery codes (GitHub) and the devices signed in now.
 */
export function AccountSection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.account");
  const ta = useTranslations("auth");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { passkeys, sessions, recoveryLeft } = data.account;
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pair, setPair] = useState<{ code: string; until: string; url: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [askCodes, setAskCodes] = useState(false);
  const [askOthers, setAskOthers] = useState(false);
  const others = sessions.filter((s) => !s.current);

  async function addPasskey() {
    setAdding(true);
    try {
      const options = await runAction(startAddPasskeyAction());
      if (!options) return;
      let response;
      try {
        response = await startRegistration({ optionsJSON: options });
      } catch (err) {
        const code = browserErrorCode(err);
        if (code !== "cancelled") toast.error(ta(`errors.${code}` as "errors.verify"));
        return;
      }
      await runAction(finishAddPasskeyAction(response), { success: t("passkeyAdded") });
    } finally {
      setAdding(false);
    }
  }

  async function newPairingCode() {
    const res = await runAction(pairingCodeAction());
    if (!res) return;
    setPair({ code: res.code, until: formatTime(new Date(Date.now() + res.expiresInMinutes * 60_000)), url: `${window.location.host}/pair` });
  }

  async function regenerate() {
    const res = await runAction(newRecoveryCodesAction());
    setAskCodes(false);
    if (res) setCodes(res.codes);
  }

  return (
    <SettingsSection id="account" title={t("title")} hint={t("hint")}>
      {/* Passkeys */}
      <Row label={t("passkeys")} hint={t("passkeysHint")} stack>
        {passkeys.length === 0 ? <p className="text-[14px] text-muted">{t("noPasskeys")}</p> : null}
        <ul className="flex w-full flex-col" data-testid="s-passkeys">
          {passkeys.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft py-2.5 last:border-0">
              <Fingerprint size={16} className="shrink-0 text-muted" aria-hidden />
              {renaming?.id === p.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if ((await runAction(renamePasskeyAction(p.id, renaming.name))) !== undefined) setRenaming(null);
                  }}
                >
                  <Input value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} maxLength={60} autoFocus aria-label={t("passkeyName")} className="h-9 min-w-0 flex-1" data-testid="s-passkey-name" />
                  <Button type="submit" size="sm" disabled={!renaming.name.trim()}>
                    {tc("save")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                    {tc("cancel")}
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px]">{p.name}</span>
                    <span className="text-[13px] text-muted">
                      {p.lastUsedAt ? t("lastUsed", { when: formatDateTime(p.lastUsedAt, locale) }) : t("added", { when: formatDateTime(p.createdAt, locale) })}
                    </span>
                  </span>
                  {p.synced ? (
                    <Badge variant="outline" size="sm" title={t("syncedHint")}>
                      {t("synced")}
                    </Badge>
                  ) : null}
                  <span className="flex shrink-0 items-center">
                    <Button variant="ghost" size="icon-sm" onClick={() => setRenaming({ id: p.id, name: p.name })} aria-label={t("renamePasskey", { name: p.name })}>
                      <Pencil size={14} />
                    </Button>
                    {passkeys.length > 1 ? (
                      <Button variant="ghost" size="icon-sm" onClick={() => setRemoving(p.id)} aria-label={t("removePasskey", { name: p.name })} data-testid="s-passkey-remove">
                        <Trash2 size={15} />
                      </Button>
                    ) : null}
                  </span>
                </>
              )}
              {removing === p.id ? (
                <div className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-panel px-3 py-2 text-[14px]">
                  <span className="min-w-0 flex-1">{t("removeConfirm")}</span>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                    {tc("cancel")}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      await runAction(deletePasskeyAction(p.id), { success: t("passkeyRemoved") });
                      setRemoving(null);
                    }}
                  >
                    {tc("delete")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={addPasskey} disabled={adding} data-testid="s-passkey-add">
            <Fingerprint size={15} />
            {t("addHere")}
          </Button>
          <Button variant="outline" size="sm" onClick={newPairingCode} data-testid="s-pair">
            <Smartphone size={15} />
            {t("addDevice")}
          </Button>
        </div>
      </Row>

      {/* Recovery codes */}
      <Row label={t("recovery")} hint={t("recoveryHint")}>
        <span className="text-[14px] text-muted" data-testid="s-recovery-left">
          {t("recoveryLeft", { count: recoveryLeft })}
        </span>
        <Button variant="outline" size="sm" onClick={() => setAskCodes(true)} data-testid="s-recovery-new">
          {t("recoveryNew")}
        </Button>
      </Row>
      {askCodes ? (
        <div className="-mt-1 mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-panel px-3 py-2 text-[14px]">
          <span className="min-w-0 flex-1">{t("recoveryConfirm")}</span>
          <Button size="sm" variant="ghost" onClick={() => setAskCodes(false)}>
            {tc("cancel")}
          </Button>
          <Button size="sm" onClick={regenerate} data-testid="s-recovery-confirm">
            {t("recoveryNew")}
          </Button>
        </div>
      ) : null}

      {/* Signed-in devices */}
      <Row label={t("sessions")} hint={t("sessionsHint")} stack>
        <ul className="flex w-full flex-col" data-testid="s-sessions">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-[15px]">
                  {s.device ?? t("unknownDevice")}
                  {s.current ? <Badge size="sm">{t("thisDevice")}</Badge> : null}
                </span>
                <span className="text-[13px] text-muted">{t("lastSeen", { when: formatDateTime(s.lastSeenAt, locale) })}</span>
              </span>
              {s.current ? (
                <SignOutButton inline />
              ) : (
                <Button variant="ghost" size="sm" onClick={() => runAction(signOutSessionAction(s.id), { success: t("signedOut") })} data-testid="s-session-out">
                  <LogOut size={15} />
                  {t("signOut")}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {others.length ? (
          askOthers ? (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-panel px-3 py-2 text-[14px]">
              <span className="min-w-0 flex-1">{t("othersConfirm", { count: others.length })}</span>
              <Button size="sm" variant="ghost" onClick={() => setAskOthers(false)}>
                {tc("cancel")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  const res = await runAction(signOutOtherSessionsAction());
                  setAskOthers(false);
                  if (res) toast(t("othersDone", { count: res.count }));
                }}
                data-testid="s-sessions-others-confirm"
              >
                {t("signOutOthers")}
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAskOthers(true)} data-testid="s-sessions-others">
              <LogOut size={15} />
              {t("signOutOthers")}
            </Button>
          )
        ) : null}
      </Row>

      {/* A short code for a new phone or laptop */}
      <Dialog open={pair !== null} onOpenChange={(v) => !v && setPair(null)}>
        <DialogContent title={t("pairTitle")} description={t("pairHint")}>
          {pair ? (
            <div className="flex flex-col gap-5">
              <ol className="flex flex-col gap-2 text-[15px]">
                <li className="flex gap-2">
                  <span className="w-5 shrink-0 text-right text-faint">1.</span>
                  <span>
                    {t("pairStep1")} <span className="font-medium">{pair.url}</span>
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 shrink-0 text-right text-faint">2.</span>
                  {t("pairStep2")}
                </li>
              </ol>
              <p className="rounded-2xl bg-panel py-5 text-center font-mono text-[40px] tracking-[0.2em] tabular-nums" data-testid="s-pair-code" aria-label={pair.code.split("").join(" ")}>
                {pair.code.slice(0, 3)} {pair.code.slice(3)}
              </p>
              <p className="text-[13px] text-muted">{t("pairUntil", { time: pair.until })}</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={newPairingCode}>
                  {t("pairAgain")}
                </Button>
                <Button onClick={() => setPair(null)}>{tc("done")}</Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* New recovery codes, shown once */}
      <Dialog open={codes !== null} onOpenChange={(v) => !v && setCodes(null)}>
        <DialogContent title={ta("recoveryTitle")} description={ta("recoveryBody")}>
          {codes ? (
            <div className="flex flex-col gap-5">
              <ol className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-2xl bg-panel p-5 font-mono text-[15px] tracking-wider" data-testid="s-recovery-codes">
                {codes.map((c, i) => (
                  <li key={c} className="flex gap-2">
                    <span className="w-5 text-right text-faint">{i + 1}.</span>
                    {c}
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(codes.join("\n"));
                    toast(tc("copied"));
                  }}
                >
                  <Copy size={15} />
                  {ta("copyCodes")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const url = URL.createObjectURL(new Blob([`${t("fileHeading", { app: data.profile.appName })}\n\n${codes.join("\n")}\n`], { type: "text/plain;charset=utf-8" }));
                    const a = Object.assign(document.createElement("a"), { href: url, download: t("fileName") });
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download size={15} />
                  {t("download")}
                </Button>
                <Button onClick={() => setCodes(null)}>{ta("iSavedThem")}</Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
