import { ogRoute, ogStaticPaths } from "@/lib/og-card";

export const getStaticPaths = () => ogStaticPaths("en");

export const GET = ogRoute("en");
