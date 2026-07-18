import { format } from "date-fns";
import { ChevronDownIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

interface DateTimePickerProps {
	value: string; // ISO string like "2025-05-13T09:30"
	onChange: (value: string) => void;
	placeholder?: string;
}

export function DateTimePicker({
	value,
	onChange,
	placeholder = "Pick a date",
}: DateTimePickerProps) {
	const [open, setOpen] = React.useState(false);
	const date = value ? new Date(value) : undefined;

	return (
		<div className="flex items-center gap-1">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						className="w-[130px] justify-between font-normal text-xs h-8"
					>
						{date ? format(date, "MMM d, yyyy") : placeholder}
						<ChevronDownIcon className="size-3.5 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-auto overflow-hidden p-0" align="start">
					<Calendar
						mode="single"
						selected={date}
						captionLayout="dropdown"
						defaultMonth={date}
						onSelect={(d) => {
							if (!d) return;
							const time = value ? value.slice(11, 16) : "00:00";
							const iso = `${format(d, "yyyy-MM-dd")}T${time}`;
							onChange(iso);
							setOpen(false);
						}}
					/>
				</PopoverContent>
			</Popover>
			<Input
				type="time"
				step="60"
				value={value ? value.slice(11, 16) : "00:00"}
				onChange={(e) => {
					const d = value
						? value.slice(0, 10)
						: format(new Date(), "yyyy-MM-dd");
					onChange(`${d}T${e.target.value}`);
				}}
				className="w-[90px] h-8 text-xs appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
			/>
		</div>
	);
}
