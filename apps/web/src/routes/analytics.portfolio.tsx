import { createFileRoute } from "@tanstack/react-router";

import PortfolioPage from "@/components/analytics/portfolio-page";

/** Cross-product revenue; static segment, so it wins over /analytics/$siteId. */
export const Route = createFileRoute("/analytics/portfolio")({
	component: PortfolioPage,
	head: () => ({ meta: [{ title: "Portfolio · RevKlik" }] }),
});
