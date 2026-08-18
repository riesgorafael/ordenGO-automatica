import test from "node:test";
import assert from "node:assert/strict";
import { reportCompanyLines, reportCompanyProfile } from "../../shared/brandingRules.js";

test("un reporte sin datos corporativos no hereda datos de otra empresa", () => {
  assert.deepEqual(reportCompanyProfile({ companyName: "REFRIGEN" }), {
    name: "REFRIGEN", cuit: "", address: "", phone: "", email: "", website: "",
  });
  assert.deepEqual(reportCompanyLines({ companyName: "REFRIGEN" }), ["REFRIGEN"]);
});

test("un reporte usa exclusivamente los datos provistos por su tenant", () => {
  const branding = {
    companyLegalName: "REFRIGEN S.R.L.", companyCuit: "30-12345678-9",
    companyAddress: "Calle 123", companyPhone: "+54 11 5555-0000",
    companyEmail: "info@refrigen.example", companyWebsite: "refrigen.example",
  };
  assert.deepEqual(reportCompanyLines(branding), [
    "REFRIGEN S.R.L.", "CUIT: 30-12345678-9", "Calle 123", "Tel.: +54 11 5555-0000",
    "info@refrigen.example", "refrigen.example",
  ]);
});
