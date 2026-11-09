export type QuoteStatus = "quoted" | "reviewed" | "archived";

export interface Quote {
  file: string;
  quantity: number;
  material: string;
  geometry: {
    bounding_box_mm: { length: number; width: number; height: number };
    volume_cm3: number;
    surface_area_cm2: number;
  };
  features: {
    holes_detected: number;
    face_count: number;
    edge_count: number;
    complexity_score: number;
  };
  cost_breakdown: {
    material_cost_per_unit: number;
    machine_time_cost_per_unit: number;
    setup_cost_per_unit: number;
    total_cost_per_unit: number;
    total_order_cost: number;
  };
  lead_time_days: number;
  id: number;
  status: QuoteStatus;
  created_at: string;
}
