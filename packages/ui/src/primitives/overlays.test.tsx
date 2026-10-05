/**
 * Overlay and control primitives (P0-20): Dialog and Sheet trap focus and close on Escape,
 * Popover opens from its trigger, Tabs move with the arrow keys, Switch/Checkbox/Slider
 * respond to the keyboard, Tooltip shows its content on focus.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";
import { Sheet, SheetBody, SheetContent, SheetTitle, SheetTrigger } from "./Sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
import { Switch } from "./Switch";
import { Checkbox } from "./Checkbox";
import { Slider } from "./Slider";
import { Tooltip, TooltipProvider } from "./Tooltip";
import { installDomStubs } from "./testStubs";

afterEach(cleanup);
beforeAll(() => installDomStubs());

describe("Dialog", () => {
  function renderDialog(onOpenChange = vi.fn()) {
    render(
      <Dialog onOpenChange={onOpenChange}>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Publish</DialogTitle>
            <DialogDescription>Versions are immutable.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input aria-label="Notes" />
          </DialogBody>
          <DialogFooter>
            <button type="button">Cancel</button>
            <button type="button">Publish now</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    return onOpenChange;
  }

  it("opens with a named dialog and keeps focus inside it", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog", { name: "Publish" });
    expect(dialog).toHaveAccessibleDescription("Versions are immutable.");
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const onOpenChange = renderDialog();
    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(trigger).toHaveFocus();
  });
});

describe("Sheet", () => {
  it("is a dialog on the chosen side and closes from its close button", async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Palette</SheetTrigger>
        <SheetContent side="left" width={360}>
          <SheetTitle>Nodes</SheetTitle>
          <SheetBody>
            <button type="button">Add HTTP</button>
          </SheetBody>
        </SheetContent>
      </Sheet>,
    );
    await user.click(screen.getByRole("button", { name: "Palette" }));
    const sheet = await screen.findByRole("dialog", { name: "Nodes" });
    expect(sheet.getAttribute("data-side") ?? sheet.className).toMatch(/left/);
    await user.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

// F-05: overlays opened from code (no Radix trigger) gave focus to <body> when they closed
describe("focus return", () => {
  function FromButton({ sheet = false }: { sheet?: boolean }) {
    const [open, setOpen] = useState(false);
    const Root = sheet ? Sheet : Dialog;
    const Content = sheet ? SheetContent : DialogContent;
    const Title = sheet ? SheetTitle : DialogTitle;
    return (
      <>
        <button type="button">Before</button>
        <button type="button" onClick={() => setOpen(true)}>
          Open navigation
        </button>
        <Root open={open} onOpenChange={setOpen}>
          <Content aria-describedby={undefined}>
            <Title>Navigation</Title>
            <button type="button">Workflows</button>
          </Content>
        </Root>
      </>
    );
  }

  it("returns focus to the button that opened a dialog from code", async () => {
    const user = userEvent.setup();
    render(<FromButton />);
    const opener = screen.getByRole("button", { name: "Open navigation" });
    await user.click(opener);
    await screen.findByRole("dialog", { name: "Navigation" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("returns focus to the button that opened a sheet from code", async () => {
    const user = userEvent.setup();
    render(<FromButton sheet />);
    const opener = screen.getByRole("button", { name: "Open navigation" });
    await user.click(opener);
    await screen.findByRole("dialog", { name: "Navigation" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("returns focus to the menu button when a menu item opened the dialog", async () => {
    function FromMenu() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger>Close or quit</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setOpen(true)}>Quit FlowAId…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Quit FlowAId?</DialogTitle>
              <button type="button">Quit</button>
            </DialogContent>
          </Dialog>
        </>
      );
    }
    const user = userEvent.setup();
    render(<FromMenu />);
    const trigger = screen.getByRole("button", { name: "Close or quit" });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Quit FlowAId…" }));
    await screen.findByRole("dialog", { name: "Quit FlowAId?" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("passes over a control that went with an overlay to that overlay's own opener", async () => {
    // ⌘K → "Quit FlowAId…": the palette closes as the confirmation opens
    function FromPalette() {
      const [palette, setPalette] = useState(false);
      const [confirm, setConfirm] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setPalette(true)}>
            Search
          </button>
          <Dialog open={palette} onOpenChange={setPalette}>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Command menu</DialogTitle>
              <button
                type="button"
                onClick={() => {
                  setPalette(false);
                  setConfirm(true);
                }}
              >
                Quit FlowAId…
              </button>
            </DialogContent>
          </Dialog>
          <Dialog open={confirm} onOpenChange={setConfirm}>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Quit FlowAId?</DialogTitle>
              <button type="button">Quit</button>
            </DialogContent>
          </Dialog>
        </>
      );
    }
    const user = userEvent.setup();
    render(<FromPalette />);
    const search = screen.getByRole("button", { name: "Search" });
    await user.click(search);
    await user.click(await screen.findByRole("button", { name: "Quit FlowAId…" }));
    await screen.findByRole("dialog", { name: "Quit FlowAId?" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(search).toHaveFocus());
  });

  it("keeps the caller's own close focus when it prevents the default", async () => {
    const user = userEvent.setup();
    function Custom() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <input aria-label="Name" />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
              aria-describedby={undefined}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                screen.getByRole("textbox", { name: "Name" }).focus();
              }}
            >
              <DialogTitle>Rename</DialogTitle>
            </DialogContent>
          </Dialog>
        </>
      );
    }
    render(<Custom />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus());
  });
});

describe("Popover", () => {
  it("opens from its trigger and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Filters</PopoverTrigger>
        <PopoverContent aria-label="Filter runs">
          <button type="button">Failed only</button>
        </PopoverContent>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Filters" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(await screen.findByRole("button", { name: "Failed only" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Failed only")).not.toBeInTheDocument());
  });
});

describe("Tabs", () => {
  it("moves between tabs with the arrow keys and shows the matching panel", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Tabs defaultValue="trace" onValueChange={onValueChange}>
        <TabsList aria-label="Run">
          <TabsTrigger value="trace">Trace</TabsTrigger>
          <TabsTrigger value="output" count={2}>
            Output
          </TabsTrigger>
          <TabsTrigger value="logs" disabled>
            Logs
          </TabsTrigger>
        </TabsList>
        <TabsContent value="trace">Timeline</TabsContent>
        <TabsContent value="output">JSON</TabsContent>
        <TabsContent value="logs">Lines</TabsContent>
      </Tabs>,
    );
    const trace = screen.getByRole("tab", { name: "Trace" });
    expect(trace).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Timeline");
    await user.click(trace);
    await user.keyboard("{ArrowRight}");
    const output = screen.getByRole("tab", { name: /Output/ });
    expect(output).toHaveFocus();
    expect(output).toHaveAttribute("aria-selected", "true");
    expect(onValueChange).toHaveBeenLastCalledWith("output");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("JSON");
    // the disabled tab is skipped
    await user.keyboard("{ArrowRight}");
    expect(trace).toHaveFocus();
  });
});

describe("Switch, Checkbox and Slider", () => {
  it("toggles a switch with Space", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Tail" onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole("switch", { name: "Tail" });
    sw.focus();
    await user.keyboard(" ");
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("toggles a labelled checkbox from its label and reports invalid", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Deploy to prod" invalid onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox", { name: "Deploy to prod" });
    expect(box).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByText("Deploy to prod"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
  });

  it("steps a slider with the arrow keys within its bounds", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Slider
        aria-label="Threshold"
        min={0}
        max={1}
        step={0.05}
        defaultValue={[0.95]}
        onValueChange={onValueChange}
      />,
    );
    const thumb = screen.getByRole("slider");
    thumb.focus();
    await user.keyboard("{ArrowRight}");
    expect(onValueChange).toHaveBeenLastCalledWith([1]);
    await user.keyboard("{ArrowRight}");
    expect(thumb).toHaveAttribute("aria-valuenow", "1");
    await user.keyboard("{Home}");
    expect(onValueChange).toHaveBeenLastCalledWith([0]);
  });
});

describe("Tooltip", () => {
  it("shows its content when the trigger receives keyboard focus", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip content="Copy the run id">
          <button type="button">Copy</button>
        </Tooltip>
      </TooltipProvider>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Copy" })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Copy the run id");
  });
});
