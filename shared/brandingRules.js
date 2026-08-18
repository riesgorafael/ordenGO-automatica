const text = (value) => String(value || "").trim();

export function reportCompanyProfile(branding = {}) {
  const cuitDigits = text(branding.companyCuit).replace(/\D/g, "");
  return {
    name: text(branding.companyLegalName) || text(branding.companyName) || "Empresa emisora",
    cuit: cuitDigits.replace(/^(\d{2})(\d{8})(\d)$/, "$1-$2-$3"),
    address: text(branding.companyAddress),
    phone: text(branding.companyPhone),
    email: text(branding.companyEmail),
    website: text(branding.companyWebsite),
  };
}

export function reportCompanyLines(branding = {}) {
  const company = reportCompanyProfile(branding);
  return [
    company.name,
    company.cuit ? `CUIT: ${company.cuit}` : "",
    company.address,
    company.phone ? `Tel.: ${company.phone}` : "",
    company.email,
    company.website,
  ].filter(Boolean);
}
