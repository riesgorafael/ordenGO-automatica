export const wholeMoneyValue = (value) => Math.max(0, Math.round(Number(value) || 0));

export const normalizedRateValue = (value) => {
  const rate = wholeMoneyValue(value);
  return !rate || rate === 850 ? 50 : rate;
};

export const billableHoursValue = (order, now = Date.now()) => {
  const effective = Math.max(0, Number(order?.laborHours) || 0);
  const waiting = Math.max(0, Number(order?.technical?.billableWaitMinutes) || 0) / 60;
  const arrival = order?.technical?.arrivalAt ? new Date(order.technical.arrivalAt).getTime() : NaN;
  const end = order?.technical?.completedAt ? new Date(order.technical.completedAt).getTime() : now;
  const onSiteMs = Number.isFinite(arrival) && Number.isFinite(end) ? Math.max(0, end - arrival) : 0;
  return onSiteMs > 0 && onSiteMs < 3600000
    ? Math.max(0, Number(order?.minimumBillableHours) || 2)
    : Math.round((effective + waiting) * 100) / 100;
};

export const invoiceTotals = (net, vatRate = 21) => {
  const safeNet = Math.max(0, Number(net) || 0);
  const safeRate = Math.max(0, Number(vatRate) || 0);
  const vat = Math.round(safeNet * safeRate) / 100;
  return { net: safeNet, vat, gross: Math.round((safeNet + vat) * 100) / 100 };
};
