// primitives components. Every export here is re-exported from @flowaid/ui.
import "./primitives.css";

export { Button, buttonVariants, type ButtonProps } from "./Button";
export { IconButton, iconButtonVariants, type IconButtonProps } from "./IconButton";
export {
  Kbd,
  Shortcut,
  parseShortcut,
  detectPlatform,
  type KbdProps,
  type ShortcutProps,
  type ShortcutPlatform,
} from "./Kbd";
export { Spinner, type SpinnerProps, type SpinnerSize } from "./Spinner";

export { Input, inputVariants, type InputProps } from "./Input";
export { Textarea, type TextareaProps } from "./Textarea";
export {
  NumberInput,
  clampNumber,
  stepNumber,
  inferPrecision,
  type NumberInputProps,
} from "./NumberInput";
export { SearchInput, type SearchInputProps } from "./SearchInput";
export {
  Select,
  SelectItem,
  SelectGroup,
  SelectSeparator,
  type SelectProps,
  type SelectItemProps,
  type SelectGroupProps,
} from "./Select";
export { Switch, type SwitchProps } from "./Switch";
export { Checkbox, type CheckboxProps } from "./Checkbox";
export { Slider, type SliderProps } from "./Slider";
export { RadioGroup, RadioItem, type RadioGroupProps, type RadioItemProps } from "./RadioGroup";
export {
  ToggleGroup,
  ToggleGroupItem,
  type ToggleGroupProps,
  type ToggleGroupItemProps,
} from "./ToggleGroup";
export { Label, type LabelProps } from "./Label";
export {
  FieldRow,
  FieldHint,
  FieldError,
  useFieldContext,
  useFieldControl,
  type FieldRowProps,
  type FieldHintProps,
  type FieldErrorProps,
  type FieldContextValue,
  type FieldControlAttributes,
} from "./Field";

export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  type TooltipProps,
  type TooltipContentProps,
} from "./Tooltip";
export { Hint, type HintProps } from "./Hint";
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverClose,
  type PopoverContentProps,
} from "./Popover";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  type DropdownMenuContentProps,
  type DropdownMenuItemProps,
  type DropdownMenuCheckboxItemProps,
  type DropdownMenuRadioItemProps,
  type DropdownMenuSubTriggerProps,
  type DropdownMenuSubContentProps,
  type DropdownMenuLabelProps,
  type DropdownMenuSeparatorProps,
  type DropdownMenuShortcutProps,
} from "./DropdownMenu";
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type DialogSize,
  type DialogContentProps,
  type DialogOverlayProps,
  type DialogHeaderProps,
  type DialogBodyProps,
  type DialogFooterProps,
  type DialogTitleProps,
  type DialogDescriptionProps,
} from "./Dialog";
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  type SheetContentProps,
  type SheetHeaderProps,
  type SheetBodyProps,
  type SheetFooterProps,
  type SheetTitleProps,
  type SheetDescriptionProps,
} from "./Sheet";
export { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  type TabsProps,
  type TabsListProps,
  type TabsTriggerProps,
  type TabsContentProps,
} from "./Tabs";
export { Separator, type SeparatorProps } from "./Separator";
export { ScrollArea, ScrollBar, type ScrollAreaProps, type ScrollBarProps } from "./ScrollArea";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardBody,
  CardFooter,
  type CardProps,
  type CardHeaderProps,
  type CardTitleProps,
  type CardDescriptionProps,
  type CardBodyProps,
  type CardFooterProps,
} from "./Card";
export { Panel, type PanelProps } from "./Panel";
export { Skeleton, type SkeletonProps } from "./Skeleton";
export {
  ProgressBar,
  clampFraction,
  type ProgressBarProps,
  type ProgressTone,
} from "./ProgressBar";
export { Badge, badgeVariants, type BadgeProps } from "./Badge";
export {
  StatusChip,
  statusLabel,
  statusTone,
  statusIsActive,
  type StatusChipProps,
  type ChipStatus,
  type StatusTone,
} from "./StatusChip";
export { CategoryDot, type CategoryDotProps } from "./CategoryDot";
export { Avatar, initialsFor, type AvatarProps, type AvatarSize } from "./Avatar";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { Toaster, toast, type ToasterProps } from "./Toaster";
export {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  type ResizablePanelGroupProps,
  type ResizablePanelProps,
  type ResizableHandleProps,
} from "./Resizable";
export { CopyButton, copyToClipboard, type CopyButtonProps } from "./CopyButton";
export {
  Collapsible,
  CollapsibleRoot,
  CollapsibleTrigger,
  CollapsibleContent,
  type CollapsibleProps,
  type CollapsibleTriggerProps,
  type CollapsibleContentProps,
} from "./Collapsible";
export {
  Accordion,
  AccordionItem,
  type AccordionProps,
  type AccordionItemProps,
} from "./Accordion";
export { LogoMark, LogoWordmark, type LogoMarkProps, type LogoWordmarkProps } from "./icons";
export { useControllableState } from "./useControllableState";
