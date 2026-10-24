"use client";

import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { wrapUpAction } from "@/app/(app)/today/actions";
import type { TaskItem } from "@/components/tasks/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Field, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";

/** Sunsama's evening wrap-up: what got done, leftovers to tomorrow, one line for the daily note. */
export function WrapUpDialog({
  open,
  onOpenChange,
  day,
  done,
  leftovers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  day: string;
  done: { id: string; title: string }[];
  leftovers: TaskItem[];
}) {
  const t = useTranslations("today.wrap");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")} wide>
        {/* The body mounts each time the dialog opens, so it starts fresh. */}
        <WrapUpBody
          onOpenChange={onOpenChange}
          day={day}
          done={done}
          leftovers={leftovers}
        />
      </DialogContent>
    </Dialog>
  );
}

function WrapUpBody({
  onOpenChange,
  day,
  done,
  leftovers,
}: {
  onOpenChange: (v: boolean) => void;
  day: string;
  done: { id: string; title: string }[];
  leftovers: TaskItem[];
}) {
  const t = useTranslations("today.wrap");
  const tc = useTranslations("common");
  const [move, setMove] = useState<Set<string>>(
    () => new Set(leftovers.map((l) => l.id)),
  );
  const [reflection, setReflection] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await runAction(
      wrapUpAction({ day, moveIds: [...move], reflection }),
    );
    setBusy(false);
    if (res) onOpenChange(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-[15px] font-semibold">
          {t("done", { count: done.length })}
        </h3>
        {done.length ? (
          <ul className="flex flex-col gap-1">
            {done.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-2 text-[15px] text-ink-2"
              >
                <CheckCircle2 size={16} className="shrink-0 text-success" />
                {d.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">{t("noneDone")}</p>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[15px] font-semibold">{t("leftovers")}</h3>
        {leftovers.length ? (
          <ul className="flex flex-col gap-1">
            {leftovers.map((l) => (
              <li key={l.id}>
                <label className="flex min-h-10 items-center gap-3 text-[15px]">
                  <Checkbox
                    checked={move.has(l.id)}
                    onCheckedChange={(v) =>
                      setMove((s) => {
                        const n = new Set(s);
                        if (v === true) n.add(l.id);
                        else n.delete(l.id);
                        return n;
                      })
                    }
                  />
                  {l.title}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">{t("noLeftovers")}</p>
        )}
        {leftovers.length ? (
          <p className="text-[13px] text-muted">{t("moveHint")}</p>
        ) : null}
      </section>
      <Field
        label={t("reflection")}
        hint={t("reflectionHint")}
        htmlFor="wrap-reflection"
      >
        <Textarea
          id="wrap-reflection"
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          placeholder={t("reflectionPlaceholder")}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {tc("cancel")}
        </Button>
        <Button onClick={save} disabled={busy}>
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
