"use client";

import { startRegistration } from "@simplewebauthn/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { finishPairingAction, startPairingAction } from "../actions";
import { browserErrorCode } from "../passkey-errors";

export function PairForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const opts = await startPairingAction(code);
      if (!opts.ok) return setError(opts.error);
      let response;
      try {
        response = await startRegistration({ optionsJSON: opts.data });
      } catch (err) {
        return setError(browserErrorCode(err));
      }
      const res = await finishPairingAction(response);
      if (!res.ok) return setError(res.error);
      router.replace("/today");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[36px] leading-none">{t("addThisDevice")}</h1>
        <p className="text-[15px] text-muted">{t("addThisDeviceBody")}</p>
      </div>
      <Field label={t("pairCode")} htmlFor="pair">
        <Input
          id="pair"
          inputMode="numeric"
          pattern="[0-9 ]*"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="font-mono text-[20px] tracking-[0.3em]"
          autoComplete="one-time-code"
          required
        />
      </Field>
      {error ? (
        <p role="alert" className="rounded-xl bg-accent-soft px-4 py-3 text-[14px] text-accent-ink">
          {t(`errors.${error}` as "errors.verify")}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {t("pairSubmit")}
      </Button>
      <Link href="/sign-in" className="text-[14px] font-medium text-muted hover:text-ink">
        ← {tc("back")}
      </Link>
    </form>
  );
}
