import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@revklik/ui/components/select";
import { ListFilter, X } from "lucide-react";
import { useState } from "react";

import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import type { FilterOperator, LegacyFilter } from "@/lib/legacy/api";

import { FILTER_DIMS, FILTER_OPS } from "./data";
import { addFilter, removeFilter } from "./filter-model";
import { SegmentControls } from "./segments";

const dimKey = (dimension: string): MessageKey | null =>
	FILTER_DIMS.find((d) => d.value === dimension)?.label ?? null;

const opKey = (operator: string): MessageKey | null =>
	FILTER_OPS.find((o) => o.value === operator)?.label ?? null;

const needsValue = (op: FilterOperator): boolean => op !== "exists" && op !== "not_exists";

/** "Country is ID": what an active filter says, in the owner's language. */
export const FilterChip = ({
	filter,
	onRemove,
}: {
	filter: LegacyFilter;
	onRemove: () => void;
}) => {
	const t = useT();
	const dim = dimKey(filter.dimension);
	const op = opKey(filter.operator);
	const label = `${dim ? t(dim) : filter.dimension} ${op ? t(op) : filter.operator} ${
		needsValue(filter.operator) ? filter.value : ""
	}`.trim();
	return (
		<span className="inline-flex min-h-8 items-center gap-1 rounded-full bg-(--chart)/12 ps-3 pe-1 text-[13px] font-medium text-(--chart)">
			<span className="max-w-56 truncate">{label}</span>
			<button
				type="button"
				aria-label={t("filter.remove", { label })}
				onClick={onRemove}
				className="hover:bg-(--chart)/15 focus-visible:outline-ring pointer-coarse:size-11 flex size-7 items-center justify-center rounded-full outline-offset-1 focus-visible:outline-2"
			>
				<X className="size-3.5" aria-hidden />
			</button>
		</span>
	);
};

/**
 * Active filters as removable chips, plus a collapsed builder for filters no
 * breakdown row offers (operator, free text). Rows in the panels add the
 * common ones with one click.
 */
export const FiltersBar = ({
	siteId,
	filters,
	onChange,
}: {
	siteId: string;
	filters: LegacyFilter[];
	onChange: (next: LegacyFilter[]) => void;
}) => {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [dim, setDim] = useState("");
	const [op, setOp] = useState<FilterOperator>("is");
	const [value, setValue] = useState("");

	const canAdd = Boolean(dim) && (!needsValue(op) || value.trim() !== "");
	const submit = () => {
		if (!canAdd) {
			return;
		}
		onChange(
			addFilter(filters, {
				dimension: dim,
				operator: op,
				value: needsValue(op) ? value.trim() : "",
			}),
		);
		setValue("");
	};

	return (
		<div className="mb-3 flex flex-wrap items-center gap-2">
			<Button
				variant="outline"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="pointer-coarse:h-11 h-8 gap-1.5 rounded-full px-3 text-[13px]"
			>
				<ListFilter className="size-3.5" aria-hidden />
				{t("filter.add")}
			</Button>
			{filters.map((f) => (
				<FilterChip
					key={`${f.dimension}-${f.operator}-${f.value}`}
					filter={f}
					onRemove={() => onChange(removeFilter(filters, f))}
				/>
			))}
			{filters.length > 0 ? (
				<button
					type="button"
					onClick={() => onChange([])}
					className="text-muted-foreground hover:text-foreground focus-visible:outline-ring pointer-coarse:min-h-11 min-h-8 rounded-md px-2 text-[13px] underline-offset-2 outline-offset-2 hover:underline focus-visible:outline-2"
				>
					{t("filter.clear")}
				</button>
			) : null}
			<SegmentControls siteId={siteId} filters={filters} onApply={onChange} />
			{open ? (
				<form
					className="bg-card ring-foreground/10 flex w-full flex-wrap items-center gap-2 rounded-xl p-2 ring-1"
					onSubmit={(e) => {
						e.preventDefault();
						submit();
					}}
				>
					<Select
						value={dim}
						onValueChange={(v) => {
							setDim(String(v));
							setValue("");
						}}
					>
						<SelectTrigger
							aria-label={t("filter.dimension")}
							className="pointer-coarse:h-11 h-9 w-44 text-[13px]"
						>
							<SelectValue placeholder={t("filter.dimension")}>
								{dimKey(dim) ? t(dimKey(dim) as MessageKey) : null}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{FILTER_DIMS.map((d) => (
								<SelectItem
									key={d.value}
									value={d.value}
									className="pointer-coarse:min-h-11 text-[13px]"
								>
									{t(d.label)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{dim ? (
						<>
							<Select value={op} onValueChange={(v) => setOp(String(v) as FilterOperator)}>
								<SelectTrigger
									aria-label={t("filter.operator")}
									className="pointer-coarse:h-11 h-9 w-36 text-[13px]"
								>
									<SelectValue>{opKey(op) ? t(opKey(op) as MessageKey) : null}</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{FILTER_OPS.map((o) => (
										<SelectItem
											key={o.value}
											value={o.value}
											className="pointer-coarse:min-h-11 text-[13px]"
										>
											{t(o.label)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{needsValue(op) ? (
								<Input
									aria-label={t("filter.value")}
									value={value}
									placeholder={t("filter.valuePlaceholder")}
									onChange={(e) => setValue(e.target.value)}
									className="pointer-coarse:h-11 h-9 w-48 text-[13px]"
								/>
							) : null}
						</>
					) : null}
					<Button
						type="submit"
						disabled={!canAdd}
						className="pointer-coarse:h-11 h-9 px-4 text-[13px]"
					>
						{t("filter.apply")}
					</Button>
				</form>
			) : null}
		</div>
	);
};
