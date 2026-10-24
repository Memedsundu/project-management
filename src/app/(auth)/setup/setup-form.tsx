"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { finishSetupAction, startSetupAction } from "../actions";
import { browserErrorCode } from "../passkey-errors";
import { RecoveryCodes } from "./recovery-codes";

export function SetupForm({ needsToken, tokenMissing }: { needsToken: boolean; tokenMissing: boolean }) {
  const t = useTranslations("auth");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  if (codes) return <RecoveryCodes codes={codes} continueHref="/today?welcome=1" />;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const opts = await startSetupAction({ name, setupToken: token || undefined });
      if (!opts.ok) return setError(opts.error);
      let response;
      try {
        response = await startRegistration({ optionsJSON: opts.data });
      } catch (err) {
        return setError(browserErrorCode(err));
      }
      const res = await finishSetupAction(response);
      if (!res.ok) return setError(res.error);
      setCodes(res.data.recoveryCodes);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[40px] leading-none">{t("setupTitle")}</h1>
        <p className="text-[15px] text-muted">{t("setupBody")}</p>
      </div>
      {tokenMissing ? (
        <p className="rounded-xl bg-accent-soft px-4 py-3 text-[14px] text-accent-ink">{t("setupTokenMissing")}</p>
      ) : null}
      <Field label={t("yourName")} hint={t("yourNameHint")} htmlFor="name">
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      </Field>
      {needsToken ? (
        <Field label={t("setupToken")} hint={t("setupTokenHint")} htmlFor="token">
          <Input
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </Field>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl bg-accent-soft px-4 py-3 text-[14px] text-accent-ink">
          {t(`errors.${error}` as "errors.verify")}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending || tokenMissing} data-testid="setup-submit">
        <Fingerprint size={18} />
        {t("createPasskey")}
      </Button>
    </form>
  );
}
