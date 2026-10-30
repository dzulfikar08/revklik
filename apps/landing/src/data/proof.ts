// Real customer quotes only. Each entry needs the person's permission and a
// name, role and site that can be checked. The About section renders this list
// only when it has entries, so it stays empty until a real quote exists; never
// add a placeholder or invented quote here.
export type Quote = {
	lang: 'id' | 'en';
	quote: string;
	name: string;
	role: string;
	/** Public site of the customer, so the claim can be checked. */
	url?: string;
};

export const proof: readonly Quote[] = [];
