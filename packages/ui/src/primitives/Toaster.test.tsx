/**
 * F-11: every toast vanished after 4 s, errors included (a failed approval, a refused save), often
 * before anyone could read them. Errors now stay, with a close button, until dismissed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast as sonnerToast } from "sonner";
import { toast } from "./Toaster";

afterEach(() => vi.restoreAllMocks());

describe("toast", () => {
  it("keeps an error until it is closed, with a close button", () => {
    const error = vi.spyOn(sonnerToast, "error").mockReturnValue("t1");
    expect(toast.error("Could not approve the task")).toBe("t1");
    expect(error).toHaveBeenCalledWith("Could not approve the task", {
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
    });
  });

  it("lets a call set its own duration, and leaves the other kinds as they were", () => {
    // success, info, promise, dismiss … are sonner's own
    expect(toast.success).toBe(sonnerToast.success);
    expect(toast.dismiss).toBe(sonnerToast.dismiss);
    const error = vi.spyOn(sonnerToast, "error").mockReturnValue("t2");
    toast.error("Retrying", { duration: 6000 });
    expect(error).toHaveBeenCalledWith("Retrying", {
      duration: 6000,
      closeButton: true,
    });
  });
});
