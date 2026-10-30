import { ogRoute, ogStaticPaths } from "@/lib/og-card";

export const getStaticPaths = () => ogStaticPaths("id");

export const GET = ogRoute("id");
