"use client";
/** Environments: create, edit variables and protection, delete. */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldRow,
  IconButton,
  Input,
  Switch,
} from "@flowaid/ui/primitives";
import { KeyValueEditor } from "@flowaid/ui/forms";
import { del, patch, post } from "~/api/client";
import type { Environment } from "~/api/types";
import { useSession } from "~/session";
import { ENVIRONMENT_NAME, VARIABLE_NAME, rowsToVariables, variablesToRows } from "../logic";
import { Section, useConfirm, useMutate } from "../ui";

function EnvironmentDialog({
  env,
  open,
  onOpenChange,
}: {
  env: Environment | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const s = useSession();
  const qc = useQueryClient();
  const [name, setName] = useState(env?.name ?? "");
  const [isProtected, setProtected] = useState(env?.protected ?? false);
  const [rows, setRows] = useState(variablesToRows(env?.variables ?? {}));
  const vars = rowsToVariables(rows);
  const save = useMutate(
    () => {
      const body = { name: name.trim(), protected: isProtected, variables: vars.value };
      return env
        ? patch<Environment>(`/v1/environments/${env.id}`, body)
        : post<Environment>("/v1/environments", body);
    },
    {
      success: (e) => (env ? `Saved ${e.name}` : `Created ${e.name}`),
      onSuccess: () => {
        onOpenChange(false);
        void qc.invalidateQueries({ queryKey: ["environments", s.ws] });
      },
    },
  );
  const nameOk = ENVIRONMENT_NAME.test(name.trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <DialogHeader>
            <DialogTitle>{env ? `Edit ${env.name}` : "New environment"}</DialogTitle>
            <DialogDescription>
              Variables are available to workflows as <code className="font-mono">$vars</code>;
              deployments can override them.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FieldRow
              label="Name"
              htmlFor="env-name"
              required
              hint="Lowercase letters, digits and dashes"
              error={name && !nameOk ? "Use lowercase letters, digits and dashes" : undefined}
            >
              <Input
                id="env-name"
                className="font-mono"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="staging"
              />
            </FieldRow>
            <FieldRow
              label="Protected"
              htmlFor="env-protected"
              layout="row"
              hint="Deploying here needs the publish scope and counts as production"
            >
              <Switch id="env-protected" checked={isProtected} onCheckedChange={setProtected} />
            </FieldRow>
            <FieldRow label="Variables" error={vars.errors[0]}>
              <KeyValueEditor
                value={rows}
                onChange={(r) => setRows(r.map((x) => ({ key: x.key, value: x.value })))}
                keyPlaceholder="NAME"
                valuePlaceholder="value or JSON"
                mono
                addLabel="Add variable"
                emptyText="No variables"
                validateRow={(r) =>
                  r.key && !VARIABLE_NAME.test(r.key) ? "Letters, digits and _ only" : undefined
                }
              />
            </FieldRow>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={save.isPending}
              disabled={!nameOk || vars.errors.length > 0}
            >
              {env ? "Save" : "Create environment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EnvironmentsTab() {
  const s = useSession();
  const qc = useQueryClient();
  const canEdit = s.can("admin");
  const [editing, setEditing] = useState<Environment | "new" | null>(null);
  const confirm = useConfirm<Environment>();
  const remove = useMutate((e: Environment) => del(`/v1/environments/${e.id}`), {
    success: (_, e) => `Deleted ${e.name}`,
    onSuccess: () => {
      confirm.close();
      void qc.invalidateQueries({ queryKey: ["environments", s.ws] });
    },
    errorTitle: "Could not delete the environment",
  });
  return (
    <Section
      title="Environments"
      description="Each environment has its own deployments, secret bindings and variables."
      actions={
        canEdit ? (
          <Button
            variant="primary"
            leadingIcon={<Plus strokeWidth={1.75} />}
            onClick={() => setEditing("new")}
          >
            New environment
          </Button>
        ) : null
      }
    >
      <ul
        className="flex flex-col divide-y divide-border rounded-md border border-border"
        role="list"
      >
        {s.environments.map((e) => {
          const n = Object.keys(e.variables ?? {}).length;
          return (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2">
              <span className="font-mono text-sm text-ink">{e.name}</span>
              {e.protected ? (
                <Badge tone="warn" icon={<Lock strokeWidth={1.75} />}>
                  Protected
                </Badge>
              ) : null}
              <span className="flex-1 text-2xs text-ink-3">
                {n} variable{n === 1 ? "" : "s"}
              </span>
              {canEdit ? (
                <>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Edit ${e.name}`}
                    onClick={() => setEditing(e)}
                  >
                    <Pencil strokeWidth={1.75} />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={`Delete ${e.name}`}
                    onClick={() => confirm.ask(e)}
                  >
                    <Trash2 strokeWidth={1.75} />
                  </IconButton>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      {editing !== null ? (
        <EnvironmentDialog
          key={editing === "new" ? "new" : editing.id}
          env={editing === "new" ? null : editing}
          open
          onOpenChange={(o) => (o ? undefined : setEditing(null))}
        />
      ) : null}
      <ConfirmDialog
        open={confirm.target !== null}
        onOpenChange={(o) => (o ? undefined : confirm.close())}
        title={`Delete ${confirm.target?.name ?? "environment"}?`}
        description="Its deployments, secret bindings, webhooks and schedules are removed. Runs keep their history."
        variant="danger"
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => {
          if (confirm.target) remove.mutate(confirm.target);
        }}
      />
    </Section>
  );
}
