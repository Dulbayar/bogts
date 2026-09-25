/**
 * Who the payer is paying, for the public pages' header. Field by field: the
 * project's own display name and logo (project page → Payment page), else the
 * company's (Settings → Branding), else the project's name and a monogram.
 * Support contacts are the company's.
 */
import type { BrandView } from '../branding';
import type { PublicInvoice } from './invoice-view';

export type Payee = {
	name: string;
	logoUrl: string | null;
	supportEmail: string | null;
	supportUrl: string | null;
};

export function payeeOf(invoice: Pick<PublicInvoice, 'projectName' | 'projectDisplayName' | 'projectLogoUrl'>, brand: BrandView): Payee {
	return {
		name: invoice.projectDisplayName ?? brand.companyName ?? invoice.projectName,
		logoUrl: invoice.projectLogoUrl ?? brand.logoUrl,
		supportEmail: brand.supportEmail,
		supportUrl: brand.supportUrl
	};
}
