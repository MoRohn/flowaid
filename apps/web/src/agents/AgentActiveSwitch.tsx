"use client";
/**
 * An agent's Active switch on the Agents page. Active agents are offered as their own steps in
 * the builder's Add node palette; inactive ones are hidden there but keep working in the steps
 * that already use them. The card changes at once and goes back if the server refuses.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { Switch, toast } from "@flowaid/ui/primitives";
import { patch } from "~/api/client";
import { useSession } from "~/session";
import { errorMessage } from "~/shell/states";
import type { AgentPreset } from "./logic";

/** The builder's palette reads this list (active agents only). */
export const activeAgentsKey = (ws: string) => ["agents", ws, "active"] as const;

export function AgentActiveSwitch({ agent, disabled }: { agent: AgentPreset; disabled?: boolean }) {
  const s = useSession();
  const qc = useQueryClient();
  const id = useId();
  const listKey = ["agents", s.ws];
  const active = agent.active !== false;
  const change = useMutation({
    mutationFn: (next: boolean) => patch<AgentPreset>(`/v1/agents/${agent.id}`, { active: next }),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: listKey, exact: true });
      const before = qc.getQueryData<AgentPreset[]>(listKey);
      qc.setQueryData<AgentPreset[]>(listKey, (rows) =>
        rows?.map((a) => (a.id === agent.id ? { ...a, active: next } : a)),
      );
      return { before };
    },
    onError: (e, next, saved) => {
      qc.setQueryData(listKey, saved?.before);
      toast.error(`Could not ${next ? "activate" : "deactivate"} ${agent.name}`, {
        description: errorMessage(e),
      });
    },
    onSuccess: (a) =>
      toast.success(
        a.active
          ? `${a.name} is active: it is in Add node in every workflow`
          : `${a.name} is inactive: it is no longer offered in Add node`,
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: listKey });
      void qc.invalidateQueries({ queryKey: activeAgentsKey(s.ws) });
    },
  });
  return (
    <div className="flex items-center gap-2">
      <Switch
        id={id}
        size="sm"
        checked={active}
        disabled={disabled || change.isPending}
        onCheckedChange={(v) => change.mutate(v)}
        aria-describedby={`${id}-state`}
      />
      <label htmlFor={id} className="cursor-pointer text-xs text-ink-2">
        {/* every card has a switch: each is named after its agent */}
        <span className="sr-only">{agent.name}: </span>
        {active ? "Active" : "Inactive"}
        <span id={`${id}-state`} className="text-ink-3">
          {active ? " · in Add node" : " · hidden from Add node"}
        </span>
      </label>
    </div>
  );
}
