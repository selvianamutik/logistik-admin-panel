import type { CompanyProfile } from './types';

export const DEFAULT_COMPANY_LOGO_URL = '/logo.png';

export function resolveCompanyLogoUrl(company?: Pick<CompanyProfile, 'logoUrl'> | null) {
    const logoUrl = company?.logoUrl?.trim();
    return logoUrl || DEFAULT_COMPANY_LOGO_URL;
}
