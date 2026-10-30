import type { APIRoute } from "astro";

import { llmsFull } from "@/lib/llms";

export const GET: APIRoute = () => llmsFull("en");
