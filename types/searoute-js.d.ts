declare module "searoute-js" {
  interface SeaPoint {
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: { type: "Point"; coordinates: [number, number] };
  }
  interface SeaLineString {
    type: "Feature";
    properties: { units?: string; length?: number } & Record<string, unknown>;
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }
  type SeaUnits = "nm" | "km" | "miles" | "degrees" | "radians";
  export default function searoute(
    origin: SeaPoint,
    destination: SeaPoint,
    units?: SeaUnits,
  ): SeaLineString | null;
}
