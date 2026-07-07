"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, THead, TBody, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Field } from "@/components/ui/input";
import { ROLE_TONES, AREA_KEYS } from "@/lib/labels";
import { AREA_LABELS, ROLE_LABELS } from "@/lib/i18n/dict";
import { useTr } from "@/components/i18n-provider";
import { EMPTY } from "@/lib/utils";
import { Plus, Copy, Check, KeyRound, Grid3x3, Users, UserPlus } from "lucide-react";
import type { AppMember, PermLevel } from "@/lib/types";

type PermRow = { role: string; area: string; level: string };
type PersonnelOption = { notion_id: string; nom: string | null; email: string | null; role: string | null; actif: boolean };

const MATRIX_ROLES = ["medecin", "secretaire", "ipa", "externe"]; // admin/owner = toujours tout
const LEVEL_CYCLE: Record<string, PermLevel[]> = {
  default: ["none", "full"],
  paiements_own: ["none", "status", "full"],
  paiements_all: ["none", "full"],
};

function levelLabel(level: string, statusLabel: string): { text: string; cls: string } {
  if (level === "full") return { text: "✓", cls: "bg-success-soft text-success" };
  if (level === "status") return { text: statusLabel, cls: "bg-warning-soft text-warning" };
  return { text: EMPTY, cls: "bg-background text-muted" };
}

export function AccesClient({
  permissions,
  members,
  personnel,
  selfId,
}: {
  permissions: PermRow[];
  members: AppMember[];
  personnel: PersonnelOption[];
  selfId: string;
}) {
  const router = useRouter();
  const { lang, tr } = useTr();
  const [perms, setPerms] = useState<Map<string, string>>(
    new Map(permissions.map((p) => [`${p.role}:${p.area}`, p.level]))
  );
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cycleCell(role: string, area: string) {
    const key = `${role}:${area}`;
    const cycle = LEVEL_CYCLE[area] ?? LEVEL_CYCLE.default;
    const current = (perms.get(key) ?? "none") as PermLevel;
    const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
    setBusyCell(key);
    setError(null);
    const res = await fetch("/api/matrice", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, area, level: next }),
    });
    if (res.ok) {
      setPerms(new Map(perms).set(key, next));
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? tr.common.error);
    }
    setBusyCell(null);
  }

  // ----- création de membre -----
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [nom, setNom] = useState("");
  const [role, setRole] = useState("medecin");
  const [isOwner, setIsOwner] = useState(false);
  const [personnelId, setPersonnelId] = useState("");
  const [pending, setPending] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function createMember(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/membres", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, nom, role, is_owner: isOwner, personnel_notion_id: personnelId || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      setError(body.error ?? tr.acces.createError);
      return;
    }
    setCreatedPassword(body.password);
    router.refresh();
  }

  async function patchMember(id: string, patch: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/membres", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? tr.common.error);
      return null;
    }
    router.refresh();
    return body;
  }

  async function resetPassword(id: string) {
    const body = await patchMember(id, { reset_password: true });
    if (body?.password) {
      setCreatedPassword(body.password);
      setOpen(true);
    }
  }

  function copyPassword() {
    if (createdPassword) {
      navigator.clipboard.writeText(createdPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  function closeDialog() {
    setOpen(false);
    setCreatedPassword(null);
    setEmail(""); setNom(""); setPersonnelId(""); setIsOwner(false);
  }

  const roleLabels = ROLE_LABELS[lang];
  const areaLabels = AREA_LABELS[lang];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<KeyRound />}
        title={tr.acces.title}
        subtitle={tr.acces.subtitle}
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" /> {tr.acces.addMember}
          </Button>
        }
      />

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <Card>
        <CardHeader icon={<Grid3x3 />} title={tr.acces.matrixTitle} subtitle={tr.acces.matrixSub} />
        <Table>
          <THead>
            <th>{tr.acces.colZone}</th>
            {MATRIX_ROLES.map((r) => (
              <th key={r} className="text-center">{roleLabels[r]}</th>
            ))}
          </THead>
          <TBody>
            {AREA_KEYS.map((areaKey) => {
              const area = areaLabels[areaKey];
              return (
                <Tr key={areaKey}>
                  <td>
                    <p className="text-sm font-medium">{area.label}</p>
                    <p className="text-xs text-muted">{area.description}</p>
                  </td>
                  {MATRIX_ROLES.map((r) => {
                    const key = `${r}:${areaKey}`;
                    const level = perms.get(key) ?? "none";
                    const { text, cls } = levelLabel(level, lang === "en" ? "status" : "statut");
                    return (
                      <td key={r} className="text-center">
                        <button
                          onClick={() => cycleCell(r, areaKey)}
                          disabled={busyCell === key}
                          className={`inline-flex h-7 min-w-12 cursor-pointer items-center justify-center rounded-md px-2 text-xs font-semibold transition-all hover:opacity-70 active:scale-95 disabled:opacity-40 ${cls}`}
                          title={tr.acces.clickToChange(level)}
                        >
                          {busyCell === key ? "…" : text}
                        </button>
                      </td>
                    );
                  })}
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader icon={<Users />} title={tr.acces.membersTitle} subtitle={tr.acces.membersSub} />
        <Table>
          <THead>
            <th>{tr.acces.colMember}</th><th>{tr.acces.colRole}</th><th>{tr.acces.colNotion}</th><th>{tr.acces.colActive}</th><th></th>
          </THead>
          <TBody>
            {members.map((m) => {
              const person = personnel.find((p) => p.notion_id === m.personnel_notion_id);
              return (
                <Tr key={m.id}>
                  <td>
                    <p className="font-medium">{m.nom ?? m.email}</p>
                    <p className="text-xs text-muted">{m.email}</p>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={ROLE_TONES[m.role] ?? "gray"}>{roleLabels[m.role] ?? m.role}</Badge>
                      {m.is_owner && <Badge tone="red">{tr.common.owner}</Badge>}
                    </div>
                  </td>
                  <td className="text-xs">
                    {person ? (
                      person.nom
                    ) : (
                      <Select
                        className="h-7 w-auto text-xs"
                        defaultValue=""
                        onChange={(e) => e.target.value && patchMember(m.id, { personnel_notion_id: e.target.value })}
                      >
                        <option value="">{tr.acces.linkTo}</option>
                        {personnel.map((p) => (
                          <option key={p.notion_id} value={p.notion_id}>{p.nom}</option>
                        ))}
                      </Select>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() => m.id !== selfId && patchMember(m.id, { active: !m.active })}
                      disabled={m.id === selfId}
                      title={m.id === selfId ? tr.acces.cantDeactivateSelf : tr.acces.toggleHint}
                      className={`inline-flex h-6 w-11 cursor-pointer items-center rounded-full p-0.5 transition-colors disabled:opacity-40 ${m.active ? "bg-success" : "bg-border"}`}
                    >
                      <span className={`size-5 rounded-full bg-white shadow transition-transform ${m.active ? "translate-x-5" : ""}`} />
                    </button>
                  </td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => resetPassword(m.id)} title={tr.acces.newPassword}>
                      <KeyRound className="size-3.5" /> {tr.acces.passwordBtn}
                    </Button>
                  </td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <Dialog
        open={open}
        onClose={closeDialog}
        title={createdPassword ? tr.acces.pwdTitle : tr.acces.memberTitle}
        icon={createdPassword ? <KeyRound /> : <UserPlus />}
      >
        {createdPassword ? (
          <div className="space-y-4">
            <p className="text-sm">
              {tr.acces.pwdReady} <strong>{tr.acces.pwdCopyNow}</strong> {tr.acces.pwdOnce}
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
              <code className="flex-1 text-base font-semibold tracking-wide">{createdPassword}</code>
              <Button size="sm" variant="secondary" onClick={copyPassword}>
                {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                {copied ? tr.common.copied : tr.common.copy}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={closeDialog}>{tr.common.done}</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={createMember} className="space-y-3">
            <Field label={tr.dialogs.email} hint={tr.acces.emailHint}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="prenom@cabinet.fr" />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={tr.acces.displayName}>
                <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Dr…" />
              </Field>
              <Field label={tr.acces.role}>
                <Select value={role} onChange={(e) => setRole(e.target.value)}>
                  {Object.entries(roleLabels).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={tr.acces.notionSheet} hint={tr.acces.notionHint}>
              <Select value={personnelId} onChange={(e) => setPersonnelId(e.target.value)}>
                <option value="">{tr.acces.detectByEmail}</option>
                {personnel.map((p) => (
                  <option key={p.notion_id} value={p.notion_id}>
                    {p.nom} {p.role ? `(${p.role})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isOwner} onChange={(e) => setIsOwner(e.target.checked)} className="size-4 accent-[var(--primary)]" />
              {tr.acces.ownerCheck}
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={closeDialog}>{tr.common.cancel}</Button>
              <Button type="submit" loading={pending}>{tr.acces.createAccount}</Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
