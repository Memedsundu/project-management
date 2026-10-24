"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, KeyRound, Smartphone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { finishLoginAction, recoveryLoginAction, startLoginAction } from "../actions";
import { browserErrorCode } from "../passkey-errors";

export function SignInForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"passkey" | "recovery">("passkey");
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();

  function signInWithPasskey() {
    setError(null);
    start(async () => {
      const opts = await startLoginAction();
      if (!opts.ok) return setError(opts.error);
      let response;
      try {
        response = await startAuthentication({ optionsJSON: opts.data });
      } catch (e) {
        return setError(browserErrorCode(e));
      }
      const res = await finishLoginAction(response);
      if (!res.ok) return setError(res.error);
      router.replace("/today");
      router.refresh();
    });
  }

  function signInWithCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await recoveryLoginAction(code);
      if (!res.ok) return setError(res.error);
      router.replace("/settings/account?recovered=1");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[40px] leading-none">{t("signInTitle")}</h1>
        <p className="text-[15px] text-muted">{t("signInBody")}</p>
      </div>

      {mode === "passkey" ? (
        <Button size="lg" onClick={signInWithPasskey} disabled={pending} data-testid="passkey-login">
          <Fingerprint size={18} />
          {pending ? t("signingIn") : t("signInWithPasskey")}
        </Button>
      ) : (
        <form onSubmit={signInWithCode} className="flex flex-col gap-4">
          <Field label={t("recoveryCode")} hint={t("recoveryCodeHint")} htmlFor="code">
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono tracking-wider"
              required
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {t("recoverySubmit")}
          </Button>
        </form>
      )}

      {error ? (
        <p role="alert" className="rounded-xl bg-accent-soft px-4 py-3 text-[14px] text-accent-ink">
          {t(`errors.${error}` as "errors.verify")}
        </p>
      ) : null}

      <div className="flex flex-col gap-1 border-t border-line-soft pt-4">
        <button
          type="button"
          onClick={() => {
            setMode(mode === "passkey" ? "recovery" : "passkey");
            setError(null);
          }}
          className="flex min-h-11 items-center gap-2 rounded-lg text-left text-[14px] font-medium hover:text-accent"
        >
          {mode === "passkey" ? <KeyRound size={16} /> : <Fingerprint size={16} />}
          {mode === "passkey" ? t("useRecoveryCode") : t("signInWithPasskey")}
        </button>
        <Link
          href="/pair"
          className="flex min-h-11 items-center gap-2 rounded-lg text-[14px] font-medium hover:text-accent"
        >
          <Smartphone size={16} />
          {t("addThisDevice")}
        </Link>
      </div>
    </div>
  );
}
