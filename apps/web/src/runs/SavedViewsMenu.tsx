"use client";
/**
 * Saved views of the runs list (API.md §3.4): a person's named filter sets. A view stores the
 * list's URL query (`serializeFilters`), so applying one is a navigation and a shared link still
 * reads the same filters.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bookmark, Check, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FieldRow,
  IconButton,
  Input,
  toast,
} from "@flowaid/ui/primitives";
import { del, getAll, post } from "~/api/client";
import { errorMessage } from "~/shell/states";

export interface SavedView {
  id: string;
  scope: "runs";
  name: string;
  filters: { query?: string };
}

export interface SavedViewsMenuProps {
  ws: string;
  /** The list's current filters as a URL query, "" when none. */
  query: string;
  onApply: (query: string) => void;
}

export function SavedViewsMenu({ ws, query, onApply }: SavedViewsMenuProps) {
  const qc = useQueryClient();
  const key = ["saved-views", ws, "runs"];
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const views = useQuery({
    queryKey: key,
    queryFn: () => getAll<SavedView>("/v1/saved-views", { scope: "runs" }),
  });
  const save = useMutation({
    mutationFn: (n: string) =>
      post<SavedView>("/v1/saved-views", { scope: "runs", name: n, filters: { query } }),
    onSuccess: (v) => {
      toast.success(`Saved “${v.name}”`);
      setNaming(false);
      setName("");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/v1/saved-views/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const current = views.data?.find((v) => (v.filters.query ?? "") === query && query !== "");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Bookmark strokeWidth={1.75} />}
            aria-label="Saved views"
          >
            {current ? current.name : "Views"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {views.data?.length ? (
            views.data.map((v) => (
              <DropdownMenuItem
                key={v.id}
                onSelect={() => onApply(v.filters.query ?? "")}
                className="group/view flex items-center gap-2"
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {v.id === current?.id ? <Check strokeWidth={1.75} aria-hidden="true" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                <IconButton
                  size="xs"
                  label={`Delete ${v.name}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    remove.mutate(v.id);
                  }}
                >
                  <Trash2 strokeWidth={1.75} />
                </IconButton>
              </DropdownMenuItem>
            ))
          ) : (
            <p className="px-2 py-1.5 text-xs text-ink-3">
              {views.isPending ? "Loading…" : "No saved views yet."}
            </p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={query === ""} onSelect={() => setNaming(true)}>
            Save current filters…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) save.mutate(name.trim());
            }}
          >
            <DialogHeader>
              <DialogTitle>Save view</DialogTitle>
              <DialogDescription>
                Only you see your views. A view with the same name is replaced.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <FieldRow label="Name" htmlFor="view-name" required>
                <Input
                  id="view-name"
                  value={name}
                  maxLength={80}
                  placeholder="Failed this week"
                  onChange={(e) => setName(e.target.value)}
                />
              </FieldRow>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" type="button" onClick={() => setNaming(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={!name.trim()}
                loading={save.isPending}
              >
                Save view
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
