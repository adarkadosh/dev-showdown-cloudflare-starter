import { z } from 'zod';

/**
 * Canonical product shape returned for the JSON_MODE challenge.
 * Parsed deterministically from English product copy.
 */
export const productOutputSchema = z.object({
	name: z.string().min(1),
	price: z.number().finite(),
	currency: z.string().min(1),
	inStock: z.boolean(),
	dimensions: z.object({
		length: z.number().finite(),
		width: z.number().finite(),
		height: z.number().finite(),
		unit: z.string().min(1),
	}),
	manufacturer: z.object({
		name: z.string().min(1),
		country: z.string().min(1),
		website: z.string().url(),
	}),
	specifications: z.object({
		weight: z.number().finite(),
		weightUnit: z.string().min(1),
		warrantyMonths: z.number().int().nonnegative(),
	}),
});

export type ProductOutput = z.infer<typeof productOutputSchema>;

const PRICE_CURRENCY =
	/(?:priced at|price is|costs|listed at|retails for)\s*(\d+(?:\.\d+)?)\s+([A-Z]{3})\b/i;

const NAME_BEFORE_PRICE = /^(.+?)\s+(?:is\s+)?(?:priced at|price is|costs|listed at|retails for)\b/i;

const DIMENSIONS_LWH =
	/(\d+(?:\.\d+)?)\s*(cm|mm|m|in)\s+long,\s*(\d+(?:\.\d+)?)\s*\2\s+wide,\s*(?:and\s*)?(\d+(?:\.\d+)?)\s*\2\s+tall/i;

const DIMENSIONS_ALT =
	/(?:length|long)\s*(?:of|:)?\s*(\d+(?:\.\d+)?)\s*(cm|mm|m|in)[^.]*?(?:width|wide)\s*(?:of|:)?\s*(\d+(?:\.\d+)?)\s*\2[^.]*?(?:height|tall|high)\s*(?:of|:)?\s*(\d+(?:\.\d+)?)\s*\2/i;

const MANUFACTURER =
	/manufacturer\s+is\s+(.+?)\s+from\s+([A-Za-z][A-Za-z\s]{0,60}?)(?=,|\s+with\s+|\s+and\s+|\s+whose|\s+located|$)/i;

const WEBSITE = /(https?:\/\/[^\s)\],]+)/i;

const WEIGHT =
	/(?:listed\s+)?weight\s+(?:is\s+)?(\d+(?:\.\d+)?)\s*(kg|lb|lbs|g)\b/i;

const WARRANTY =
	/(?:comes\s+with\s+(?:a\s+)?)?(\d+)\s*[-]?\s*month(?:s)?\s+warranty|warranty\s+(?:of|for)\s+(\d+)\s+months?/i;

/**
 * Parses a single product blurb into structured fields using regex heuristics.
 * Throws if required signals are missing or validation fails.
 */
export function parseProductDescription(description: string): ProductOutput {
	const text = description.trim();
	if (!text) {
		throw new Error('Empty description');
	}

	const priceMatch = text.match(PRICE_CURRENCY);
	if (!priceMatch) {
		throw new Error('Could not parse price and currency');
	}
	const price = Number(priceMatch[1]);
	const currency = priceMatch[2].toUpperCase();
	if (!Number.isFinite(price)) {
		throw new Error('Invalid price');
	}

	const nameMatch = text.match(NAME_BEFORE_PRICE);
	const name = nameMatch
		? nameMatch[1].replace(/^the\s+/i, '').trim()
		: inferNameFromOpening(text);

	const inStock = parseInStock(text);

	const dims =
		parseDimensions(text.match(DIMENSIONS_LWH)) ??
		parseDimensions(text.match(DIMENSIONS_ALT));
	if (!dims) {
		throw new Error('Could not parse dimensions');
	}

	const mfg = text.match(MANUFACTURER);
	if (!mfg) {
		throw new Error('Could not parse manufacturer');
	}
	const manufacturerName = mfg[1].trim();
	const country = mfg[2].trim();

	const site = text.match(WEBSITE);
	if (!site) {
		throw new Error('Could not parse manufacturer website');
	}
	const website = stripTrailingUrlNoise(site[1]);

	const weightMatch = text.match(WEIGHT);
	if (!weightMatch) {
		throw new Error('Could not parse weight');
	}
	const weight = Number(weightMatch[1]);
	const weightUnit = normalizeWeightUnit(weightMatch[2]);
	if (!Number.isFinite(weight)) {
		throw new Error('Invalid weight');
	}

	const warrantyMatch = text.match(WARRANTY);
	const warrantyMonths = warrantyMatch
		? Number(warrantyMatch[1] ?? warrantyMatch[2])
		: NaN;
	if (!Number.isInteger(warrantyMonths) || warrantyMonths < 0) {
		throw new Error('Could not parse warranty months');
	}

	const candidate = {
		name,
		price,
		currency,
		inStock,
		dimensions: dims,
		manufacturer: {
			name: manufacturerName,
			country,
			website,
		},
		specifications: {
			weight,
			weightUnit,
			warrantyMonths,
		},
	};

	return productOutputSchema.parse(candidate);
}

function inferNameFromOpening(text: string): string {
	const sentence = text.split(/[.!?]\s/)[0] ?? text;
	const withoutPrice = sentence.replace(PRICE_CURRENCY, '').trim();
	const cleaned = withoutPrice.replace(/\s+is\s+$/i, '').trim();
	if (!cleaned) {
		throw new Error('Could not parse product name');
	}
	return cleaned;
}

function parseInStock(text: string): boolean {
	if (/out\s+of\s+stock|unavailable|sold\s+out|not\s+in\s+stock/i.test(text)) {
		return false;
	}
	if (/in\s+stock|available\s+now|ships\s+immediately/i.test(text)) {
		return true;
	}
	throw new Error('Could not parse stock status');
}

function parseDimensions(match: RegExpMatchArray | null): ProductOutput['dimensions'] | null {
	if (!match) {
		return null;
	}
	const [, a, unit, b, c] = match;
	const length = Number(a);
	const width = Number(b);
	const height = Number(c);
	if (![length, width, height].every((n) => Number.isFinite(n))) {
		return null;
	}
	return { length, width, height, unit };
}

function normalizeWeightUnit(unit: string): string {
	const u = unit.toLowerCase();
	if (u === 'lbs') {
		return 'lb';
	}
	return u;
}

function stripTrailingUrlNoise(raw: string): string {
	return raw.replace(/[.,;:!?)]+$/, '');
}
