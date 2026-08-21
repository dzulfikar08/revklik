// Device data table

import { useState } from "react";
import type { DeviceEntry } from "@revklik/shared";
import { BrowserIcon, DeviceIcon, OSIcon } from "./icons";

type DeviceTab = "device" | "os" | "browser";

export function DeviceTable({
	devices,
	os,
	browsers,
	onCrossFilter,
}: {
	devices: DeviceEntry[];
	os: DeviceEntry[];
	browsers: DeviceEntry[];
	onCrossFilter?: (dimension: string, value: string) => void;
}) {
	const [tab, setTab] = useState<DeviceTab>("device");
	const data = tab === "device" ? devices : tab === "os" ? os : browsers;

	return (
		<div
			className="data-table-card"
			style={{
				border: "none",
				background: "transparent",
				display: "flex",
				flexDirection: "column",
				height: "100%",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					marginBottom: 6,
				}}
			>
				<span className="data-table-title" style={{ marginBottom: 0 }}>
					Devices
				</span>
				<div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
					{(
						[
							["device", "Device"],
							["os", "OS"],
							["browser", "Browser"],
						] as [DeviceTab, string][]
					).map(([key, label]) => (
						<button
							type="button"
							key={key}
							onClick={() => setTab(key)}
							style={{
								fontSize: 10,
								padding: "2px 8px",
								borderRadius: 4,
								border: "none",
								cursor: "pointer",
								fontFamily: "var(--mono)",
								background: tab === key ? "var(--accent-dim)" : "transparent",
								color: tab === key ? "var(--accent)" : "var(--text3)",
							}}
						>
							{label}
						</button>
					))}
				</div>
			</div>
			{data.length === 0 ? (
				<div
					style={{
						padding: 16,
						color: "var(--text3)",
						fontSize: 12,
						textAlign: "center",
					}}
				>
					No data
				</div>
			) : (
				<div style={{ flex: 1, overflowY: "auto" }}>
					<table className="data-table">
						<thead>
							<tr>
								<th>{tab === "device" ? "Device" : tab === "os" ? "OS" : "Browser"}</th>
								<th style={{ textAlign: "right" }}>Visitors</th>
								<th style={{ textAlign: "right" }}>Share</th>
							</tr>
						</thead>
						<tbody>
							{data.map((d) => (
								<tr
									key={d.device}
									style={{ cursor: onCrossFilter ? "pointer" : undefined }}
									onClick={() => onCrossFilter?.(tab === "device" ? "device_type" : tab, d.device)}
								>
									<td style={{ fontSize: 13 }}>
										<span
											style={{
												display: "inline-flex",
												alignItems: "center",
												gap: 5,
											}}
										>
											{tab === "device" ? (
												<DeviceIcon device={d.device} />
											) : tab === "os" ? (
												<OSIcon os={d.device} />
											) : (
												<BrowserIcon browser={d.device} />
											)}
											{d.device.charAt(0).toUpperCase() + d.device.slice(1)}
										</span>
									</td>
									<td
										style={{
											textAlign: "right",
											fontFamily: "var(--mono)",
											fontSize: 12,
										}}
									>
										{d.visitors.toLocaleString()}
									</td>
									<td style={{ textAlign: "right" }}>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												justifyContent: "flex-end",
												gap: 6,
											}}
										>
											<div
												style={{
													width: 48,
													height: 4,
													borderRadius: 2,
													background: "var(--bg3)",
												}}
											>
												<div
													style={{
														width: `${d.percentage}%`,
														height: "100%",
														borderRadius: 2,
														background: "var(--accent)",
													}}
												/>
											</div>
											<span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
												{d.percentage}%
											</span>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
