import { Button } from "@revklik-new/ui/components/button";
import { Input } from "@revklik-new/ui/components/input";
import { Label } from "@revklik-new/ui/components/label";
import { Textarea } from "@revklik-new/ui/components/textarea";
import {
  ArrowDownUp,
  ArrowDown as ArrowDownIcon,
  BookOpen,
  Check,
  Copy,
  Eye,
  Flag,
  Monitor,
  MousePointerClick,
  Plus,
  Target,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { toast } from "sonner";

import { dayLabel, fmt, timeLabel, visitorAvatar, visitorName } from "./data";
import type { Visitor, VisitorEvent } from "./data";

const eventIcon = (kind: VisitorEvent["kind"]) => {
  if (kind === "view") {
    return Eye;
  }
  if (kind === "scroll") {
    return ArrowDownIcon;
  }
  if (kind === "section") {
    return BookOpen;
  }
  if (kind === "click") {
    return MousePointerClick;
  }
  if (kind === "conversion") {
    return Flag;
  }
  return Target;
};

const chip =
  "bg-muted rounded px-1.5 py-0.5 font-mono text-[11px] text-foreground/90";

const isConversionKind = (ev: VisitorEvent): boolean =>
  ev.kind === "conversion";

const VisitorStep = ({ ev }: { ev: VisitorEvent }) => {
  const isConversion = ev.kind === "conversion";
  return (
    <span
      className={`flex flex-wrap items-center gap-1.5 ${isConversion ? "font-medium text-(--up)" : ""}`}
    >
      {ev.kind === "view" ? (
        <>
          Viewed page <span className={chip}>{ev.page}</span>
        </>
      ) : null}
      {ev.kind === "view" ? (
        <>
          Viewed page <span className={chip}>{ev.page}</span>
        </>
      ) : null}
      {ev.kind === "scroll" ? (
        <>
          Scrolled to <span className={chip}>{ev.milestone}%</span>
        </>
      ) : null}
      {ev.kind === "section" ? (
        <>
          Read section <span className={chip}>{ev.section}</span>
        </>
      ) : null}
      {ev.kind === "click" ? (
        <>
          Clicked <span className={chip}>{ev.click}</span>
        </>
      ) : null}
      {ev.kind === "conversion" ? (
        <>
          Conversion: <span className={chip}>{ev.event}</span>
          {ev.revenue ? <span className="font-mono">{ev.revenue}</span> : null}
        </>
      ) : null}
      {ev.kind === "event" ? (
        <>
          Triggered event: <span className={chip}>{ev.event}</span>
        </>
      ) : null}
    </span>
  );
};

const PropChips = ({ props }: { props: [string, string][] }) => (
  <div className="mt-1.5 flex flex-wrap gap-1">
    {props.map(([k, v]) => (
      <span
        key={k}
        className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]"
      >
        {k}: {v}
      </span>
    ))}
  </div>
);

const ParamRow = ({ name }: { name: string }) => (
  <div className="flex items-center justify-between">
    <span className="font-mono text-xs">{name}</span>
    <span className="bg-muted rounded px-1.5 font-mono text-[10px]">****</span>
  </div>
);

export const VisitorSheet = ({
  visitor,
  onClose,
  onSave,
}: {
  visitor: Visitor;
  onClose: () => void;
  onSave: (patch: { tags: string[]; note: string }) => Promise<void>;
}) => {
  const [oldestFirst, setOldestFirst] = useState(true);
  const [copied, setCopied] = useState(false);
  const [tags, setTags] = useState<string[]>([...visitor.tags]);
  const [tagDraft, setTagDraft] = useState("");
  const [note, setNote] = useState(visitor.note);
  const [saving, setSaving] = useState(false);
  const displayName = visitorName(visitor);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const events = useMemo(
    () => (oldestFirst ? visitor.events.toReversed() : visitor.events),
    [visitor.events, oldestFirst]
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ events, visitor }, null, 2)
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy the journey");
    }
  };

  const addTag = () => {
    const t = tagDraft.trim().toLowerCase();
    if (!t) {
      return;
    }
    if (!tags.includes(t)) {
      setTags([...tags, t]);
    }
    setTagDraft("");
  };

  const onTagKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  };

  const renderEvent = (ev: VisitorEvent, i: number) => {
    const Icon = eventIcon(ev.kind);
    return (
      <li
        key={`${ev.time}-${i}`}
        className="hover:bg-muted/50 rounded-lg px-2 py-1.5"
      >
        <div className="flex items-start gap-2.5 text-[13px]">
          <Icon
            className={`mt-0.5 size-3.5 shrink-0 ${isConversionKind(ev) ? "text-(--up)" : "text-muted-foreground"}`}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <VisitorStep ev={ev} />
            {ev.props ? <PropChips props={ev.props} /> : null}
          </div>
          <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
            {timeLabel(ev.time)}
          </span>
        </div>
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-40">
      <dialog
        open
        aria-label={`Journey for ${displayName}`}
        className="fixed inset-0 z-40 m-0 h-svh max-h-none w-full max-w-none overflow-visible border-0 bg-transparent p-0"
      >
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="animate-in fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={`Journey for ${displayName}`}
          tabIndex={-1}
          autoFocus
          className="bg-card ring-foreground/10 animate-in slide-in-from-right-8 absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col rounded-l-2xl ring-1 duration-200 outline-none"
        >
          <div className="border-border/60 flex items-center gap-2 border-b p-3">
            <p className="truncate text-sm font-semibold">
              Journey{" "}
              <span className="text-muted-foreground">· {displayName}</span>
              <span className="bg-muted text-muted-foreground ml-1.5 rounded px-1 py-0.5 font-mono text-[10px]">
                {fmt(visitor.events.length)} events
              </span>
            </p>
            <div className="ms-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setOldestFirst(!oldestFirst)}
                className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-ring focus-visible:outline-2 outline-offset-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] tracking-wider uppercase"
              >
                <ArrowDownUp className="size-3" aria-hidden />
                {oldestFirst ? "Oldest first" : "Newest first"}
              </button>
              <button
                type="button"
                onClick={copy}
                className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-ring focus-visible:outline-2 outline-offset-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] tracking-wider uppercase"
              >
                {copied ? (
                  <Check className="size-3" aria-hidden />
                ) : (
                  <Copy className="size-3" aria-hidden />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="hover:bg-muted focus-visible:outline-ring rounded-md p-1.5 outline-offset-2 focus-visible:outline-2"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="border-border/60 flex items-start gap-3 border-b p-4">
              <img
                src={visitorAvatar(visitor)}
                alt=""
                loading="lazy"
                className="ring-foreground/10 bg-card size-12 shrink-0 rounded-full ring-1"
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {displayName}
                  {visitor.customer ? (
                    <span className="rounded-full bg-(--chart)/10 px-2 py-0.5 text-[10px] font-medium text-(--chart)">
                      Customer
                    </span>
                  ) : null}
                </p>
                <p className="text-muted-foreground font-mono text-xs">
                  {visitor.email ?? "not identified"}
                </p>
                <div className="text-muted-foreground mt-2 grid gap-1 text-[13px]">
                  <span>
                    {visitor.flag} {visitor.country ?? "Unknown"}
                    {visitor.city ? `, ${visitor.city}` : ""}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Monitor className="size-3.5" aria-hidden />
                    {visitor.device ?? "—"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-1.5 rounded-full bg-(--compare)"
                      aria-hidden
                    />
                    {visitor.os}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-1.5 rounded-full bg-(--compare)"
                      aria-hidden
                    />
                    {visitor.browser}
                  </span>
                </div>
              </div>
            </div>

            {visitor.params.length > 0 ? (
              <div className="border-border/60 border-b p-4">
                <p className="text-muted-foreground mb-1.5 text-[11px] tracking-wider uppercase">
                  Parameters
                </p>
                <div className="grid gap-1">
                  {visitor.params.map((p) => (
                    <ParamRow key={p} name={p} />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="border-border/60 border-b p-4">
              <Label htmlFor="visitor-tags" className="mb-1.5 block">
                Tags
              </Label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-(--chart)/10 px-2 py-0.5 text-[11px] font-medium text-(--chart)"
                  >
                    {t}
                    <button
                      type="button"
                      aria-label={`Remove tag ${t}`}
                      onClick={() => setTags(tags.filter((x) => x !== t))}
                      className="hover:text-foreground focus-visible:outline-ring outline-offset-2 focus-visible:outline-2"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </span>
                ))}
                {tags.length === 0 ? (
                  <span className="text-muted-foreground text-xs">
                    No tags yet.
                  </span>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Input
                  id="visitor-tags"
                  value={tagDraft}
                  placeholder="Add a tag…"
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={onTagKey}
                  className="h-8 text-xs"
                />
                <Button variant="outline" size="sm" onClick={addTag}>
                  <Plus className="size-3.5" aria-hidden />
                  Add
                </Button>
              </div>
              <div className="mt-3 grid gap-1.5">
                <Label htmlFor="visitor-note">Notes</Label>
                <Textarea
                  id="visitor-note"
                  rows={3}
                  value={note}
                  placeholder="Context for the team…"
                  onChange={(e) => setNote(e.target.value)}
                  className="text-xs"
                />
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      try {
                        await onSave({ note, tags });
                        toast.success("Saved");
                      } catch {
                        toast.error("Couldn't save");
                      }
                      setSaving(false);
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-4">
              <p className="bg-muted/70 text-muted-foreground mb-2 rounded-lg py-1.5 text-center text-xs font-medium">
                {events[0] ? dayLabel(events[0].time) : ""}
              </p>
              <ol className="grid gap-0.5">{events.map(renderEvent)}</ol>
              <p className="text-muted-foreground mt-3 text-center font-mono text-[11px] tabular-nums">
                {fmt(visitor.events.length)} steps
                {visitor.source ? ` · ${visitor.source}` : ""}
              </p>
            </div>
          </div>
        </aside>
      </dialog>
    </div>
  );
};
