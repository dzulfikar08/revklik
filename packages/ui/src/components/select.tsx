"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "@revklik/ui/lib/utils";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import * as React from "react";

const Select = ({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) => (
	<SelectPrimitive.Root data-slot="select" {...props} />
);

const SelectGroup = ({ ...props }: SelectPrimitive.Group.Props) => (
	<SelectPrimitive.Group data-slot="select-group" {...props} />
);

const SelectValue = ({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) => (
	<SelectPrimitive.Value data-slot="select-value" {...props} />
);

const SelectTrigger = ({
	className,
	size = "default",
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
	size?: "sm" | "default";
}) => (
	<SelectPrimitive.Trigger
		data-slot="select-trigger"
		data-size={size}
		className={cn(
			"border-input data-[placeholder]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/20 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-none transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2",
			className,
		)}
		{...props}
	>
		{children}
		<SelectPrimitive.Icon render={<ChevronDownIcon className="size-4 opacity-50" />} />
	</SelectPrimitive.Trigger>
);

const SelectContent = ({
	className,
	children,
	side = "bottom",
	sideOffset = 4,
	align = "start",
	alignItemWithTrigger = true,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Popup> &
	Pick<
		SelectPrimitive.Positioner.Props,
		"align" | "side" | "sideOffset" | "alignItemWithTrigger"
	>) => (
	<SelectPrimitive.Portal>
		<SelectPrimitive.Positioner
			className="isolate z-50 outline-none"
			align={align}
			side={side}
			sideOffset={sideOffset}
			alignItemWithTrigger={alignItemWithTrigger}
		>
			<SelectPrimitive.ScrollUpArrow className="bg-popover text-foreground top-0 z-10 flex h-6 w-full cursor-default items-center justify-center">
				<ChevronUpIcon className="size-4" />
			</SelectPrimitive.ScrollUpArrow>
			<SelectPrimitive.Popup
				data-slot="select-content"
				className={cn(
					"cn-menu-target bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-50 max-h-(--available-height) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md shadow-md ring-1 duration-100 outline-none",
					className,
				)}
				{...props}
			>
				<SelectPrimitive.List>{children}</SelectPrimitive.List>
			</SelectPrimitive.Popup>
			<SelectPrimitive.ScrollDownArrow className="bg-popover text-foreground bottom-0 z-10 flex h-6 w-full cursor-default items-center justify-center">
				<ChevronDownIcon className="size-4" />
			</SelectPrimitive.ScrollDownArrow>
		</SelectPrimitive.Positioner>
	</SelectPrimitive.Portal>
);

const SelectLabel = ({ className, ...props }: SelectPrimitive.Label.Props) => (
	<SelectPrimitive.Label
		data-slot="select-label"
		className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
		{...props}
	/>
);

const SelectItem = ({ className, children, ...props }: SelectPrimitive.Item.Props) => (
	<SelectPrimitive.Item
		data-slot="select-item"
		className={cn(
			"cn-menu-target data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
			className,
		)}
		{...props}
	>
		<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		<span className="absolute right-2 flex size-3.5 items-center justify-center">
			<SelectPrimitive.ItemIndicator>
				<CheckIcon className="size-4" />
			</SelectPrimitive.ItemIndicator>
		</span>
	</SelectPrimitive.Item>
);

const SelectSeparator = ({ className, ...props }: SelectPrimitive.Separator.Props) => (
	<SelectPrimitive.Separator
		data-slot="select-separator"
		className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
		{...props}
	/>
);

export {
	Select,
	SelectGroup,
	SelectValue,
	SelectTrigger,
	SelectContent,
	SelectLabel,
	SelectItem,
	SelectSeparator,
};
