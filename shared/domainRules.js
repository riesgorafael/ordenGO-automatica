export const wholeMoneyValue = (value) => Math.max(0, Math.round(Number(value) || 0));

export const normalizedRateValue = (value) => {
  const rate = wholeMoneyValue(value);
  return !rate || rate === 850 ? 50 : rate;
};

export const billableHoursValue = (order, now = Date.now()) => {
  if (order?.billableHours !== undefined && order?.billableHours !== null && order?.billableHours !== "") return Math.max(0, Number(order.billableHours) || 0);
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

export const targetMarginValue = (value, fallback = 35) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
};

export const orderAssignedIdsValue = (order) => [...new Set([order?.techId, ...(Array.isArray(order?.assignedTechIds) ? order.assignedTechIds : [])].filter(Boolean))];
export const orderVisibleToUserValue = (user, order) => user?.role !== "tecnico" || orderAssignedIdsValue(order).includes(user?.id);

export const expenseVatBreakdown = (gross, included, rate = 21, computablePercent = 100) => {
  const safeGross = Math.max(0, Number(gross) || 0);
  const safeRate = included ? Math.min(100, Math.max(0, Number.isFinite(Number(rate)) ? Number(rate) : 21)) : 0;
  const safeComputable = included ? Math.min(100, Math.max(0, Number(computablePercent) || 0)) : 0;
  const net = included ? Math.round((safeGross / (1 + safeRate / 100)) * 100) / 100 : safeGross;
  const vat = included ? Math.round((safeGross - net) * 100) / 100 : 0;
  return { gross: safeGross, net, vat, rate: safeRate, computablePercent: safeComputable, computableVat: Math.round(vat * safeComputable) / 100 };
};
