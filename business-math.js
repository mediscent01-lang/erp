(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MediscentMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const finite = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const round = (value, digits = 4) => {
    const factor = 10 ** digits;
    return Math.round((finite(value) + Number.EPSILON) * factor) / factor;
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value)));

  function dilution({ finalAmount, targetPercent, stockPercent = 100, lossPercent = 0 }) {
    const finalNet = finite(finalAmount);
    const target = finite(targetPercent);
    const stock = finite(stockPercent);
    const loss = finite(lossPercent);
    if (finalNet <= 0) throw new Error('최종 제조량은 0보다 커야 합니다.');
    if (target < 0 || target > 100) throw new Error('목표 농도는 0~100% 범위여야 합니다.');
    if (stock <= 0 || stock > 100) throw new Error('원액 농도는 0보다 크고 100% 이하여야 합니다.');
    if (target > stock) throw new Error('목표 농도는 보유 원액 농도보다 높을 수 없습니다.');
    if (loss < 0 || loss >= 100) throw new Error('손실률은 0% 이상 100% 미만이어야 합니다.');
    const grossAmount = finalNet / (1 - loss / 100);
    const stockAmount = grossAmount * (target / stock);
    return {
      grossAmount: round(grossAmount),
      stockAmount: round(stockAmount),
      diluentAmount: round(grossAmount - stockAmount),
      pureAromaticAmount: round(grossAmount * target / 100),
      expectedLoss: round(grossAmount - finalNet)
    };
  }

  function batchComposition({ finalAmount, components = [], lossPercent = 0 }) {
    const amount = finite(finalAmount);
    const loss = finite(lossPercent);
    if (amount <= 0) throw new Error('최종 제조량은 0보다 커야 합니다.');
    if (loss < 0 || loss >= 100) throw new Error('손실률은 0% 이상 100% 미만이어야 합니다.');
    const totalPercent = components.reduce((sum, item) => sum + finite(item.percent), 0);
    if (Math.abs(totalPercent - 100) > 0.001) throw new Error(`배합비 합계가 ${round(totalPercent, 3)}%입니다. 100%로 맞춰주세요.`);
    const grossAmount = amount / (1 - loss / 100);
    return {
      grossAmount: round(grossAmount),
      expectedLoss: round(grossAmount - amount),
      totalPercent: round(totalPercent),
      components: components.map((item) => ({
        ...item,
        percent: finite(item.percent),
        amount: round(grossAmount * finite(item.percent) / 100)
      }))
    };
  }

  function costMargin(input) {
    const retailVatIncluded = Math.max(0, finite(input.retailPrice));
    const discountRate = clamp(input.discountRate, 0, 100);
    const wholesaleRate = clamp(input.wholesaleRate || 100, 0, 1000);
    const platformFeeRate = clamp(input.platformFeeRate, 0, 100);
    const paymentFeeRate = clamp(input.paymentFeeRate, 0, 100);
    const vatRate = clamp(input.vatRate == null ? 10 : input.vatRate, 0, 100);
    const cogs = Math.max(0, finite(input.cogs));
    const fulfillment = Math.max(0, finite(input.fulfillment));
    const otherVariable = Math.max(0, finite(input.otherVariable));
    const discountedRetail = retailVatIncluded * (1 - discountRate / 100);
    const channelRevenue = discountedRetail * wholesaleRate / 100;
    const netRevenue = input.vatIncluded === false ? channelRevenue : channelRevenue / (1 + vatRate / 100);
    const feeBase = input.feeOnVatExcluded ? netRevenue : channelRevenue;
    const fees = feeBase * (platformFeeRate + paymentFeeRate) / 100;
    const contribution = netRevenue - fees - cogs - fulfillment - otherVariable;
    const marginRate = netRevenue > 0 ? contribution / netRevenue * 100 : 0;
    const markupRate = cogs > 0 ? (netRevenue - cogs) / cogs * 100 : 0;
    const breakEvenRetail = (cogs + fulfillment + otherVariable) /
      Math.max(0.000001, (wholesaleRate / 100) * (1 / (input.vatIncluded === false ? 1 : 1 + vatRate / 100) - (platformFeeRate + paymentFeeRate) / 100));
    return {
      discountedRetail: round(discountedRetail, 2),
      channelRevenue: round(channelRevenue, 2),
      netRevenue: round(netRevenue, 2),
      fees: round(fees, 2),
      variableCost: round(cogs + fulfillment + otherVariable, 2),
      contribution: round(contribution, 2),
      marginRate: round(marginRate, 2),
      markupRate: round(markupRate, 2),
      breakEvenRetail: round(breakEvenRetail, 2)
    };
  }

  function moqScenario(input) {
    const moq = Math.max(1, Math.round(finite(input.moq, 1)));
    const unitCost = Math.max(0, finite(input.unitCost));
    const fixedCost = Math.max(0, finite(input.fixedCost));
    const sellingPrice = Math.max(0, finite(input.sellingPrice));
    const variableSellingCost = Math.max(0, finite(input.variableSellingCost));
    const defectRate = clamp(input.defectRate, 0, 99.99);
    const monthlySales = Math.max(0, finite(input.monthlySales));
    const saleableUnits = Math.floor(moq * (1 - defectRate / 100));
    const investment = moq * unitCost + fixedCost;
    const unitContribution = sellingPrice - variableSellingCost;
    const totalRevenue = saleableUnits * sellingPrice;
    const totalContribution = saleableUnits * unitContribution - investment;
    const breakEvenUnits = unitContribution > 0 ? Math.ceil(investment / unitContribution) : Infinity;
    const monthsToSell = monthlySales > 0 ? saleableUnits / monthlySales : Infinity;
    const cashRecoveryMonths = monthlySales > 0 && unitContribution > 0 ? breakEvenUnits / monthlySales : Infinity;
    return {
      moq,
      saleableUnits,
      investment: round(investment, 2),
      totalRevenue: round(totalRevenue, 2),
      projectedProfit: round(totalContribution, 2),
      roi: investment > 0 ? round(totalContribution / investment * 100, 2) : 0,
      unitContribution: round(unitContribution, 2),
      breakEvenUnits,
      monthsToSell: Number.isFinite(monthsToSell) ? round(monthsToSell, 2) : Infinity,
      cashRecoveryMonths: Number.isFinite(cashRecoveryMonths) ? round(cashRecoveryMonths, 2) : Infinity
    };
  }

  function exportPrice(input) {
    const krwPerCurrency = Math.max(0.000001, finite(input.krwPerCurrency));
    const koreanRetail = Math.max(0, finite(input.koreanRetail));
    const supplyRate = clamp(input.supplyRate, 0, 1000);
    const cogs = Math.max(0, finite(input.cogs));
    const logisticsKrw = Math.max(0, finite(input.logisticsKrw));
    const fxBuffer = clamp(input.fxBuffer, 0, 100);
    const dutyRate = clamp(input.dutyRate, 0, 1000);
    const importerMargin = clamp(input.importerMargin, 0, 99.9);
    const retailerMargin = clamp(input.retailerMargin, 0, 99.9);
    const vatRate = clamp(input.localVatRate, 0, 100);
    const wholesaleKrw = koreanRetail * supplyRate / 100;
    const bufferedKrwPerCurrency = krwPerCurrency * (1 - fxBuffer / 100);
    const exportUnitPrice = wholesaleKrw / Math.max(0.000001, bufferedKrwPerCurrency);
    const landedCurrency = (exportUnitPrice + logisticsKrw / krwPerCurrency) * (1 + dutyRate / 100);
    const importerSell = landedCurrency / (1 - importerMargin / 100);
    const localRetailExVat = importerSell / (1 - retailerMargin / 100);
    const localRetailIncVat = localRetailExVat * (1 + vatRate / 100);
    const contributionKrw = wholesaleKrw - cogs - logisticsKrw;
    return {
      wholesaleKrw: round(wholesaleKrw, 2),
      exportUnitPrice: round(exportUnitPrice, 2),
      landedCurrency: round(landedCurrency, 2),
      importerSell: round(importerSell, 2),
      localRetailExVat: round(localRetailExVat, 2),
      localRetailIncVat: round(localRetailIncVat, 2),
      contributionKrw: round(contributionKrw, 2),
      contributionRate: wholesaleKrw > 0 ? round(contributionKrw / wholesaleKrw * 100, 2) : 0,
      costFloorCurrency: round((cogs + logisticsKrw) / bufferedKrwPerCurrency, 2)
    };
  }

  function influencerRoas(input) {
    const fee = Math.max(0, finite(input.fee));
    const giftedCogs = Math.max(0, finite(input.giftedCogs));
    const shipping = Math.max(0, finite(input.shipping));
    const production = Math.max(0, finite(input.production));
    const usageRights = Math.max(0, finite(input.usageRights));
    const views = Math.max(0, finite(input.views));
    const clicks = Math.max(0, finite(input.clicks));
    const orders = Math.max(0, finite(input.orders));
    const revenue = Math.max(0, finite(input.revenue));
    const grossMarginRate = clamp(input.grossMarginRate, 0, 100);
    const ltvMultiplier = Math.max(1, finite(input.ltvMultiplier, 1));
    const totalCost = fee + giftedCogs + shipping + production + usageRights;
    const adjustedRevenue = revenue * ltvMultiplier;
    const grossProfit = adjustedRevenue * grossMarginRate / 100;
    const netReturn = grossProfit - totalCost;
    const avgOrder = orders > 0 ? revenue / orders : Math.max(0, finite(input.averageOrder));
    const grossProfitPerOrder = avgOrder * grossMarginRate / 100 * ltvMultiplier;
    return {
      totalCost: round(totalCost, 2),
      adjustedRevenue: round(adjustedRevenue, 2),
      roas: totalCost > 0 ? round(adjustedRevenue / totalCost, 3) : 0,
      profitRoas: totalCost > 0 ? round(grossProfit / totalCost, 3) : 0,
      netReturn: round(netReturn, 2),
      cpm: views > 0 ? round(totalCost / views * 1000, 2) : 0,
      cpc: clicks > 0 ? round(totalCost / clicks, 2) : 0,
      cpa: orders > 0 ? round(totalCost / orders, 2) : 0,
      ctr: views > 0 ? round(clicks / views * 100, 3) : 0,
      conversionRate: clicks > 0 ? round(orders / clicks * 100, 3) : 0,
      breakEvenOrders: grossProfitPerOrder > 0 ? Math.ceil(totalCost / grossProfitPerOrder) : Infinity,
      breakEvenViews: orders > 0 && views > 0 && grossProfitPerOrder > 0
        ? Math.ceil((totalCost / grossProfitPerOrder) / (orders / views)) : Infinity
    };
  }

  function allergenConcentration({ ingredientPercent, allergenPercentInIngredient }) {
    const ingredient = clamp(ingredientPercent, 0, 100);
    const allergen = clamp(allergenPercentInIngredient, 0, 100);
    return round(ingredient * allergen / 100, 8);
  }

  function allergenStatus({ concentration, productType = 'leave-on' }) {
    const threshold = productType === 'rinse-off' ? 0.01 : 0.001;
    return { threshold, mustLabel: finite(concentration) > threshold };
  }

  function gtin13CheckDigit(first12) {
    const digits = String(first12 || '').replace(/\D/g, '');
    if (digits.length !== 12) throw new Error('체크디지트 계산에는 12자리 숫자가 필요합니다.');
    const sum = digits.split('').reduce((acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
    return String((10 - (sum % 10)) % 10);
  }

  function validateGtin13(gtin) {
    const digits = String(gtin || '').replace(/\D/g, '');
    return digits.length === 13 && gtin13CheckDigit(digits.slice(0, 12)) === digits.slice(-1);
  }

  function normalizeSku(parts) {
    return parts
      .filter(Boolean)
      .map((part) => String(part).trim().toUpperCase()
        .replace(/[^A-Z0-9가-힣]+/g, '-')
        .replace(/^-+|-+$/g, ''))
      .filter(Boolean)
      .join('-');
  }

  function lotCode({ prefix = 'FGT', productCode = 'PRODUCT', date = new Date(), sequence = 1 }) {
    const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : date;
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new Error('올바른 제조일을 입력하세요.');
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const product = normalizeSku([productCode]).slice(0, 18) || 'PRODUCT';
    return `${normalizeSku([prefix]) || 'LOT'}-${product}-${ymd}-${String(Math.max(1, Math.round(finite(sequence, 1)))).padStart(3, '0')}`;
  }

  return {
    finite,
    round,
    clamp,
    dilution,
    batchComposition,
    costMargin,
    moqScenario,
    exportPrice,
    influencerRoas,
    allergenConcentration,
    allergenStatus,
    gtin13CheckDigit,
    validateGtin13,
    normalizeSku,
    lotCode
  };
});
