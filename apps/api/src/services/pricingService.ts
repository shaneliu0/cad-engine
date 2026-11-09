import type { CostBreakdown, Features, Geometry } from "../types.js";

export const MATERIAL_NAME: string = "6061 Aluminum";
const MATERIAL_DENSITY_G_PER_CM3: number = 2.7;
const GRAMS_PER_KG: number = 1000;
const MATERIAL_PRICE_USD_PER_KG: number = 5;

const MACHINE_RATE_USD_PER_HOUR: number = 100;
const SETUP_HOURS: number = 1.5;

const MM3_PER_CM3: number = 1000;
const MINUTES_PER_HOUR: number = 60;
const ROUGHING_RATE_CM3_PER_MINUTE: number = 20;
const FINISHING_RATE_CM2_PER_MINUTE: number = 20;
const MINUTES_PER_HOLE: number = 1;
const CUTTING_TIME_CALIBRATION: number = 1.01174;

const BASE_LEAD_TIME_DAYS: number = 5;
const PRODUCTION_HOURS_PER_DAY: number = 8;

const STABLE_SIGNIFICANT_DIGITS: number = 12;

export interface QuoteInput {
  geometry: Geometry;
  features: Features;
  quantity: number;
}

export interface QuoteCalculation {
  costBreakdown: CostBreakdown;
  leadTimeDays: number;
}

function withoutFloatNoise(value: number): number {
  return Number(value.toPrecision(STABLE_SIGNIFICANT_DIGITS));
}

function toCents(usd: number): number {
  return Math.round(withoutFloatNoise(usd * 100));
}

function stableCeil(value: number): number {
  return Math.ceil(withoutFloatNoise(value));
}

function quantityDiscount(quantity: number): number {
  if (quantity <= 5) {
    return 0;
  }
  if (quantity <= 20) {
    return 0.1;
  }
  return quantity <= 100 ? 0.2 : 0.3;
}

function cuttingHours(geometry: Geometry, features: Features): number {
  const { length, width, height } = geometry.bounding_box_mm;
  const boundingBoxCm3: number = (length * width * height) / MM3_PER_CM3;
  const removedCm3: number = Math.max(boundingBoxCm3 - geometry.volume_cm3, 0);
  const minutes: number =
    removedCm3 / ROUGHING_RATE_CM3_PER_MINUTE +
    geometry.surface_area_cm2 / FINISHING_RATE_CM2_PER_MINUTE +
    features.holes_detected * MINUTES_PER_HOLE;
  return (minutes * CUTTING_TIME_CALIBRATION) / MINUTES_PER_HOUR;
}

export function calculateQuote({ geometry, features, quantity }: QuoteInput): QuoteCalculation {
  const materialUsd: number =
    (geometry.volume_cm3 * MATERIAL_DENSITY_G_PER_CM3 * MATERIAL_PRICE_USD_PER_KG) / GRAMS_PER_KG;
  const discountedMachineHours: number =
    cuttingHours(geometry, features) * features.complexity_score * (1 - quantityDiscount(quantity));

  const materialCents: number = toCents(materialUsd);
  const machineCents: number = toCents(discountedMachineHours * MACHINE_RATE_USD_PER_HOUR);
  const setupCents: number = toCents((SETUP_HOURS * MACHINE_RATE_USD_PER_HOUR) / quantity);
  const totalCentsPerUnit: number = materialCents + machineCents + setupCents;

  const productionDays: number = stableCeil(
    (discountedMachineHours * quantity + SETUP_HOURS) / PRODUCTION_HOURS_PER_DAY,
  );
  const complexityBufferDays: number = stableCeil(features.complexity_score - 1);

  return {
    costBreakdown: {
      material_cost_per_unit: materialCents / 100,
      machine_time_cost_per_unit: machineCents / 100,
      setup_cost_per_unit: setupCents / 100,
      total_cost_per_unit: totalCentsPerUnit / 100,
      total_order_cost: (totalCentsPerUnit * quantity) / 100,
    },
    leadTimeDays: BASE_LEAD_TIME_DAYS + productionDays + complexityBufferDays,
  };
}
