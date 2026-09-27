"use client";
/**
 * Importing an external flow export: the file (or pasted text) is analysed by the server's
 * FlowAId importer (`/v1/workflows/import/preview`), the migration report is shown in the
 * `ImportDialog`, and "Import" saves it (`/v1/workflows/import` with `external`).
 */
import { useState } from "react";
import {
  ImportDialog,
  type ImportDialogStatus,
  type ImportMigrationReport,
} from "@flowaid/ui/builder";
import { ApiError, post } from "~/api/client";
import {
  looksLikeExternalExport,
  parseJson,
  toMigrationReport,
  type ApiImportReport,
} from "./report";

export interface ExternalImportState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** analyse text already in hand (a pasted export) */
  analyse: (text: string, fileName: string) => void;
  dialog: React.ReactNode;
}

export function useExternalImport(o: {
  name?: string;
  onImported: (workflowId: string) => void;
}): ExternalImportState {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ImportDialogStatus>("idle");
  const [error, setError] = useState<string | undefined>();
  const [report, setReport] = useState<ImportMigrationReport | null>(null);
  const [external, setExternal] = useState<unknown>(null);

  const reset = () => {
    setStatus("idle");
    setError(undefined);
    setReport(null);
    setExternal(null);
  };

  const analyse = (text: string, fileName: string) => {
    setOpen(true);
    setError(undefined);
    const value = parseJson(text);
    if (!looksLikeExternalExport(value)) {
      setStatus("error");
      setError(
        "This is not an agent flow or LangChain chat flow export. FlowAId definitions go in the Import card's editor.",
      );
      return;
    }
    setStatus("analysing");
    setExternal(value);
    post<{ report: ApiImportReport }>("/v1/workflows/import/preview", {
      external: value,
      ...(o.name ? { name: o.name } : {}),
    })
      .then((res) => {
        setReport(toMigrationReport(res.report, fileName));
        setStatus("ready");
      })
      .catch((e: unknown) => {
        setStatus("error");
        setError(e instanceof ApiError ? e.message : "The flow could not be analysed.");
      });
  };

  const dialog = (
    <ImportDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
      report={report}
      status={status}
      {...(error ? { error } : {})}
      onFile={(text, fileName) => analyse(text, fileName)}
      onImport={() => {
        setStatus("importing");
        post<{ workflow: { id: string } }>("/v1/workflows/import", {
          external,
          ...(o.name ? { name: o.name } : {}),
        })
          .then((res) => {
            setOpen(false);
            reset();
            o.onImported(res.workflow.id);
          })
          .catch((e: unknown) => {
            setStatus("ready");
            setError(e instanceof ApiError ? e.message : "The import failed.");
          });
      }}
      onCancel={() => {
        setOpen(false);
        reset();
      }}
    />
  );
  return { open, setOpen, analyse, dialog };
}
