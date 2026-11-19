// Unit tests for the F01 checks and geometry in js/checks.js.
// Run with: node --test tests/   (Node 20 or newer, no install needed)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/checks.js";
import { DEMO_FARMERS } from "../js/demo-data.js";

/* ---------- fixtures ---------- */
// A square of side `m` metres whose south-west corner is at (lon, lat), closed ring not repeated.
const square = (lon, lat, m) => {
  const dLat = m / 110540, dLon = m / (111320 * Math.cos(lat * Math.PI / 180));
  return [[lon, lat], [lon + dLon, lat], [lon + dLon, lat + dLat], [lon, lat + dLat]];
};
// A plot with every piece of evidence filled in, so only the thing under test raises an issue.
const goodPlot = (o = {}) => ({
  pid: "P01", country: "Cameroon", area: "2", lat: "4.168342", lon: "11.532871", polygon: null,
  defoEvidence: "Satellite review", defoDate: "2026-10-01", legalEvidence: "x", rightEvidence: "x", linkEvidence: "x",
  mapDate: "2026-10-28", provider: "SAIC", fileVersion: "1", harvest: "Main crop", expectedKg: "1000", ...o,
});
const goodFarmer = (o = {}) => ({
  id: "F0001", name: "Test Farmer", village: "Nkolmelen", idType: "CNI", idNumber: "123", idViewedOn: "2026-11-01",
  photoPath: "a.jpg", phone: "+237", confirmDate: "2026-11-01", type: "Farmer", plots: [goodPlot()], ...o,
});
const keys = iss => iss.map(i => i.k).sort();
const issuesFor = (p, others = []) => {
  const f = goodFarmer({ plots: [p] });
  const geoms = [{ f, p }, ...others.map((q, i) => ({ f: goodFarmer({ id: "F09" + i }), p: q }))];
  return C.plotIssues(f, p, geoms);
};

/* ---------- geometry ---------- */
describe("geometry", () => {
  test("polyAreaHa: a 100 m square is 1 ha", () => {
    assert.ok(Math.abs(C.polyAreaHa(square(11.5, 4.1, 100)) - 1) < 0.01);
  });
  test("polyAreaHa: a 200 m square is 4 ha, and winding order does not matter", () => {
    const sq = square(11.5, 4.1, 200);
    assert.ok(Math.abs(C.polyAreaHa(sq) - 4) < 0.02);
    assert.ok(Math.abs(C.polyAreaHa([...sq].reverse()) - 4) < 0.02);
  });
  test("polyAreaHa: fewer than 3 points is 0", () => {
    assert.equal(C.polyAreaHa(null), 0);
    assert.equal(C.polyAreaHa([[1, 1], [2, 2]]), 0);
  });
  test("distM: 0.001° of latitude is about 110 m", () => {
    assert.ok(Math.abs(C.distM([11.5, 4.1], [11.5, 4.101]) - 110.54) < 0.1);
  });
  test("inPoly: inside and outside", () => {
    const sq = square(11.5, 4.1, 100);
    assert.equal(C.inPoly(C.centroid(sq), sq), true);
    assert.equal(C.inPoly([11.6, 4.1], sq), false);
  });
  test("polysOverlap: overlapping, contained, touching-free and far apart", () => {
    const a = square(11.5, 4.1, 100);
    assert.equal(C.polysOverlap(a, square(11.5004, 4.1004, 100)), true, "corners overlap");
    assert.equal(C.polysOverlap(a, square(11.5002, 4.1002, 20)), true, "one inside the other");
    assert.equal(C.polysOverlap(square(11.5002, 4.1002, 20), a), true, "other way round");
    assert.equal(C.polysOverlap(a, square(11.5011, 4.1, 100)), false, "side by side with a gap");
    assert.equal(C.polysOverlap(a, square(12, 5, 100)), false, "far apart");
  });
  test("decimals counts digits after the point", () => {
    assert.equal(C.decimals("4.123456"), 6);
    assert.equal(C.decimals("4.12"), 2);
    assert.equal(C.decimals("4"), 0);
    assert.equal(C.decimals(""), 0);
  });
  test("norm ignores case, accents and extra spaces", () => {
    assert.equal(C.norm("  Ébolowa   Centre "), "ebolowa centre");
  });
});

/* ---------- parseGeometry ---------- */
describe("parseGeometry", () => {
  const ring = [[11.5, 4.1], [11.501, 4.1], [11.501, 4.101], [11.5, 4.101]];
  test("empty text means no polygon", () => {
    assert.deepEqual(C.parseGeometry(""), { polygon: null });
  });
  test("GeoJSON Polygon, closing point removed", () => {
    const r = C.parseGeometry(JSON.stringify({ type: "Polygon", coordinates: [[...ring, ring[0]]] }));
    assert.deepEqual(r.polygon, ring);
  });
  test("GeoJSON Feature and FeatureCollection", () => {
    const feat = { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } };
    assert.deepEqual(C.parseGeometry(JSON.stringify(feat)).polygon, ring);
    assert.deepEqual(C.parseGeometry(JSON.stringify({ type: "FeatureCollection", features: [feat] })).polygon, ring);
  });
  test("GeoJSON MultiPolygon keeps the first polygon and says so", () => {
    const r = C.parseGeometry(JSON.stringify({ type: "MultiPolygon", coordinates: [[ring], [ring]] }));
    assert.deepEqual(r.polygon, ring);
    assert.match(r.note, /first polygon/);
  });
  test("GeoJSON Point becomes lat/lon, not a polygon", () => {
    const r = C.parseGeometry(JSON.stringify({ type: "Point", coordinates: [11.532871, 4.168342] }));
    assert.deepEqual(r, { point: { lat: "4.168342", lon: "11.532871" }, polygon: null });
  });
  test("KML <coordinates> (lon,lat,alt)", () => {
    const kml = `<Polygon><coordinates>${ring.map(c => c.join(",") + ",0").join(" ")}</coordinates></Polygon>`;
    assert.deepEqual(C.parseGeometry(kml).polygon, ring);
  });
  test("plain text is lat lon per line, stored as [lon, lat]", () => {
    const txt = ring.map(([lon, lat]) => `${lat} ${lon}`).join("\n");
    assert.deepEqual(C.parseGeometry(txt).polygon, ring);
    const txt2 = ring.map(([lon, lat]) => `${lat}, ${lon}`).join("\n");
    assert.deepEqual(C.parseGeometry(txt2).polygon, ring);
  });
  test("errors: bad JSON, unreadable line, too few corners, nothing usable", () => {
    assert.match(C.parseGeometry("{oops").error, /^GeoJSON:/);
    assert.match(C.parseGeometry("4.1 11.5\nhello").error, /Cannot read the line/);
    assert.match(C.parseGeometry("4.1 11.5\n4.2 11.6").error, /at least 3/);
    assert.match(C.parseGeometry(JSON.stringify({ type: "LineString", coordinates: [] })).error, /No Polygon or Point/);
  });
  test("error messages in French", () => {
    assert.match(C.parseGeometry("4.1 11.5\n4.2 11.6", "fr").error, /au moins 3/);
  });
});

/* ---------- plot checks ---------- */
describe("plotIssues (F01 Sheet B)", () => {
  test("a complete plot with a precise point raises nothing", () => {
    assert.deepEqual(issuesFor(goodPlot()), []);
  });
  test("no point and no polygon", () => {
    assert.ok(keys(issuesFor(goodPlot({ lat: "", lon: "" }))).includes("i.no_geo"));
  });
  test("above 4 ha a polygon is required; exactly 4 ha is fine", () => {
    assert.ok(keys(issuesFor(goodPlot({ area: "4.01" }))).includes("i.poly_req"));
    assert.ok(!keys(issuesFor(goodPlot({ area: "4" }))).includes("i.poly_req"));
  });
  test("point needs 6 decimals on both lat and lon", () => {
    assert.ok(keys(issuesFor(goodPlot({ lat: "4.16834" }))).includes("i.decimals"));
    assert.ok(keys(issuesFor(goodPlot({ lon: "11.53" }))).includes("i.decimals"));
  });
  test("point outside Cameroon, and swapped lat/lon", () => {
    assert.ok(keys(issuesFor(goodPlot({ lat: "48.856613", lon: "2.352222" }))).includes("i.outside"));
  });
  test("swapped coordinates are recognised when the swap lands inside Cameroon", () => {
    // lat 14.5 is north of Cameroon, but read the other way round (lat 10, lon 14.5) the point is inside
    assert.ok(keys(issuesFor(goodPlot({ lat: "14.500000", lon: "10.000000" }))).includes("i.swapped"));
  });
  test("country check only runs for Cameroon", () => {
    assert.ok(!keys(issuesFor(goodPlot({ country: "Côte d'Ivoire", lat: "6.800000", lon: "-5.300000" }))).includes("i.outside"));
  });
  test("mapped polygon area more than 20 % off the declared area", () => {
    const poly = square(11.5, 4.1, 100); // 1 ha
    assert.ok(keys(issuesFor(goodPlot({ lat: "", lon: "", polygon: poly, area: "1.5" }))).includes("i.area_diff"));
    assert.ok(!keys(issuesFor(goodPlot({ lat: "", lon: "", polygon: poly, area: "1.1" }))).includes("i.area_diff"));
  });
  test("two overlapping polygons are both flagged", () => {
    const a = goodPlot({ lat: "", lon: "", area: "1", polygon: square(11.5, 4.1, 100) });
    const b = goodPlot({ pid: "P02", lat: "", lon: "", area: "1", polygon: square(11.5004, 4.1004, 100) });
    assert.ok(keys(issuesFor(a, [b])).includes("i.overlap"));
    assert.ok(keys(issuesFor(b, [a])).includes("i.overlap"));
  });
  test("a point inside another farmer's polygon", () => {
    const poly = goodPlot({ lat: "", lon: "", area: "1", polygon: square(11.5, 4.1, 100) });
    const pt = goodPlot({ pid: "P02", lat: "4.100400", lon: "11.500400" });
    assert.ok(keys(issuesFor(pt, [poly])).includes("i.in_other"));
    assert.ok(keys(issuesFor(poly, [pt])).includes("i.pt_in_poly"));
  });
  test("two points closer than 10 m are possible duplicates", () => {
    const a = goodPlot({ lat: "4.100000", lon: "11.500000" });
    const near = goodPlot({ pid: "P02", lat: "4.100050", lon: "11.500000" }); // ~5.5 m
    const far = goodPlot({ pid: "P03", lat: "4.100200", lon: "11.500000" });  // ~22 m
    assert.ok(keys(issuesFor(a, [near])).includes("i.dup_pt"));
    assert.ok(!keys(issuesFor(a, [far])).includes("i.dup_pt"));
  });
  test("a plot is never compared with itself", () => {
    const p = goodPlot({ lat: "", lon: "", area: "1", polygon: square(11.5, 4.1, 100) });
    assert.ok(!keys(issuesFor(p, [p])).includes("i.overlap"));
  });
  test("deforestation evidence and date are both required", () => {
    assert.ok(keys(issuesFor(goodPlot({ defoDate: "" }))).includes("i.defo"));
    assert.ok(keys(issuesFor(goodPlot({ defoEvidence: "" }))).includes("i.defo"));
  });
  test("missing evidence and mapping details are warnings", () => {
    const iss = issuesFor(goodPlot({ legalEvidence: "", rightEvidence: "", linkEvidence: "", harvest: "", provider: "", area: "" }));
    for (const k of ["i.legal", "i.right", "i.link", "i.harvest", "i.mapping", "i.no_area"])
      assert.equal(iss.find(i => i.k === k)?.lv, "warn", k);
  });
  test("yield above 1000 kg/ha is flagged; 1000 is not", () => {
    assert.ok(keys(issuesFor(goodPlot({ area: "2", expectedKg: "2001" }))).includes("i.yield"));
    assert.ok(!keys(issuesFor(goodPlot({ area: "2", expectedKg: "2000" }))).includes("i.yield"));
  });
  test("Hold and Rejected decisions block the plot", () => {
    assert.equal(issuesFor(goodPlot({ decision: "Hold" })).find(i => i.k === "i.dec_hold").lv, "bad");
    assert.equal(issuesFor(goodPlot({ decision: "Rejected" })).find(i => i.k === "i.dec_rej").lv, "bad");
  });
});

describe("plotStatus", () => {
  const ok = { decision: "Approved", chkFormat: true, chkLink: true, chkRisk: true };
  test("any blocking issue means hold", () => {
    assert.equal(C.plotStatus(ok, [{ lv: "bad" }]), "hold");
  });
  test("verified needs approval and all three checks", () => {
    assert.equal(C.plotStatus(ok, [{ lv: "warn" }]), "verified");
    assert.equal(C.plotStatus({ ...ok, chkRisk: false }, []), "pending");
    assert.equal(C.plotStatus({ ...ok, decision: "" }, []), "pending");
  });
});

/* ---------- farmer checks ---------- */
describe("farmerIssues (F01 Sheet A)", () => {
  test("a complete farmer raises nothing", () => {
    assert.deepEqual(C.farmerIssues(goodFarmer(), []), []);
  });
  test("missing ID, missing plots", () => {
    assert.ok(keys(C.farmerIssues(goodFarmer({ idNumber: "" }))).includes("i.no_id"));
    assert.ok(keys(C.farmerIssues(goodFarmer({ plots: [] }))).includes("i.no_plots"));
  });
  test("ID not yet viewed is a warning only when an ID exists", () => {
    assert.ok(keys(C.farmerIssues(goodFarmer({ idViewedOn: "" }))).includes("i.id_viewed"));
    assert.ok(!keys(C.farmerIssues(goodFarmer({ idViewedOn: "", idNumber: "" }))).includes("i.id_viewed"));
  });
  test("non-farmer suppliers need a representative", () => {
    assert.ok(keys(C.farmerIssues(goodFarmer({ type: "Cooperative" }))).includes("i.no_rep"));
    assert.ok(!keys(C.farmerIssues(goodFarmer({ type: "Cooperative", representative: "A" }))).includes("i.no_rep"));
  });
  test("same ID number as another farmer blocks; matching ignores case and spaces", () => {
    const other = goodFarmer({ id: "F0002", idNumber: " 123 " });
    assert.equal(C.farmerIssues(goodFarmer(), [other]).find(i => i.k === "i.same_id")?.p.o, "F0002");
  });
  test("same name and village is a possible duplicate", () => {
    const other = goodFarmer({ id: "F0002", idNumber: "999", name: "TEST  farmer", village: "nkolmelen" });
    assert.equal(C.farmerIssues(goodFarmer(), [other]).find(i => i.k === "i.dup_name")?.lv, "warn");
  });
  test("archived farmers and the farmer itself are ignored for duplicates", () => {
    const f = goodFarmer();
    assert.deepEqual(C.farmerIssues(f, [f, goodFarmer({ id: "F0002", archived: true })]), []);
  });
});

/* ---------- overall status ---------- */
describe("evaluate", () => {
  const approved = goodFarmer({
    decision: "Approved", chkIdentity: true, chkRep: true, chkPlots: true,
    plots: [goodPlot({ decision: "Approved", chkFormat: true, chkLink: true, chkRisk: true })],
  });
  const run = f => C.evaluate(f, C.allGeoms([f]), [f]);
  test("fully approved farmer with verified plots is verified", () => {
    assert.equal(run(approved).status, "verified");
  });
  test("one plot on hold puts the farmer on hold", () => {
    assert.equal(run({ ...approved, plots: [{ ...approved.plots[0], defoDate: "" }] }).status, "hold");
  });
  test("approved farmer with an unverified plot stays pending", () => {
    assert.equal(run({ ...approved, plots: [{ ...approved.plots[0], chkRisk: false }] }).status, "pending");
  });
  test("archived wins over everything", () => {
    assert.equal(run({ ...approved, archived: true }).status, "archived");
  });
  test("allGeoms skips archived farmers", () => {
    assert.equal(C.allGeoms([approved, { ...approved, id: "F0002", archived: true }]).length, 1);
  });
  test("demo data evaluates without errors", () => {
    const geoms = C.allGeoms(DEMO_FARMERS);
    for (const f of DEMO_FARMERS) assert.ok(["verified", "pending", "hold", "archived"].includes(C.evaluate(f, geoms, DEMO_FARMERS).status));
  });
});
