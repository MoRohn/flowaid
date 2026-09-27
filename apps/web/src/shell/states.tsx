"use client";
/** Shared loading, empty and error states for pages. */
import { AlertTriangle } from "lucide-react";
import { Button, EmptyState } from "@flowaid/ui/primitives";
import { ApiError } from "~/api/client";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return error.status === 403 ? "You do not have access to this." : error.message;
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<AlertTriangle strokeWidth={1.5} />}
      title={
        error instanceof ApiError && error.status === 404 ? "Not found" : "Could not load this"
      }
      description={errorMessage(error)}
      primaryAction={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}
