import test from "node:test";
import assert from "node:assert/strict";
import { billableHoursValue, invoiceTotals, normalizedRateValue } from "../domainRules.js";

test("aplica dos horas mínimas cuando la visita dura menos de una hora", () => {
  const arrivalAt = "2026-08-15T12:00:00.000Z";
  const completedAt = "2026-08-15T12:35:00.000Z";
  assert.equal(billableHoursValue({ laborHours: 0.5, technical: { arrivalAt, completedAt } }), 2);
});

test("respeta el mínimo definido por contrato", () => {
  const arrivalAt = "2026-08-15T12:00:00.000Z";
  const completedAt = "2026-08-15T12:20:00.000Z";
  assert.equal(billableHoursValue({ laborHours: 0.3, minimumBillableHours: 3, technical: { arrivalAt, completedAt } }), 3);
});

test("suma horas efectivas y espera facturable fuera de la regla mínima", () => {
  const arrivalAt = "2026-08-15T12:00:00.000Z";
  const completedAt = "2026-08-15T14:00:00.000Z";
  assert.equal(billableHoursValue({ laborHours: 1.5, technical: { arrivalAt, completedAt, billableWaitMinutes: 30 } }), 2);
});

test("normaliza la tarifa histórica incorrecta y valores vacíos a USD 50", () => {
  assert.equal(normalizedRateValue(850), 50);
  assert.equal(normalizedRateValue(0), 50);
  assert.equal(normalizedRateValue(75), 75);
});

test("calcula IVA 21% y total con dos decimales", () => {
  assert.deepEqual(invoiceTotals(4800), { net: 4800, vat: 1008, gross: 5808 });
  assert.deepEqual(invoiceTotals(226.66), { net: 226.66, vat: 47.6, gross: 274.26 });
});
