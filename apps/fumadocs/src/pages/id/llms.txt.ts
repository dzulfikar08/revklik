import type { APIRoute } from "astro";

import { llmsIndex } from "@/lib/llms";

export const GET: APIRoute = ({ site }) =>
	llmsIndex("id", site ?? new URL("https://docs.revklik.com"));
