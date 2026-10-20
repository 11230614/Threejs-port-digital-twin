import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { RoadSystem } = await vite.ssrLoadModule("/src/world/RoadSystem.ts");
  const scene = new THREE.Scene();
  const roads = new RoadSystem(scene);

  assert.throws(
    () => roads.createRoad({ id: "invalid", points: [new THREE.Vector3()] }),
    /requires at least two points/,
    "a road needs at least two points",
  );

  const road = roads.createRoad({
    id: "road-smoke",
    type: "AGV",
    points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 0, 0), new THREE.Vector3(20, 0, 20)],
    visualize: false,
    lanes: [{ id: "road-smoke-lane", offset: 0, direction: 1 }],
  });
  assert.equal(roads.getRoad("road-smoke"), road);
  assert.equal(roads.getPrimaryLane("road-smoke")?.id, "road-smoke-lane");
  assert.ok(roads.getLaneLength("road-smoke-lane") > 0);
  const midpoint = roads.getPointAt("road-smoke-lane", 0.5);
  assert.ok(midpoint && Number.isFinite(midpoint.x) && Number.isFinite(midpoint.z));
  const tangent = roads.getTangentAt("road-smoke-lane", 0.5);
  assert.ok(tangent && tangent.length() > 0);
  assert.ok(roads.getNearestU("road-smoke-lane", new THREE.Vector3(20, 0, 4)) > 0.35);
  assert.equal(roads.getPath("missing-road"), null);

  const intersection = roads.registerIntersection({
    id: "intersection-smoke",
    roadIds: ["road-smoke", "road-smoke"],
    position: new THREE.Vector3(10, 0, 0),
  });
  assert.deepEqual(intersection.roadIds, ["road-smoke", "road-smoke"]);
  assert.equal(roads.getIntersection("intersection-smoke")?.id, "intersection-smoke");
  assert.throws(
    () => roads.registerIntersection({ id: "bad-intersection", roadIds: ["missing", "road-smoke"], position: new THREE.Vector3() }),
    /requires at least two registered roads/,
  );

  const route = roads.createRoutePath([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 10)]);
  assert.match(route.roadId, /^ROUTE_\d{4}$/);
  assert.ok(route.length > 0);
  assert.equal(roads.removeRoad(route.roadId), true);
  assert.equal(roads.getRoad(route.roadId), null);
  assert.equal(roads.removeRoad(route.roadId), false);

  assert.equal(roads.removeRoad("road-smoke"), true);
  assert.equal(roads.getLane("road-smoke-lane"), null);
  assert.equal(roads.getRoad("road-smoke"), null);
  console.log("RoadSystem behavior checks passed (validation, lanes, paths, intersections, routes, cleanup).");
} finally {
  await vite.close();
}
